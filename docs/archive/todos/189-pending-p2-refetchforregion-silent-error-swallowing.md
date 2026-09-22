---
status: done
priority: p2
issue_id: 189
tags: [code-review, phase-0, regional-intelligence, error-handling, ui]
dependencies: []
---

# ForecastPanel refetchForRegion catches errors silently - UI shows stale data with no badge

## Problem Statement
`src/components/ForecastPanel.ts:326-336` has try/catch with empty catch. On failure, the panel shows the previous region's data (or stays empty) with no indication that the refetch failed. Comment says "same pattern as the initial load" but the initial load actually reports failures via the data badge.

## Findings
- Empty catch block swallows all errors
- User has no way to know the refetch failed
- Comment claims parity with initial load, but initial load sets the data badge on failure
- Stale data + no indicator is worse than a clear error state

## Proposed Solutions

### Option 1: Add setDataBadge('unavailable') in catch
Mirror the initial load's failure path.

**Pros:** Consistent UX; clear signal to user
**Cons:** Needs verification that initial load actually does this
**Effort:** Small
**Risk:** Low

### Option 2: Log errors via console.error
Sentry breadcrumbs will capture them; adds observability.

**Pros:** Dev visibility; triage signal
**Cons:** Doesn't improve user experience alone
**Effort:** Small
**Risk:** Low

### Option 3: Combined - badge + log
Do both: set badge to 'unavailable' AND log via console.error.

**Pros:** Full coverage (UX + observability)
**Cons:** None material
**Effort:** Small
**Risk:** Low

## Recommended Action


## Technical Details
File: `src/components/ForecastPanel.ts:326-336`
Pattern to mirror: the initial load's setDataBadge call on the same file.

## Acceptance Criteria
- [ ] On RPC failure, setDataBadge('unavailable') is called
- [ ] Errors are logged via console.error (Sentry breadcrumbs capture them)
- [ ] User sees a clear failed-to-load indicator

## Work Log

### 2026-09-06
Already fixed / moot — same root cause as #178. `ForecastPanel.ts` has no
`refetchForRegion` method and region-pill clicks fire no RPC at all (region
filtering is client-side against the already-loaded forecast list). The only
network call in the file, `loadCaseFiles()`, already has non-empty error
handling appropriate to its own context (leaves the dossier pane empty and
clears the promise so a later expand can retry — it doesn't set a data badge
because it's a per-row dossier fetch, not the panel's primary data source).
There is no empty catch block silently swallowing a region-refetch error
because there is no region-refetch. No code change made.
verified: `grep -n "catch" src/components/ForecastPanel.ts` — only `loadCaseFiles()`'s non-empty catch remains; `npx tsc --noEmit -p tsconfig.json` — pass.

## Resources
- PR #2940
- PR #2942
