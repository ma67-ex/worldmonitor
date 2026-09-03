**STATUS: DONE — 2026-09-03**

# 30 — Bundle-size wins: SW precache, dead WebGPU code, chunk-naming drift

Not from the depaywall hunt list. Owner asked for perf/cleanliness work with
a hard constraint: never remove a panel, feature, or user-facing
functionality — config-only and dead-code changes only. A read-only survey
(separate pass) audited the whole codebase first and came back with the
runtime-smoothness side already clean (polling, DOM-write discipline, and
caching all checked out — nothing to fix there); the real remaining wins
were in bundle size. This task implements the 4 items the owner approved as
safe/config-only. A 5th item (deferring the checkout subsystem's boot-time
import) was attempted, found to be both ineffective and risky, and reverted
— see "Item 5" below.

## Item 1 — Service-worker over-precaching

`vite.config.ts`'s PWA `globIgnores` was missing several asset patterns that
got precached on every first visit regardless of whether the user ever
touches the feature behind them:

- `GlobeMap-*.js` (1.79MB) — only loaded when switching to globe view.
- `main-*.css` (531KB) — verified via grep that only `settings.html` and
  `live-channels.html` reference this stylesheet; the dashboard entry
  (`src/main.ts`) never does.
- `hls-*.js` (512KB) — video player, already lazy-loaded at runtime
  (`LiveNewsPanel.ts:1352`), just wasn't excluded from precache.
- `sentry-*.js` (440KB) — deliberately deferred at runtime already
  (`src/bootstrap/sentry-defer.ts`) — precaching it eagerly undid that
  deferral's entire point.

## Item 2 — Locale chunk regex bug (real bug, not just a size issue)

`vite.config.ts`'s locale-chunk-naming regex was `/\/locales\/(\w+)\.json$/`
— `\w` doesn't match `-`, so `src/locales/zh-TW.json` fell through to a
differently-named chunk (`zh-TW-*.js` instead of `locale-zh-TW-*.js`). This
broke two things that pattern-match on the `locale-` prefix: the
`globIgnores` precache exclusion, AND the runtime Workbox `CacheFirst` rule
(`cacheName: 'locale-files'`) — meaning zh-TW readers got **zero**
client-side caching of their locale file, a real functional bug beyond the
precache-size waste. Fixed to `/\/locales\/([\w-]+)\.json$/`; the deliberate
`en.json` exclusion (a separate `!== 'en'` check) was left untouched.

## Item 3 — Two confirmed-dead WebGPU code paths

**`three/webgpu`** (~585KB minified / ~165KB gzip, in the GlobeMap chunk):
`three-render-objects.mjs` unconditionally imports `WebGPURenderer` from it
at module scope, but this app's only `rendererConfig`
(`src/components/GlobeMap.ts` ~line 673-679) never sets `useWebGPU: true`,
so `three-render-objects` always defaults to `false` → plain
`WebGLRenderer`. The second reachability path, `three-globe.mjs`'s
`computeGeoKde` (GPU heatmap kernel-density), only runs on non-empty
`heatmapsData` — `GlobeMap.ts` never calls it, so globe.gl's default `[]`
stands.

**`wgsl_reflect`** (~192KB minified / ~45KB gzip, in the `conflict-zone-cull`
chunk): pulled in via `@luma.gl/shadertools`'s barrel re-export of
`getShaderLayoutFromWGSL`, reachable only through a WebGPU device adapter.
`@luma.gl/webgpu` is not a dependency of this project at all (`grep -rn
"@luma.gl/webgpu|WebGPUDevice" src` — zero hits).

Both aliased in `vite.config.ts`'s `resolve.alias` to new stub files
(`scripts/stubs/three-webgpu-stub.ts`, `scripts/stubs/wgsl-reflect-stub.ts`)
that satisfy the TypeScript import surface but **throw loudly on
construction** if actually instantiated — so if this dead-code analysis is
ever wrong, it fails hard instead of silently rendering a broken globe.

**Runtime verification not performed** — no browser environment in this
session to open the globe view and confirm `globe.renderer().constructor.name
=== 'WebGLRenderer'` live. The static analysis (no `useWebGPU: true` call
site anywhere in the app, confirmed by grep) is strong, and the stub's
throw-on-construct design means a wrong assumption surfaces immediately and
loudly the first time someone opens the globe view in a real browser,
rather than degrading silently. Flagging this as the one unverified claim in
this task.

## Item 4 — Chunk-naming drift hiding real content

`vite.config.ts`'s `manualChunks` uses `onlyExplicitManualChunks: true`, so
any static import Rollup can't match to an explicit rule lands in an
arbitrary bucket named after whichever file Rollup happens to pick — hiding
the chunk's real size from the build log:

