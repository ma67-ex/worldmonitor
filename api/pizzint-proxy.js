// Thin server-side proxy for pizzint.watch's public dashboard-data endpoint.
// The SITREP fork has no backend of its own behind the PizzINT panel (see
// docs/plans/2026-08-15-001-feat-sitrep-rebrand-depaywall-plan.md), and
// pizzint.watch doesn't send Access-Control-Allow-Origin, so the browser
// can't call it directly. This edge function fetches it server-side (no
// CORS restriction applies to server-to-server requests) and re-serves the
// JSON with permissive CORS for our own frontend.
import { jsonResponse } from './_json-response.js';

export const config = { runtime: 'edge' };

const UPSTREAM_URL = 'https://www.pizzint.watch/api/dashboard-data';

export default async function handler() {
  try {
    const resp = await fetch(UPSTREAM_URL, {
      headers: { 'User-Agent': 'SITREP/1.0 (+https://github.com/AkulxSharma/worldmonitor)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      return jsonResponse({ error: `Upstream ${resp.status}` }, 502, {
        'Access-Control-Allow-Origin': '*',
      });
    }
    const data = await resp.json();
    return jsonResponse(data, 200, {
      'Cache-Control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=60, stale-if-error=300',
      'Access-Control-Allow-Origin': '*',
    });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Fetch failed' }, 502, {
      'Access-Control-Allow-Origin': '*',
    });
  }
}
