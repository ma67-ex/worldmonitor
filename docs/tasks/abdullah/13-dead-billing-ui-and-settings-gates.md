**STATUS: DONE — 2026-08-24**

# Task: Kill dead billing UI and the two genuinely-locked settings gates

## Why
Second task from the plan (`/Users/muhammadabdullah/.claude/plans/glimmering-sleeping-lerdorf.md`). `CLAUDE.md` names `.upgrade-pro-section` explicitly in its hunt list. Turned out to be a much larger, more entangled surface than the plan estimated — documented here as actually executed, not as originally scoped.

## What was actually there (bigger than planned)
The plan expected: delete 2 dead files, remove a tab + `renderUpgradeSection()`, neuter `hasFeature()`. Real scope, traced before touching anything:

1. **`ProBanner.ts` / `CommunityWidget.ts`** — confirmed zero real importers (some files reference the string "ProBanner" in comments or import from the separate `pro-banner-policy.ts` decision-logic file, which is NOT the component and stays wired). Deleted both components.
2. **Their CSS** — not just the component files. `.pro-banner*` (main.css, ~100 lines) and `.community-widget`/`.cw-*` (main.css, ~160 lines across 2 more scattered spots) were fully orphaned once the components were gone — deleted. Also a `#proBannerSlot` DOM mount point in `panel-layout.ts`'s template that nothing ever filled, and its `.pro-banner-slot` CSS in `header.css`.
3. **`UnifiedSettings.ts`'s "Plan & billing" tab** — much more than a tab + one render method. Also entangled: `replaceUpgradeSection()` (re-rendered the section on subscription-change events), a subscription listener wired only to call it, an `onEntitlementVerificationChange` listener that existed only to call it too (removed that whole subscription — nothing else used it), and 3 click-delegate handlers (`.upgrade-pro-cta`, `.upgrade-to-business-btn`, `.manage-billing-btn`) whose only render sites were inside the now-deleted section, plus `handleUpgradeClick()` itself. `BusinessSeatsSection` (a real Business-tier seat-management subsystem, own file, own invite/remove handlers) was embedded inside the deleted section's output — left it wired as-is: it's a separate concern, still self-contained, out of scope for this task (matches the plan's precedent of not chasing every downstream implication of `hasTier(1)`).
4. **`hasFeature('apiAccess' | 'mcpAccess')`** — confirmed (grepped every call site fork-wide) these are the only two flags ever checked, both real UI-visibility gates reading a real entitlement field (not dead code, not rate limits). Neutered to always return `true` at the single choke point in `src/services/entitlements.ts`, matching task 08's precedent. Unlocks the API-keys tab (previously blocked at its own internal gate) and the MCP-clients tab (previously permanently hidden — nothing ever set `mcpAccess: true` on this fork). Removed the now-decorative `PRO` badges on both tab labels.
5. **Index.html's pre-paint skeleton** — found while cleaning up: a `wm-pro-banner-launched-dismissed` localStorage housekeeping block in the inline pre-paint script, only meaningful when `ProBanner.ts` still existed to write that key. Removed. (The `wm-pro-banner-reserved`/`entitledHint` CSS reservation system referenced elsewhere in `index.html` turned out to already be dead/unwired before this task — confirmed via `git stash`, not something this task broke or needed to fix.)

## What broke, and how it was fixed (not deferred)
Deleting live UI surfaces broke tests beyond the 12 pre-existing failures task 14 was scoped for. Found and fixed all of them in this task rather than letting task 13 land with new red tests:
- `tests/dom/pro-banner-premium-stability.test.mts` — entire file drove `ProBanner.ts`'s real DOM mount/unmount behavior. Deleted (component's gone, nothing to test).
- `tests/dom/unified-settings-upgrade-click-runtime.test.mts` — entire file tested `handleUpgradeClick()`. Deleted.
- `tests/dom/unified-settings-account-handoff.test.mts` — 2 of its tests asserted the billing tab's "Checking your plan…"/retry states. Removed those 2 (rest of the file is unrelated real handoff coverage, untouched).
- `tests/billing-state-wiring.test.mts` — 2 tests read `ProBanner.ts`/`UnifiedSettings.ts` source expecting the lapsed-billing-reactivation UI to exist. Removed (that UI is gone fork-wide now).
- `tests/pro-banner-entitlement-race.test.mts` — 1 test read `ProBanner.ts` source directly. Removed; the rest of the file (pure `pro-banner-policy.ts` logic tests, which is untouched) still passes.
- **Build itself broke**: `scripts/source-attribution.mjs` hard-fails on manifest drift (per `CLAUDE.md`'s own standing note) — deleting `CommunityWidget.ts` removed the only reference to `discord.gg`. Fixed with `node scripts/source-attribution.mjs --retire discord.gg --write`, exactly as the error message said to.

## Verify
- `npm run typecheck` — clean.
- `npm run typecheck:api` — clean.
- `npm run build` — clean (after the source-attribution retire; failed once before that fix, confirmed the fix resolves it, not just papers over it).
- `node --test tests/panel-config-guardrails.test.mjs` — 22/22.
- `npx vitest run --config vitest.dom.config.mts` (full suite, not just the affected files) — 33/34 files pass; the 1 failing file (`world-clock-tick.test.mts`, 7 tests) confirmed pre-existing and unrelated via `git stash` diff.
- `npx tsx --test tests/billing-state-wiring.test.mts` — 12 pass / 10 fail, confirmed via `git stash` the same 10 pre-existing failures as before this task (unmodified HEAD: 14 pass/10 fail; this task retired 2 obsolete-but-previously-passing tests, net matches).
- `npx tsx --test tests/pro-banner-entitlement-race.test.mts` — 28 pass / 3 fail, confirmed via `git stash` the same 3 pre-existing failures.
- `node --test tests/unified-settings-active-tab.test.mjs` — 6/6, unaffected.
- `npx vitest run server/__tests__/entitlement-check.test.ts` — 67 pass / 10 fail, unchanged from task 12 (this task didn't touch server-side entitlement paths).
- **Not verified live** — same standing limitation as every prior task this session (no Redis/Convex credentials, unreliable browser-preview tool). Spot-check in a real browser after deploy: Settings modal signed-out should show no "Plan & billing" tab at all; signed-in should show no billing tab either (feature removed entirely, not just gated); API Keys and MCP Clients tabs should render real content, no `PRO` badge, no lock screen.

## Next
Task 14 — rewrite/retire the original 10+2 pre-existing obsolete failures (`entitlement-check.test.ts`, `summarize-article-handler-security.test.ts`, `widget-agent-billing-denial.test.ts`'s stale import), per the plan. Still explicitly out of scope: scenario modeling / Railway go-no-go, `hasTier(1)` call sites outside `UnifiedSettings.ts`.
