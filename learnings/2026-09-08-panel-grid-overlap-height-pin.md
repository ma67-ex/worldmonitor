# Dashboard panels overlap when a panel renders taller than its grid cell

**Date:** 2026-09-08

## Problem

Playing a YouTube / live-news video (or opening any tall panel) on the dashboard
made other panels render on top of it — AI Insights sitting on the lower half of
the live-news video, strategic-posture bleeding across cii / strategic-risk, etc.
User's words: "other panels override it or are on half of it."

## Approach

1. Read `docs/Docs_To_Review/PANELS.md` + `src/styles/main.css` `.panels-grid` /
   `.panel` rules. Grid is `grid-template-columns: repeat(auto-fill, minmax(280px,1fr))`,
   `grid-auto-rows: minmax(--dashboard-panel-row-min /*200px*/, --dashboard-panel-row-max /*380px*/)`,
   `grid-auto-flow: row dense`. `.panel` has `overflow:hidden; height:100%; contain:content`.
2. Suspected content overflow first — ruled out: `.panel { overflow:hidden }` clips content.
3. Suspected `grid-auto-flow: dense` packing — ruled out: CSS grid never overlaps
   auto-placed items.
4. Measured the live DOM on worldmonitor.app (browser tool, `getBoundingClientRect`
   + computed `grid-template-rows`). Found the smoking gun:
   - Grid rows **all resolve to 200px** (33 rows, `distinctRowSizes: ["200px"]`).
   - `main.css` had two blocks (~line 1746-1798) pinning "always-full" panels
     (`live-news`, `live-webcams`, `threat-timeline`, `gdelt-intel`,
     `strategic-posture`, `intel`, `politics`, `energy-complex`, `global-procurement`,
     `cascade`) to `height: var(--dashboard-panel-row-max)` (380px, 1-row) or
     `calc(var(--dashboard-panel-row-max) * 2 + gap)` (764px, wide/span-2).
   - So `live-news` occupied a 2×200+4 = 404px grid area but rendered `height: 764px`
     → overflowed 360px → the next grid item (`insights`, placed correctly at the
     404px cell boundary) painted over the overflow. Same for every pinned panel.
   - `cii` (span-2, **not** in the pin list) rendered `height: 404px` = exactly its
     grid area → no overlap. That contrast confirmed the diagnosis.
5. Tested the fix live by injecting `height: 100% !important` for those selectors →
   re-ran a pairwise overlap detector across all 43 panels + video playing +
   map-pinned layout → overlap count went from many to **0**.
6. Applied: deleted the three pin blocks, replaced with a `ponytail:` comment.
   `.panel { height: 100% }` (already there, main.css:1724) now governs.

## Why

- A `height` on a CSS **grid item** does not size its track. `minmax(200px, 380px)`
  auto-rows size from content contribution, clamped to a *fixed* 380px max — and the
  panels' content scrolls inside `.panel-content`, so it never pushes the row past
  the 200px min. The pins therefore never achieved their stated #5332/#4580 goal
  (pre-reserving a 380px row against CLS); they only ever made the panel overflow.
- `height: 100%` is geometry-agnostic: the panel fills whatever the grid area
  resolves to (200px, 404px, or 380px if a row ever does grow). Overlap becomes
  structurally impossible because the grid itself places panels without overlap.
- The `:not(.resized)` guard on every pin block was the tell: resized / `.span-N`
  panels already relied on `.panel { height:100% }` + `grid-row: span N` and worked
  fine. The fix just makes non-resized panels behave the same way.
- The deferred-shell CLS reservations (`.panel-deferred-shell.panel-wide` etc. use
  `--dashboard-first-grid-reservation` = 404px) actually *match* the grid-span
  height (404px), not the buggy 764px pin — so removing the pins improves the
  shell→panel hydration shift rather than regressing it.

## Gotchas

- Don't "fix" this by hand-tuning the pin constants to 200/404px — that breaks at
  any breakpoint where tracks differ (mobile `@media (max-width:768px)` sets
  `.panel { max-height: min(70vh,500px) }` and a single-column flex layout).
  `height: 100%` is the only value that's correct at every track size.
- Don't chase *why* the 380px track never materializes — irrelevant to the fix.
- Don't turn this into a z-index / stacking system. The grid places panels without
  overlap; only the forced heights broke that.
- Resize path (`Panel.ts`) uses span classes only, never inline pixel heights — so
  it was never affected and needs no change.
- The layer control is duplicated in `DeckGLMap.ts` (2D) and `GlobeMap.ts` (3D) —
  shared helpers live in `src/config/map-layer-definitions.ts`.

## Reusable pattern

CSS grid children overlapping = something is rendering outside its grid area.
Nearly always an explicit `height` / `min-height` / `position` on a grid item that
exceeds its `grid-row` span times the resolved track height. Measure the computed
`grid-template-rows` and each child's `getBoundingClientRect` vs its span; fix by
letting the item fill its area (`height: 100%`) instead of pinning pixels, or size
the track (`grid-auto-rows: <fixed>`), never the item.
