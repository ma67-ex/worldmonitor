import type {
  Forecast,
  ForecastServiceHandler,
  ServerContext,
  GetForecastsRequest,
  GetForecastsResponse,
} from '../../../../src/generated/server/worldmonitor/forecast/v1/service_server';
import filterParamContracts from '../../../../shared/openapi-filter-param-contracts.json';
import { getRawJson, cachedFetchJson } from '../../../_shared/redis';
import { markNoStoreFallbackResponse } from '../../../_shared/response-headers';

const REDIS_KEY = 'forecast:predictions:v2';
// Separate in-process coalescing key — never reuse REDIS_KEY here.
// cachedFetchJson writes its result back to this key with the TTL below, so
// pointing it at the canonical forecast key would clobber the seeder's own
// (much longer) TTL on every RPC call.
const RPC_CACHE_KEY = 'forecast:predictions:v2:rpc-cache';
const RPC_CACHE_TTL_SECONDS = 30;
const FORECAST_DOMAINS = new Set(filterParamContracts.forecastDomains);

type ForecastFeed = { predictions: Forecast[]; generatedAt: number };

export const getForecasts: ForecastServiceHandler['getForecasts'] = async (
  ctx: ServerContext,
  req: GetForecastsRequest,
): Promise<GetForecastsResponse> => {
  try {
    // Coalesces concurrent RPC calls onto a single Redis GET (cache stampede
    // guard) instead of every request hitting getRawJson directly.
    const data = await cachedFetchJson<ForecastFeed>(
      RPC_CACHE_KEY,
      RPC_CACHE_TTL_SECONDS,
      () => getRawJson(REDIS_KEY) as Promise<ForecastFeed | null>,
    );
    if (!data?.predictions) {
      return markNoStoreFallbackResponse(ctx.request, { forecasts: [], generatedAt: 0, degraded: false, stale: false, error: '' });
    }

    let forecasts = data.predictions;
    if (req.domain) {
      if (!FORECAST_DOMAINS.has(req.domain)) {
        return { forecasts: [], generatedAt: data.generatedAt || 0, degraded: false, stale: false, error: '' };
      }
      forecasts = forecasts.filter(f => f.domain === req.domain);
    }
    if (req.region) forecasts = forecasts.filter(f => f.region.toLowerCase().includes(req.region.toLowerCase()));

    return { forecasts, generatedAt: data.generatedAt || 0, degraded: false, stale: false, error: '' };
  } catch (err) {
    console.error('[forecast] getRawJson failed:', err instanceof Error ? err.message : String(err));
    return {
      forecasts: [],
      generatedAt: 0,
      degraded: true,
      stale: false,
      error: 'forecast_backend_unavailable',
    };
  }
};
