**STATUS: DONE — 2026-08-16**

Ported client + edge-config layers only, NOT Railway seed-infra (per README constraint — that's Akul's call). Real data won't flow until the 4 seed scripts (`seed-provincial-511.mjs`, `seed-toronto-road-restrictions.mjs`, `seed-open511.mjs`, `seed-alberta-emergency-alert.mjs`) are deployed on Railway; until then the layer renders correctly and toggles, but shows empty (honest — no fabricated data).

Files touched: `src/types/index.ts` (MapLayers fields), `src/config/panels.ts` (12 MapLayers literals + LAYER_TO_SOURCE), `src/config/variants/*.ts` (8 more MapLayers literals across full/tech/finance/happy/commodity/energy + REFRESH_INTERVALS in `base.ts`), `src/config/map-layer-definitions.ts` (registry/explanations/variant-order/synonyms), `src/components/DeckGLMap.ts` (render layers + tooltips + help sections), `src/components/MapContainer.ts` (forwarding, deckGL-only per `deckGLOnly: true` — no SVG/globe support), `src/components/Map.ts` (help sections), `src/App.ts` (opt-in migration + refresh scheduling), `src/app/data-loader.ts` (loadCanadaRoads/loadCanadaAlerts), `src/services/canada-roads.ts` + `canada-roads-core.ts` + `canada-roads-opt-in.ts` + `canada-alerts.ts` (new, ported whole), `shared/bootstrap-tier-keys.js` + `api/_bootstrap.js` (bootstrap key registration + cache profiles), `src/locales/en.json` (layer label/description — the Map Layers Guide reads these directly, not `LAYER_EXPLANATIONS`; found this the hard way when the guide rendered raw i18n keys instead of text), `src/e2e/map-harness.ts` + `mobile-map-integration-harness.ts`, `src/embed/embed-url.ts`.

**Deliberately skipped, real scope boundaries, not oversights:**
- `scripts/seed-bundle-canada.mjs` — Railway seed-infra, explicitly not mine
- `server/worldmonitor/resilience/v1/_canada-national-overlay.ts` — different upstream feature (resilience composite), not the roads/alerts layer this task scoped
- `api/health.js` freshness monitoring entries — ops-visibility only, not in the render critical path; the map layer works without it, Akul just won't get automated staleness alerts for these 4 sources yet
- The `cooperativeGestures: true` removal that appeared in the raw upstream diff — that's upstream's own unrelated map-scroll change, and this fork deliberately ADDED that setting as its own scroll-bug fix; porting the removal would have undone Akul's own fix. Left in place.
- `CANADA_DEPTH_OPT_IN_SOURCES`/`migrateCanadaDepthOptInsV7`/`showProBanner`/`mountCommunityWidget`/`pizzintHasShownData` removal — all appeared interleaved in the same file diffs but belong to unrelated upstream work; two of them (ProBanner, CommunityWidget) would have directly undone this fork's own de-paywall/rebrand work if ported blindly

**Verified live:** layer registered correctly (`getLayersForVariant('full','flat')` includes both keys), unlocked/visible in the Map Layers Guide with real label + description text (not raw i18n keys — caught and fixed a locale-key gap), correctly deckGL-only (no globe/SVG crash risk). Did not verify live data rendering — no real data exists in this dev environment (no Railway seeder running) or would exist in production until Akul deploys the seed scripts.

`npm run typecheck` and `npm run typecheck:api` both clean throughout.

---

# Task: Port the Canada roads/alerts map layer from upstream

## Why
`koala73/worldmonitor` (upstream) added a new map layer after this fork's branch point. Confirmed via a full panel-parity audit (2026-08-16) that this is the ONLY feature gap vs upstream — everything else is 1:1.

## What it is
A road-conditions/alerts map layer covering major Canadian provinces. Sources: Ontario 511, Alberta 511, Toronto roads, BC Open511.

## What to do
1. `git fetch upstream && git diff HEAD upstream/main -- src/config/panels.ts` to find the exact new panel/layer entries.
2. Find the upstream commit(s) that added it (search upstream's log for "canada" or the source names above).
3. Diff the relevant service/component files (likely a new `src/services/canada-roads.ts` or similar, plus a map layer registration and panel entry) between this fork and upstream.
4. Port the files over, adapting for any rebrand/de-paywall changes already made in this fork (e.g. don't reintroduce a `premium: 'locked'` flag if upstream added one — this fork has no paywall).
5. Register in `src/config/panels.ts` and the relevant `src/config/variants/` file(s) for the 'full' variant.

## Verify
`npm run dev`, confirm the layer appears in the Layers panel and toggles on/off correctly, confirm data renders on the map for at least one of the 4 sources.
