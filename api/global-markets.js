/**
 * Every country tracked for its primary stock market index (45 countries —
 * the same enum GetCountryStockIndex answers one at a time). Public,
 * cacheable, no per-user variation: one pipelined Redis read of the
 * Railway-seeded `market:stock-index:v1:<CC>` keys.
 */
export const config = { runtime: 'edge' };

import { GLOBAL_COUNTRY_INDEXES } from './_global-country-indexes.js';
import { getPublicCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { jsonResponse } from './_json-response.js';
import { checkRateLimit } from './_rate-limit.js';
import { readJsonBatchFromUpstashWithStatus } from './_upstash-json.js';

const RATE_LIMIT_SCOPE = 'global-markets';
const RATE_LIMIT_PER_MINUTE = 120;

const CODES = Object.keys(GLOBAL_COUNTRY_INDEXES).sort();
const KEY_FOR = (code) => `market:stock-index:v1:${code}`;

export default async function handler(req, ctx) {
  if (isDisallowedOrigin(req)) return new Response('Forbidden', { status: 403 });

  const cors = getPublicCorsHeaders('GET, OPTIONS');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, cors);

  const limited = await checkRateLimit(req, cors, {
    failClosed: false,
    ctx,
    scope: RATE_LIMIT_SCOPE,
    limit: RATE_LIMIT_PER_MINUTE,
    window: '60 s',
  });
  if (limited) return limited;

  const results = await readJsonBatchFromUpstashWithStatus(CODES.map(KEY_FOR));

  const countries = CODES.map((code, i) => {
    const { status, value } = results[i];
    const seeded = status === 'hit' && value && typeof value === 'object' ? value : null;
    return {
      code,
      symbol: GLOBAL_COUNTRY_INDEXES[code].symbol,
      indexName: seeded?.indexName ?? GLOBAL_COUNTRY_INDEXES[code].name,
      available: Boolean(seeded?.available),
      price: seeded?.price ?? null,
      weekChangePercent: seeded?.weekChangePercent ?? null,
      currency: seeded?.currency ?? null,
      fetchedAt: seeded?.fetchedAt ?? null,
    };
  });

  const anyAvailable = countries.some((c) => c.available);

  return jsonResponse({ countries }, 200, {
    ...cors,
    'Cache-Control': anyAvailable
      ? 'public, max-age=300, s-maxage=900, stale-while-revalidate=1800'
      : 'public, max-age=15, s-maxage=15',
  });
}
