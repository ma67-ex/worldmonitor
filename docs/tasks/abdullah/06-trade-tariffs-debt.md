**STATUS: PARTIALLY DONE — 2026-08-16 (debt sub-metric only)**

Confirmed World Bank's API (`api.worldbank.org/v2`) is genuinely CORS-open (`access-control-allow-origin: *`, verified via curl) and returns small per-country JSON, unlike OFAC's bulk-only shape (see `04`). Implemented for **national debt**:

- `fetchNationalDebtFromWorldBank()` in `src/services/economic/index.ts` — batches `NY.GDP.MKTP.CD` (GDP) and `GC.DOD.TOTL.GD.ZS` (central government debt, % of GDP) for the 31 `TIER1_COUNTRIES`, derives `debtUsd` from the two real indicators for the same year (never cross-year), and derives `annualGrowth`/`perSecondRate`/`perDayRate` from two real reported years — never estimated or invented.
- Wired as the FIRST attempt for non-premium users in `getNationalDebtData()`, ahead of the existing bootstrap-hydration path (matches the fork's own established pattern in `earthquakes.ts`: direct free source before a hydration cache that's likely stale without live seed infra).
- **Real, stated limitation**: "central government debt" is narrower than the general-government figure WorldMonitor's premium backend likely tracks, and it's on the response's `source` field so this isn't hidden. Some countries (China notably) don't report this consistently to World Bank and are simply absent — never backfilled with a guess.
- `npm run typecheck` clean.
- **Verified live, twice** — first pass returned 0 entries: GDP publishes a preliminary current-year estimate before the debt-ratio indicator catches up, so "latest year per indicator independently" almost never landed on a matching year, and the code correctly refused to pair mismatched years rather than fabricate (also found and fixed a too-tight 12s timeout on the real ~15s batched-country response). Fixed by intersecting the years each country actually has for BOTH indicators before pairing. Re-verified: 10 of 31 TIER1_COUNTRIES have usable data (real World Bank reporting-coverage limit, not a bug), real sanity-checked figures — UK 131% debt-to-GDP, Brazil 82%, India 47%, all correct order of magnitude.

**Not done — trade flows and tariffs** (the `trade-policy` panel, separate from `national-debt`). Ran out of session time after the debt sub-metric; UN Comtrade and USTR are still just the candidates listed below, unresearched for CORS/shape. `trade-policy`'s `premium: 'locked'` flags are still in place in `panels.ts`.

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
