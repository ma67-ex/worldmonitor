**STATUS: DONE — 2026-08-22**

Built exactly what the decision below asks for:

- **`api/_sanctions-ofac-proxy.ts`** — fetches `sanctionslistservice.ofac.treas.gov/entities` (the 111MB Enhanced-XML dump), streams it with a hand-rolled buffer-scanning parser (fetch + `ReadableStream` + `TextDecoder`, no XML library — see below for why), reduces it to a per-country + per-program aggregate (entry/new/vessel/aircraft counts), and caches the result in Redis for 24h via `cachedFetchJson`. Registered into `api/misc-gateway/[name].ts`'s `REGISTRY` (not a new top-level function) with a matching `vercel.json` rewrite (`/api/sanctions-ofac-proxy` → `/api/misc-gateway/sanctions-ofac-proxy`).
- **`src/services/sanctions-pressure.ts`** — new `fetchSanctionsPressureFromOfacProxy()` tried first for non-premium users (same "direct free source ahead of hydrated/RPC fallback" convention as `earthquakes.ts`/`weather.ts`), mapped into the existing `SanctionsPressureResult` shape. `countryCode` per country is filled in client-side via the existing `nameToCountryCode()` in `src/services/country-geometry.ts` (reused, not reimplemented) since the OFAC aggregate only carries country names.

**Real gaps, stated plainly, not hidden:**
1. **No individual `entries` list** — the aggregate is deliberately countries+programs only (Akul's decision explicitly scoped this to "a per-country aggregate count/summary," not a full entity replica). `SanctionsPressurePanel.ts` already renders an empty-state message when `entries` is empty, so this degrades visibly but doesn't break.
2. **Didn't reuse `scripts/seed-sanctions-pressure.mjs`**, WorldMonitor's own existing (and much more capable) seeder for this exact data — it already has a real `sax`-based streaming parser and a richer output shape. Checked it, deliberately didn't import `sax` here: that script is a Node process meant for the deferred Railway seed-infra, and `sax` reaches for Node's `Buffer`/`require('stream')` internally, which this file's Edge Runtime does not reliably provide (and this task's own decision rules out adding a non-edge function). Full reasoning is in the new file's header comment.
3. **"New entry" is a heuristic, not a guarantee** — OFAC's feed has no clean "date added" field at the aggregate level; the proxy uses the most recent per-designation `datePublished` and treats anything within 30 days as new. A republish without a genuinely new designation could in principle bump this.
4. **`countryCode` mapping depends on `country-geometry.ts`'s name table already being loaded** client-side by the time the panel renders — soft-degrades to an empty code (not a crash) if it isn't.

**Verify:**
- `npm run typecheck`, `npm run typecheck:api`, `npm run build` all clean (build required regenerating `docs/source-attribution.mdx` + both `source-attribution-manifest.json` files via `node scripts/source-attribution.mjs --write` — the new proxy references `sanctionslistservice.ofac.treas.gov`, the manifest tracks that; committed alongside).
- `npm run lint:rate-limit-policies` clean (new file needs no policy — it enforces no per-caller rate limit itself, relying entirely on the Redis cache to bound upstream calls).
- **Not verified live.** No Redis/Upstash credentials in this environment, and the real cost/latency of streaming a genuine 111MB response only shows up against Vercel's actual Edge Runtime, not anything reproducible here. First real check after this deploys: hit `/api/sanctions-ofac-proxy` directly and confirm it returns real country/program data within the ~60s budget (`PARSE_TIME_BUDGET_MS` = 45s + 15s slack), then confirm the Sanctions Pressure panel renders it for a signed-out session. If the 111MB transfer routinely blows the 45s budget in production (this environment measured a much smaller sample at ~2.2MB/s, which would put the full file around 50s — right at the edge), the `partial: true` path still returns whatever was aggregated before the cutoff rather than failing outright, but the budget constant may need raising — that number is a real ponytail-flagged guess, not a measured production value.

---

**STATUS: DECIDED, CLEARED TO BUILD — 2026-08-22 — Akul's call made, no longer needs his attention**

Akul decided 2026-08-22: **server-side proxy + parse** (option (b) from the 2026-08-16 blocker note below). Build a small proxy endpoint that fetches OFAC's 111MB SDN entities XML dump server-side (once, on a cache TTL — do not re-fetch per request), parses it down to a per-country aggregate count/summary, and serves that small JSON to the browser. This is genuinely new server-side work, not a client fetch swap — treat it like `api/_pizzint-proxy.js`.

**Fold it into the existing dispatcher registries, don't add a new top-level Vercel function** — this fork is capped at exactly 12 deployed functions (see `sessions/worldmonitor/summary.md` for the full consolidation story). `api/misc-gateway/[name].ts`'s registry is the right home for a new proxy like this one, same as the note below already suggested. Cache the parsed result (Redis/Upstash TTL, e.g. 24h — OFAC's list doesn't change that often) so the 111MB download only happens on cache miss, not per request.

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
