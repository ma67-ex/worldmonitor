import { createRelayHandler } from './_relay.js';
import { jsonResponse } from './_json-response.js';

export const config = { runtime: 'edge' };

export default createRelayHandler({
  buildRelayPath: () => '/oref/summary',
  forwardSearch: false,
  timeout: 12000,
  onlyOk: true,
  cacheHeaders: () => ({
    'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600',
  }),
  fallback: (_req, corsHeaders) => jsonResponse({
    configured: false,
    monthCount: 0,
    yearCount: 0,
    topAreasMonth: [],
    topAreasYear: [],
    updatedAtMs: 0,
    error: 'No data source available',
  }, 503, corsHeaders),
});
