# 21 — Deferred: not safe to swap tonight

Split off from the root `summary.md` paid-service audit (2026-08-24) after checking live config (`npx vercel env ls` + `gh secret list`) and each integration's actual runtime. Everything here failed the "works exactly the same, or one minor compromise" bar — either no free alt exists, or the alt needs infra this fork has explicitly deferred. Kept out of tonight's swap queue; revisit only once its blocking decision is made.

## `AVIATIONSTACK_API` — flight delay data
No free alt covers delay data. OpenSky (already wired, free) covers live positions only. Swapping means dropping the delay-data capability, not replacing it — a real feature loss, not a "minor compromise."

## `CORRIDOR_RISK_API_KEY` — maritime corridor risk scoring
No direct free source exists. The only path is deriving a rough heuristic from AIS data already ingested elsewhere in this fork — that's a real data-science build (scoring methodology, validation), not a signup-and-swap. Belongs in its own task file with a chosen methodology, not tonight's batch.

## `DATABASE_URL` (consumer-prices-core) + `FIRECRAWL_API_KEY`
`consumer-prices-core/` is a separate Dockerized microservice — Dockerfile only, no docker-compose/fly.toml/railway.json, not wired into any active deploy. `scripts/seed-consumer-prices.mjs` has an explicit comment: "Do NOT configure as a Railway cron." This whole subsystem is downstream of the same Railway seed-infra go/no-go call that's already deferred in `README.md` ("NOT Abdullah's" section) — standing up Neon + a host for this service before that decision is made would be building infra for a service that has nowhere to run yet.

## `WINGBITS_API_KEY` — aircraft owner/operator enrichment
Not re-checked tonight (lower priority, no live env var set either way) — original audit's call stands: OpenFlights static DB (free, less live) or drop the feature. Worth a quick pass once the queue above is clear, but not blocking.

## `SCRAPECREATORS_API_KEY` — Reddit data (WSB tickers, social velocity)
**Corrected from the original audit** — the free path assumed here doesn't actually exist. Per `.env.example`'s own comment block (lines ~285-297): Reddit's unauthenticated `hot.json` endpoint is now policy-blocked (HTTP 403) regardless of IP/UA, **and Reddit removed self-serve OAuth-app creation entirely** ("Responsible Builder Policy 2026") — a brand-new `REDDIT_CLIENT_ID`/`SECRET` cannot be created at all. The `REDDIT_CLIENT_ID`/`SECRET` path in the relay code only works with a pre-policy (pre-~March-2026) app that already exists, which this fork doesn't have. So the actual current provider precedence is: ScrapeCreators (paid) → a Reddit app we can't create → public endpoint that 403s. No free/no-card alternative exists today. Leave `SCRAPECREATORS_API_KEY` unset (feature degrades to `SEED_ERROR`, already graceful) until Reddit reopens app registration or a different social-velocity source is found.

## `BRAVE_API_KEYS`/`EXA_API_KEYS` — stock news search
Abdullah's `ddae8c5a0` already wires a SearXNG attempt ahead of Exa/Brave, correctly gated behind `SEARXNG_URL` (unset → identical to before). The problem is finding an instance to point it at:
- **Public instances**: tested 6 candidates from searx.space's top-uptime list live (`libresearch.space`, `priv.au`, `paulgo.io`, `opnxng.com`, `searx.be`, `searx.tiekoetter.com`) — every one either bot-walls (Anubis challenge instead of JSON), or 429s. None return usable JSON. Public instances disable/throttle the JSON API specifically because of exactly this kind of automated use.
- **Self-hosting**: SearXNG is a persistent Python service. Every genuinely card-free always-on host either is Railway (explicitly deferred, cost decision not yours to make) or has an unverified/conflicting card requirement (Render's free-tier card policy has contradictory reports as of this check).
- **Net**: not a safe swap tonight. Also low-value to force — `EXA_API_KEYS`/`BRAVE_API_KEYS` are both unset already, so `stock-news-search.ts` already falls through to `google-news-rss` (free, no key) today. SearXNG would only be a quality upgrade on an already-working free path, not a fix for something broken. Leave `SEARXNG_URL` unset; revisit once Railway's status is decided or a genuinely free always-on host is confirmed.

## `lint:api-contract` — CI, unrelated to the paid-service audit
Found 2026-08-25 chasing an unrelated Deploy Gate failure. Dozens of `src/generated/server/worldmonitor/**/service_server.ts` files (positive_events, prediction, radiation, research, resilience, sanctions, scenario, seismology, shipping, supply_chain, thermal, trade, unrest, webcam, wildfire, more) have no matching `api/<domain>/v1/[rpc].ts` HTTP gateway, which `lint:api-contract` requires. Pre-existing, not caused by anything in this file's swap work. Real production deploys are unaffected — Vercel deploys directly on push regardless of GitHub Actions status, confirmed live 2026-08-25 while these checks were red. Genuinely CI-only debt.

Not fixed tonight: real scope question (which of these RPCs are actually wired to a live feature vs. dead generated code that should be deleted instead of gatewayed), and any new `api/` route has to be checked against the Vercel Hobby 12-function cap (`CLAUDE.md`'s dispatcher-registry rule) before adding it. Needs its own pass.

---

**Everything else from the original audit** (R2, Anthropic, Axiom) turned out to be safe — see commits landed 2026-08-25 for the actual swaps, and `docs/tasks/abdullah/README.md` for the index entry.
