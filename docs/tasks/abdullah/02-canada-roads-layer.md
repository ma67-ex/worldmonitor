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
