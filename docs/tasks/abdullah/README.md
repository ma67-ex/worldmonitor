**2026-08-24: read `CLAUDE.md` in this folder first.** Mission changed — full scope now, full autonomy, no more waiting on Akul's approval except for one thing (new paid infra). This README's task list below is now historical record, not a gate.

**SESSION STATUS (2026-08-22, overnight run): the full queue below is now DONE — 01, 02, 03 (built directly by Akul), 04, 06, 07, 08, 09 all complete, pushed to `main`, and confirmed live 2026-08-24 (see `summary.md`'s deploy-gotcha entry).**

# Abdullah's task queue (2026-08-16, updated 2026-08-22)

**Rule for this file, going forward: only put a task here once any decision it needed has already been made.** If a task still needs Akul to pick a methodology, an approach, or a scope, it does NOT belong in this file — it stays on Akul's own plate until he decides, and only lands here after.

Everything below is cleared to work on independently — none need Akul's approval or a question back to him. Full background/context lives in `docs/plans/2026-08-15-001-feat-sitrep-rebrand-depaywall-plan.md` if you want more; each file here is self-contained enough to start from directly.

Do NOT touch: Railway seed-infra (news feed digest, telegram-feed, gpsjam, oref-alerts) — that's explicitly deferred pending Akul's own decision (cost/billing risk he's weighing), not yours to provision or propose.

Suggested order (not mandatory — pick whatever's most useful):

1. [`01-byok-panels.md`](./01-byok-panels.md) — done
2. [`02-canada-roads-layer.md`](./02-canada-roads-layer.md) — done
3. [`03-resilience-score.md`](./03-resilience-score.md) — done, built directly, nothing left here
4. [`08-server-entitlement-stripping.md`](./08-server-entitlement-stripping.md) — done 2026-08-22, server-side entitlement enforcement stripped fork-wide
5. [`04-sanctions-pressure.md`](./04-sanctions-pressure.md) — done 2026-08-22, OFAC proxy + parse, folded into `api/misc-gateway`
6. [`06-trade-tariffs-debt.md`](./06-trade-tariffs-debt.md) — done 2026-08-22 (debt sub-metric was already done; trade flows + tariffs turned out to need no new data source, just removing 3 redundant client-side gates left over from before 08 — see the file for the full trace)
7. [`07-verify-depaywall-end-to-end.md`](./07-verify-depaywall-end-to-end.md) — re-verified 2026-08-22 after 04/06/08 landed. Flags `stock-backtest`, `global-procurement`, `wsb-ticker-scanner` as likely candidates for the exact same fix `06` just did for `trade-policy` — not fixed (out of this session's scope), a real finding for a future task if Akul wants them unlocked too.
8. [`09-theme-css-tuning.md`](./09-theme-css-tuning.md) — done 2026-08-22, fixed 4 real contrast bugs the SITREP accent-color rebrand introduced (DEFCON badge + pills, BYOK key inputs, desktop settings placeholder)
9. [`10-remaining-panel-unlocks.md`](./10-remaining-panel-unlocks.md) — done 2026-08-23, unlocked `stock-backtest`, `daily-market-brief`, `wsb-ticker-scanner`, `global-procurement` (client-side gates for all 4 + a real server-side tier gate for 2 of them); `latest-brief` confirmed still genuinely Clerk-bound, left locked
10. [`11-map-renderer-boot-race.md`](./11-map-renderer-boot-race.md) — done 2026-08-24, not from the paywall hunt list: fixed the 2D map falling back to plain SVG in local dev (window-width mobile check was a one-shot read at construction time, before the window settled)
11. [`12-supply-chain-trade-unlock.md`](./12-supply-chain-trade-unlock.md) — done 2026-08-24, unlocked supply-chain (8 RPCs), trade (comtrade + tariffs), and food-stocks — confirmed these don't need Railway (scenario modeling and sanctions do, left alone). Full remaining plan at `/Users/muhammadabdullah/.claude/plans/glimmering-sleeping-lerdorf.md` (tasks 13-14 next: dead billing UI + settings gates, then test cleanup)

Mark a file done by adding `**STATUS: DONE — <date>**` at the top when you finish it. Don't delete the files — they're the record of what shipped and why.

## NOT Abdullah's — stays on Akul's plate

These still need a decision only Akul can make. Don't pick them up until they move to the queue above with a decision already attached.

- **[`05-supply-chain-chokepoints.md`](./05-supply-chain-chokepoints.md)** — the free/basic status strip already works; the real locked analytics (8 RPCs of scenario modeling) need Akul's Railway call, same as below.
- **Railway seed-infra go/no-go** — currently deferred (cost/billing risk). Blocks `news/v1/list-feed-digest`, `telegram-feed`, `gpsjam`, `oref-alerts`, and the rest of `05`.
- **4 leftover locked panels, never scoped**: `global-procurement`, `stock-backtest`, `wsb-ticker-scanner`, `latest-brief`. `trade-policy` came OFF this list 2026-08-22 (see `06`) — it turned out to be the same class of bug (stale client-side gate, not a real data-source gap), and `07`'s re-verification flags `global-procurement`/`stock-backtest`/`wsb-ticker-scanner` as likely the same pattern. `latest-brief` is confirmed genuinely different — Clerk-account-bound data, not fixable by unlocking a gate. Akul hasn't said whether the remaining 3 matter enough to prioritize.
