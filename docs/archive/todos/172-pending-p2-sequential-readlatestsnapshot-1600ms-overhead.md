---
status: done
priority: p2
issue_id: 172
tags: [code-review, phase-0, regional-intelligence, performance, redis]
dependencies: []
---

# Sequential per-region readLatestSnapshot wastes ~1600ms wall-clock per cron run

## Problem Statement

Each region in the snapshot writer calls `readLatestSnapshot()`, which issues 2 sequential round-trip GETs (latest pointer → ID, then snapshot-by-id). With 8 regions inside the sequential `for` loop in `seed-regional-snapshots.mjs:181`, that's 16 serial HTTP round-trips. At ~100ms Upstash latency that's ~1600ms wall-clock for reads alone on every cron invocation.

## Findings

- `scripts/regional-snapshot/persist-snapshot.mjs:85-113` implements the two-step read.
- `scripts/seed-regional-snapshots.mjs:135` calls `readLatestSnapshot` from inside `computeSnapshot`.
- `scripts/seed-regional-snapshots.mjs:181` wraps `computeSnapshot` in a sequential `for` loop over all 8 regions.

## Proposed Solutions

### Option 1: Hoist readLatestSnapshot out of computeSnapshot

Move `readLatestSnapshot` into `main()`. Issue all 8 `:latest` GETs as one pipeline, then all 8 `snapshot-by-id` GETs as one pipeline. Two round-trips total instead of 16.

**Pros:** Preserves existing pointer-indirection schema; minimal churn; ~1400ms saved.
**Cons:** `computeSnapshot` signature grows to accept `prevSnapshot`.
**Effort:** Medium.
**Risk:** Low.

### Option 2: Inline the full snapshot in the `:latest` key

Drop the indirection — store the full snapshot JSON directly in `:latest`. Then 8 GETs become a single pipeline. ~1500ms saved.

**Pros:** Simplest read path; one pipeline call total.
**Cons:** Writer must keep `:by-id` and `:latest` in sync with the same payload; roughly doubles write-side storage; migration needed.
**Effort:** Medium.
**Risk:** Medium (write-side invariant must hold).

## Recommended Action

Option 2 if simplicity matters more than storage; Option 1 if minimal change matters more. Either choice combined with #173 drops total runtime from ~3.4s to <800ms.

## Technical Details

Upstash REST latency per call is ~100ms on the current Railway region. The reads are fully independent per region (dedup keys are region-scoped and the snapshot schema is isolated). Both options are safe to parallelize because no read depends on another region's write.

Pipeline API on the existing `redis.ts` helper supports batched GETs, so Option 1 is a mechanical transformation.

## Acceptance Criteria

- [ ] All 8 region prev snapshots are fetched in <300ms total wall-clock.
- [ ] Existing tests still pass.
- [ ] No regression in dedup/write semantics.

## Work Log

### 2026-09-06
Fixed via a Promise.all variant of Option 1. `readLatestSnapshot` is no
longer called inside `computeSnapshot`; `main()` in
`scripts/seed-regional-snapshots.mjs` now batch-reads every region's
previous snapshot concurrently before the per-region loop
(`Promise.all(REGIONS.map(...))`) and passes the result into
`computeSnapshot(regionId, sources, metaSources, pre, previousSnapshot)`.
16 serial round-trips become 16 concurrent ones instead of a literal 2-call
pipeline batch (simpler diff, same wall-clock win — bounded by the slowest
single GET rather than the sum). Left the per-region narrative LLM call
itself sequential (see #173 work log) — that's the actual runtime bottleneck,
not the Redis reads this issue targets.
verified: `npx tsx --test tests/regional-snapshot.test.mjs tests/regional-snapshot-regime-history.test.mjs tests/scripts-shared-mirror.test.mjs` — pass (all green); `node --check scripts/seed-regional-snapshots.mjs` — pass.

## Resources

- PR #2940
- Spec: `docs/internal/pro-regional-intelligence-upgrade.md`
