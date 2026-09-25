# NSE (India) equity data layer: seeding per-company data without an official API

**Date:** 2026-09-24

## Problem
Build an India company terminal (shareholding, results, insider trades, filings, flows, deals) from free sources, run it inside `seed-all.yml` (each seeder is killed at 90s), and keep it country-pluggable for 15 more markets.

## Approach
1. **Probed before building.** Called every candidate NSE endpoint from the Mac, then from a GitHub Actions runner through an orphan branch holding only the probe workflow plus `vercel.json {"git":{"deploymentEnabled":false}}`. No other workflow or Vercel deploy could fire. NSE answered 200 JSON from the cloud, so no proxy is needed. Deleted the branch after.
2. **Recorded fixtures while NSE answered.** Real responses went into `tests/fixtures/equity-in/`. Big ones were trimmed (announcements 2.8 MB → 25 rows). Parsers are pure and asserted against figures from Reliance's own filings.
3. **Checked where the numbers actually live.** The obvious endpoints were traps:
   - `corporates-financial-results` returns metadata only, and nothing after Dec 2024.
   - `results-comparision` is stale.
   - The shareholding list has no FII/DII split.
   - The real data is in per-filing **XBRL**: results come from `integrated-filing-results` (SEBI's 2025 integrated filings), shareholding from the SHP XBRL.
4. **Rotation instead of one big fetch.**
   - `runEquityCompanySeed()` refreshes as many companies as fit in 55s and stores a cursor in the summary key.
   - Each company's detail is its own extra key with `skipWhenEmpty: true`, so companies not refreshed this run keep their last-good data.
   - XBRL is downloaded at most N per company per run and never again once parsed, keyed by filing id.

## Why
- Per-filing XBRL is the only source that is both current and complete. The same element names cover both taxonomies (`in-bse-fin`, `in-capmkt`), with context `OneD` = the quarter and values in absolute INR, so one regex fact extractor handles every filing.
- Rotation plus incremental XBRL keeps each run inside 90s at 1 request/400ms. In prod, a full 12-quarter history fills in over ~4 runs (12h).

## Gotchas
- `runSeed` calls `process.exit`, so one script can't loop over countries. Use one seeder file per (country, dataset).
- The local Redis REST proxy rejects `EVAL`, and `releaseLock` uses EVAL. Locally, a seeder's lock lingers 120s, and an immediate rerun prints "SKIPPED: another seed run in progress". This isn't a bug in the seeder; prod Upstash supports EVAL.
- New `STANDALONE_KEYS` break `tests/mcp-bootstrap-parity.test.mjs` until the keys get an MCP tool or an `EXCLUDED_FROM_MCP` reason.
- New upstream hosts break the source-attribution check. Add `PROVIDER_OVERRIDES` in `scripts/source-attribution.mjs`, then run `npm run sources:generate`.
- New health keys change the "total" in 4 health docs. `docs:check` already had 21 stale counts at HEAD, so diff against a clean worktree to see which ones are yours.
- The shareholding XBRL gives a promoter-pledge **flag**, not a percentage. Announcements need `from_date`/`to_date` or they're megabytes.

## Reusable pattern
Adding a data source with no official API: first probe from the machine that will run it in prod (orphan branch, nothing else in the tree). Record fixtures on day one. Look for the structured filing (XBRL) behind the summary endpoint. Then seed per entity with a cursor-based rotation and `skipWhenEmpty` extra keys, so partial runs never destroy last-good data.
