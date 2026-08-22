import type { GetFoodStocksResponse, GetResilienceRankingResponse, GetResilienceScoreResponse, ResilienceDomain, ResilienceDimension, ResilienceRankingItem, ScoreInterval } from '@/generated/client/worldmonitor/resilience/v1/service_client';
import { getRpcBaseUrl } from '@/services/rpc-client';
import { premiumFetch } from '@/services/premium-fetch';
import { ResilienceServiceClient } from '@/services/generated-rpc-clients';
import { hasPremiumAccess } from '@/services/panel-gating';
import { fetchCachedRiskScores, getCachedCountryScore } from '@/services/cached-risk-scores';
import { getNationalDebtData } from '@/services/economic';
import { iso3ToIso2Code } from '@/services/country-geometry';

export type ResilienceScoreResponse = GetResilienceScoreResponse & {
  // Set only by generateCompositeResilienceScore below, never present on a
  // real WorldMonitor response. Lets the widget disclose that a given score
  // is SITREP's own composite, not WorldMonitor's proprietary methodology --
  // see docs/tasks/abdullah/03-resilience-score.md's verify requirement.
  compositeSources?: string[];
};
export type ResilienceRankingResponse = GetResilienceRankingResponse;
export type FoodStocksResponse = GetFoodStocksResponse;
export type { ResilienceDomain, ResilienceDimension, ResilienceRankingItem, ScoreInterval };

let _client: InstanceType<typeof ResilienceServiceClient> | null = null;

function getClient(): InstanceType<typeof ResilienceServiceClient> {
  if (!_client) {
    // Resilience RPCs are in PREMIUM_RPC_PATHS, so the global fetch patch
    // was already attaching their Clerk bearer — but routing around
    // `premiumFetch` also routed around `reportServerError`, which is why a real
    // `billing_verification_503` on get-resilience-ranking (2026-08-08, 2026-08-10)
    // never opened a Sentry issue the way its market and intelligence siblings did.
    _client = new ResilienceServiceClient(getRpcBaseUrl(), {
      fetch: premiumFetch,
    });
  }
  return _client;
}

function normalizeCountryCode(countryCode: string): string {
  const normalized = countryCode.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : '';
}

function resilienceLevelFromScore(score: number): string {
  if (score >= 80) return 'very_high';
  if (score >= 60) return 'high';
  if (score >= 40) return 'moderate';
  if (score >= 20) return 'low';
  return 'very_low';
}

function freshDimension(id: string, score: number, observedAtMs: number): ResilienceDimension {
  return {
    id,
    score,
    coverage: 1,
    observedWeight: 1,
    imputedWeight: 0,
    imputationClass: '',
    freshness: { lastObservedAtMs: String(observedAtMs), staleness: 'fresh' },
  };
}

/**
 * SITREP's homegrown resilience composite. WorldMonitor's real resilience
 * score (server/worldmonitor/resilience/v1/) is proprietary 6-domain,
 * 23-dimension modeling -- not a data feed with a free drop-in replacement
 * (see docs/tasks/abdullah/03-resilience-score.md). This combines two
 * signals already live and free on this fork instead of approximating that
 * private methodology:
 *   - CII instability score (intelligence/v1/get-risk-scores, TIER1
 *     countries only), inverted into a resilience reading.
 *   - National debt-to-GDP (World Bank alt-source, services/economic),
 *     inverted -- lower leverage reads as more resilient.
 * Only domains with a real signal are included; every other WorldMonitor
 * domain is simply omitted rather than filled with an invented score.
 * Returns null when neither signal covers this country, so the caller
 * can fall back to whatever real access it has.
 */
async function generateCompositeResilienceScore(countryCode: string): Promise<ResilienceScoreResponse | null> {
  if (!countryCode) return null;

  const domains: ResilienceDomain[] = [];
  const sources: string[] = [];
  const subScores: number[] = [];

  try {
    await fetchCachedRiskScores();
    const cii = getCachedCountryScore(countryCode);
    if (cii) {
      const resilienceFromCii = Math.max(0, Math.min(100, 100 - cii.score));
      const observedAtMs = cii.lastUpdated ? cii.lastUpdated.getTime() : Date.now();
      domains.push({
        id: 'social-governance',
        score: resilienceFromCii,
        weight: 1,
        dimensions: [freshDimension('borderSecurity', resilienceFromCii, observedAtMs)],
      });
      subScores.push(resilienceFromCii);
      sources.push('CII instability index (inverted)');
    }
  } catch {
    // No CII coverage for this country/session -- leave the domain out entirely.
  }

  try {
    const debt = await getNationalDebtData();
    const iso2 = countryCode.toUpperCase();
    const entry = debt.entries.find((e) => iso3ToIso2Code(e.iso3) === iso2);
    if (entry) {
      const resilienceFromDebt = Math.max(0, Math.min(100, 100 - entry.debtToGdp));
      const observedAtMs = entry.baselineTs ? new Date(entry.baselineTs).getTime() : Date.now();
      domains.push({
        id: 'economic',
        score: resilienceFromDebt,
        weight: 1,
        dimensions: [freshDimension('macroFiscal', resilienceFromDebt, observedAtMs)],
      });
      subScores.push(resilienceFromDebt);
      sources.push('World Bank government debt-to-GDP (inverted)');
    }
  } catch {
    // World Bank fetch failed or country not covered -- leave the domain out.
  }

  if (subScores.length === 0) return null;

  const overallScore = subScores.reduce((sum, s) => sum + s, 0) / subScores.length;

  return {
    countryCode: countryCode.toUpperCase(),
    overallScore,
    level: resilienceLevelFromScore(overallScore),
    domains,
    trend: 'stable',
    change30d: 0,
    lowConfidence: subScores.length < 2,
    imputationShare: subScores.length < 2 ? 0.5 : 0,
    baselineScore: 0,
    stressScore: 0,
    stressFactor: 0,
    dataVersion: '',
    pillars: [],
    schemaVersion: '1.0',
    headlineEligible: true,
    compositeSources: sources,
  };
}

export async function getResilienceScore(countryCode: string): Promise<ResilienceScoreResponse> {
  const normalized = normalizeCountryCode(countryCode);

  // Real Pro entitlement (if this deploy ever has one) still gets
  // WorldMonitor's actual model -- the composite is a substitute for
  // de-paywalled users, not a downgrade for a genuinely paying one.
  if (!hasPremiumAccess()) {
    const composite = await generateCompositeResilienceScore(normalized);
    if (composite) return composite;
  }

  return getClient().getResilienceScore({
    countryCode: normalized,
  });
}

export async function getResilienceRanking(): Promise<ResilienceRankingResponse> {
  return getClient().getResilienceRanking({});
}

export async function getFoodStocks(
  opts: { countryCode?: string; commodity?: string; signal?: AbortSignal } = {},
): Promise<FoodStocksResponse> {
  return getClient().getFoodStocks(
    {
      countryCode: opts.countryCode ? normalizeCountryCode(opts.countryCode) || opts.countryCode.trim().toUpperCase() : '',
      commodity: opts.commodity ?? '',
    },
    // Forwarded so a panel close or country switch actually cancels the request
    // rather than only discarding its result.
    opts.signal ? { signal: opts.signal } : undefined,
  );
}
