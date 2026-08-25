# Paid Service Audit — Free/No-Card Alternatives

Scanned [.env.example](.env.example) (~60 optional integrations). Most are already free-tier/no-card per their own comments — no action needed. Below: only services that actually cost money or require a card, with a free-no-card alt for each.

| Service | Used for | Problem | Free/no-card alt |
|---|---|---|---|
| `AVIATIONSTACK_API` | Flight delays, 55 airports/tick | Paid, has monthly spend budget guard already in code | No full swap — OpenSky (already wired) covers live positions free, but no delay data free equiv |
| `WINGBITS_API_KEY` | Aircraft owner/operator enrichment | Paid, contact-sales | OpenFlights static DB (free, less live) or drop feature |
| `SCRAPECREATORS_API_KEY` | Reddit data (WSB tickers, social velocity) | Paid, per-credit | Subreddit `.json`/RSS fallback — free, no key, less reliable |
| `CORRIDOR_RISK_API_KEY` | Maritime corridor risk scoring | Paid/enterprise | No direct swap — derive rough heuristic from free AIS data already ingested |
| `CLOUDFLARE_R2_*` (all) | Object storage, bootstrap tiers | R2 needs card on file even for free-tier usage | Backblaze B2 — 10GB free, no card |
| `ANTHROPIC_API_KEY` | Locale translation, optional forecast LLM | Paid, needs card. **Currently unset everywhere** (no `.env.local`, zero fork repo secrets) — feature silently skipped, not actually costing anything yet | Google AI Studio (Gemini) free tier, no card — or just use Groq/OpenRouter free tiers already wired as primary/fallback |
| `BRAVE_API_KEYS` | Relay news/search loop | Brave now requires card even for free quota | Self-hosted SearXNG — zero cost, zero key |
| `EXA_API_KEYS` | Grocery-basket / price discovery search | Paid, free credits run out → card | Self-hosted SearXNG, or Tavily free tier (verify no-card at signup) |
| `FIRECRAWL_API_KEY` | Scraping fallback for grocery-basket | Paid beyond free credits | Self-hosted Playwright scraper script |
| `AXIOM_API_TOKEN` | Usage log shipping | Free tier increasingly card-gated | Better Stack Logs free tier, no card |
| `DATABASE_URL` (consumer-prices-core) | Postgres | Railway/managed Postgres = paid | Neon.tech free tier, no card (or Supabase Postgres, already used elsewhere here) |
| `IMF_API_KEY` (Azure APIM) | IMF WEO/gold reserves data | Azure signup sometimes card-gated | Skip key — code comment confirms unauthenticated calls still work today |

Everything else (Groq, Finnhub, FRED, EIA, OpenAQ, ACLED, UCDP, NASA FIRMS, Supabase, Clerk, Resend, Convex, Turnstile, Telegram, AISStream, OpenSky, CoinGecko demo, etc.) — already free, no card, per their own `.env.example` comments.

## Task list (checked against current code, 2026-08-25)

### Task 1 — SearXNG rollout (IN PROGRESS)
Swap `BRAVE_API_KEYS` / `EXA_API_KEYS` / `FIRECRAWL_API_KEY` for self-hosted SearXNG.
- [x] `server/worldmonitor/market/v1/stock-news-search.ts` — SearXNG tried before Brave
- [x] `scripts/seed-bigmac.mjs` — Economist open dataset before EXA/search
- [x] `scripts/seed-grocery-basket.mjs` — Numbeo + SearXNG before EXA; Firecrawl still last-resort fallback
- [x] `consumer-prices-core/src/acquisition/exa.ts` — `ExaProvider.search()` tries SearXNG first (site:-restricted to `includeDomains`), falls through to paid Exa on miss. This is the real money path: 28 retailer configs route through `SearchAdapter` → `this.exa.search()`. Verified: 266/266 `consumer-prices-core` tests pass (2 new), typecheck clean, outer-repo `test:data` pre-existing failures (`widget-agent.ts` ENOENT etc.) confirmed unrelated via stash test.
- [x] `scripts/company-monitoring-worker.mjs` — checked, skipped: its EXA path is deliberately frozen (`paidRuntimeApproved: false` in `scripts/lib/company-monitoring-exa.mjs`), never calls out in production, costs nothing. Touching it means overriding an intentional stop-gate, not a free-tier swap.
- [x] `consumer-prices-core` diag/smoke files (`discovery.diag.ts`, `extraction.diag.ts`, `search.smoke.ts`) and `ExaSearchAdapter` (`src/adapters/exa-search.ts`) — checked, skipped: dev tooling / only 1 retailer config still uses `exa-search` and `search.ts`'s own comment says it *replaces* that adapter (legacy path, not worth swapping).
- [x] Settings/config-only references (`src/services/runtime-config.ts`, `mcp-store.ts`, `settings-constants.ts`, `src-tauri/sidecar/local-api-server.mjs`) — confirmed these just declare the env var name for UI/secrets listing, no HTTP calls, nothing to swap.
- [ ] Decide whether to drop Firecrawl fallback entirely or keep as final tier

