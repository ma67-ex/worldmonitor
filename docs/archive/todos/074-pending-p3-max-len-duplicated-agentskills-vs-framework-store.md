---
status: done
priority: p3
issue_id: "074"
tags: [code-review, quality, analytical-frameworks]
dependencies: []
---

# `MAX_LEN = 2000` duplicated in `fetch-agentskills.ts` vs `MAX_INSTRUCTIONS_LEN` in `analysis-framework-store.ts`

## Problem Statement
`api/skills/fetch-agentskills.ts` defines its own `MAX_LEN = 2000` for instructions length. `src/services/analysis-framework-store.ts` already exports `MAX_INSTRUCTIONS_LEN` (or equivalent) for the same product limit. These constants are currently equal but defined independently — a change to one will silently diverge from the other.

## Proposed Solution
Import the shared constant in `fetch-agentskills.ts`. Note: edge functions (`api/*.ts`) cannot import from `src/` directly — if `MAX_INSTRUCTIONS_LEN` is in `src/`, extract it to a shared constants file accessible by both.

## Technical Details
- Files: `api/skills/fetch-agentskills.ts`, `src/services/analysis-framework-store.ts`
- Effort: Small | Risk: Low

## Work Log
- 2026-03-28: Identified by architecture-strategist during PR #2386 review
- 2026-09-06: Fixed — extracted `MAX_INSTRUCTIONS_LEN` to `shared/analysis-framework-limits.ts` (accessible from both `api/` and `src/`, matching the existing `shared/` pattern used elsewhere in the repo); both `analysis-framework-store.ts` and `_fetch-agentskills.ts` now import it. `npx tsx --test tests/fetch-agentskills.test.mjs` (10/10 pass), `npm run typecheck` and `npm run typecheck:api` pass.
