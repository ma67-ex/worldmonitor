**STATUS: RESEARCHED, BLOCKED — 2026-08-16 — real finding, not a fetch swap**

Checked `src/services/sanctions-pressure.ts` first: the client already has an honest free-tier path (`getHydratedData('sanctionsPressure')` → public `/api/bootstrap?keys=sanctionsPressure` → empty for non-premium, never calls the Pro RPC anonymously). That part predates this session — it's real, it's not new work, and it just needs Akul's Railway seed actually populated to serve data.

**OFAC SDN checked directly** (`curl -sD - "https://sanctionslistservice.ofac.treas.gov/entities" -H "Origin: ..."`): genuinely CORS-open (`access-control-allow-origin: *`), confirmed live. But it's the full entities dump — **111 MB of XML**, not a paginated/filtered JSON API. That's not fetchable from a browser panel (bandwidth, memory, and the fact that most users don't need all ~17,000 SDN entries just to see country-level sanctions pressure). This is exactly why WorldMonitor's own real backend does this server-side (download once, parse, aggregate, seed to Redis) — the same shape of work Akul's Railway seed script already does, which this task is explicitly not supposed to duplicate.

Did not find a smaller paginated/search OFAC endpoint in the time available (their newer API does have a documented search function, but it needs a real query per entity/name rather than a bulk country-aggregate listing, which doesn't match what this panel displays).

**No code changed for this task.** The existing hydration-based free path is the real answer until either (a) a genuine free bulk/paginated sanctions API surfaces, or (b) Akul decides this is worth a small server-side proxy (would need to fit inside the 12-Vercel-function cap — see note in `05`/`06`).

---

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
