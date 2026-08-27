**STATUS: PARTIAL — 2026-08-27.** Cron intervals cut on all 5 adjustable workflows (2026-08-26, see "Decision" below — was never actually pushed, see 2026-08-27 README note). Option 2 (`api/_scenario-drain.ts`) built and typecheck/build clean (2026-08-27) — needs you to register the cron-job.org hit before it's live, and everything here needs pushing.

**2026-08-27 follow-up (Abdullah): option 2 built.** First pass hit a real blocker: all three gateway dispatchers run `export const config = { runtime: 'edge' }` with no `maxDuration` override — caps Vercel Edge Functions on Hobby at ~25s execution, and `scripts/scenario-worker.mjs`'s drain loop runs a 4-minute budget. Wrapping it as-is would get killed mid-batch.

Real fix, now shipped: `api/_scenario-drain.ts`, a from-scratch Edge-safe drain — same queue logic (`BLMOVE` dequeue, `computeScenario()`, `SETEX` result, orphan-requeue on crash) copied from `scripts/scenario-worker.mjs` (not imported — that file has Node-only bits, SIGTERM/argv/node:url, that don't run on Edge), but bounded to a 20s budget instead of 4 minutes. Safe because Upstash's REST `BLMOVE` doesn't actually honor its blocking-timeout arg — confirmed in the CLI worker's own comment, it returns `null` immediately on an empty queue — so this was never really a blocking-wait problem, just a total-runtime one. A job stranded in `scenario-queue:processing` by a mid-run cutoff self-heals on the *next* invocation via the same orphan-requeue the CLI worker already relies on.

Wired into `api/misc-gateway/[name].ts`'s existing REGISTRY as `scenario-drain` (stays inside the 12-function cap, no new Vercel function) + one `vercel.json` rewrite (`/api/scenario-drain` → `/api/misc-gateway/scenario-drain`). Auth: `RELAY_SHARED_SECRET`, the same internal-cron secret every other ops-admin endpoint here already uses (`server/_shared/internal-auth.ts`) — no new secret to provision. `npm run typecheck`, `npm run typecheck:api`, `npm run build`, and `biome lint` all clean. Not runtime-verified against real Redis (still no `UPSTASH_REDIS_REST_URL`/`TOKEN` in this dev environment) — the logic is a line-for-line port of the already-proven CLI worker, but the first live hit should be watched.

**To finish option 2, paste this into cron-job.org (needs your account, not done here):**
- URL: `https://worldmonitor-one-theta.vercel.app/api/scenario-drain`
- Method: `GET` (or `POST` — handler doesn't check method)
- Schedule: every 1–5 minutes
- Custom header: `Authorization: Bearer <RELAY_SHARED_SECRET value, from Vercel env vars>`
- Expected response: `200 {"processed":N,"requeued":N,"queueEmptied":bool,"tookMs":N}`; `401` means the header's wrong, `503` means Redis env vars aren't set on Vercel.

Once that cron is live and confirmed hitting 200s, `scenario-worker-drain.yml`'s GitHub Actions cron can be deleted entirely — it's now redundant, and removing it recovers another ~2,880 min/mo on top of the ~8,640 this file's earlier cut already got. Didn't delete it in this pass — wanted the external cron proven live first, per this file's own house rule about verifying before declaring something done.

# 22 — GitHub Actions minutes exhausted (Akul's find, 2026-08-26)

Akul is out of GitHub Actions minutes on the fork. Root cause traced, not your fault exactly but your call to fix — flagging here per the usual task-queue channel since there's no live session-to-session ping available.

## Root cause
GitHub bills every job run with a **1-minute floor**, even if it finishes in 5 seconds. This repo is **private** (billed, no unlimited free minutes — that's public-repo only). Six workflows are cron-scheduled every 5-30 minutes, 24/7:

| Workflow | Cadence | Est. runs/mo | Est. min/mo (1min floor) |
|---|---|---|---|
| `scenario-worker-drain.yml` | `*/5 * * * *` | ~8,640 | ~8,640 |
| `analytics-collector-monitor.yml` | `*/5 * * * *` | ~8,640 | ~8,640 |
| `postmerge-deploy-monitor.yml` | `*/10 * * * *` | ~4,320 | ~4,320 |
| `seed-freshness-monitor.yml` | `*/15 * * * *` | ~2,880 | ~2,880 |
| `umami-storage-monitor.yml` | `*/15 * * * *` | ~2,880 | ~2,880 |
| `deploy-gate.yml` | `*/30 * * * *` | ~1,440 | ~1,440 |

**~28,800 min/mo floor** from cron alone, before any push-triggered CI. GitHub Free is 2,000 min/mo (private repos), Pro is 3,000 — blown out 10-15x.

`scenario-worker-drain.yml` (your task 15, added 2026-08-24) is the single biggest line — it was built specifically to avoid Railway's recurring $ cost, but at `*/5`, it traded that for a GitHub Actions minutes cost that hit its own ceiling just as hard. Worth knowing for future "avoid a paid host" calls: **a free-tier billing surface can still have a real usage ceiling**, not costing $ per-run isn't the same as costing nothing at scale.

## Options (Akul's call on which, not fully decided as of this file)
1. **Cut cron intervals** on all 6 (5/10/15min → 30min+) — cuts to ~2,880 min/mo, free, immediate, some freshness loss on each monitor's signal.
2. **Move `scenario-worker-drain` off GitHub Actions entirely** — a free external cron (e.g. cron-job.org, no card) hitting the same Vercel endpoint the workflow currently curls, on the same `*/5` cadence, costs zero GitHub minutes. This is probably the actual right fix for that one specifically, since it's also the workflow you built as a Railway-cost dodge — an external free cron dodges both.
3. Buy overage minutes — real $, back-of-envelope ~$230/mo if left running as-is at full overage. Bandaid, not a fix, don't do this without discussing.
4. Public repo — GitHub Actions is unlimited free on public repos. Not recommended: this fork's whole codebase (not just `docs/`) would go public, and tonight's session did real work specifically to keep `docs/tasks/abdullah/` off the *public docs site* — going fully public is a much bigger exposure than that, a different decision entirely.

Pick whichever combination makes sense when you pick this up — no single "correct" answer forced here, same as the file's usual convention (state the decision once made, don't leave it as an open question forever).

## Decision (2026-08-26)

Went with a hybrid: option 1 (cut intervals) on all 5 adjustable workflows tonight, `deploy-gate.yml` left untouched since it's already at 30min and is a safety net (weakening it risks stranded PRs again, #5479/#5851 — not worth it for this fix). Option 2 for `scenario-worker-drain` (moving it fully off Actions) is **not done** — see gap below.

| Workflow | Old | New | Old min/mo | New min/mo |
|---|---|---|---|---|
| `scenario-worker-drain.yml` | `*/5` | `*/15` | ~8,640 | ~2,880 |
| `analytics-collector-monitor.yml` | `*/5` | `*/30` | ~8,640 | ~1,440 |
| `postmerge-deploy-monitor.yml` | `*/10` | `*/30` | ~4,320 | ~1,440 |
| `seed-freshness-monitor.yml` | `*/15` | `0 * * * *` (hourly) | ~2,880 | ~720 |
| `umami-storage-monitor.yml` | `*/15` | `0 * * * *` (hourly) | ~2,880 | ~720 |
| `deploy-gate.yml` | `*/30` | unchanged | ~1,440 | ~1,440 |
| **Total** | | | **~28,800** | **~8,640** |

~70% cut, immediate, zero new infra, zero new risk (schedule-only edits, workflow logic untouched). Also fixed a stale "fires every 5 minutes" comment in `scripts/scenario-worker.mjs` (MAX_RUN_MS rationale) to match the new 15min cadence.

**Gap: still ~3-4x over GitHub Free's 2,000 min/mo** (or ~3x over Pro's 3,000), before counting push-triggered CI (Test/Typecheck/Lint/Security Audit) which isn't in this table at all. Verified `scenario-worker.mjs` drains `scenario-queue:pending` via direct Upstash Redis REST calls (BLMOVE) inside the runner script — it does **not** curl a Vercel endpoint, so this file's original assumption for option 2 ("hitting the same Vercel endpoint the workflow currently curls") was wrong; no such endpoint exists yet. Doing option 2 for real means:
1. A new public Vercel endpoint wrapping the drain logic (fits the existing `api/misc-gateway*` dispatcher pattern, Hobby's 12-function cap), auth'd with a shared secret so it's not an open unauthenticated Redis-queue-drain endpoint.
2. An external free cron (cron-job.org or similar) hitting it every 5-15min.

Didn't build (1) tonight — new public authenticated endpoint touching the paid Redis queue is a bigger surface than a schedule edit, wanted to land the safe win first. Didn't do (2) at all — **account creation on an external service is something I won't do on your behalf**, that step needs you. If you want, next session I can build the endpoint + secret and hand you the exact cron-job.org config (URL + header) to paste in.
