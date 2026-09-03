**STATUS: DONE — 2026-09-03**

# 29 — Remove the `latest-brief` panel entirely

Owner decision (explicit, not inferred): the fork should require zero sign-in
anywhere. `latest-brief` was the one remaining panel gated on a real Clerk
account with no free/anonymous alternative — unlike every other panel task
27's sweep found, this one isn't a stale client-side gate over free-capable
data. Confirmed from the panel's own code and comments before touching
anything:

- `LatestBriefPanel.ts`'s `fetchLatest()`: *"/api/latest-brief is user-scoped
  and Bearer-only... Always mint a fresh Bearer here."*
- `renderSignInRequired()`: *"Your personalised brief is tied to your
  WorldMonitor account."*
- The data itself is written by a per-user Railway digest cron into Redis at
  `brief:{clerkUserId}:{date}` — there is no global/anonymous brief to serve.

Removing the sign-in check without removing the panel would just turn a
clean "Sign in to view your brief" CTA into a raw 401/503 — no functional
gain, since the underlying personalized data can't exist without the
Dodo→Convex→Railway chain this fork doesn't run. Decision: hide the panel
entirely rather than leave a broken feature.

## What was removed

**Registration / config** (panel no longer exists, not just disabled):
- 5x `'latest-brief': { name: 'Latest Brief', ..., premium: 'locked' }` entries
  across `src/config/panels.ts`'s per-variant panel-config objects.
- `'latest-brief'` from the `core` category's `panelKeys` array
  (`panels.ts` `PANEL_CATEGORY_MAP`).
- The `this.lazyDefaultPanel('latest-brief', ...)` registration in
  `src/app/panel-layout.ts`.
- `'latest-brief'` from `WEB_PREMIUM_PANELS`.
- The whole `WEB_CLERK_PRO_ONLY_PANELS` set (`latest-brief` was its only
  member) and the `updatePanelGating()` branch that consulted it — dead once
  the set was empty. Its now-unused imports (`hasTier`, `getEntitlementState`
  from `@/services/entitlements`) were dropped too.
- The command-palette entry (`src/config/commands.ts`).
- The barrel export (`src/components/index.ts`) and the component file
  itself, `src/components/LatestBriefPanel.ts` — deleted.
- The `.latest-brief-*` CSS block in `src/styles/panels.css` (lines
  3425-3582, ~20 rules).
- `'latest-brief'` dropped from `EntitlementDesyncPanel`'s union type in
  `src/services/entitlement-desync-telemetry.ts` (no caller left).

**Tests fixed** (referenced the now-deleted component):
- `tests/panel-attached-fetch-guard.test.mts` — removed the one
  LatestBriefPanel-specific `it` block.
- `tests/premium-denial.test.mts` — removed `LatestBriefPanel.ts` from the
  `WIRED_PANELS` array, its 2 dedicated `it` blocks (`routes its denials
  through routeDenial`, `has exactly two renderUpgradeRequired call sites`),
  and its entry in the entitlement-desync decision-sites map (renamed that
  test from "three" to "two" sites).

**Left untouched, deliberately** (server-side, now dormant/unreachable —
same precedent as every other client-only removal in this queue):
- `api/_latest-brief.ts`, `api/brief/[userId]/[issueDate].ts`, and their
  tests (`brief-edge-route-smoke.test.mjs`, `news-digest-methodology-parity.test.mjs`,
  `brief-thread-open-telemetry.test.mjs`) — these exercise the server route
  directly by module import, not through the deleted client panel, and still
  pass unmodified. No client code calls this endpoint anymore, but ripping
  out the Redis/Railway-side infra was out of scope for a client-side panel
  removal and carries no benefit.
- `docs/panels/latest-brief.mdx` — left as historical documentation.

## Verification

1. `npx tsc --noEmit -p tsconfig.json` — clean.
2. `npm run build` — clean (regenerated `public/product-facts.json`'s
   `panelImplementations` count 109→108, accurately reflecting the real
   removal; `public/sitemap.xml`'s timestamp bump was reverted, unrelated
   noise).
3. Ran all 10 test files that referenced `latest-brief`/`LatestBriefPanel`
   (`brief-edge-route-smoke.test.mjs`, `pro-json-entitlement-gates.test.mts`,
   `panel-entitlement-byok-guard.test.mts`, `billing-state-wiring.test.mts`,
   `panel-attached-fetch-guard.test.mts`, `chat-analyst.test.mts`,
   `entitlement-desync-telemetry.test.mts`, `brief-thread-open-telemetry.test.mjs`,
   `premium-denial.test.mts`, `news-digest-methodology-parity.test.mjs`):
   271 tests, 269 pass, 2 fail (`widget-agent structured billing denial
   (#4771)`, `classifier vocabulary matches what the servers actually emit`)
   — both confirmed present in the pre-change 238-failure baseline
   (`docs/tasks/abdullah/28-remove-dead-showlocked-cta.md`), unrelated to
   this change.
4. `pro-json-entitlement-gates.test.mts`'s 8 failures (server-side
   `checkProEntitlement`/`checkTierProEntitlement` contract tests, unrelated
   to the client-only panel removal) also confirmed against that same
   baseline.
