/**
 * RPC: ListOtherTokens -- reads seeded other/trending token data from
 * Railway seed cache, falling back to a live CoinGecko/CoinPaprika fetch
 * (Redis-cached, 10 min) when the seed key is cold — never seeded, or its
 * TTL expired with nothing to refresh it.
 */

import type {
  ServerContext,
  ListOtherTokensRequest,
  ListOtherTokensResponse,
  CryptoQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { getCachedJson, cachedFetchJson } from '../../../_shared/redis';
import { markNoStoreFallbackResponse } from '../../../_shared/response-headers';
import { fetchTokenPanelLive } from './_shared';
import otherConfig from '../../../../shared/other-tokens.json';

const SEED_CACHE_KEY = 'market:other-tokens:v1';
const LIVE_CACHE_KEY = 'market:other-tokens:live:v1';
const LIVE_CACHE_TTL = 600;

type TokenSeedEntry = { name: string; symbol: string; price: number; change24h: number; change7d: number };

function toQuotes(tokens: TokenSeedEntry[]): CryptoQuote[] {
  return tokens.map(t => ({
    name: t.name,
    symbol: t.symbol,
    price: t.price,
    change: t.change24h,
    change7d: t.change7d,
    sparkline: [],
  }));
}

export async function listOtherTokens(
  ctx: ServerContext,
  _req: ListOtherTokensRequest,
): Promise<ListOtherTokensResponse> {
  try {
    const seedData = await getCachedJson(SEED_CACHE_KEY, true) as { tokens: TokenSeedEntry[] } | null;
    if (seedData?.tokens?.length) return { tokens: toQuotes(seedData.tokens) };
  } catch {
    // sentry-coverage-ok: a seed read failure falls through to the live fetch below.
  }

  try {
    const live = await cachedFetchJson<CryptoQuote[]>(
      LIVE_CACHE_KEY,
      LIVE_CACHE_TTL,
      () => fetchTokenPanelLive(otherConfig),
      120,
      { timeoutMs: 15_000, cacheFetcherErrors: false },
    );
    if (live && live.length > 0) return { tokens: live };
  } catch (err) {
    // sentry-coverage-ok: live fallback failure degrades to the empty response below.
    console.warn('[other-tokens] live fallback failed:', (err as Error).message);
  }

  return markNoStoreFallbackResponse(ctx.request, { tokens: [] });
}
