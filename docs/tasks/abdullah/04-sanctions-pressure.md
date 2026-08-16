# Task: Sanctions pressure — free alt-source

## Why
Currently gated behind WorldMonitor's licensed dataset. Real free public sources exist for this one — more tractable than resilience score.

## Candidates to check first
- **OFAC SDN List** (US Treasury) — public, free, bulk-downloadable, no API key: https://sanctionslist.ofac.treas.gov (check current endpoint/format, they've changed formats before)
- **UN Security Council Consolidated List** — public, free: https://www.un.org/securitycouncil/sanctions/information
- **EU Sanctions Map** — public: https://www.sanctionsmap.eu

Check each for: CORS support (test with `curl -sI <url>` for `access-control-allow-origin`), rate limits, update frequency, and license/attribution requirements before wiring one in.

## What to do
1. Pick the source (or combination) that best matches what the existing panel displays — check `src/config/panels.ts` for the panel id and `src/services/` for any existing sanctions-related file to see the current data shape.
2. Follow the direct-source pattern from `src/services/earthquakes.ts`/`weather.ts`: CORS-open source → direct browser fetch; no-CORS source → new proxy function in `api/_*.js` following `api/_pizzint-proxy.js`'s pattern (be mindful this fork is capped at exactly 12 Vercel functions — check `vercel.json` and the 3 dispatcher registries before adding a new standalone function; prefer folding a new proxy into `api/misc-gateway/[name].ts`'s registry instead of creating a new top-level function).
3. Remove any remaining `premium: 'locked'` flag for this panel in `src/config/panels.ts`.

## Verify
Confirm the panel shows real, current sanctions data for at least a few countries/entities, source is attributed somewhere visible.
