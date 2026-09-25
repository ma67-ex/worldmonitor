/**
 * India equity terminal, market-wide summaries: FII/DII flows, bulk/block
 * deals, all NSE indices, and the upcoming results calendar.
 *
 * Public, cacheable, no per-user variation — reads four seeded Redis keys in
 * one pipeline call. Per-company detail is not served here (it is read
 * on-demand by the company page once that RPC exists; see docs/plans/
 * 2026-09-24-global-equity-terminal-plan.md).
 */
export const config = { runtime: 'edge' };

import { getPublicCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { jsonResponse } from './_json-response.js';
import { checkRateLimit } from './_rate-limit.js';
import { readJsonBatchFromUpstashWithStatus } from './_upstash-json.js';

const RATE_LIMIT_SCOPE = 'equity-india';
const RATE_LIMIT_PER_MINUTE = 120;

const SECTIONS = /** @type {const} */ (['flows', 'deals', 'indices', 'calendar']);
const KEY_FOR = {
  flows: 'equity:flows:v1:IN',
  deals: 'equity:deals:v1:IN',
  indices: 'equity:indices:v1:IN',
  calendar: 'equity:calendar:v1:IN',
};

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

  const url = new URL(req.url);
  const requested = url.searchParams.getAll('section').filter((s) => SECTIONS.includes(s));
  const sections = requested.length > 0 ? requested : SECTIONS;
  const keys = sections.map((s) => KEY_FOR[s]);

  const results = await readJsonBatchFromUpstashWithStatus(keys);

  /** @type {Record<string, unknown>} */
  const body = {};
  let anyHit = false;
  sections.forEach((section, i) => {
    const { status, value } = results[i];
    body[section] = status === 'hit' ? value : null;
    if (status === 'hit') anyHit = true;
  });

  return jsonResponse(body, 200, {
    ...cors,
    'Cache-Control': anyHit
      ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
      : 'public, max-age=15, s-maxage=15',
  });
}
