**STATUS: PARTIALLY ALREADY DONE (pre-existing), REST OUT OF SCOPE — 2026-08-16**

Checked both panels backing this feature area:

1. **`ChokepointStripPanel.ts`** (basic chokepoint status/traffic strip) — `fetchChokepointStatus()` in `src/services/supply-chain/index.ts` has NO `hasPremiumAccess()` gate at all, and its RPC (`get-chokepoint-status`) isn't in `PREMIUM_RPC_PATHS`. This is **already free**, confirming the task's own hunch ("may not need a live feed at all"). Real data still depends on Akul's Railway seed populating the `chokepoints` bootstrap key — same caveat as everything else in this whole backlog — but the code path itself needs nothing from me.
2. **`SupplyChainPanel.ts`** (the actually-locked one) — 8 separate premium RPCs: bypass options, cost-shock modeling, route explorer, route impact, sector dependency, multi-sector shock, country chokepoint index, country products. This is real economic modeling (scenario simulation over trade-flow data), not a data-source swap — closer in kind to `03-resilience-score.md`'s difficulty than this task's own framing suggested. Building 8 free equivalents is out of proportion for the time available this session.

**No code changed for this task** — item 1 needed none, item 2 needs its own dedicated session with the same "real decision, not just a fetch swap" framing `03` already flags.

---

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
