/**
 * ListClimateNews RPC -- reads seeded climate news data from Railway seed
 * cache, falling back to a live RSS/API fetch (Redis-cached, 10 min) when the
 * seed key is cold — never seeded, or its TTL expired with nothing to
 * refresh it.
 */

import type {
  ClimateServiceHandler,
  ServerContext,
  ListClimateNewsRequest,
  ListClimateNewsResponse,
} from '../../../../src/generated/server/worldmonitor/climate/v1/service_server';

import { getCachedJson, cachedFetchJson } from '../../../_shared/redis';
import { CLIMATE_NEWS_KEY } from '../../../_shared/cache-keys';
import { fetchClimateNewsLive } from './_live-fetch';

const LIVE_CACHE_KEY = 'climate:news-intelligence:live:v1';
const LIVE_CACHE_TTL = 600;

export const listClimateNews: ClimateServiceHandler['listClimateNews'] = async (
  _ctx: ServerContext,
  _req: ListClimateNewsRequest,
): Promise<ListClimateNewsResponse> => {
  try {
    const result = await getCachedJson(CLIMATE_NEWS_KEY, true) as ListClimateNewsResponse | null;
    if (result?.items?.length) return { ...result, dataAvailable: true };
  } catch {
    // sentry-coverage-ok: a seed read failure falls through to the live fetch below.
  }

  try {
    const live = await cachedFetchJson<{ items: ListClimateNewsResponse['items']; fetchedAt: number }>(
      LIVE_CACHE_KEY,
      LIVE_CACHE_TTL,
      fetchClimateNewsLive,
      120,
      { timeoutMs: 20_000, cacheFetcherErrors: false },
    );
    if (live && live.items.length > 0) {
      return { items: live.items, fetchedAt: live.fetchedAt, dataAvailable: true };
    }
  } catch (err) {
    // sentry-coverage-ok: live fallback failure degrades to the empty response below.
    console.warn('[climate-news] live fallback failed:', (err as Error).message);
  }

  return { items: [], fetchedAt: 0, dataAvailable: false };
};
