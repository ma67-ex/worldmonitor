**STATUS: DONE — 2026-08-31**

# isPanelEntitled's apiKeyPanels gate was unreachable for 5 BYOK panels

Found while continuing the sweep after tasks 24/25 — this is the opposite direction from the rest of the de-paywalling work: a gate that was *silently disabled by accident*, not a stale badge.

## What was wrong

`isPanelEntitled()` (`src/config/panels.ts:1288`) has an `apiKeyPanels` special-case for 5 panels that need the user's own AI key to function (`stock-analysis`, `market-implications`, `regional-intelligence`, `deduction`, `chat-analyst`) — but that branch only ran if `config.premium` was truthy first:

```js
if (!config.premium) return true;   // early return, before apiKeyPanels is ever checked
...
const apiKeyPanels = [...];
if (apiKeyPanels.includes(key)) { ... }
```

My own first commit on this fork (`cf35573`, 2026-08-16, `docs/tasks/abdullah/01-byok-panels.md`) removed `premium: 'locked'` from these 5 panels' `panels.ts` entries in the same commit that built the real replacement mechanism — `WEB_PREMIUM_PANELS`/`BYOK_GATED_PANELS` in `src/app/panel-layout.ts`, which gates by a fixed key set instead of `config.premium`. That was the right call for the panel's actual render-time lock CTA. But `isPanelEntitled`'s `apiKeyPanels` branch was never removed or reordered, and its doc comment still says it "Mirrors the entitlement checks in panel-layout.ts (single source of truth)" — it just went quietly unreachable for these 5 keys, since `!config.premium` now returns `true` before the check ever runs.

Confirmed via `git log -p --follow -- src/config/panels.ts` that the field removal was deliberate (part of shipping BYOK) and the dead apiKeyPanels branch left behind was the oversight, not a redesign — if it were intentional, the dead array/branch would have been deleted too.

## Real impact

`isPanelEntitled` has 8 production call sites beyond the panel's own render path. Panel-layout.ts's `WEB_PREMIUM_PANELS` check still correctly shows the lock CTA when you actually open one of these 5 panels without a key — but everywhere else that calls `isPanelEntitled` treated them as unconditionally entitled with no key present:

- `src/app/search-manager.ts:816` — CMD+K search listed them as available/toggleable for every user, key or not
- `src/App.ts:1724` — WebMCP's `isPanelAllowed`, so an AI agent could be told the panel is allowed with no key
- `src/components/UnifiedSettings.ts:879,959` / `src/settings-window.ts:93` — settings panel-toggle visibility

This is the exact same bug class an existing guardrail test in `tests/panel-config-guardrails.test.mjs` already documents and guards against for a *different* path — its comment cites PR #3578, where `regional-intelligence` was in `apiKeyPanels` but missing from `WEB_PREMIUM_PANELS`, producing a "PRO badge + visible internal loader" that looked broken. That guardrail only checks the two arrays are in sync (static text match) — it doesn't catch `isPanelEntitled`'s own internal short-circuit, which is a different gap with the same user-visible symptom, just reached through search/settings/WebMCP instead of the render path.

## Fix

Moved the `apiKeyPanels` check above the `!config.premium` early return in `isPanelEntitled`, so it's unconditional for those 5 keys (still short-circuited by a real `isEntitled()` Pro/Dodo check first). Every other panel's fast path (`!config.premium → true`) is untouched — same order, same behavior, zero perf/behavior change for the other ~180 panels.

## Verification

- New test: `tests/panel-entitlement-byok-guard.test.mts` — confirmed it fails against the pre-fix code (`git stash`) and passes after
- `tests/panel-config-guardrails.test.mjs`'s existing `WEB_PREMIUM_PANELS` guardrail still passes (76 tests, 1 pre-existing unrelated failure — `webmcp.test.mjs`'s exception-content test, present in the baseline before this change too)
- `npx tsc --noEmit -p tsconfig.json` — clean
- Full `npm run test:data`, diffed against the prior clean state: zero new failures, zero regressions
