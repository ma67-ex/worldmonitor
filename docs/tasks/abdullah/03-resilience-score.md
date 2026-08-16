# Task: Resilience score — free alt-source or simplified replica

## Why
Currently powered by WorldMonitor's own proprietary scoring backend (real modeling work on their end, not just a paywalled data feed) — no drop-in free replacement exists. This is the hardest of the 4 alt-data tasks; expect it to need a real decision, not just a fetch swap.

## What to do
This needs research before code. Two viable directions:
1. **Find a free public resilience/stability index** that's close enough in spirit (candidates to check: Fragile States Index / Fund for Peace, World Bank Governance Indicators, INFORM Risk Index — check licensing/terms before using any of these, some require attribution or have usage limits).
2. **Build a simplified homegrown version** using data already flowing through this fork (e.g. combine conflict events (ACLED/UCDP), economic indicators, and infrastructure outage data already live in this deploy into a basic composite score). Lower fidelity than WorldMonitor's real model, but zero new dependencies.

Check `server/worldmonitor/resilience/v1/` (or wherever the original scoring logic lives in this repo) to understand what WorldMonitor's real methodology computes, so a replacement (of either kind) is at least conceptually comparable.

## Reference pattern for direct-source work in this fork
See `src/services/earthquakes.ts` (`fetchFromUsgs()`) and `src/services/weather.ts` (`fetchFromNws()`) for the established pattern: check the target API sends `Access-Control-Allow-Origin: *` (test with `curl -sI <url>`), write a direct browser-side fetch function, map the response to the existing internal type, wire it in ahead of any hydrated/RPC fallback. If the chosen source needs a server-side proxy (no CORS), follow `api/_pizzint-proxy.js`'s pattern instead — but that adds one of the fork's 12 precious Vercel functions, so prefer a CORS-open source if one exists.

## Verify
Confirm the panel renders real, non-zero data for at least a handful of countries, and that the source/methodology is documented somewhere visible (tooltip, panel footer, or code comment) so it's clear this isn't WorldMonitor's original score.
