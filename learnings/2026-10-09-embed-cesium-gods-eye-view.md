# Embedding a Cesium 3D view (God's Eye View) in the map

**Date:** 2026-10-09

## Problem
Add the open-source God's Eye View (Cesium, MIT) to World Monitor so users who zoom in, or want a 3D view, can get it inside the app, not as an outbound link.

## Approach
Rejected a fourth MapContainer renderer (it would need ~50 data setters). Built a lazy overlay instead: `GodsEyeEntry.ts` (tiny button, always loaded) dynamically imports `GodsEyeView.ts` (Cesium viewer over the map container). Camera handoff uses the map's centre and zoom going in, and pickPosition on the screen centre going out. Dead ends: `cesium@1.124.0` pulled mismatched `@cesium/engine` copies and a `@zip.js/zip.js` without `lib/zip-no-worker.js`, which broke Vite dep pre-bundling. Upgrading to 1.146.0 fixed it.

## Why
- Overlay keeps the live map untouched, so exit is just `setCenter`.
- `vercel.json` CSP uses `strict-dynamic`, which ignores `'self'` for scripts, so Cesium workers could be blocked. Cesium assets are self-hosted under `/cesium/` (small Vite plugin: dev middleware plus copy at `closeBundle`) with their own `script-src 'self'` header rule. The catch-all header regex now excludes `cesium/`.
- `vite-plugin-cesium` was skipped because it injects a global script tag.
- The repo's `check-vite-env-secrets.mjs` rejects `VITE_*KEY/TOKEN`, so the photoreal-tiles upgrade was dropped. It stays keyless (Esri imagery plus Re:Earth terrain). Photoreal would need a server-side token proxy.
- `onStateChanged` is a single slot, so MapContainer wraps it (callback plus entry zoom hint) instead of adding a second subscriber.

## Gotchas
- Use maplibre zoom math: 78271.5 m/px (512px tiles), not 156543.
- Add `cesium` to `LAZY_HTML_PRELOAD_CHUNKS`, `manualChunks`, and PWA `globIgnores`.
- The full `npm run build` runs a prebuild that fails here for unrelated reasons; use `npx vite build`.
- The preview pane is "hidden", so rAF is throttled: the deck renderer takes ~30s to attach and Cesium tiles load slowly. Call `tabs_select` and wait before concluding it is broken.
- The dev URL clamps zoom to 10.

## Reusable pattern
Heavy WebGL add-on to a CSP-locked Vite app: dynamic-import it, self-host its runtime assets with a dedicated header rule, keep it out of precache and modulepreload, and overlay rather than adding a renderer.

## Follow-up: 3D buildings, road map, no logo
- Keyless 3D buildings: OpenFreeMap vector tiles (`tiles.openfreemap.org/planet` TileJSON, `building` layer, `render_height`) decoded with `@mapbox/vector-tile` + `pbf`, extruded as one Cesium `Primitive` per z14 tile, base height from `sampleTerrainMostDetailed`.
- Road map: Esri `World_Street_Map`. Carto raster tiles now stamp "API KEY REQUIRED" across the map, so do not use them.
- Cesium logo is hidden by passing a detached `creditContainer`. A visible attribution line (Esri, OSM/OpenFreeMap, Re:Earth) replaces it because those data licences still require credit.
