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

### Task 4 — DATABASE_URL → Neon (HANDED OFF TO AKUL)
`consumer-prices-core`'s DB client (`src/db/client.ts`) is a generic `pg.Pool` on `DATABASE_URL` — no code change needed, confirmed compatible with any Postgres host (SSL handling already generic). Corrected an earlier wrong assumption: the existing `SUPABASE_URL`/`SUPABASE_ANON_KEY` in `.env.example` is read-only access to a *third party's* public Supabase project (PIZZINT dataset maintainers), not an account Akul owns — not reusable here.
Neon.tech confirmed the better zero-signup-cost fit over Railway's own Postgres addon: Railway's permanent free tier is only $1/month usage credit (too small for an always-on DB), Neon's free tier is a genuine indefinite 0.5GB/100 compute-hours, no card, auto-suspends when idle.
Neon project created, connection string ready. Setting `DATABASE_URL` in Railway is Akul's action (his Railway account/deploy, not the user's) — task blocked on him, not code.

### Task 5 — Case-by-case (CHECKED — 1 code fix done, 5 need Akul's call)
Checked every caller for all 6 before touching anything. All 6 already degrade gracefully today (no crash, no cost, just a skipped feature) when their key is unset — none of these are actively costing money or broken right now.

- **`CORRIDOR_RISK_API_KEY` — FIXED.** Stale documentation: `.env.example` still asked for a key, but `scripts/ais-relay.cjs` already switched to corridorrisk.io's free open-beta endpoint months ago (confirmed by its own `tests/corridorrisk-upstream.test.mjs`, which asserts the relay does NOT reference this env var). Removed the dead lines, replaced with a note explaining it's a no-op now. Zero risk — 14/14 relevant tests still pass.
- **`SCRAPECREATORS_API_KEY` — needs Akul, no free fix exists.** The code's own comment says Reddit's free `hot.json` is policy-blocked (403, all IPs/UAs) and Reddit stopped allowing new OAuth app creation in 2026 — the "free RSS fallback" this audit originally suggested is already confirmed dead by whoever wrote that comment. Ask Akul: does he have a **pre-2026** Reddit "script" app's client ID/secret already sitting somewhere (grandfathered apps still work via `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`)? If not, it's pay-for-ScrapeCreators or drop WSB/social-velocity tracking — his call.
- **`AVIATIONSTACK_API` — needs Akul, no free equivalent for delay data.** Already has a spend-budget guard and skips cleanly when unset. OpenSky (free, already wired) covers live positions but nobody publishes flight-delay data for free. Ask Akul: keep paying, or drop delay tracking specifically (positions stay free either way)?
- **`WINGBITS_API_KEY` — needs Akul, a build decision not a swap.** Already skips cleanly (`configured: false`) when unset — this is a nice-to-have (aircraft owner/operator enrichment), not broken. A free OpenFlights static-DB alternative exists but is new feature work (bundle a dataset, write ICAO24 matching), not a mechanical key swap — didn't build it speculatively. Ask Akul: worth building, or leave as an optional paid enrichment?
- **`AXIOM_API_TOKEN` — needs Akul, any alt is a new signup.** Already drops telemetry silently when unset. Better Stack Logs (the suggested alt) is itself a new account — conflicts with the "no new signups" rule same as everything else in this bucket. Ask Akul: is usage telemetry worth a signup anywhere, or fine staying off?
- **`IMF_API_KEY` — no action needed, already correct.** Already optional, already degrades to unauthenticated calls, already has a code comment documenting a real 2026-05-09 incident where IMF's gateway briefly hard-401'd. FYI for Akul only: a free key at portal.api.imf.org would harden against a repeat of that outage — not urgent, today's behavior already works.

### Done
- Railway CI drift-check fix (see below) — commit [37253d1](https://github.com/AkulxSharma/worldmonitor/commit/37253d1ca)

---

## Related: Railway CI fix (done this session)
- Fork's `railway-deploy-drift.yml` was failing hourly — empty `RAILWAY_API_TOKEN`/`RAILWAY_PROJECT_ID` (fork has zero Railway secrets/vars/deploys, confirmed via `gh api`).
- Fixed: removed `schedule:` trigger, kept `workflow_dispatch` only. Commit [37253d1](https://github.com/AkulxSharma/worldmonitor/commit/37253d1ca) on fork `main`.
- Confirmed no other local repo (`automaton`, `jarvis`, `tombstone`) has the same issue.
