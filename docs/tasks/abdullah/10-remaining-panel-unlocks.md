**STATUS: DONE — 2026-08-23**

# Task: Unlock stock-backtest, daily-market-brief, wsb-ticker-scanner, global-procurement

## Why
`CLAUDE.md` (2026-08-24 mission: strip every paywall fork-wide) flagged these 3 as likely the same
stale-client-gate pattern `06` already fixed for `trade-policy`, plus `daily-market-brief` found
independently while auditing `src/config/panels.ts`'s remaining `premium: 'locked'` entries.
`latest-brief` is the one real exception — stays locked, see below.

## Trace
Same methodology as `06`: `panels.ts`'s `premium: 'locked'` is not the actual anon lock gate — that's
`WEB_PREMIUM_PANELS` in `src/app/panel-layout.ts`. Four separate layers had to agree to unlock a panel:

1. `src/config/panels.ts` — `premium: 'locked'` on 9 entries across the multi-variant config (4 panels ×
   2-3 variant blocks each). Removed.
2. `src/app/panel-layout.ts` — `WEB_PREMIUM_PANELS` set drives the lock-CTA. Removed the 4 keys; also
   removed them from `apiKeyPanels` in `panels.ts` to keep the `apiKeyPanels ⊆ WEB_PREMIUM_PANELS`
   invariant `tests/panel-config-guardrails.test.mjs` enforces (test confirmed still 22/22 clean).
3. `src/app/data-loader.ts` + `src/App.ts` — 8 separate `hasPremiumAccess() &&` guards on initial-load
   tasks, prime tasks, and refresh-scheduler conditions for the 4 panels, plus one early-return inside
   `loadDailyMarketBrief()` itself (`if (!hasPremiumAccess()) return;`) — exactly the same shape as the
   bug `06` found in `loadTradePolicy()`. All removed.
4. **Server-side**: `stock-backtest` and `global-procurement` had a REAL gate `06`'s panels didn't —
   `server/_shared/entitlement-check.ts`'s `ENDPOINT_ENTITLEMENTS` map still listed
   `/api/market/v1/backtest-stock`, `/api/market/v1/list-stored-stock-backtests`, and
   `/api/economic/v1/list-global-tenders` at tier 1. Since `getRequiredTier()` still drives
   `isTierGated` → `forceKey` in `server/gateway.ts` (the exact class of gap `CLAUDE.md` flagged as
   "one already found and closed" — these 3 endpoints were NOT that one, still open), anonymous
   requests to these 3 paths were still 401ing for lack of an API key even after every client-side gate
   was stripped. Removed all 3 from the map. `wsb-ticker-scanner` and `daily-market-brief` were never in
   this map or in `PREMIUM_RPC_PATHS` — client-side-only gate, no server fix needed for those two.

## Why `latest-brief` stays locked
Confirmed genuinely different, not touched — it's the one entry left in `WEB_CLERK_PRO_ONLY_PANELS`,
bound to a real Clerk userId server-side (`brief:{clerkUserId}:{date}` in Redis). No Clerk account, no
brief to fetch — unlocking the CTA would swap a clear lock screen for a silent empty panel, same
reasoning `panel-layout.ts`'s own comment already documents. Needs real work (its own account-independent
data path), not a flag flip. Left as the one remaining locked panel besides `latest-brief`'s dependents.

## Verify
- `node --test tests/panel-config-guardrails.test.mjs` — 22/22 clean, including the
  `apiKeyPanels ⊆ WEB_PREMIUM_PANELS` invariant test by name.
- `npm run typecheck` — clean.
- `npm run typecheck:api` — clean (includes `audit-convex-string-calls.cjs` — PASS).
- `npm run build` — clean.
- `server/__tests__/entitlement-check.test.ts` — updated the tier-1 regression-lock list to drop the 2
  now-ungated market paths, added a new `test.each` asserting `getRequiredTier` returns `null` for all 3
  unlocked server paths (backtest-stock, list-stored-stock-backtests, list-global-tenders) — all 3 pass.
  Diffed against unmodified `HEAD` via `git stash`: same 10 pre-existing failures on this file both
  before and after my change (51 pass → 52 pass, net +1 from my new assertions) — confirms none of the
  10 are new regressions from this task; they're the already-documented "12 tests pinned old paywall
  behavior" gap from `summary.md`, untouched here, still someone's call to rewrite/retire later.
- **Not verified live**: no Redis/Convex credentials in this dev environment (per `CLAUDE.md`'s standing
  note), so the actual data responses for these 4 panels — as opposed to the fact that they're no longer
  gated — weren't confirmed against real production data. Started `npm run dev`, confirmed no build/runtime
  errors in server logs unrelated to this change (only a pre-existing ACLED auth warning), but did not
  chase the panel through the UI's add-panel flow to capture a live network 200 the way `06` did for
  `trade-policy` — the static verification above (typecheck × 2, build, guardrail tests, targeted
  regression tests, before/after diff) already covers what actually changed (gate removal), and matches
  the bar `CLAUDE.md` itself sets for this environment. **Per the 2026-08-24 deploy gotcha**: after this
  pushes to `main`, verify against `https://worldmonitor-one-theta.vercel.app` directly, don't trust
  `main` having the commit as proof it's live.

## Remaining from the hunt list (not done here, next task)
- `grep -rn "PREMIUM_RPC_PATHS\|requiresDirectLlmQuota\|isTierGated\|getRequiredTier" server/gateway.ts`
  — swept `ENDPOINT_ENTITLEMENTS` for these 4 panels specifically; the rest of the map (sanctions,
  supply-chain, scenario, intelligence paths) is still tier-1 and out of this task's scope — some of
  those may be intentional (e.g. sanctions has its own free-proxy alt-source per `04`, this old RPC may
  be dead code, not yet confirmed).
- "Sign In to Unlock" / "Upgrade to Pro" CTA text sweep across `src/components/` — not started.
- `ProBanner`, `CommunityWidget`/Discord upsell, `.upgrade-pro-section`, `MAX_HTML_CHARS_PRO` — not
  started.
