# Task: Supply-chain/chokepoint analytics — free alt-source

## Why
Currently gated behind WorldMonitor's licensed route/chokepoint dataset.

## Candidates to check first
- **UN Comtrade** — public bulk trade-flow data, free tier with rate limits: https://comtradeplus.un.org
- **AIS/shipping data** — some public AIS aggregators exist with free tiers (check current terms; this fork already has an AIS relay pattern in the original codebase via Railway, worth reading `scripts/` for how the original ingested AIS before assuming a new source is needed)
- **Marine chokepoint reference data** (Suez, Hormuz, Malacca, Panama, etc.) is often static/structural — may not need a live feed at all, just accurate reference data + live traffic overlay if available free

## What to do
1. Check `src/config/panels.ts` + `src/services/` for the existing chokepoint/supply-chain panel(s) to understand the current data shape expected.
2. Pick a source, verify CORS (`curl -sI <url>` for `access-control-allow-origin`) or plan a proxy function (see note in `04-sanctions-pressure.md` about the 12-function cap — reuse `misc-gateway` registries, don't add a new top-level function).
3. Remove any remaining `premium: 'locked'` flag for this panel.

## Verify
Confirm the panel shows real chokepoint/route data, at minimum the major chokepoints (Suez, Hormuz, Malacca, Panama) render correctly.
