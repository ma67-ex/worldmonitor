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
