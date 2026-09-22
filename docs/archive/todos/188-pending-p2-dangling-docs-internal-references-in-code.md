---
status: done
priority: p2
issue_id: 188
tags: [code-review, phase-0, regional-intelligence, docs, stale-references]
dependencies: []
---

# Code comments reference docs/internal/ paths that don't exist in this worktree

## Problem Statement
Multiple files reference `docs/internal/pro-regional-intelligence-{appendix-engineering, appendix-scoring}.md` in code comments:
- `scripts/seed-regional-snapshots.mjs:12-14`
- `scripts/regional-snapshot/freshness.mjs:2`
- `scripts/regional-snapshot/triggers.config.mjs:4`
- `scripts/regional-snapshot/scenario-builder.mjs:2`
- `scripts/regional-snapshot/balance-vector.mjs:3`
- `shared/geography.js:21`

But only `plans/pro-regional-intelligence-upgrade.md` exists in this worktree. The appendix files ship to `docs/internal/` in the main repo.

## Findings
- 6 files reference appendix docs not present in the worktree
- Reviewers in the worktree cannot follow the references
- Breaks reviewer navigation; misleading for anyone reading this code outside main

## Proposed Solutions

### Option 1: Copy the appendix files into the worktree
Mirror `docs/internal/pro-regional-intelligence-appendix-engineering.md` and `docs/internal/pro-regional-intelligence-appendix-scoring.md` into the worktree.

**Pros:** Everything is self-contained; comments work
**Cons:** Duplicated content; possible drift from main
**Effort:** Small
**Risk:** Low

### Option 2: Update code comments to reference the actual location
Point comments at `plans/pro-regional-intelligence-upgrade.md` or the real location.

**Pros:** Single source of truth; no duplication
**Cons:** Comments may lose specificity if the appendix had more detail
**Effort:** Small
**Risk:** Low

## Recommended Action


## Technical Details
Files with dangling references:
- `scripts/seed-regional-snapshots.mjs` (lines 12-14)
- `scripts/regional-snapshot/freshness.mjs` (line 2)
- `scripts/regional-snapshot/triggers.config.mjs` (line 4)
- `scripts/regional-snapshot/scenario-builder.mjs` (line 2)
- `scripts/regional-snapshot/balance-vector.mjs` (line 3)
- `shared/geography.js` (line 21)

## Acceptance Criteria
- [ ] Either copy the appendix files into the worktree under docs/internal/
- [ ] Or update code comments to reference the actual location

## Work Log

### 2026-09-06
Fixed via Option 2, adjusted: `plans/pro-regional-intelligence-upgrade.md`
(the todo's proposed fallback target) also does not exist in this worktree
(confirmed via repo-wide find). Rather than point at a second nonexistent
path, reworded all 6 comments (plus `regime-derivation.mjs:3`, scope+1 — same
drift class, not in the todo's file list but touched while auditing) to
describe the doc by name and note it ships to docs/internal/ in the main repo
per the PR #2940 description, without asserting a broken worktree-relative
path. Files touched: `seed-regional-snapshots.mjs`, `freshness.mjs`,
`triggers.config.mjs`, `scenario-builder.mjs`, `balance-vector.mjs`,
`shared/geography.js` (+ mirrored to `scripts/shared/geography.js`),
`regime-derivation.mjs`.
verified: `grep -rn "docs/internal/pro-regional" scripts/regional-snapshot/*.mjs scripts/seed-regional-snapshots.mjs shared/geography.js` — zero matches; `npx tsx --test tests/regional-snapshot.test.mjs tests/scripts-shared-mirror.test.mjs` — pass.

## Resources
- PR #2940
- PR #2942
