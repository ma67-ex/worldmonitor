**STATUS: TODO — spec'd 2026-09-01, ready to execute (no decisions left)**

# 28 — Remove dead `Panel.showLocked()` CTA + unreachable `lockedFeatures` plumbing

Flagged by task 27, not fixed there ("a second small-but-separate cleanup, not folded in here"). Mission fit: `showLocked()`'s CTA button calls `startCheckout()` / opens `https://worldmonitor.app/pro` — exactly the checkout/billing UI `CLAUDE.md`'s hunting list says to kill, and it's confirmed unreachable in production.

## Confirmed dead (already verified, don't re-derive)

- `Panel.showLocked(features)` — [`src/components/Panel.ts:956-997`](../../../src/components/Panel.ts#L956-L997). Only call site: [`panel-layout.ts:3371-3372`](../../../src/app/panel-layout.ts#L3371-L3372) — `if (lockedFeatures) basePanel.showLocked(lockedFeatures);` inside `lazyPanel()`.
- `lockedFeatures` is threaded through 3 methods purely to reach that one branch: `lazyPanel` ([panel-layout.ts:3351-3387](../../../src/app/panel-layout.ts#L3351-L3387), param at line 3355), `lazyImportedPanel` ([panel-layout.ts:3316-3330](../../../src/app/panel-layout.ts#L3316-L3330), param at line 3322), `lazyDefaultPanel` ([panel-layout.ts:3332-3340](../../../src/app/panel-layout.ts#L3332-L3340), param at line 3337).
- Grepped every one of the ~90 `this.lazyPanel(`/`this.lazyImportedPanel(`/`this.lazyDefaultPanel(` call sites in `createPanels()` (panel-layout.ts, roughly lines 1720-2595): **zero pass a `lockedFeatures` arg.** The branch is dead code, not just an edge case.
- `showLocked` is directly called from exactly 2 test files, both confirmed still passing today (2026-09-01): `tests/panel-unlock-restore.test.mts` and `tests/dom/panel-error-latch.test.mts`. No other reachability.

## Step 1 — `src/components/Panel.ts`

Delete the whole `showLocked` method, lines 956-997 (from `public showLocked(features: string[] = []): void {` through its closing `}`, the blank line right before the `gatedCtaEntry` doc comment stays).

After deleting it, `openExternalUrl` (imported at line 11: `import { openExternalUrl } from '@/services/external-navigation';`) has no remaining call site in this file — remove that import line too. Do NOT touch these, they're still used elsewhere in the file:
- `isDesktopRuntime` — still used at `showConfigError` (line ~1207).
- `lockSvg` — still used 4x in `gatedCtaEntry` (lines ~1014/1026/1032/1038).
- The dynamic `import('@/services/checkout')` / `import('@/config/products')` calls only existed inside `showLocked` — nothing else to clean up there, they're not static imports.

## Step 2 — `src/app/panel-layout.ts`

Remove the now-dead `lockedFeatures` parameter and its pass-through, in this order (each is a 2-4 line edit):

1. `lazyPanel` (~line 3351): delete the `lockedFeatures?: string[],` parameter (line 3355), then collapse the `if (lockedFeatures) { basePanel.showLocked(lockedFeatures); } else { ... }` (lines 3371-3382) down to just the `else` body, unconditionally — i.e. `updatePanelGating`/`replayPendingCalls`/the destroyed-check/`setup(panel)` always run, the `showLocked` branch and its `if`/`else` wrapper are gone.
2. `lazyImportedPanel` (~line 3316): delete the `lockedFeatures?: string[],` parameter (line 3322) and its pass-through arg in the `return this.lazyPanel(...)` call (line 3328).
3. `lazyDefaultPanel` (~line 3332): delete the `lockedFeatures?: string[],` parameter (line 3337) and its pass-through arg in the `return this.lazyImportedPanel(...)` call (line 3339).

## Step 3 — `tests/panel-unlock-restore.test.mts`

- Delete the whole `it('showLocked → unlockPanel also restores via the snapshot', ...)` block (lines 91-108). It's fully redundant once `showLocked` doesn't exist — the identical restore-by-identity guarantee is already covered by the `showGatedCta → unlockPanel restores...` test right above it (lines 40-89), which exercises the same shared snapshot/restore machinery.
- Rename `it('a second showLocked WHILE already locked does not corrupt the snapshot', ...)` (line 135) — it doesn't actually call `showLocked` anywhere in its body (it calls `showGatedCta` twice), the name is just stale. Rename to `'a second lock call WHILE already locked does not corrupt the snapshot'`. No logic change.
- Update the two comments that mention `showLocked` (lines 12-13 and 24-25 at the top of the file) to drop it, e.g. `Panel.ts (showLocked / showGatedCta / unlockPanel)` → `Panel.ts (showGatedCta / unlockPanel)`, and `Panel snapshots this.content's child nodes at the moment showLocked / showGatedCta replaces them` → `... at the moment showGatedCta replaces them`.

## Step 4 — `tests/dom/panel-error-latch.test.mts`

Both remaining call sites just need `showLocked(['probe feature'])` swapped for `showGatedCta('free_tier', () => {})` — same `.panel-locked-state` output, same `_locked` flag, verified by reading `showGatedCta`'s body (`Panel.ts:1053-1086`): identical `_locked = true` / `clearRetryCountdown()` / `_snapshotContentForRestore()` / `replaceContent(...panel-locked-state...)` sequence `showLocked` used. Zero coverage lost.

- Line 257: `panel.showLocked(['probe feature']);` → `panel.showGatedCta('free_tier', () => {});`
- Line 285: `panel.showLocked(['probe feature']);` → `panel.showGatedCta('free_tier', () => {});`
- Line 253's comment (`showGatedCta/showLocked painted premium markup...`) — drop `/showLocked`, it's just `showGatedCta` now.

## Verification (run all of these, in order)

1. `npx tsc --noEmit -p tsconfig.json` — must be clean (catches the `lockedFeatures` signature changes and the dropped `openExternalUrl` import).
2. `npx tsx --test tests/panel-unlock-restore.test.mts` — expect 6/6 passing (was 7, minus the one deleted `it`).
3. `npx vitest run tests/dom/panel-error-latch.test.mts --config vitest.dom.config.mts` — expect the same pass count as before the edit (only the two calls changed, not the assertion count).
4. `npm run build` — clean.
5. Full `npm run test:data`, diffed against a `git stash` baseline the same way task 27 did it (stash the touched files, run, note total/failing count, unstash, run again, `comm` the sorted failure-title lists) — expect **zero new failures, zero new passes** (same 235-failure baseline task 27 confirmed, unless it's drifted — if the baseline count differs, that's pre-existing and unrelated, not something this task introduced).

Mark this file `**STATUS: DONE — <date>**` at the top and add a one-line entry to `README.md`'s numbered list when finished, same as every task before it.
