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

---

**Everything else from the original audit** (R2, Anthropic, Axiom, Brave/Exa via SearXNG) turned out to be safe — see commits landed 2026-08-25 for the actual swaps, and `docs/tasks/abdullah/README.md` for the index entry.
