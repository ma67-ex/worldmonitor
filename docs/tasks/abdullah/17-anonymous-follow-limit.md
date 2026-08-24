**STATUS: DONE — 2026-08-24**

# Task: Strip the anonymous-user follow-cap (client-only, no server backing)

## Why
`src/services/followed-countries.ts` caps followed-country watchlists at
`FREE_TIER_FOLLOW_LIMIT = 3`. Two independent code paths hit this cap, and
only one is real:

1. **Signed-in users** — genuinely, independently enforced server-side in
   Convex. `convex/followedCountries.ts` (`followCountry` mutation, ~lines
   381-388; `mergeAnonymousLocal`, ~lines 556-561) checks `tier < 1` against
   the real `entitlements` table (a Dodo-billed subscription row) and caps
   at 3 inside the mutation itself. Same class as `latest-brief` — backed
   by real infra this fork doesn't control. **Not touched.**
2. **Anonymous users** (no Clerk account) — `serviceEntitlementState()`
   always returns `'free'` for anon (no Clerk session to read a tier from;
   `hasTier()` is never reached). The `addCountry()` cap check
   (`ent === 'free' && existing.length >= FREE_TIER_FOLLOW_LIMIT`) ran
   purely against `localStorage.length`, with zero server-side backing —
   there's no Convex row for someone with no account to check against.
   Same bug class as everything else fixed this session: a client-only
   soft cap with no real infra behind it for the population it blocks.

## Traced before touching anything
- `serviceEntitlementState()` (`src/services/followed-countries.ts:563-569`):
  `if (!user) return 'free';` — the ONLY branch reached for anonymous
  callers. Signed-in users fall through to the `_entitlementStateGetter()`/
  `_hasTierFn(1)` branches below it. These two populations never share a
  code path inside this function — anon always short-circuits at the first
  line.
- `addCountry()` (`src/services/followed-countries.ts:1106-1234`): a single
  `if (user) { ... Convex mutation ... }` block (unchanged, still returns
  before falling through) followed by the anonymous-only `localStorage`
  branch. The `if (user)` block is reached ONLY when signed in and always
  `return`s — so everything after it executes ONLY when `!user`. The old
  cap check lived in that anonymous-only tail.
- `follow-button.ts`'s `computeViewState()` (`src/utils/follow-button.ts`
  ~184-216): predicts `atCap` from `entState === 'free' && !followed` for
  the tooltip/CTA. Since `entState` is `'free'` for BOTH anon and
  signed-in-free-tier users, this collapsed both populations — it needed
  its own way to tell them apart, which `serviceEntitlementState()` alone
  doesn't give a caller.

## What changed
- `src/services/followed-countries.ts`:
  - `addCountry()`'s anonymous-mode branch (was ~line 1220): removed the
    `if (ent === 'free' && existing.length >= FREE_TIER_FOLLOW_LIMIT)`
    cap check. Anon adds now go straight to `_writeLocalStorageAdd(code)`.
    `FREE_TIER_FOLLOW_LIMIT` itself is untouched (still a real constant,
    still used by the signed-in Convex-error fallback path and by the
    signed-in FREE_CAP result shape).
  - Added `export function hasSignedInUser(): boolean` — thin wrapper
    around the same test-injectable `_clerkUserGetter()` seam
    `serviceEntitlementState()` already uses. Gives callers outside this
    module a way to distinguish "anonymous" from "signed-in free-tier"
    (`serviceEntitlementState()` alone collapses both to `'free'`).
