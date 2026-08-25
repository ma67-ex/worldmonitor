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

### Task 2 — Cloudflare R2 → Backblaze B2 (NOT STARTED)
Touches: `scripts/_r2-storage.mjs`, `scripts/_kv-storage.mjs`, `scripts/seed-forecast-resolutions.mjs`, `scripts/seed-military-bases.mjs`, plus `tests/bootstrap-kv-publisher.test.mjs`, `tests/bootstrap-r2-env-docs.test.mjs`, `tests/forecast-trace-export.test.mjs`, `tests/r2-storage-s3-timeout.test.mjs`, `tests/forecast-resolutions-seeder.test.mjs`.
Highest blast radius of all tasks here — most files touch it.

### Task 3 — ANTHROPIC_API_KEY → free LLM fallback (NOT STARTED)
Single file: `scripts/translate-locales.mjs` (currently hard-requires `ANTHROPIC_API_KEY`, no fallback). Swap to Gemini free tier or reuse Groq/OpenRouter already wired elsewhere in the repo.

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
