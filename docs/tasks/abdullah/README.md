**SESSION STATUS (2026-08-16): 01, 02, 07 done. 06 partial (debt only, trade flows + tariffs still open). 03/04/05 researched, not implemented — see each file's STATUS line for the real reason. 08/09 added 2026-08-22 — cleared to start, no approval needed.**

# Abdullah's task queue (2026-08-16, updated 2026-08-22)

All of these are cleared to work on independently — none need Akul's approval or a question back to him. Full background/context lives in `docs/plans/2026-08-15-001-feat-sitrep-rebrand-depaywall-plan.md` if you want more; each file here is self-contained enough to start from directly.

Do NOT touch: Railway seed-infra (news feed digest, telegram-feed, gpsjam, oref-alerts) — that's explicitly deferred pending Akul's own decision (cost/billing risk he's weighing), not yours to provision or propose.

Suggested order (not mandatory — pick whatever's most useful):

1. [`01-byok-panels.md`](./01-byok-panels.md) — highest value, mechanical pattern, reference implementation already exists
2. [`02-canada-roads-layer.md`](./02-canada-roads-layer.md) — small, self-contained port from upstream
3. [`03-resilience-score.md`](./03-resilience-score.md)
4. [`04-sanctions-pressure.md`](./04-sanctions-pressure.md)
5. [`05-supply-chain-chokepoints.md`](./05-supply-chain-chokepoints.md)
6. [`06-trade-tariffs-debt.md`](./06-trade-tariffs-debt.md) — debt sub-metric done, trade flows + tariffs still unstarted (see bottom of the file for the remaining task)
7. [`07-verify-depaywall-end-to-end.md`](./07-verify-depaywall-end-to-end.md) — do this last, after 1 is fully done
8. [`08-server-entitlement-stripping.md`](./08-server-entitlement-stripping.md) — no decision needed, finishes the de-paywall on the server side
9. [`09-theme-css-tuning.md`](./09-theme-css-tuning.md) — optional polish pass, do whenever

Mark a file done by adding `**STATUS: DONE — <date>**` at the top when you finish it. Don't delete the files — they're the record of what shipped and why.
