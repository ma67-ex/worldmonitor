**STATUS: DONE — 2026-08-24**

# Task: 2D map falls back to plain SVG in local dev, works fine on production

## Why
Not from `CLAUDE.md`'s hunt list — found while checking `10`'s panel unlocks in local dev. `src/components/MapContainer.ts` was consistently logging `Initializing SVG map (mobile/fallback mode)` locally: no deck.gl/maplibre, just the flat SVG placeholder, even on a full-width desktop window with real WebGL2 hardware acceleration.

## Root cause
`MapContainer`'s constructor decided the renderer (SVG vs deck.gl vs 3D globe) synchronously, at the moment the class was constructed — before `init()`'s own `await afterFirstPaint();` had a chance to let the browser window settle:

```ts
constructor(...) {
  ...
  this.isMobile = isMobileDevice();              // window.innerWidth <= 768
  this.useGlobe = preferGlobe && this.hasGlobeSupport();
  this.useDeckGL = !this.useGlobe && this.shouldUseDeckGL();  // reads this.isMobile
  ...
  void this.init();  // init() THEN awaits afterFirstPaint() before using these
}
```

Once `useDeckGL` was set `false` here, it was never re-derived — `init()` just branched on the stale value after its `afterFirstPaint()` wait. If `window.innerWidth` was ≤768 at the exact instant of construction (a local dev window that hasn't been maximized/settled yet, DevTools eating horizontal space, a narrow split-screen — anything that isn't true on a production tab typically opened already full-size), the session permanently locked onto the SVG fallback for its entire lifetime, no later resize could fix it. `App.ts:901`'s separate top-level `isMobile` (used for default layers, initial zoom/view) has the exact same one-shot-at-boot shape but was left alone — much larger blast radius (touches unrelated mobile-layout behavior across the app), out of scope for what's actually a map-renderer bug specifically.

## Fix
`src/components/MapContainer.ts`:
- Kept the constructor's synchronous read as a best-effort initial guess (still needed — `getPendingRendererKind()`/`showRendererShell()` and the public `isMobile()` getter can be read before `init()`'s `afterFirstPaint()` resolves).
- Re-derive `this.isMobile`, `this.useGlobe`, `this.useDeckGL` a second time inside `init()`, right after `await afterFirstPaint()` resolves and right before the renderer branch — the earliest point layout is reliably settled.
- Extracted the `resilienceScore` layer-gating side effect (`!useDeckGL` clears that layer) into `applyResilienceScoreGate()` so it re-runs against the corrected value too, not just the constructor's stale guess.
- Added `preferGlobe` as a stored field so the re-derivation can reuse it without re-threading a constructor parameter.

## Verify
- `npm run typecheck` — clean.
- `npm run build` — clean.
- **Live browser verification not possible this session**: this environment's preview tool serves a dev server whose filesystem view doesn't reflect edits made through the file-editing tools — confirmed directly, not assumed: `md5` of the on-disk file vs. `curl http://localhost:3020/src/components/MapContainer.ts | md5` differ, and a cache-busted `fetch(..., {cache:'no-store'})` still returned pre-fix content. This is a sandbox/preview-tool mismatch in this session, not a code issue — the dev server process's own shell couldn't resolve `getcwd()` for its parent directories either (`shell-init: error retrieving current directory: getcwd: cannot access parent directories: Operation not permitted`, visible in its logs), consistent with it running in a separate mounted view than the one the editing tools write to. Static verification (typecheck + build) is what backs this fix; the actual runtime behavior change (SVG → deck.gl on a normal-width window) is unverified live and should be spot-checked in a real browser at `localhost:3020` before/after this commit, or against production after deploy.

## Remaining, not done here
`App.ts:901`'s own `isMobile` has the identical one-shot-at-boot pattern (affects default map layers, initial zoom/view, a couple of other UI branches at `App.ts:2113`/`2142`). Deliberately left alone — same race in principle, but a much wider blast radius to fix reactively, and no report of it actually misfiring the way the map renderer did. Flag for a future task if it turns out to bite the same way.
