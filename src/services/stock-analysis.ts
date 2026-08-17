import { MARKET_SYMBOLS, STOCK_CATALOG } from '@/config';
import { getRpcBaseUrl } from '@/services/rpc-client';
import type { AnalyzeStockResponse } from '@/generated/client/worldmonitor/market/v1/service_client';
import {
  getCatalogSelection,
  getMarketWatchlistEntries,
  resolveEffectiveMarketWatchlist,
} from '@/services/market-watchlist';
import { runThrottledTargetRequests } from '@/services/throttled-target-requests';
import { premiumFetch } from '@/services/premium-fetch';
import { isProUser } from '@/services/widget-store';
import {
  selectStockAnalysisTargets,
  type StockAnalysisTarget,
} from '@/services/stock-analysis-targets';
import { MarketServiceClient } from '@/services/generated-rpc-clients';
import { hasUserAiKey, generateStructuredCompletion } from '@/services/user-ai-keys';
import { fetchMultipleStocks } from '@/services/market';

const client = new MarketServiceClient(getRpcBaseUrl(), { fetch: premiumFetch });

export type StockAnalysisResult = AnalyzeStockResponse;

export {
  isAnalyzableSymbol,
  selectStockAnalysisTargets,
  STOCK_ANALYSIS_FREE_LIMIT,
  STOCK_ANALYSIS_PRO_LIMIT,
} from '@/services/stock-analysis-targets';
export type { StockAnalysisTarget } from '@/services/stock-analysis-targets';

/**
 * Tier-aware watchlist resolution: the user's analysable picks lead, then the
 * panel is topped up with default symbols. `limitOverride` only shrinks the
 * resolved cap — callers pass it to keep dependent fetches aligned with an
 * already-resolved target list. See selectStockAnalysisTargets for the rules.
 */
export function getStockAnalysisTargets(limitOverride?: number): StockAnalysisTarget[] {
  const resolved = resolveEffectiveMarketWatchlist(
    STOCK_CATALOG,
    MARKET_SYMBOLS,
    getCatalogSelection(),
    getMarketWatchlistEntries(),
  );
  // Searchable custom entries intentionally lead premium targets. A persisted
  // catalog subset is also a user selection (and therefore sizes the PRO cap),
  // while the untouched default universe preserves current-main's four-card
  // baseline when the user has made no catalog choice.
  const userPicks = resolved.usesCatalogSelection
    ? [...resolved.customEntries, ...resolved.baseSymbols]
    : resolved.customEntries;
  return selectStockAnalysisTargets(userPicks, resolved.symbols, {
    isPro: isProUser(),
    limitOverride,
  });
}

export async function fetchStockAnalysesForTargets(targets: StockAnalysisTarget[]): Promise<StockAnalysisResult[]> {
  return runThrottledTargetRequests(targets, async (target) => {
    return client.analyzeStock({
      symbol: target.symbol,
      name: target.name,
        includeNews: true,
    });
  });
}

export async function fetchStockAnalyses(limitOverride?: number): Promise<StockAnalysisResult[]> {
  return fetchStockAnalysesForTargets(getStockAnalysisTargets(limitOverride));
}

// BYOK results are tagged with this provider so StockAnalysisPanel's
// renderCard can skip the technical-indicator grid (MA/RSI/volume/trend)
// instead of showing fabricated zeros for numbers no free source provides.
export const BYOK_STOCK_PROVIDER = 'user-key';

/**
 * Client-side fallback for non-premium users: unlike Deduction/country-brief/
 * regional-intelligence, this can't be a pure LLM call — AnalyzeStockResponse
 * mixes real computed technicals (MA/RSI/MACD from price history) with LLM
 * narrative, and the technicals need Yahoo Finance price history that's only
 * reachable server-side (no CORS for browser JS). So: real current price +
 * change from WorldMonitor's own free, non-premium quote endpoint
 * (list-market-quotes — same one the Markets panel uses for every visitor),
 * LLM narrative on top of that, technical fields left at their zero-value
 * default and never rendered (see BYOK_STOCK_PROVIDER above) — no fabricated
 * numbers reach the UI.
 */
