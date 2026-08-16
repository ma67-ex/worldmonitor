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
