**SESSION STATUS (2026-08-22): 01, 02, 03, 07 done (03 built directly by Akul, not by Abdullah — see its file). 04 decided and cleared (server-side OFAC proxy). 06 partial (debt only, trade flows + tariffs still open). 05 stays out of scope — needs Akul's Railway call. 08/09 cleared, no approval needed.**

# Abdullah's task queue (2026-08-16, updated 2026-08-22)

**Rule for this file, going forward: only put a task here once any decision it needed has already been made.** If a task still needs Akul to pick a methodology, an approach, or a scope, it does NOT belong in this file — it stays on Akul's own plate until he decides, and only lands here after.

Everything below is cleared to work on independently — none need Akul's approval or a question back to him. Full background/context lives in `docs/plans/2026-08-15-001-feat-sitrep-rebrand-depaywall-plan.md` if you want more; each file here is self-contained enough to start from directly.

Do NOT touch: Railway seed-infra (news feed digest, telegram-feed, gpsjam, oref-alerts) — that's explicitly deferred pending Akul's own decision (cost/billing risk he's weighing), not yours to provision or propose.

Suggested order (not mandatory — pick whatever's most useful):

1. [`01-byok-panels.md`](./01-byok-panels.md) — done
2. [`02-canada-roads-layer.md`](./02-canada-roads-layer.md) — done
3. [`03-resilience-score.md`](./03-resilience-score.md) — done, built directly, nothing left here
4. [`04-sanctions-pressure.md`](./04-sanctions-pressure.md) — decided 2026-08-22 (server-side proxy + parse), cleared to build now
5. [`06-trade-tariffs-debt.md`](./06-trade-tariffs-debt.md) — debt sub-metric done, trade flows + tariffs still unstarted (see bottom of the file for the remaining task, no decision needed — same free-API-swap pattern as debt)
6. [`07-verify-depaywall-end-to-end.md`](./07-verify-depaywall-end-to-end.md) — done, but re-run once 04 lands
7. [`08-server-entitlement-stripping.md`](./08-server-entitlement-stripping.md) — no decision needed, finishes the de-paywall on the server side
8. [`09-theme-css-tuning.md`](./09-theme-css-tuning.md) — optional polish pass, do whenever

Mark a file done by adding `**STATUS: DONE — <date>**` at the top when you finish it. Don't delete the files — they're the record of what shipped and why.

## NOT Abdullah's — stays on Akul's plate

These still need a decision only Akul can make. Don't pick them up until they move to the queue above with a decision already attached.

- **[`05-supply-chain-chokepoints.md`](./05-supply-chain-chokepoints.md)** — the free/basic status strip already works; the real locked analytics (8 RPCs of scenario modeling) need Akul's Railway call, same as below.
- **Railway seed-infra go/no-go** — currently deferred (cost/billing risk). Blocks `news/v1/list-feed-digest`, `telegram-feed`, `gpsjam`, `oref-alerts`, and the rest of `05`.
- **5 leftover locked panels, never scoped**: `global-procurement`, `trade-policy`, `stock-backtest`, `wsb-ticker-scanner`, `latest-brief`. Akul hasn't said whether these matter for his use case at all — no decision made yet on whether to even prioritize them.
