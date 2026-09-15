/**
 * RPC: ListCryptoSectors -- reads seeded crypto sector data from Railway seed
 * cache, falling back to a live CoinGecko fetch (Redis-cached, 10 min) when
 * the seed key is cold — never seeded, or its TTL expired with nothing to
 * refresh it.
 */

import type {
  ServerContext,
  ListCryptoSectorsRequest,
  ListCryptoSectorsResponse,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { getCachedJson, cachedFetchJson } from '../../../_shared/redis';
import { markNoStoreFallbackResponse } from '../../../_shared/response-headers';
import { fetchCryptoMarkets } from './_shared';
import sectorsConfig from '../../../../shared/crypto-sectors.json';

const SEED_CACHE_KEY = 'market:crypto-sectors:v1';
const LIVE_CACHE_KEY = 'market:crypto-sectors:live:v1';
const LIVE_CACHE_TTL = 600;

interface SectorRow {
  id: string;
  name: string;
  change: number;
}

async function fetchSectorsLive(): Promise<SectorRow[] | null> {
  const allIds = [...new Set(sectorsConfig.sectors.flatMap((s) => s.tokens))];
  const items = await fetchCryptoMarkets(allIds);
  if (items.length === 0) return null;

  const byId = new Map(items.map((c) => [c.id, c.price_change_percentage_24h]));
  const sectors = sectorsConfig.sectors.map((sector) => {
    const changes = sector.tokens
      .map((id) => byId.get(id))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const change = changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
    return { id: sector.id, name: sector.name, change };
  });
  return sectors;
}

export async function listCryptoSectors(
  ctx: ServerContext,
  _req: ListCryptoSectorsRequest,
): Promise<ListCryptoSectorsResponse> {
  try {
    const seedData = await getCachedJson(SEED_CACHE_KEY, true) as { sectors: SectorRow[] } | null;
    if (seedData?.sectors?.length) return { sectors: seedData.sectors };
  } catch {
    // sentry-coverage-ok: a seed read failure falls through to the live fetch below.
  }

  try {
    const live = await cachedFetchJson<SectorRow[]>(
      LIVE_CACHE_KEY,
      LIVE_CACHE_TTL,
      fetchSectorsLive,
      120,
      { timeoutMs: 15_000, cacheFetcherErrors: false },
    );
    if (live && live.length > 0) return { sectors: live };
  } catch (err) {
    // sentry-coverage-ok: live fallback failure degrades to the empty response below.
    console.warn('[crypto-sectors] live fallback failed:', (err as Error).message);
  }

  return markNoStoreFallbackResponse(ctx.request, { sectors: [] });
}
