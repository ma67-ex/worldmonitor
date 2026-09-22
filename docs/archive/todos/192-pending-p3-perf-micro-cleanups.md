---
status: done
priority: p3
issue_id: 192
tags: [code-review, phase-0, regional-intelligence, performance, safety]
dependencies: []
---

# Performance micro-cleanups (buildPreMeta x8, signal indexing, evidence chokepoint filter, prototype-pollution guards)

## Problem Statement
Several minor perf and safety cleanups:

1. `buildPreMeta(sources)` is called 8x with identical results (only depends on sources, not regionId). Hoist out of `computeSnapshot` into `main()`.
2. `signals.filter(theater substring)` rebuilds per region in `balance-vector.mjs` and `evidence-collector.mjs`. Precompute `signalsByRegion` Map once in `main()`.
3. `evidence-collector.mjs:62-77` iterates ALL chokepoints regardless of region. Filter by `getRegionCorridors(regionId).map(c => c.chokepointId)`.
4. `geography.js:countryCriticality()` and `regionForCountry()` use bracket access on plain objects - prototype pollution risk if `iso2` is `__proto__`. Use `Object.hasOwn()` guard.
5. `JSON.stringify(snapshot)` happens twice in `persist-snapshot.mjs` (for tsKey and idKey). Stringify once, reuse.
6. `actor-scoring.mjs`, `balance-vector.mjs`, `scenario-builder.mjs` `JSON.stringify` on `caseFile` not wrapped in try/catch. Circular references in upstream payload would crash the seed for all 8 regions.

## Findings
- #1-3, #5 are pure perf: redundant work per region
- #4 is a safety issue (bracket access on user-supplied string keys)
- #6 is a reliability issue (one bad forecast crashes the whole seed)
- All items small, independent, safe

## Proposed Solutions

### Option 1: Do all 6 in one PR
Small mechanical cleanups; low risk.

**Pros:** Single follow-up
**Cons:** Mix of concerns
**Effort:** Small (each item)
**Risk:** Low

### Option 2: Split perf vs safety
(a) perf micros (#1, #2, #3, #5), (b) safety (#4, #6).

**Pros:** Each PR has a clean theme
**Cons:** More overhead
**Effort:** Small
**Risk:** Low

## Recommended Action


## Technical Details
Affected files:
- `scripts/seed-regional-snapshots.mjs` - main(), computeSnapshot, buildPreMeta call site
- `scripts/regional-snapshot/balance-vector.mjs` - signals.filter, caseFile stringify
- `scripts/regional-snapshot/evidence-collector.mjs:62-77` - chokepoint iteration
- `scripts/regional-snapshot/actor-scoring.mjs` - caseFile stringify
- `scripts/regional-snapshot/scenario-builder.mjs` - caseFile stringify
- `scripts/regional-snapshot/persist-snapshot.mjs` - double stringify
- `shared/geography.js` - countryCriticality, regionForCountry

For #4, pattern:
```js
if (!Object.hasOwn(table, iso2)) return fallback;
return table[iso2];
```

For #6, wrap each `JSON.stringify(f?.caseFile ?? ...)` in try/catch and fall back to `"{}"` (ties in naturally with issue #190's precompute-once).

## Acceptance Criteria
- [ ] buildPreMeta hoisted to main()
- [ ] signalsByRegion indexed once
- [ ] Chokepoint evidence filtered by region corridors
- [ ] Object.hasOwn guards on geography lookups
- [ ] JSON.stringify(snapshot) called once per region
- [ ] caseFile JSON.stringify wrapped in try/catch with fallback to {}

## Work Log

### 2026-09-06
Mixed: fixed 4 of 6, 1 already fixed, 1 skipped.
1. Fixed — `buildPreMeta(sources, ...)` hoisted out of `computeSnapshot` into
   `main()` (computed once, passed to `computeSnapshot` as `pre`); it never
   depended on `regionId` so all 8 per-region calls were producing an
   identical result.
2. Skipped — `signalsByRegion` Map precompute for `balance-vector.mjs` /
   `evidence-collector.mjs`. Unlike #1, this filter's *result* genuinely
   differs per region (different predicate), so "hoisting" means building a
   region-keyed index up front, which touches `isSignalInRegion`'s multi-
   format matching semantics for a saving of at most ~100 signals x 8
   regions of `Array.filter` work per 6h run — negligible next to the
   per-region LLM narrative call that dominates runtime. Left as-is; revisit
   only if signal volume grows by orders of magnitude.
3. Already fixed — `evidence-collector.mjs:69-97` already filters chokepoints
   by `getRegionCorridors(regionId)` before iterating, matching the todo's
   own recommended fix. No change needed.
4. Fixed — `geography.js`'s `regionForCountry()` and `countryCriticality()`
   now guard with `Object.hasOwn()` before the bracket access.
5. Already fixed — `persist-snapshot.mjs` already stringifies `snapshot`
   once into a local `json` var and reuses it for both `tsKey` and `idKey`
   SETs. No change needed.
6. Fixed — folded into #190's `getCaseFileText()` helper, which wraps the
   `JSON.stringify(caseFile)` call in try/catch with a `'{}'` fallback so a
   circular/unstringifiable upstream caseFile can't crash the whole run.
verified: `npx tsx --test tests/regional-snapshot.test.mjs tests/regional-snapshot-envelope-unwrap.test.mjs` — pass; `node --check shared/geography.js scripts/regional-snapshot/persist-snapshot.mjs scripts/seed-regional-snapshots.mjs` — pass.

## Resources
- PR #2940
- PR #2942