- `conflict-zone-cull-*.js` (was 275KB) — actually dominated by
  `src/config/commodity-geo.ts` (26KB) + the now-removed wgsl_reflect dead
  weight, named after a 2.7KB unrelated file.
- `layer-explanation-card-*.js` (was 127KB) — actually dominated by
  `src/components/MapPopup.ts`, named after a 2.0KB unrelated file.

Added explicit `manualChunks` entries for both, following this file's
existing `geo-map-data`/`tech-geo-data` convention — new chunks
`commodity-geo-data-*.js` and `map-popup-*.js` now show their real,
accurate sizes in the build log.

## Item 5 — Checkout deferral: attempted, reverted (not shipped)

The original plan (per the survey) was to convert `src/App.ts`'s eager
static imports of `@/services/checkout` to a dynamic `import()` deferred
until after first paint, since nobody actively completes a Pro purchase on
this fork. **This was implemented, independently verified, and then
reverted** for two reasons discovered during review:

1. **Zero actual bundle benefit.** Rollup's own build-warning output
   flagged that `checkout.ts` is *also* statically imported by
   `src/app/panel-layout.ts` (6 symbols:
   `registerCheckoutSuccessCallback`, `destroyCheckoutOverlay`,
   `showCheckoutSuccess`, `consumePostCheckoutFlag`, `clearCheckoutAttempt`,
   `loadCheckoutAttempt`) and `src/components/checkout-failure-banner.ts` —
   both of which stayed untouched. Because a module with even one remaining
   static importer can't be moved to a separate chunk, the module still
   shipped in the same place; `main-*.js` measured byte-identical
   (859.42KB) before and after the App.ts change.
2. **Real ordering risk for zero gain.** App.ts's deferred
   `capturePendingCheckoutIntentFromUrl()` call (now scheduled for
   post-first-paint) races against `panel-layout.ts`'s
   `handleCheckoutReturn()`, which still runs synchronously during
   panel-layout's mount — well before first paint. The removed code's own
   comment stated the invariant this depends on: the failure-retry banner's
   `handleCheckoutReturn` must run *after* the URL-intent capture
   repopulates the attempt record. Deferring only the App.ts half broke
   that ordering guarantee for a real payment-return flow, in exchange for
   a change that (per point 1) saved zero bytes. Not a trade worth making,
   especially under the "never risk a real feature" constraint.

`src/App.ts` was reverted to its committed state; `git diff` for this task
touches only `vite.config.ts` and the two new stub files. Properly deferring
checkout would need panel-layout.ts's and checkout-failure-banner.ts's
static imports addressed in the same change (with careful sequencing of
`registerCheckoutSuccessCallback`'s must-register-before-it-could-fire
timing and `destroyCheckoutOverlay()`'s must-run-synchronously-on-teardown
constraint) — flagging as a real future task, not something to rush.

## Verification

1. `npx tsc --noEmit -p tsconfig.json` — clean.
2. `npx tsc --noEmit -p tsconfig.api.json` — clean.
3. `npm run build` — clean. Before/after (all measured, not estimated):

   | | before | after | saved |
   |---|---|---|---|
   | SW precache total | 11,428 KiB (243 entries) | 7,852 KiB (239 entries) | **~3.5MB** |
   | GlobeMap chunk | 1,829.38 KB / 506.38 KB gzip | 1,219.79 KB / 334.74 KB gzip | **~610KB / ~172KB gzip** |
   | `conflict-zone-cull` chunk | ~275 KB | 59.05 KB / 21.37 KB gzip | **~216KB** |
   | `locale-zh-TW` chunk | `zh-TW-*.js` (mis-named, uncached) | `locale-zh-TW-*.js` (correct) | bug fix |
   | `commodity-geo-data` / `map-popup` chunks | hidden inside mis-named buckets | 26.64KB / 124.17KB, correctly named | visibility fix |
   | `main-*.js` (post Item-5 revert) | 859.42 KB | 859.42 KB | unchanged, as expected |

4. Targeted tests (`tests/dashboard-eager-chunks.test.mjs`,
   `tests/deploy-config.test.mjs`, `tests/panel-cluster-chunks.test.mjs`,
   `tests/pro-sentry-chunk.test.mjs`): 354 tests, 349 pass, 5 fail — all 5
   confirmed pre-existing via two independent methods: (a) re-running
   `tests/panel-cluster-chunks.test.mjs`'s checkout-chunk assertion against
   the untouched committed baseline (`git stash`) reproduces the identical
   failure with zero relation to this task's changes; (b) the other 4
   (`skeleton-brand` × 2, `CSP script-src hashes`, `pins welcome and
   dashboard SEO canonicals`) all appear verbatim in this session's earlier
   saved baseline failure captures from tasks 28/29, predating this task
   entirely.
5. Full `npm run test:data` — see commit for final count, cross-checked
   against the same pre-existing-failure baseline this session has used
   throughout.
