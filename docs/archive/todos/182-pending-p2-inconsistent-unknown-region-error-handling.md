---
status: done
priority: p2
issue_id: 182
tags: [code-review, phase-0, regional-intelligence, error-handling, consistency]
dependencies: []
---

# Compute modules return different things for unknown region (some throw, some return empty)

## Problem Statement
`balance-vector.mjs:18` throws on unknown region. `scoreActors:26`, `buildScenarioSets:18`, `collectEvidence:16` silently return empty. Inconsistent contracts. The seed orchestrator should pick one.

## Findings
- 4 compute modules, 2 different error strategies
- Caller cannot rely on a uniform contract
- A typo'd region id will crash one path, silently empty-render another

## Proposed Solutions

### Option 1: Validate region in orchestrator
Fail-fast in `seed-regional-snapshots.mjs` before calling any compute module. Compute modules can assume a valid region.

**Pros:** Single validation point; compute modules simplify
**Cons:** Orchestrator must know region invariants
**Effort:** Small
**Risk:** Low

### Option 2: All modules throw on unknown region
Normalize every compute module to throw.

**Pros:** Loud failures at call site; easy debugging
**Cons:** Requires each compute module to handle the error
**Effort:** Small
**Risk:** Low

## Recommended Action


## Technical Details
Files involved:
- `scripts/regional-snapshot/balance-vector.mjs:18` (throws)
- `scripts/regional-snapshot/actor-scoring.mjs:26` (returns empty)
- `scripts/regional-snapshot/scenario-builder.mjs:18` (returns empty)
- `scripts/regional-snapshot/evidence-collector.mjs:16` (returns empty)
- `scripts/seed-regional-snapshots.mjs` - orchestrator

## Acceptance Criteria
- [ ] All compute modules use consistent error semantics
- [ ] Either: orchestrator validates region before calling any compute module
- [ ] Or: every module throws on unknown region

## Work Log

### 2026-09-06
Fixed. Chose Option 2 (all modules throw) over Option 1 (orchestrator pre-
validates) because it fits the existing infrastructure with zero orchestrator
changes: `seed-regional-snapshots.mjs`'s per-region loop already wraps
`computeSnapshot` in a try/catch that counts a throw as a region failure and
logs it — `balance-vector.mjs` already relied on exactly this. Normalized
`actor-scoring.mjs`, `scenario-builder.mjs`, and `evidence-collector.mjs` to
throw `Unknown region: ${regionId}` instead of silently returning `{actors:
[], edges: []}` / `[]`. Added a focused test (`unknown region contract` in
`tests/regional-snapshot.test.mjs`) asserting all 4 modules throw.
verified: `npx tsx --test tests/regional-snapshot.test.mjs` — pass, including the new `unknown region contract` suite (4/4).

## Resources
- PR #2940
- PR #2942
