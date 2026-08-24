**STATUS: DONE — 2026-08-24**

# Task: Unlock the Resilience map-layer lock + Route Explorer's PRO gate

Two fresh findings, never touched by any prior task in this queue (confirmed via grep of all `docs/tasks/abdullah/*.md` for "RouteExplorer" — zero hits before this file).

## Finding 1: dead map-layer lock on Resilience Score

`src/config/map-layer-definitions.ts`'s `LAYER_REGISTRY.resilienceScore` entry still carried the 4th `def()` arg `'locked'`, which renders a disabled checkbox + 🔒 icon in the DeckGL layer picker (`DeckGLMap.ts:5581-5588`) even though the underlying data was already made free in task 03 — `ResilienceWidget.ts:140-148`'s `getGateReason()` hardcodes `PanelGateReason.NONE`. This was a second, parallel lock on the same feature that task 03 never touched because it lived in a different registry (map layers vs. panel gating).

Every consumer of `premium: 'locked'` on this layer — `DeckGLMap.ts` (layer-picker checkbox/icon, `syncPremiumLayerControls`), `GlobeMap.ts` (`getPremiumLayerPresentation`, `lockedPremiumLayerKeys`), `premium-layer-gate.ts` (`PremiumLayerGate`), and `map-layer-definitions.ts`'s own `isLayerEntitled`/`sanitizeLockedLayers`/`sanitizeLockedLayersWithOwnership`/`restoreGateOwnedLockedLayers` — all key off `LAYER_REGISTRY[key].premium` as the single source of truth. No second gate existed anywhere else (checked `basemap.ts` — doesn't exist in this repo; grepped every other `.premium`/`'locked'` consumer).

### What changed
`src/config/map-layer-definitions.ts:93` — dropped the `'locked'` 4th arg from the `resilienceScore` `def()` call (now `undefined`, `deckGLOnly: true` unchanged), matching how every other unlocked layer in the same table omits the premium arg entirely. Added a one-line comment pointing at `ResilienceWidget.ts`'s already-free gate so the next person doesn't reintroduce this drift.

Everything downstream (lock icon, disabled checkbox, `PremiumLayerGate` re-lock-on-downgrade, CMD+K entitlement checks) self-heals from that one flag — confirmed by reading `DeckGLMap.ts:5603-5614`'s `lockedLayerControls` construction: it's built by filtering `layerConfig` for `premium === 'locked'`, so resilienceScore now simply falls out of that filter, no special-casing needed anywhere.

## Finding 2: RouteExplorer's client-side PRO gate

`src/components/RouteExplorer/RouteExplorer.ts:216` gated `fetchLane()` behind `hasPremiumAccess(getAuthState())`, rendering a "Upgrade to PRO" CTA (`renderFreeGate()`, class `.re-content__upgrade`) plus a blurred left rail, and `components/LeftRail.ts:75` had a matching `'gate'` mode showing "Upgrade to PRO for route intelligence." The RPC itself (`fetchRouteExplorerLane` in `src/services/supply-chain/index.ts`) was already a plain unconditional call with no server-side entitlement entry (`get-route-explorer-lane` isn't in `server/_shared/entitlement-check.ts`'s `ENDPOINT_ENTITLEMENTS` — confirmed via grep, task 12 already covers this RPC family) — this was purely a leftover client-side UI gate, same class of bug as every prior unlock this session.

