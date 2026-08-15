import { toApiUrl } from '@/services/runtime';
import { premiumFetch } from '@/services/premium-fetch';
import { getHydratedData } from '@/services/bootstrap';
import { hasUserAiKey, generateStructuredCompletion } from '@/services/user-ai-keys';
import type { NewsItem } from '@/types';

export interface TransmissionNode {
  node: string;
  impactType: string;
  logic: string;
}

export interface MarketImplicationCard {
  ticker: string;
  name: string;
  direction: string;
  timeframe: string;
  confidence: string;
  title: string;
  narrative: string;
  riskCaveat: string;
  driver: string;
  transmissionChain?: TransmissionNode[];
}

export interface MarketImplicationsData {
  cards: MarketImplicationCard[];
  degraded: boolean;
  emptyReason: string;
  generatedAt: string;
}

export function normalizeCard(raw: Record<string, unknown>): MarketImplicationCard {
  const chain = Array.isArray(raw.transmissionChain)
    ? (raw.transmissionChain as Array<Record<string, unknown>>).map(n => ({
        node: String(n.node ?? ''),
        impactType: String(n.impactType ?? ''),
        logic: String(n.logic ?? ''),
      }))
    : Array.isArray(raw.transmission_chain)
      ? (raw.transmission_chain as Array<Record<string, unknown>>).map(n => ({
          node: String(n.node ?? ''),
          impactType: String(n.impact_type ?? ''),
          logic: String(n.logic ?? ''),
        }))
      : [];
  return {
    ticker: String(raw.ticker ?? ''),
    name: String(raw.name ?? ''),
    direction: String(raw.direction ?? ''),
    timeframe: String(raw.timeframe ?? ''),
    confidence: String(raw.confidence ?? ''),
    title: String(raw.title ?? ''),
    narrative: String(raw.narrative ?? ''),
    riskCaveat: String(raw.riskCaveat ?? raw.risk_caveat ?? ''),
    driver: String(raw.driver ?? ''),
    transmissionChain: chain,
  };
}

// Cache keyed by frameworkId ('' = no framework). Avoids 100 users × 1 API call
// when all have the same framework selected — server serves from its own Redis key.
const cache = new Map<string, { data: MarketImplicationsData; cachedAt: number }>();
const CACHE_TTL = 10 * 60 * 1000;

export function getCachedMarketImplications(): MarketImplicationsData | null {
  return cache.get('')?.data ?? null;
}

export async function fetchMarketImplications(frameworkId = ''): Promise<MarketImplicationsData | null> {
  const now = Date.now();
  const cached = cache.get(frameworkId);
  if (cached && !cached.data.degraded && now - cached.cachedAt < CACHE_TTL) return cached.data;

  if (!frameworkId) {
    const hydrated = getHydratedData('marketImplications') as { cards?: unknown[]; degraded?: boolean; emptyReason?: string; generatedAt?: string } | undefined;
    if (hydrated?.cards && Array.isArray(hydrated.cards) && hydrated.cards.length > 0 && !hydrated.degraded) {
      const data: MarketImplicationsData = {
        cards: hydrated.cards.map(c => normalizeCard(c as Record<string, unknown>)),
        degraded: false,
        emptyReason: hydrated.emptyReason ?? '',
        generatedAt: hydrated.generatedAt ?? '',
      };
      cache.set('', { data, cachedAt: now });
      return data;
    }
  }

  try {
    const url = new URL(toApiUrl('/api/intelligence/v1/list-market-implications'));
    if (frameworkId) url.searchParams.set('frameworkId', frameworkId);
    // list-market-implications is a PREMIUM_RPC_PATH; a bare fetch still picked
    // up the Clerk bearer from the global patch but skipped reportServerError,
    // so its 503s were invisible in Sentry. The 15s budget comfortably covers a
    // first attempt plus the server's 5s Retry-After and the replay.
    const resp = await premiumFetch(url.toString(), {
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return cached?.data ?? null;

    const raw = (await resp.json()) as { cards?: unknown[]; degraded?: boolean; emptyReason?: string; generatedAt?: string };
    if (!Array.isArray(raw.cards)) return cached?.data ?? null;

    const data: MarketImplicationsData = {
      cards: raw.cards.map(c => normalizeCard(c as Record<string, unknown>)),
      degraded: raw.degraded ?? false,
      emptyReason: raw.emptyReason ?? '',
      generatedAt: raw.generatedAt ?? '',
    };
    cache.set(frameworkId, { data, cachedAt: now });
    return data;
  } catch {
    return cached?.data ?? null;
  }
}

const SYSTEM_PROMPT = `You are a markets analyst turning geopolitical/macro news into tradeable implications.
Given a list of recent headlines, output 3-6 market implication cards as JSON.
Respond ONLY with a JSON object: { "cards": [ { "ticker": string, "name": string, "direction": "LONG"|"SHORT"|"HEDGE", "timeframe": string, "confidence": "HIGH"|"MEDIUM"|"LOW", "title": string, "narrative": string, "riskCaveat": string, "driver": string } ] }.
Use real, liquid tickers (equities, ETFs, commodities, currencies). Keep narrative to 1-2 sentences. Be specific about the causal driver. This is not financial advice — riskCaveat must always note real uncertainty.`;

/**
 * Client-side fallback for non-premium users: generates the same
 * MarketImplicationsData shape as the server RPC, but from the user's own
 * Groq/OpenRouter key (see services/user-ai-keys.ts) instead of
 * WorldMonitor's paid backend. Returns null if no user key is configured or
 * generation fails — callers should treat that the same as "unavailable".
 */
export async function generateMarketImplicationsFromUserKey(
  headlines: NewsItem[],
): Promise<MarketImplicationsData | null> {
  if (!hasUserAiKey()) return null;
  const top = headlines.slice(0, 25).map(h => `- ${h.title} (${h.source})`).join('\n');
  if (!top) return null;

  try {
    const parsed = await generateStructuredCompletion(SYSTEM_PROMPT, `Recent headlines:\n${top}`) as { cards?: unknown[] };
    if (!Array.isArray(parsed.cards) || parsed.cards.length === 0) return null;
    return {
      cards: parsed.cards.map(c => normalizeCard(c as Record<string, unknown>)),
      degraded: false,
      emptyReason: '',
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('[MarketImplications] User-key generation failed:', err);
    return null;
  }
}
