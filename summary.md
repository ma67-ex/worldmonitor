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

## Suggested order to tackle
1. `CLOUDFLARE_R2_*` → Backblaze B2 — highest usage, clean swap
2. `ANTHROPIC_API_KEY` → Gemini — single script (`scripts/translate-locales.mjs`), low risk
3. `BRAVE_API_KEYS` / `EXA_API_KEYS` / `FIRECRAWL_API_KEY` → SearXNG self-host — covers 3 at once
4. `DATABASE_URL` → Neon/Supabase — swap connection string only
5. Rest (`AVIATIONSTACK`, `WINGBITS`, `SCRAPECREATORS`, `CORRIDOR_RISK`, `AXIOM`, `IMF`) — case-by-case, no clean 1:1 swap for some

---

## Related: Railway CI fix (done this session)
- Fork's `railway-deploy-drift.yml` was failing hourly — empty `RAILWAY_API_TOKEN`/`RAILWAY_PROJECT_ID` (fork has zero Railway secrets/vars/deploys, confirmed via `gh api`).
- Fixed: removed `schedule:` trigger, kept `workflow_dispatch` only. Commit [37253d1](https://github.com/AkulxSharma/worldmonitor/commit/37253d1ca) on fork `main`.
- Confirmed no other local repo (`automaton`, `jarvis`, `tombstone`) has the same issue.
