# Project summary — for Abdullah

Read `CLAUDE.md` in this folder first for the current mission and operating rules. This file is the "how did we get here" history so you're not starting cold.

## What this fork is

`AkulxSharma/worldmonitor`, forked from `koala73/worldmonitor` (real-time geopolitical/OSINT intelligence dashboard — TypeScript SPA, dark-terminal Bloomberg-style UI, deck.gl map, ~186 panel components, ~117 Vercel Edge Functions, proto/RPC backend). Akul turned it into his own product — rebranded "SITREP" — for his own geopolitical situational awareness, not to run WorldMonitor's paid SaaS. Deploy: Vercel Hobby (free) tier, project `akul-sharmas-projects-8d7c98ac/worldmonitor`, production alias `https://worldmonitor-one-theta.vercel.app`, auto-deploys on push to `main`.

Full detailed history lives in the brain-repo sidecar note: `sessions/worldmonitor/summary.md` (not in this repo — that's Akul's own notes repo). This file is a condensed version scoped to what matters for your work.

## Timeline

**2026-08-15/16 — rebrand + initial de-paywall push.** New brand identity (`src/config/brand.ts`, kept the existing dark/monospace/OSINT-terminal aesthetic). UI-only paywall gates deleted (ProBanner, Discord widgets). Solved Vercel Hobby's 12-function cap by consolidating ~149 API routes into 3 dispatcher files. Fixed a path-parsing bug in those dispatchers (Vercel rewrites preserve the original client path in `req.url`, not the rewrite destination — cost a full night of 404s the first time). Fixed PizzINT and earthquake data both silently failing because they checked a stale hydration cache before attempting a live fetch. Provisioned real infra (Upstash Redis, session secret) instead of a fail-open hack when the anonymous-session mint started 503ing. Confirmed zero panels lost vs upstream in a full parity audit.

**2026-08-17 — your first session.** BYOK (bring-your-own-AI-key) shipped for all 5 remaining LLM-backed panels. Found and fixed a real gap: the lock-CTA/PRO-badge gate never checked `hasUserAiKey()`, so BYOK panels stayed visually locked even when the underlying data path worked — added `BYOK_GATED_PANELS` + pub/sub so saving a key re-gates live. Canada roads/alerts map layer ported from upstream. National debt got a real World Bank alt-source. Resilience score, sanctions, and supply-chain were researched but correctly left unbuilt — you documented real blockers instead of forcing something half-working.

**2026-08-22 — resilience score + your second session (overnight).** Akul + Claude built the resilience-score composite directly (CII instability score + World Bank debt-to-GDP, both inverted, only real domains included — no invented data). Same night, you shipped all 4 remaining queued tasks: sanctions pressure (a real server-side OFAC proxy with a hand-rolled streaming XML parser — no `sax`, Edge Runtime can't do Node `Buffer`/`stream`), trade-policy unlock (turned out to be 3 stale client-side gates, not a missing data source), server-side entitlement stripping (neutralized the paywall at its enforcement points in `gateway.ts` + 3 shared modules + one inline copy in `_widget-agent.ts`), and a theme contrast pass (found 4 real accessibility bugs the rebrand's color change introduced, including BYOK's key-input fields having zero CSS at all).

**2026-08-24 — the deploy gotcha.** None of your 2026-08-22 work had actually gone live — the production site was frozen on the pre-08-22 bundle for two days despite all 6 commits sitting correctly on `main`. Traced to: Vercel's dashboard shows your account as "not on a team" (Hobby plan has no team-member support), and pushes from your GitHub account appear not to trigger Vercel's auto-deploy as a result — not fully root-caused, only worked around. A trivial commit pushed from Akul's own account triggered a fresh deploy that picked up everything, including all your pending work, which then verified clean live (sanctions proxy 200, entitlement-stripped RPC returns real data anonymously, theme fix present in the deployed CSS). **See `CLAUDE.md`'s gotcha section — this is the single most important operational thing to know before you push more work.**

## Current state (as of 2026-08-24)

**Done and verified live:** rebrand, BYOK (all 5 panels), Canada roads layer, national debt alt-source, resilience score composite, sanctions pressure proxy, trade-policy unlock, server-side entitlement stripping, theme contrast fixes.

**Known still-open, now yours to just fix (no permission needed, see `CLAUDE.md`):**
- `global-procurement`, `stock-backtest`, `wsb-ticker-scanner` — likely the same stale-client-gate pattern as `trade-policy`, unverified.
- `latest-brief` — confirmed genuinely different, tied to a real WorldMonitor Clerk account, needs real work not a flag flip.
- 12 tests now fail because they pinned the old paywall-enforcing behavior as their subject (`entitlement-check.test.ts`, `widget-agent-billing-denial.test.ts`, `summarize-article-handler-security.test.ts`) — never rewritten, your call whether to rewrite or retire them.
- Trade flows + tariffs (as opposed to national debt, which is done) in `06-trade-tariffs-debt.md` — still unstarted.
- Supply-chain's real locked analytics (8 RPCs of scenario modeling) — genuinely needs either Railway seed infra (see the one exception in `CLAUDE.md`) or a from-scratch alt-source approach.
- Resilience score, sanctions, trade-policy are "done" in the narrow sense of what was asked — but the mission is now everything, not just those four. Sweep the whole codebase per `CLAUDE.md`'s hunting list.

**Explicitly deferred, not yours to decide (the one exception):** Railway seed-infra (would unblock `news/v1/list-feed-digest`, `telegram-feed`, `gpsjam`, `oref-alerts`, and the rest of supply-chain). Flag it if you think it's worth it; don't provision it.