export async function generateStockAnalysisFromUserKey(target: StockAnalysisTarget): Promise<StockAnalysisResult | null> {
  if (!hasUserAiKey()) return null;

  const quoteResult = await fetchMultipleStocks([target]).catch(() => null);
  const quote = quoteResult?.data.find(q => q.symbol === target.symbol);
  if (!quote || quote.price == null) return null;

  const systemPrompt = `You are a markets analyst. Given a stock's name and its current real price/change, write a short read.
Respond ONLY with a JSON object: { "summary": string, "action": "BUY"|"SELL"|"HOLD", "confidence": "HIGH"|"MEDIUM"|"LOW", "whyNow": string, "bullishFactors": string[], "riskFactors": string[] }.
summary and whyNow are 1-2 sentences each. bullishFactors/riskFactors are 1-3 short items each. You have ONLY the price/change given — do not invent specific technical indicators, news events, or figures not given to you. This is not financial advice.`;
  const userPrompt = `${target.name} (${target.symbol}): $${quote.price}, ${quote.change != null ? `${quote.change >= 0 ? '+' : ''}${quote.change}%` : 'change unknown'}`;

  let parsed: { summary?: string; action?: string; confidence?: string; whyNow?: string; bullishFactors?: string[]; riskFactors?: string[] };
  try {
    parsed = await generateStructuredCompletion(systemPrompt, userPrompt) as typeof parsed;
  } catch (err) {
    console.warn('[StockAnalysis] User-key generation failed:', err);
    return null;
  }

  const now = new Date().toISOString();
  return {
    available: true,
    symbol: target.symbol,
    name: target.name,
    display: target.display,
    currency: 'USD',
    currentPrice: quote.price,
    changePercent: quote.change ?? 0,
    signalScore: 0,
    signal: parsed.action ?? 'HOLD',
    trendStatus: '', volumeStatus: '', macdStatus: '', rsiStatus: '',
    summary: parsed.summary?.trim() || 'No summary available.',
    action: parsed.action ?? 'HOLD',
    confidence: parsed.confidence ?? 'LOW',
    technicalSummary: '', newsSummary: '',
    whyNow: parsed.whyNow?.trim() || '',
    bullishFactors: (parsed.bullishFactors ?? []).filter(f => f?.trim()).slice(0, 3),
    riskFactors: (parsed.riskFactors ?? []).filter(f => f?.trim()).slice(0, 3),
    supportLevels: [], resistanceLevels: [], headlines: [],
    ma5: 0, ma10: 0, ma20: 0, ma60: 0, biasMa5: 0, biasMa10: 0, biasMa20: 0,
    volumeRatio5d: 0, rsi12: 0, macdDif: 0, macdDea: 0, macdBar: 0,
    provider: BYOK_STOCK_PROVIDER, model: '', fallback: true, newsSearched: false,
    generatedAt: now, analysisId: `byok-${target.symbol}-${Date.now()}`, analysisAt: Date.now(),
    stopLoss: 0, takeProfit: 0, engineVersion: 'byok-v1',
    recentUpgrades: [], dividendYield: 0, trailingAnnualDividendRate: 0, exDividendDate: 0,
    dividendFrequency: '', dividendCagr: 0, marketSession: '',
    compositeScore: 0, realizedVolatility: 0, atr: 0, maxDrawdown: 0,
    ratingSignal: parsed.action ?? 'HOLD', ratingSummary: parsed.summary?.trim() || '',
    ratingAction: parsed.action ?? 'HOLD', ratingConfidence: parsed.confidence ?? 'LOW',
    ratingWhyNow: parsed.whyNow?.trim() || '',
    ratingBullishFactors: (parsed.bullishFactors ?? []).filter(f => f?.trim()).slice(0, 3),
    ratingRiskFactors: (parsed.riskFactors ?? []).filter(f => f?.trim()).slice(0, 3),
  };
}

/** Caps BYOK calls to a handful of symbols — one Groq/OpenRouter request per
 * symbol, sequential, against the user's own free-tier rate limit. */
export const BYOK_STOCK_ANALYSIS_LIMIT = 3;

export async function generateStockAnalysesFromUserKey(): Promise<StockAnalysisResult[]> {
  const targets = getStockAnalysisTargets(BYOK_STOCK_ANALYSIS_LIMIT);
  const results: StockAnalysisResult[] = [];
  for (const target of targets) {
    const r = await generateStockAnalysisFromUserKey(target);
    if (r) results.push(r);
  }
  return results;
}