### What changed
`src/components/RouteExplorer/RouteExplorer.ts`:
- Removed the `if (!hasPremiumAccess(getAuthState()))` branch in `fetchLane()` (was lines 216-223) — `fetchLane()` now always proceeds straight to the real RPC call.
- Deleted `renderFreeGate()` (the CTA-rendering method, including its `startCheckout`/`openExternalUrl` fallback) and `applyPublicRouteHighlight()` (only ever called from the gate branch) as fully dead code.
- Removed `'gate'` from the `displayMode` union and `resetLaneState()`'s `mode` param — only `'loading' | 'error'` remain live states now.
- Removed the `gateHitTracked` field and its `trackGateHit('route-explorer')` call in `open()` — the gate it tracked no longer exists.
- Removed the `tier` getter (`hasPremiumAccess(getAuthState()) ? 'pro' : 'free'`) and the `tier` prop it fed into every `trackEvent()` call — `trackEvent()` now just forwards `track(event, props)`. This mirrors the pattern task 12 used in `CountryDeepDivePanel.ts` (full strip, not a stub).
- Removed the now-dead `this.leftRail.element.classList.remove('re-leftrail--blurred')` / `removeAttribute('aria-hidden')` calls in `applyData()` — nothing ever adds that class or attribute anymore.
- Cleaned up now-unused imports: `hasPremiumAccess`, `getAuthState`, `trackGateHit`, `WEB_APP_ORIGIN`, `openExternalUrl`, `COUNTRY_PORT_CLUSTERS` (JSON import only used by the deleted `applyPublicRouteHighlight`), `TRADE_ROUTES` and the `CARGO_TO_ROUTE_CATEGORY`/`ROUTE_CATEGORY_MAP` module-level constants it fed (same reason).

`src/components/RouteExplorer/components/LeftRail.ts`:
- Removed `renderGate()` and the `'gate'` branch of `updateLane()`'s `mode` param (now `'loading' | 'error'` only). Confirmed via grep that `updateLane()` has exactly one call site left passing a mode (`RouteExplorer.ts:186`, `resetLaneState`), which no longer ever passes `'gate'`.

`src/styles/route-explorer.css`:
- Removed `.re-content__gate` (and its `h3`/`ul` rules), `.re-content__upgrade`/`:hover`, and `.re-leftrail--blurred` — all now-unreferenced by any JS after the above.

Left alone: `.re-leftrail__empty` (still used by `renderNoLane()`/`renderError()`, legitimate non-gate states).

## What I found but did NOT touch (out of this task's scope)

- `src/config/panels.ts` still has `premium: 'locked'` on several panels (`forecast` desktop-only, `latest-brief`, `oref-sirens`/`telegram-intel` desktop-only) and several `Panel.ts`-based components (`ChatAnalystPanel`, `DailyMarketBriefPanel`, `GlobalProcurementPanel`, `MarketImplicationsPanel`, `RegionalIntelligenceBoard`, `StockAnalysisPanel`, `StockBacktestPanel`, `WsbTickerScannerPanel`) still carry `premium: 'locked'` in their own source despite README claiming several of these (`stock-backtest`, `daily-market-brief`, `wsb-ticker-scanner`, `global-procurement`) were "unlocked" in task 10. Did not investigate whether that's a stale flag with a separate override elsewhere (e.g. `Panel.ts`'s own gate resolution) or a genuine regression — outside this task's two named findings, and `latest-brief` is explicitly documented elsewhere as intentionally still locked (real Clerk-account dependency). Worth a dedicated follow-up trace if it matters.
- `foodStocksProLocked` / `freePanelLimit` / `freeSourceLimit` i18n strings (`src/locales/*.json`) — separate paywall surface, unrelated to either of this task's two findings.
- Did not touch `UmamiEvent` type in `src/services/analytics.ts` — `'route-explorer:free-cta-click'` remains a defined (now-unused) union member; leaving it is harmless and matches how prior tasks left unused-but-harmless type unions alone rather than chasing every transitive reference.

## Verify
- `npm run typecheck` — clean.
- `npm run typecheck:api` — clean (unaffected by this change, run per CLAUDE.md's standing instruction anyway).
- `npm run build` — clean, no `source-attribution.mjs` failure (no new external hostname referenced).
- `node --test tests/panel-config-guardrails.test.mjs` — 22/22, no new failures.
- Grepped the whole repo for `resilienceScore.*'locked'`, `.re-content__gate`, `.re-content__upgrade`, `.re-leftrail--blurred`, "Upgrade to PRO for route intelligence", and `hasPremiumAccess`/`getAuthState`/`trackGateHit` inside `src/components/RouteExplorer/` — zero hits after the fix.
- Not independently verified live (no Redis/Convex credentials in this dev environment, same standing limitation as every task this session) — typecheck/build/guardrail-test clean is the full verification available offline. Per `CLAUDE.md`'s deploy gotcha, confirm against `https://worldmonitor-one-theta.vercel.app` after this lands and deploys, not just that it's on `main`.
