**STATUS: DONE — 2026-08-24**

# Task: Unlock supply-chain, trade, and food-stocks (real gates, proven pattern)

## Why
`CLAUDE.md`'s mission is exhaustive ("the entire surface... not just the four tasks already found"). Task `05-supply-chain-chokepoints.md` was the one item explicitly deferred pending "Akul's Railway call" — `CLAUDE.md`'s 2026-08-24 update removed that exception, but nobody had actually traced whether these specific RPCs needed Railway seed infra or were just another stale client-side gate (the `trade-policy` pattern from `06`). Full plan: `/Users/muhammadabdullah/.claude/plans/glimmering-sleeping-lerdorf.md`.

## What was actually gated (traced before touching anything)
Two independent layers, same shape as every prior task:
1. **Server** — `server/_shared/entitlement-check.ts`'s `ENDPOINT_ENTITLEMENTS` map still listed 11 real paths at tier 1: all 8 `/api/supply-chain/v1/*` RPCs, both `/api/trade/v1/*` RPCs (`list-comtrade-flows`, `get-tariff-trends`), and `/api/resilience/v1/get-food-stocks`. `getRequiredTier()` still drives `isTierGated` → `forceKey` in `server/gateway.ts:1166,1211`, so anonymous callers 401'd on all 11 regardless of client-side state — same mechanism `10` closed for 3 other paths.
2. **Client** — `src/services/supply-chain/index.ts` had 8 separate `if (!hasPremiumAccess()) return <empty stub>` guards (one per RPC wrapper) that never even attempted the call for anon users. `src/app/country-intel.ts`'s `fetchProSections()` — which fetches national debt, sanctions, comtrade flows, tariff trends, and product imports for the country deep-dive — was itself only ever CALLED when `hasPremiumAccess()` was true (not a brief flash before real data loads, as initially assumed; a permanent block). `src/components/CountryDeepDivePanel.ts` had 7 more `isPro ? loading : proLocked` ternaries for the same cards, plus a separate gate on bypass-corridor rendering and on the Evidence-export button (a pure client-side markdown builder — zero data-source involved, was gated for no real reason).

## Verified before touching: does this actually need Railway?
No. Read every handler behind these 11 paths — `server/worldmonitor/supply-chain/v1/*`, `trade/v1/{get-tariff-trends,list-comtrade-flows}.ts`, `resilience/v1/get-food-stocks.ts` — none reference `WS_RELAY_URL` or any Railway-seeded cache. They read Redis/Upstash or fetch Comtrade directly. Confirmed the opposite for the two paths deliberately left alone: `scripts/scenario-worker.mjs`'s own header says "always-on Railway service" (backs `run-scenario`/`get-scenario-status`), and `list-sanctions-pressure.ts`'s comment says "logic lives in the Railway seed script... Vercel reads, Railway writes." Those two — plus the LLM-cost-bearing `classify-event`/`get-country-intel-brief`/`analyze-stock`/`get-stock-analysis-history` (already free via BYOK, task 01) — were left in the map untouched.

## What changed
- `server/_shared/entitlement-check.ts`: removed the 11 real entries above, plus 4 confirmed-dead ones with zero callers anywhere in `src/` (`search-intel-history`, `get-intel-timeline`, `get-similar-events`, `forecast/trigger-simulation`) — pure cleanup, no behavior change.
- `src/services/supply-chain/index.ts`: removed all 8 `hasPremiumAccess()` guards and the now-unused import.
- `src/app/country-intel.ts`: `fetchProSections()` is now called unconditionally on every country-brief open; the internal comtrade/tariff `hasPremium` branch inside it is gone (matches the already-unconditional debt/sanctions/products calls in the same function); the multi-sector cost-shock trigger no longer checks premium either. Also removed the now-pointless "re-fire pro sections on entitlement transition" subscription (`authUnsubscribe`/`lastHadPremium`, ~35 lines) — with nothing left gated inside `fetchProSections`, there was nothing left to re-fire.
- `src/components/CountryDeepDivePanel.ts`: bypass-corridors, cost-shock calculator, product imports, national debt, sanctions, comtrade, tariff, and food-stocks cards all render their real loading state unconditionally now instead of a lock screen. Evidence-export button gate removed (was gating a pure in-memory markdown builder). Deleted the now-dead `makeProLocked()` helper (zero remaining callers) and the unused `hasPremiumAccess`/`getAuthState`/`trackGateHit`/`showToast` imports.
- `server/__tests__/entitlement-check.test.ts`: added a `test.each` block asserting `getRequiredTier` returns `null` for all 15 removed paths, same pattern as `10`.

## Verify
- `npm run typecheck` — clean.
- `npm run typecheck:api` — clean (`audit-convex-string-calls.cjs` PASS).
- `npm run build` — clean.
- `node --test tests/panel-config-guardrails.test.mjs` — 22/22.
- `npx vitest run server/__tests__/entitlement-check.test.ts` — 67 passing (up from 52 after task `10`), same 10 pre-existing failures as before this task (confirmed unrelated — they're the already-documented "12 tests pinned old paywall behavior" gap, task `14` in the plan is scoped to fix them, not this one).
- **Not verified live** — same standing limitation as `10`/`11`: no Redis/Convex credentials in this dev environment, and this session's browser-preview tool was independently confirmed to serve stale content unrelated to any code change (see `11`'s verification note). Static verification above is what backs this. Per the deploy gotcha in `CLAUDE.md`: check `https://worldmonitor-one-theta.vercel.app`'s country deep-dive panel (signed out) after this lands on `main` — debt/sanctions/comtrade/tariff/product-imports/cost-shock/food-stocks/bypass-corridors cards should all show real data or a real "unavailable" state, never a lock screen.

## Next (from the plan, not done here)
- Task 13 — delete `ProBanner.ts`/`CommunityWidget.ts` (dead code), remove the live `.upgrade-pro-section` billing UI in `UnifiedSettings.ts`, neuter `hasFeature()` to unlock the API-keys and MCP-clients settings tabs.
- Task 14 — rewrite/retire the pre-existing 10+2 obsolete test failures and fix the 1 broken test-file import, now that this task and 13 have landed what they were waiting on.
- Scenario modeling and the wider Railway decision remain explicitly out of scope pending your go/no-go (see the plan's "Explicitly out of scope" section).
