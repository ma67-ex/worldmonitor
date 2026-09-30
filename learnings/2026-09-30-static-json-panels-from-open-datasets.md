# Adding Congress, POTUS and Mining panels from open datasets

**Date:** 2026-09-30

## Problem
Add the data behind kadoa.com's Congress, POTUS and Mining trackers to World Monitor without paying for an API and without adding a backend.

## Approach
1. Cloned kadoa-org's repos. They publish no API: the Congress and Mining repos commit finished static JSON and a SQLite file, and the POTUS repo is only a UI over a private Supabase database (no data to reuse).
2. Looked for a real API. Bargo's free Congress API answered curl once, then every later call got a Cloudflare "Just a moment" 403, so it is unusable from scripts and CI. Dropped it.
3. Used kadoa's raw GitHub files for Congress and Mining (MIT, updated continuously) and CNN's public Truth Social archive for POTUS (open CORS, refreshed every few minutes).
4. `scripts/build-alt-data.mjs` downloads each source and writes a slim JSON file (~10-20KB each) to `public/data/`. The full Congress dataset is 123MB, so it was never bundled.
5. A small `StaticJsonPanel` base class fetches one JSON file and renders it. The three panels extend it.
6. `.github/workflows/refresh-alt-data.yml` re-runs the script every 6 hours and commits only when content changed.

## Why
Every source is a static file, so cost is zero and there is no rate limit or bot protection to fight. Slimming to the latest rows keeps the repo and page small.

## Gotchas
- Mining values are mixed: pick `metric='production'`, quarterly, units `kt`/`koz`, one row per mine+commodity (latest period, best basis) or mines get double counted. Some rows have a null `calendar_period`; filter them before sorting.
- `node:sqlite` reads `mining.db` with no dependency (Node 24+).
- Registering a panel touches four files: `panels.ts` (three places: the full-variant default-off entry, the finance entry, the finance `panelKeys` list), `panel-layout.ts` (`lazyDefaultPanel`), `components/index.ts`, `commands.ts`.
- New panels do not appear for browsers that already have saved panel settings; clear `worldmonitor-panels`, `panel-order` and `worldmonitor-panel-layout-variant` from localStorage to test.
- Panels are deferred until a real scroll event; `scrollIntoView` from JS did not mount them in the preview pane.
- `innerText` on a panel read as empty while the DOM had content; check `textContent`. `performance.getEntriesByType('resource')` also overflows on this app, so use the network tool.
- The local dev server has no API backend, so other panels show 503; that is unrelated.

## Reusable pattern
When asked to "add a free API", first check whether the publisher only ships static files; if so, slim them in a build script and refresh them with a scheduled GitHub Action instead of calling anything at runtime.
