**STATUS: DONE — 2026-08-24**

# Task: Realign the 3 obsolete paywall-era test files

## Why
Last task from the plan (`/Users/muhammadabdullah/.claude/plans/glimmering-sleeping-lerdorf.md`). 12 pre-existing test failures across 3 files, documented since `summary.md`'s 2026-08-24 entry, never touched — each one pinned a deny/billing-denial response that task 08 (`docs/tasks/abdullah/08-server-entitlement-stripping.md`) deliberately removed. Deliberately done last so the rewrites reflect what tasks 12/13 already changed instead of guessing ahead of them.

## What changed

**`server/__tests__/entitlement-check.test.ts`** — 10 failures, all asserting `checkEntitlement`/`checkEntitlementDetailed` return a 403/503 `Response`. `checkEntitlementDetailed()` (`entitlement-check.ts:810-828`) is hardcoded to always return `{ response: null, ... }` by design — but it still resolves and returns a real `entitlements` row when a userId is present, for downstream telemetry. Rewrote all 10 to assert `response === null` (or `checkEntitlement(...)` returns `null` directly, matching the file's own already-passing sibling tests at lines 588/613/623), and — where the underlying resolution itself was the real thing being tested (confirmed-empty row vs. unconfigured backend vs. transient failure vs. a Redis marker short-circuiting a fresh Convex call) — kept that signal alive via `checkEntitlementDetailed()`'s `entitlements` field or the existing `fetchMock`-not-called assertions, rather than just deleting the coverage. 77/77 passing (up from 67/77).

**`server/__tests__/summarize-article-handler-security.test.ts`** — 2 failures, asserting anonymous callers get `"Pro subscription required"`. `resolvePremiumCallerIdentity()` now unconditionally treats every caller as premium. Rewrote both to use the exact same technique the file's own already-passing `"premium callers pass the summary gate"` test uses — delete `GROQ_API_KEY` so the handler skips before reaching a real provider fetch, then assert `SUMMARIZE_STATUS_SKIPPED` and that the error is NOT `"Pro subscription required"`. Not exact duplicates of the premium test: they exercise different caller identities (anonymous, and a basic session key) reaching the same outcome, which is the actual thing worth proving now. 4/4 passing.

**`server/__tests__/widget-agent-billing-denial.test.ts`** — entire suite failed to load: `Cannot find module '../../api/widget-agent'` — `api/widget-agent.ts` was renamed to `api/_widget-agent.ts` in commit `b5839d9b5` (Vercel Hobby's 12-function consolidation) and this import was never updated. Fixed the import, then found the file's whole premise (structured billing-verification denial: `getBillingVerificationDenial`, `X-Billing-Verification` header, retry codes) no longer exists in `_widget-agent.ts` at all — a valid bearer session sets `isPro = true` unconditionally (line 134, same task-08 change) and `getEntitlements` is never even called on that path. Rewrote the whole file: mocked `fetch` (the handler now actually reaches a real relay call for a valid session, which the old tests' `getEntitlements` mock never had to account for) and replaced the 5 old denial-scenario tests with 3 that assert the real current contract — a valid session is unconditionally treated as Pro (checked via the outgoing relay request's `X-Pro-Key` header and normalized `tier: 'pro'` body), an invalid/expired session still gets a real 401, and no credentials at all still gets a real 403. 3/3 passing.

## Found along the way, explicitly not fixed here
Running the full `test:data` suite (not just the 3 target files) turned up **two more** files broken by the same `api/widget-agent.ts` → `api/_widget-agent.ts` stale-import bug: `tests/widget-agent-auth.test.mts` and `tests/widget-builder.test.mjs`. Confirmed via source read (not run against `HEAD`, but neither file was touched by any commit this session, and the rename itself predates this session) that this is pre-existing and unrelated to the paywall-removal work — a leftover from the Vercel consolidation, not from task 08's entitlement stripping. Different bug class than this task's actual scope (import path vs. obsolete billing assertions), so left alone rather than scope-creeping. Real, findable, one-line-per-file fix (same shape as the one applied here) if picked up later.

## Verify
- `npx vitest run server/__tests__/entitlement-check.test.ts` — 77/77.
- `npx vitest run server/__tests__/summarize-article-handler-security.test.ts` — 4/4.
- `npx vitest run server/__tests__/widget-agent-billing-denial.test.ts` — 3/3.
- `npm run typecheck` — clean.
- `npm run typecheck:api` — clean.
- `npm run build` — clean.
- `node --test tests/panel-config-guardrails.test.mjs` — 22/22.

## This closes out the plan
Tasks 12, 13, and 14 (`/Users/muhammadabdullah/.claude/plans/glimmering-sleeping-lerdorf.md`) are all done. Remaining, explicitly out of scope per the plan: scenario modeling / the wider Railway go-no-go (needs your decision, real recurring cost), `hasTier(1)` call sites outside `UnifiedSettings.ts`, and the two stale `api/widget-agent.ts` imports found above.
