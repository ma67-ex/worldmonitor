**STATUS: DONE — 2026-08-31**

# Desktop-only stale PRO badges (task-20 pattern, missed because it's desktop-scoped)

Found while sweeping `src/config/panels.ts` per `CLAUDE.md`'s hunting list (`grep -rn "premium: 'locked'"`). Task 20 (2026-08-24) already killed stale `premium: 'locked'` badges on 4 fully-unlocked web panels, but never checked the desktop (`isDesktopRuntime()`) branch or the `'enhanced'` tier — both existed unnoticed until now.

## What was wrong

`_desktop && { premium: 'locked' | 'enhanced' }` was conditionally re-added to 7 panels and 2 map layers, **only when running as the Tauri desktop app** (Windows/macOS/Linux downloads, promoted in `README.md`):

- Panels (`src/config/panels.ts`): `forecast`, `oref-sirens`, `telegram-intel` (`'locked'`); `cii`, `strategic-risk`, `gdelt-intel`, `supply-chain` (`'enhanced'`)
- Map layers (`src/config/map-layer-definitions.ts`): `gpsJamming` (`'locked'`), `ciiChoropleth` (`'enhanced'`)

Two different bugs, verified before touching anything:

1. **Panels + `ciiChoropleth`/`'enhanced'` layer — cosmetic only, but real.** `Panel.ts:254` shows a `panel-pro-badge` ("PRO") whenever `options.premium` is truthy and no API key/AI key is present — true for every normal desktop user. `isPanelEntitled()` (`panels.ts:1296`) actually returns `isDesktopRuntime()` for `'locked'` panels, which is `true` while running desktop — so access was never blocked, just a misleading PRO badge shown on 7 panels in the shipped desktop app. Same for `'enhanced'`: `premium-layer-gate.ts`'s own comment confirms `'enhanced'` is "PRO badge only; free users can still toggle" — never a real gate.
2. **`gpsJamming` layer — a real functional gate**, not cosmetic. Map layers go through a *different* check (`getPremiumLayerPresentation` → `hasPremiumAccess(authState)` in `src/services/panel-gating.ts:55`), which has no desktop carve-out — it only returns true for a real `WORLDMONITOR_API_KEY`, `isProUser()` (Clerk), or `authState.role === 'pro'`. None of those exist on this fork. So on desktop, `gpsJamming`'s checkbox was genuinely disabled (🔒) with no way to enable it — an actual live paywall gate, not a badge.

Checked the third `_desktop`-gated layer, `iranAttacks`: still `'locked'` on desktop, left untouched — it's the already-sunset Iran-events layer (war ended 2026-07, comment at `panels.ts:12-16`), stripped by `isSunsetLayer()`/`getAllowedLayerKeys()` before it ever reaches a user regardless of platform. Not reachable, not in scope.

Also checked `bases: !_desktop` in `DEFAULT_MAP_LAYERS` (`panels.ts:144`) — a plain default-off toggle, no premium/lock/CTA involved. Left alone, out of mission scope.

## Fix

Removed the `_desktop &&` premium wrapper from all 7 panels and both layers — they're unconditional free config now, same as on web. `_desktop` const stays (still used by `iranAttacks`/`bases` above).

## Verification

- `npx tsc --noEmit -p tsconfig.json` — clean
- Updated `tests/panel-variant-config.test.mts`'s supply-chain-metadata test (it literally regex-matched the old `premium: 'enhanced'` source string) to assert no premium metadata anywhere instead
- Ran every test file referencing the touched keys (`map-layer-executable`, `docs-stats-plan-layer-entitlement`, `map-svg-layer-gate`, `map-layer-initial-url-gate`, `panel-variant-config`, `dom/globe-premium-layer-gate`, `search-cmdk-premium-layer-gate`) — diffed against a `git stash` baseline to confirm zero new failures beyond the one test above (now fixed)

## Found but NOT fixed — flagging for a future task

The stash-diff surfaced **14 pre-existing failing tests**, unrelated to this change, spread across `tests/search-cmdk-premium-layer-gate.test.mts` (6 of 8 tests), `tests/map-layer-executable.test.mts`, `tests/map-svg-layer-gate.test.mts`, `tests/map-layer-initial-url-gate.test.mts`, and `tests/dom/globe-premium-layer-gate.test.mts`. Root cause: they all assert `LAYER_REGISTRY.resilienceScore.premium === 'locked'` and build their "locked layer" test fixtures around it — but `resilienceScore` has had no `'locked'` marker since task 03 (2026-08-22, see the comment at `map-layer-definitions.ts:91-93`: "De-paywalled on this fork ... no 'locked' marker here"). Same class of test debt task 14 already cleaned up elsewhere (`entitlement-check.test.ts` etc.), just never caught in these files. This is a real, sizeable cleanup (5 files, ~14 tests, need a real fixture layer to stand in for "locked" since none exists in the live registry anymore) — didn't fold it into this task to keep this change reviewable; worth its own task file.