### Task 2 — Cloudflare R2 → Backblaze B2 (DONE)
`scripts/_r2-storage.mjs`'s `resolveR2StorageConfig()` now checks `BACKBLAZE_B2_*` env vars first, falling through to `CLOUDFLARE_R2_*` — covers every caller of the shared module automatically: `scripts/seed-forecasts.mjs`, `scripts/seed-forecast-resolutions.mjs`, `scripts/publish-bootstrap-tiers.mjs` (bootstrap profile). Backblaze is S3-compatible so it reuses the exact same S3-SDK client/retry/timeout code — no new provider class needed.
- Bucket created (`worldmonitor-storage`, Private, `us-east-005`), scoped app key generated (bucket-restricted, `listFiles/readFiles/writeFiles/deleteFiles` only — **not** the account-wide master key, which was rotated out after being pasted in chat).
- Fixed a real footgun before shipping: B2's "keyID" is an S3 `accessKeyId`, not a Cloudflare-style account ID — mapping it into the `accountId` slot would've silently built a bogus `https://{keyID}.r2.cloudflarestorage.com` endpoint if `BACKBLAZE_B2_ENDPOINT` were ever left unset. Kept `accountId` Cloudflare-only.
- Fixed `forcePathStyle`: Cloudflare R2 needs path-style (default `true`); Backblaze's own SDK docs show virtual-hosted-style with the flag unset. Now defaults per-provider (`false` when `BACKBLAZE_B2_ENDPOINT` is set) instead of one global default.
- Verified live end-to-end: real put+get+delete against the actual bucket (credential used in-memory for one command, never written to a file), plus 4 new unit tests, full `_r2-storage`/forecast-trace/bootstrap test files pass (17+422 tests), typecheck clean.
- Skipped `scripts/_kv-storage.mjs` — Cloudflare Workers KV is a different product (edge key-value DB), not S3-compatible, no B2 equivalent.
- Skipped `scripts/seed-military-bases.mjs`'s R2 call — third-tier fallback that only fires on a fresh Railway deploy with no volume yet, hand-rolled against Cloudflare's proprietary REST API (not S3), low frequency/value for the effort.
- `.env.example` documents the new `BACKBLAZE_B2_*` block, `bootstrap-r2-env-docs.test.mjs` still passes (only checks the fixed `R2_*` names, unaffected by additions).

### Task 3 — ANTHROPIC_API_KEY → free LLM fallback (DONE)
`scripts/translate-locales.mjs`: `resolveTranslationProvider()` picks Anthropic (Haiku, unchanged behavior) if `ANTHROPIC_API_KEY` is set, else falls through to `OPENROUTER_API_KEY` then `GROQ_API_KEY` — same two keys and same models `seed-forecasts.mjs` already uses, so no new signup, just reuse.
- `translateBatch()` now dispatches on `provider.kind` (`anthropic` vs `openai-compat`); the OpenAI-compatible branch is a plain `fetch` POST with the same tab-separated prompt/parsing.
- `--dry-run` still works with zero keys configured (verified). Hard error without `--dry-run` and no provider names all three env vars instead of only `ANTHROPIC_API_KEY`.
- Live-tested the new code path with a deliberately invalid Groq key: provider selection logs correctly, hits the real Groq endpoint, HTTP 401 is caught by the pre-existing per-batch retry logic (unchanged) rather than crashing — confirms the wiring reaches production code, not just mocks.
- 7 new unit tests (`tests/translate-locales-provider.test.mjs`) plus the 3 existing locale test files (55 tests) all pass; `translateLocale`'s own tests were untouched since it takes an injected `translate` callback and never saw the Anthropic client directly.

### Task 4 — DATABASE_URL → Neon/Supabase (NOT STARTED)
`consumer-prices-core` Postgres connection string only — no code change, just point `.env`/Railway var at a free-tier host (Neon.tech no-card, or reuse existing Supabase Postgres).

### Task 5 — Case-by-case, no clean 1:1 swap (NOT STARTED)
`AVIATIONSTACK_API`, `WINGBITS_API_KEY`, `SCRAPECREATORS_API_KEY`, `CORRIDOR_RISK_API_KEY`, `AXIOM_API_TOKEN`, `IMF_API_KEY` — each needs its own decision (drop feature vs. degrade vs. free alt), see table above for options per service.

### Done
- Railway CI drift-check fix (see below) — commit [37253d1](https://github.com/AkulxSharma/worldmonitor/commit/37253d1ca)

---

## Related: Railway CI fix (done this session)
- Fork's `railway-deploy-drift.yml` was failing hourly — empty `RAILWAY_API_TOKEN`/`RAILWAY_PROJECT_ID` (fork has zero Railway secrets/vars/deploys, confirmed via `gh api`).
- Fixed: removed `schedule:` trigger, kept `workflow_dispatch` only. Commit [37253d1](https://github.com/AkulxSharma/worldmonitor/commit/37253d1ca) on fork `main`.
- Confirmed no other local repo (`automaton`, `jarvis`, `tombstone`) has the same issue.