- `src/utils/follow-button.ts`: `computeViewState()`'s `atCap` prediction
  now also requires `hasSignedInUser()` — the "Upgrade to follow more"
  tooltip/CTA only renders for the real, signed-in, server-enforced cap.
  The click-time CTA (`onClick`'s `case 'FREE_CAP':` → `_upgradeTrigger`)
  needed no separate change: it only fires when `addCountry()` actually
  returns `{ reason: 'FREE_CAP' }`, which anonymous callers can no longer
  produce now that the check above is gone.

## How the signed-in path was confirmed untouched
- `git diff` on `followed-countries.ts` shows the entire `if (user) { ... }`
  Convex-mutation block in `addCountry()` (server round-trip, FREE_CAP
  handling, error-kind branches) is byte-for-byte unchanged — the diff
  only touches code after that block closes (which only runs when
  `!user`) and adds a new standalone function.
  `serviceEntitlementState()` itself is unchanged.
- `git diff` on `follow-button.ts` shows `onClick()`'s `FREE_CAP` switch
  case (the actual upgrade-trigger firing point) is untouched — only
  `computeViewState()`'s cosmetic `atCap` prediction gained an extra
  `&& hasSignedInUser()` guard.
- Ran `tests/followed-countries-service.test.mjs`'s existing
  `'signed-in free user at cap of 3: 4th add returns FREE_CAP...'` test
  (uses `setSignedInFreeLoaded()`) and the PRO no-cap test
  (`setSignedInPro()`) — both pass unmodified, confirming the signed-in
  cap behavior is identical before/after.
- Ran `tests/follow-button.test.mjs`'s signed-in loading/PRO-resolve/
  FREE-resolve-with-cap tests (`setupSignedInLoading`, real
  `getCurrentClerkUser: () => ({ id: 'user-1' })` + `_emitAuthStateForTests`)
  — all pass unmodified, including the one that clicks a new country while
  a signed-in free-tier user is genuinely at cap and still expects
  `FREE_CAP`/the upgrade CTA to fire.

## Verify
- `npm run typecheck` — clean.
- `npm run build` — clean (`tsc && vite build`, full pipeline including
  blog/crawlable-corpus/sitemap/openapi steps).
- `npm run typecheck:api` not run — this task touches no `api/` or
  `server/` code (Convex/API surfaces untouched by design).
- Test files found via
  `find . -iname "*followed-countries*test*" -o -iname "*follow-button*test*"`:
  `tests/followed-countries-fetch.test.mjs`,
  `tests/followed-countries-service.test.mjs`,
  `tests/followed-countries-sign-in-handoff.test.mjs`,
  `tests/follow-button.test.mjs`,
  `tests/followed-countries-cap-drop-toast.test.mjs`, plus 3 Convex-side
  test files under `convex/__tests__/` (not run — `convex/followedCountries.ts`
  is out of scope and untouched).
  Ran the 5 client-side files:
  `npx tsx --test tests/followed-countries-fetch.test.mjs
  tests/followed-countries-service.test.mjs
  tests/followed-countries-sign-in-handoff.test.mjs tests/follow-button.test.mjs
  tests/followed-countries-cap-drop-toast.test.mjs` → 109/109 passing.
  3 pre-existing tests asserted the old anonymous-cap behavior and were
  rewritten (not deleted) to assert the new, real contract, same pattern
  task `14` used:
  - `tests/followed-countries-service.test.mjs` — the anon "4th add hits
    FREE_CAP" case became "4th add still succeeds" (split into two `it`s,
    one for the pre-existing ENTITLEMENT_LOADING-immune assertion, one for
    the no-cap assertion).
  - `tests/follow-button.test.mjs` — the anon "click at cap → upgrade
    modal, not committed" case became "no upgrade CTA renders, click
    commits" (renamed to say why in the title).
  - The sibling signed-in FREE_CAP tests in both files were left
    completely unmodified (see previous section).

## Not touched (by design)
- `convex/followedCountries.ts` — real, server-enforced signed-in cap.
  Confirmed structurally impossible to unlock without real WorldMonitor
  SaaS billing behind it, same as `latest-brief`.
- `FREE_TIER_FOLLOW_LIMIT`'s value (still `3`) — shared constant, still
  correctly used by the signed-in path.
- `App.ts`'s `WM_FOLLOWED_COUNTRIES_CAP_DROP` toast handler — fires only
  from the sign-in `mergeAnonymousLocal` flow, driven by the real Convex
  server response (`result.droppedDueToCap`), not a client-side check.
  Legitimate signed-in-merge behavior, left alone.
