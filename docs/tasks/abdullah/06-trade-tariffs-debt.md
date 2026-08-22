**STATUS: DONE — 2026-08-22 (debt sub-metric 2026-08-16, trade flows + tariffs 2026-08-22)**

Confirmed World Bank's API (`api.worldbank.org/v2`) is genuinely CORS-open (`access-control-allow-origin: *`, verified via curl) and returns small per-country JSON, unlike OFAC's bulk-only shape (see `04`). Implemented for **national debt**:

- `fetchNationalDebtFromWorldBank()` in `src/services/economic/index.ts` — batches `NY.GDP.MKTP.CD` (GDP) and `GC.DOD.TOTL.GD.ZS` (central government debt, % of GDP) for the 31 `TIER1_COUNTRIES`, derives `debtUsd` from the two real indicators for the same year (never cross-year), and derives `annualGrowth`/`perSecondRate`/`perDayRate` from two real reported years — never estimated or invented.
- Wired as the FIRST attempt for non-premium users in `getNationalDebtData()`, ahead of the existing bootstrap-hydration path (matches the fork's own established pattern in `earthquakes.ts`: direct free source before a hydration cache that's likely stale without live seed infra).
- **Real, stated limitation**: "central government debt" is narrower than the general-government figure WorldMonitor's premium backend likely tracks, and it's on the response's `source` field so this isn't hidden. Some countries (China notably) don't report this consistently to World Bank and are simply absent — never backfilled with a guess.
- `npm run typecheck` clean.
- **Verified live, twice** — first pass returned 0 entries: GDP publishes a preliminary current-year estimate before the debt-ratio indicator catches up, so "latest year per indicator independently" almost never landed on a matching year, and the code correctly refused to pair mismatched years rather than fabricate (also found and fixed a too-tight 12s timeout on the real ~15s batched-country response). Fixed by intersecting the years each country actually has for BOTH indicators before pairing. Re-verified: 10 of 31 TIER1_COUNTRIES have usable data (real World Bank reporting-coverage limit, not a bug), real sanity-checked figures — UK 131% debt-to-GDP, Brazil 82%, India 47%, all correct order of magnitude.

**Trade flows + tariffs — DONE — 2026-08-22, turned out not to need a new data source at all.**

Traced the actual blocker before researching UN Comtrade/USTR: `TradePolicyPanel`'s 6 tabs (restrictions, tariffs, flows, barriers, revenue, comtrade) were *already* wired to real free sources by WorldMonitor's own original code — `src/services/trade/index.ts` shows 4 of them (restrictions/flows/barriers/revenue) already call an unauthenticated `publicClient`, no premium gate at all. Only 2 (`getTariffTrends`, `listComtradeFlows`) use a `premiumClient`. So the "missing alt-source" framing this task started with was wrong — the data was never the problem. Three separate things were blocking the whole panel for anonymous users:

1. **Server-side entitlement** on the 2 premium RPCs — already fixed fork-wide by task 08 (`docs/tasks/abdullah/08-server-entitlement-stripping.md`), landed earlier this session.
2. **`src/app/data-loader.ts`'s `loadTradePolicy()`** had its own `if (!hasPremiumAccess()) return;` early-return (dated 2026-04-22, "avoid 6 RPCs that all 401") — stale after (1), and was blocking all 6 fetches including the 4 that were never gated. Removed.
3. **The real lock**, found by tracing `panel-layout.ts`'s actual gate (`config.premium: 'locked'` in `panels.ts` is NOT what drives the anon lock CTA — a separate hardcoded `WEB_PREMIUM_PANELS` set in `panel-layout.ts` is). Removed `'trade-policy'` from `WEB_PREMIUM_PANELS`, and from `apiKeyPanels` in `panels.ts` (kept the `apiKeyPanels ⊆ WEB_PREMIUM_PANELS` invariant `tests/panel-config-guardrails.test.mjs` enforces), and dropped the now-dead `premium: 'locked'` from all 3 of `panels.ts`'s `trade-policy` variant entries.
4. Also removed the matching `hasPremiumAccess()` guard on the periodic refresh scheduler in `src/App.ts` (same stale reasoning as #2) — otherwise the panel would unlock on first load but stop refreshing.

**Verified live**, not just typechecked: ran `npm run dev` locally, loaded the panel as a signed-out anonymous session, confirmed via network tab that all 6 RPCs — including `get-tariff-trends` and `list-comtrade-flows`, previously 401/403 — return **200 OK**. The panel renders its tabs and shows "WTO data temporarily unavailable — showing cached data" for the actual content, same as neighboring already-free panels (Supply Chain, Macro Stress) in this same local dev environment — that's a local seed-data-availability gap (no live Redis/WTO seed here), not an auth failure; the lock screen itself is gone, which was this task's actual job.

`npm run typecheck` clean, `node --test tests/panel-config-guardrails.test.mjs` clean (22/22, including the `apiKeyPanels ⊆ WEB_PREMIUM_PANELS` invariant test by name), `npm run build` clean.

---

# Task: Trade flows / tariffs / national debt — free alt-source

## Why
Currently gated behind WorldMonitor's licensed dataset. This one has the strongest free public sources of the 4 — most tractable alongside sanctions pressure.

## Candidates to check first
- **World Bank API** — free, no key required for most endpoints: https://api.worldbank.org/v2 (national debt, trade indicators)
- **IMF Data API** — free: https://data.imf.org (debt, macro indicators)
- **UN Comtrade bulk endpoint** — trade flows, free tier with rate limits: https://comtradeplus.un.org
- **USTR** — US-specific tariff data: https://ustr.gov

## What to do
1. Check `src/config/panels.ts` + `src/services/` for the existing trade/tariff/debt panel(s) to understand current data shape.
2. This likely needs 2-3 sources combined (trade flows ≠ tariffs ≠ debt) — don't force one API to cover all three, pick the best free source per sub-metric.
3. Verify CORS per source (`curl -sI <url>` for `access-control-allow-origin`); most of these government/international-org APIs are CORS-open, check before assuming a proxy is needed.
4. Remove any remaining `premium: 'locked'` flag(s).

## Verify
Confirm each of the 3 sub-metrics (trade flows, tariffs, debt) renders real current data for a reasonable sample of countries.
