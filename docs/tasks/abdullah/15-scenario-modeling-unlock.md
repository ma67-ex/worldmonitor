**STATUS: DONE — 2026-08-24**

# Task: Unlock scenario modeling — GitHub Actions instead of Railway

## Why
The plan (`/Users/muhammadabdullah/.claude/plans/glimmering-sleeping-lerdorf.md`) left scenario modeling explicitly out of scope: `scripts/scenario-worker.mjs` needed an always-on Railway worker to drain `scenario-queue:pending`, real recurring cost, not a stale gate like everything else in tasks 12-14. Given the go/no-go, chose the free alternative over paying for Railway.

## Alternatives considered (and rejected/accepted)
Traced the actual code before picking one:
- **Railway (always-on worker)** — what the script was written for. Real $/month, rejected.
- **Vercel Cron** — same "drain and exit" code change needed either way, but Hobby-plan minimum cron interval isn't something I could verify offline (Vercel's limits shift and I won't guess a number). If it turns out to be daily-only, that's a ~24h latency hit, not a few-minutes one — too big an unknown to commit to without checking Vercel's own docs first.
- **GitHub Actions scheduled workflow** — chosen. This repo already runs 5-minute and 15-minute `schedule:` cron workflows for the same shape of problem (`analytics-collector-monitor.yml` at `*/5 * * * *`, `seed-freshness-monitor.yml` at `*/15 * * * *`) — a known-working, already-proven interval in this exact environment, not a guess. `computeScenario()` itself is cheap (Redis pipeline reads + arithmetic, no heavy compute), so a 5-minute drain easily keeps up.

## What changed

**`scripts/scenario-worker.mjs`** — was an infinite loop (BLMOVE, sleep 5s on empty, repeat forever — an always-on-process shape). Changed to drain-and-exit:
- Exits immediately when the queue is empty (`if (!raw) break;`) instead of sleeping and re-polling — the next scheduled workflow run picks up whatever arrives in the meantime.
- Added a `MAX_RUN_MS` (4 minutes) wall-clock budget checked at the top of each loop iteration, so a persistent Redis error or unexpectedly deep queue can't run past the next cron tick and overlap it.
- Header comment updated (was "always-on Railway service").
- `requeueOrphanedJobs()` still runs at the start of every invocation — unchanged, and now doing double duty as the recovery path for a run that got hard-killed by a GitHub Actions timeout, not just a Railway crash.

**`.github/workflows/scenario-worker-drain.yml`** (new) — `schedule: */5 * * * *` + `workflow_dispatch`. No `npm ci` step: the script and its one local import (`scripts/_seed-utils.mjs`) use only Node built-ins, no npm dependencies. Reuses the existing `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` repo secrets (already configured, used by `feed-validation.yml` and others — no new secret to provision). `concurrency: cancel-in-progress: false` so overlapping runs are skipped, not killed mid-write. A `Skip when Redis is not configured` step surfaces a visible `::warning::` on the run instead of silently doing nothing, same pattern as `feed-validation.yml`'s existing health-publishing check.

**Server** — `server/_shared/entitlement-check.ts`: removed `/api/scenario/v1/run-scenario` and `/api/scenario/v1/get-scenario-status` from `ENDPOINT_ENTITLEMENTS`. Confirmed `requirePremiumRpcAccess()` (the OTHER gate `run-scenario.ts` calls directly) was already neutered fork-wide by task 08 — `resolvePremiumCallerIdentity()` unconditionally returns `isPremium: true` — so the gateway's tier-forced-API-key check was the only real remaining block.

**Client** — `src/components/SupplyChainPanel.ts`:
- The scenario "Simulate Closure" button's `isPro`/`data-gated="1"` visual gate removed — it was purely cosmetic anyway (no CSS ever read `sc-scenario-btn--gated`, no other code read `data-gated`), but `runScenario()`'s own click handler *did* check `btn.dataset.gated === '1'` and silently no-op with just a `trackGateHit()` call — that was the actual enforcement point, removed.
- **Found and fixed a task-12 miss while in this file**: `renderBypassSection()` had its own separate `hasPremiumAccess()` lock + an auth-state subscription to re-render on login, gating the bypass-corridors section — a duplicate of the lock task 12 already removed from `CountryDeepDivePanel.ts`, on a feature (`fetchBypassOptions`) already confirmed free server-side since task 12. Simplified to an unconditional fetch, deleted the now-dead `bypassUnsubscribe`/`bypassGateTracked` fields and the subscription machinery.
- Removed the now-fully-unused `hasPremiumAccess`/`getAuthState`/`subscribeAuthState`/`trackGateHit` imports.

**Tests** — `server/__tests__/entitlement-check.test.ts`: added a `test.each` asserting `getRequiredTier` returns `null` for both scenario paths, same pattern as tasks 10/12.

## Trade-off, stated plainly
Latency between a client's "run scenario" click and the result being ready: was ~30s (Railway's BLMOVE poll), now up to ~5 minutes (worst case: job enqueued right after a drain run just finished). The client already polls `get-scenario-status` asynchronously — `run-scenario.ts` returns `202` + a status URL, this was already an async contract, not a request/response one — so this degrades the wait, it doesn't change the shape of the feature. $0 recurring cost either way beats Railway's real $/month for a feature at this traffic level.

## Verify
- `npm run typecheck` — clean.
- `npm run typecheck:api` — clean.
- `npm run build` — clean.
- `node --check scripts/scenario-worker.mjs` — valid syntax.
- `python3 -c "import yaml; yaml.safe_load(...)"` on the new workflow file — valid YAML.
- `node --test tests/panel-config-guardrails.test.mjs` — 22/22.
- `npx vitest run server/__tests__/entitlement-check.test.ts` — 79/79.
- **Not verified live** — same standing limitation as every task this session: no Redis/Convex credentials in this dev environment, can't functionally exercise the drain against real Upstash locally, and GitHub Actions itself only runs on a real push to `main` with real repo secrets. After this lands: confirm the workflow appears and runs green in the Actions tab, and that a real `run-scenario` request from a signed-out session resolves (not stuck `pending`) within a few minutes.

## Closes
This was the one item in the plan needing your go/no-go. With GitHub Actions chosen over Railway, the plan's "Explicitly out of scope" scenario-modeling item is now done — only the wider Railway decision for the other genuinely-Railway-dependent features (telegram-feed, oref-alerts, gpsjam, bls-series, sanctions) remains open, unrelated to this task.
