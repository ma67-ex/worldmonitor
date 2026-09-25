# Bloomberg-style quote stats in market detail views

**Date:** 2026-09-24

## Problem
Market ticker detail views showed only price, % change and a chart. The user wanted Bloomberg-level detail: day range, 52-week range, and volume.

## Approach
1. Checked the seeder first. `seed-market-quotes.mjs` calls Yahoo's `v8/finance/chart`, and that response's `meta` already includes `regularMarketDayHigh/Low`, `regularMarketVolume` and `fiftyTwoWeekHigh/Low`. `parseYahooChart` was throwing those fields away, so no new API calls were needed.
2. Left out market cap and P/E. They need Yahoo `quoteSummary` (crumb-gated) or an extra per-symbol call.
3. Traced every place a quote gets rebuilt field by field: `toSeedQuote`, the server seed passthrough (fine), `toMarketData` in `src/services/market`, and the hydration mapper in `data-loader.ts`. The two client mappers are now one exported `toMarketData`.
4. Added optional proto fields and hand-edited the generated client/server interfaces, because buf and Go aren't installed.
5. Put a shared `renderQuoteStats()` in `src/components/market-quote-stats.ts`, used by both the chart modal and the stock research overlay.

## Why
Clicking a US stock (for example AAPL) opens the Stock Research overlay. Only indices and digit-leading Asian tickers open the chart modal. A stats block in the modal alone would never show for most stocks.

## Gotchas
- `toSeedQuote` silently drops any field it doesn't list by name.
- In prod, US stocks go through Alpha Vantage (volume only) and Finnhub (day high/low only). Neither gives 52-week data. Missing stats render as `—`, and the whole block hides when a quote has none.
- Because the generated files were hand-edited, `proto-check.yml` will likely fail until someone runs `make generate`. The OpenAPI docs are also not regenerated.
- The stock research overlay uses the `--surface` background, not `--bg-panel`, so the cells need a background override.

## Reusable pattern
Before adding a new data source, dump the raw upstream response you already fetch. The field is often there and the parser discards it. Then grep every function that rebuilds the object field by field.
