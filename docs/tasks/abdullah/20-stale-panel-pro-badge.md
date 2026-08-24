**STATUS: DONE — 2026-08-24**

# Task: Remove stale `premium: 'locked'` from 4 already-unlocked panel constructors

## Why
Found while reviewing task 16's report: it flagged 8 `Panel`-subclass components still passing `premium: 'locked'` to their `super()` constructor call, and correctly declined to touch them without investigation (out of its own task's scope). Traced each one myself before acting.

## Trace
`Panel.ts:254-255` renders a `panel-pro-badge` ("PRO" badge on the panel header) whenever `options.premium` is truthy AND the caller has neither a desktop `WORLDMONITOR_API_KEY` nor their own BYOK key (`hasUserAiKey()`). This is a **separate gate from the one task 10 fixed** — task 10 removed the panel from `WEB_PREMIUM_PANELS`/`apiKeyPanels` (the lock-screen mechanism in `panel-layout.ts`), but never touched this constructor-level flag, which only controls the header badge.

Split the 8 flagged components into two real categories:
- **`ChatAnalystPanel`, `MarketImplicationsPanel`, `RegionalIntelligenceBoard`, `StockAnalysisPanel`** — still genuinely BYOK-gated (task 01): without a user's own AI key, these panels can't produce data for free (real per-call LLM inference cost, same reasoning task 01 and this session's `classify-event`/`get-country-intel-brief` exclusions already established). The badge is correct here — it clears itself the moment a user configures a BYOK key (`hasUserAiKey()`), exactly as designed. `RegionalIntelligenceBoard.ts:262` has its own comment confirming this is intentional. **Left untouched.**
- **`DailyMarketBriefPanel`, `GlobalProcurementPanel`, `StockBacktestPanel`, `WsbTickerScannerPanel`** — the 4 panels task 10 already fully unlocked (server-side tier gate removed, `WEB_PREMIUM_PANELS`/`apiKeyPanels` entries removed, real free data confirmed live in task 10's own verification). These have **no BYOK fallback and no remaining real gate anywhere** — the constructor's `premium: 'locked'` was pure leftover, causing a misleading "PRO" badge to render on a panel that's actually fully free for every user. This is a real bug: it tells users they need to pay for something that already works for free.

## What changed
- `src/components/DailyMarketBriefPanel.ts:48` — removed `premium: 'locked'` from the `super()` call.
- `src/components/StockBacktestPanel.ts:35` — removed `premium: 'locked'`; also fixed the stale title `'Premium Backtesting'` → `'Backtesting'`, matching `panels.ts`'s own already-corrected `name` field for this panel (task 10).
- `src/components/GlobalProcurementPanel.ts:62` — removed the `premium: 'locked',` line (title was already correct, no "Premium" prefix).
- `src/components/WsbTickerScannerPanel.ts:45` — removed `premium: 'locked',` line.

## Verify
- `npm run typecheck` — clean.
- Not independently re-run `npm run build`/guardrail tests for this specific change alone — folded into the end-of-session full verification pass across all of tonight's changes (see the session's final verification summary).

## Note on task numbering
Written as task 20 to avoid colliding with 17 (`anonymous-follow-limit`, a parallel agent's file already on disk) and 19 (`export-gate-and-tab-cap-unlock`, a parallel agent's task in flight at the time this was written).
