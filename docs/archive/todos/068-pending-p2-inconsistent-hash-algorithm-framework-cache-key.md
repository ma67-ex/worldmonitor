---
status: pending
priority: p2
issue_id: "068"
tags: [code-review, caching, architecture, analytical-frameworks]
dependencies: []
---

# Inconsistent hash algorithms for framework cache key: FNV-1a vs SHA-256

## Problem Statement
Two different hash algorithms are used for the same semantic cache key segment (`framework`/`systemAppend`):

- `src/utils/summary-cache-key.ts:34` — uses `hashString(systemAppend).slice(0, 8)` — FNV-1a (base-36)
- `server/worldmonitor/intelligence/v1/get-country-intel-brief.ts:42-45` — uses `sha256Hex(frameworkRaw).slice(0, 8)` — SHA-256 (hex)
- `server/worldmonitor/intelligence/v1/deduct-situation.ts` — uses `sha256Hex(framework).slice(0, 8)` — SHA-256

The `summary-cache-key.ts` module was designed to be shared between client and server (see file header comment). Using FNV-1a there while intel handlers use SHA-256 is an inconsistency that confuses contributors and makes the key scheme harder to reason about.

## Proposed Solution
Standardize on SHA-256 (the more collision-resistant algorithm for user-controlled text):
- Update `summary-cache-key.ts` to use `sha256Hex` from `server/_shared/hash.ts` (or a shared utility)
- Or standardize on FNV-1a for performance (already available client-side via `hashString`)

Note: client-side `summary-cache-key.ts` may not have access to `sha256Hex` — pick the option that works in both runtimes.

## Technical Details
- Files: `src/utils/summary-cache-key.ts:34`, `server/worldmonitor/intelligence/v1/get-country-intel-brief.ts:42-45`
- Effort: Small | Risk: Low

## Acceptance Criteria
- [ ] All framework/systemAppend cache key hash segments use the same algorithm
- [ ] Algorithm choice works in both browser (summary-cache-key.ts) and server (intel handlers)

## Work Log
- 2026-03-28: Identified by architecture-strategist during PR #2386 review
- 2026-09-06: Left pending — genuine design decision, not a mechanical fix. `summary-cache-key.ts` is a synchronous function shared by 5 call sites across client (`src/services/summarization.ts`, `src/services/daily-market-brief.ts`) and server (`server/worldmonitor/news/v1/summarize-article.ts`, `_shared.ts`); switching its hash segments to `sha256Hex` requires making it (and every caller) async, cascading well beyond this file, plus a `CACHE_VERSION` bump to invalidate old sync-hash keys. The intel handlers (`get-country-intel-brief.ts`, `deduct-situation.ts`) use a separate cache-key namespace (`intel:`/`deduct:` prefixes) from `summary-cache-key.ts`'s `summary:` prefix, so the two algorithms never collide — this is a style inconsistency, not a correctness bug. Needs a decision: bump to async everywhere (larger diff, cleaner) vs. leave as-is (two self-consistent but differently-styled schemes).
