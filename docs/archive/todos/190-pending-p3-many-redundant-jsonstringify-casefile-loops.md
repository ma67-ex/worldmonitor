---
status: done
priority: p3
issue_id: 190
tags: [code-review, phase-0, regional-intelligence, performance, dry]
dependencies: []
---

# Hot-loop JSON.stringify(caseFile) duplicated across modules - precompute once

## Problem Statement
`actor-scoring.mjs:38`, `balance-vector.mjs:259` (`computeAllianceCohesion`), `scenario-builder.mjs:50` all call `JSON.stringify(f?.caseFile ?? ...).toLowerCase()` per forecast per region. For 14 forecasts x 8 regions x 5 callsites = 560 calls producing identical strings. Also creates inconsistency: actor-scoring checks `caseFile ?? signals`, alliance-cohesion checks only `caseFile`.

## Findings
- 5 call sites stringify `caseFile` per-forecast-per-region
- ~560 redundant stringifies per seed run at current scale
- Inconsistent fallback: some use `caseFile ?? signals`, others use `caseFile` only
- Text is identical across callsites for the same forecast - prime memoization target

## Proposed Solutions

### Option 1: Precompute caseFileText once in main()
Attach `_caseFileText` to each forecast before the region loop; all modules read it.

**Pros:** Single source of truth for what counts as searchable text; ~560 stringifies become 14; removes inconsistency
**Cons:** Adds a non-schema field to the forecast object (prefix with `_` to signal internal)
**Effort:** Small
**Risk:** Low

## Recommended Action


## Technical Details
Affected files:
- `scripts/regional-snapshot/actor-scoring.mjs:38`
- `scripts/regional-snapshot/balance-vector.mjs:259` (computeAllianceCohesion)
- `scripts/regional-snapshot/scenario-builder.mjs:50`
- `scripts/seed-regional-snapshots.mjs` - main() where precomputation would land

The current code pattern is roughly:
```js
JSON.stringify(f?.caseFile ?? f?.signals ?? {}).toLowerCase()
```

The fallback chain must be normalized across all callers.

## Acceptance Criteria
- [ ] Precompute `_caseFileText: string` per forecast once before the region loop in main()
- [ ] All modules read `f._caseFileText` instead of re-stringifying
- [ ] Single consistent definition of what fields contribute to the searchable text

## Work Log

### 2026-09-06
Fixed, via a memoize-on-read helper rather than a required precompute pass —
`actor-scoring.mjs`, `balance-vector.mjs`, and `scenario-builder.mjs` are unit
-tested as pure functions in isolation (see `tests/regional-snapshot-
envelope-unwrap.test.mjs`), so a design that *required* `main()` to have
already set `f._caseFileText` broke those tests on first pass (a forecast
fixture built directly, with no precompute step, produced `text = '{}'`).
Added `getCaseFileText(f)` to `_helpers.mjs`: returns `f._caseFileText` if
already memoized, otherwise computes-and-caches
`JSON.stringify(f?.caseFile ?? f?.signals ?? {}).toLowerCase()` (wrapped in
try/catch, falling back to `'{}'` — also closes #192 item #6). All 3 call
sites now call `getCaseFileText(f)` instead of re-stringifying, and
`seed-regional-snapshots.mjs`'s `main()` proactively calls it once per
forecast before the region loop so the real pipeline still gets the ~560→14
stringify reduction, while direct/unit-test callers still get a correct
on-demand value. Also normalized the previously-inconsistent fallback chain:
`balance-vector.mjs`'s alliance-cohesion check used to be `caseFile ?? {}`
only (no `signals` fallback) vs. `actor-scoring.mjs`'s `caseFile ?? signals ??
{}` — both now go through the same `getCaseFileText`, so the searchable text
definition is single-sourced.
verified: `npx tsx --test tests/regional-snapshot.test.mjs tests/regional-snapshot-envelope-unwrap.test.mjs` — pass (both green, including the test that caught the first, broken design).

## Resources
- PR #2940
- PR #2942
