**STATUS: DONE — 2026-09-03**

Removed the "API Keys" and "Connected MCP clients" Settings tabs entirely —
the last two things in the app that required a Clerk sign-in. Not rebuilt
anonymous, just gone, per explicit instruction: nobody needs programmatic/MCP
access to a personal geopolitical dashboard.

The blast radius was bigger than the spec's anchor line numbers suggested
(it warned as much — "grep the WHOLE file, there are more than the line
numbers above"). Three things the spec didn't name turned out to be
downstream of the same removal and got pulled in too, each justified below.

# What was removed

## `src/components/UnifiedSettings.ts` (1776 → 977 lines)

Everything scoped to the two tabs, found by grepping the whole file for
`apiKeys`/`ApiKey`/`mcpClients`/`McpClient`/`api-keys`/`mcp-clients`/
`apiAccess`/`mcpAccess`/`hasFeature`/`onEntitlementChange`/`isEntitled`:

- Tab registration, tab buttons, tab panel containers (`render()`).
- `attachApiKeysHandlers`, `renderApiKeysContent`, `loadApiKeys`,
  `handleCreateApiKey`, `handleRevokeApiKey`, `showCreatedBanner`,
  `hideBanner`, `renderApiKeysError`, `renderApiKeysList`.
- `renderMcpClientsContent`, `renderMcpQuotaText`, `formatQuotaReset`,
  `loadMcpClients`, `refreshMcpQuota`, `renderMcpQuotaInPlace`,
  `start/stopMcpQuotaPolling`, `handleRevokeMcpClient`,
  `renderMcpClientsError`, `renderMcpClientsList`.
- State fields: `apiKeys*`, `newlyCreatedKey`, `mcpClients*`, `mcpQuota*`.
- Click delegation for `.api-keys-*`/`.mcp-clients-*` buttons, tab-switch
  branches, `open()`'s `mcp-clients`-without-`mcpAccess` fallback.

**Found beyond the spec's anchors, removed as the same dead-code chain:**

1. **The whole "API plan-limit notices" subsystem** — `loadPlanLimitNotices`,
   `renderPlanLimitNotices`, `handleAcknowledgePlanLimitNotice`,
   `handlePlanLimitNoticeCta`, the `planLimitNotices*` state, and the
   `data-plan-limit-ack`/`data-plan-limit-cta` click delegation. This was a
   companion billing-upsell feature (`checkout`/`billing_portal`/
   `contact_support` CTAs for API/MCP rate-limit warnings) that rendered
   exclusively inside the two removed tabs' HTML (`data-plan-limit-notices`
   appeared only in `renderApiKeysContent`/`renderMcpClientsContent`) — zero
   other render call sites. Its client service,
   `src/services/api-plan-limit-notices.ts`, is deleted below for the same
   reason `api-keys.ts`/`mcp-clients.ts` are: UnifiedSettings.ts was its only
   consumer.
2. **The whole `onEntitlementChange` subscription in `open()`** — every
   branch inside it (`accountEntitlementRefreshPending` re-render, the
   `hasMcpClientsTab` rebuild check, the API Keys panel re-render) existed
   solely to react to `apiAccess`/`mcpAccess` changes for the two removed
   tabs. `hasFeature` had zero remaining call sites in this file after the
   tabs were gone (confirmed by grep — all 10 hits were `apiAccess`/
   `mcpAccess` checks), so `hasFeature`/`isEntitled`/`onEntitlementChange`
   are dropped from the import list too.
3. **`captureAccountRequest`/`isAccountRequestCurrent`/`accountDataGeneration`
   /`AccountRequest`** — the generic "is this async settlement still for the
   current account" guard. Its only callers were the api-keys/mcp-clients/
   plan-limit-notices load methods, all deleted. `BusinessSeatsSection` (the
   other account-scoped surface in this file) has its own independent
   `accountGeneration` guard and was untouched.
4. **`trackApiAction`/`ApiActionName`/`API_ACTIONS`/the `'api-action'` event**
   in `src/services/analytics.ts` — found via `tests/funnel-analytics-policy.test.mjs`
   failing after the edit (`trackApiAction('key-created')`/`'key-revoked'` no
   longer existed in UnifiedSettings.ts, the assertion's whole subject was
   gone). Confirmed zero remaining callers anywhere in `src/`, so removed at
   the root rather than patching the test to check for absence. Left
   `trackApiKeysSnapshot` (a pre-existing, already-zero-caller no-op in the
   same file's deliberate "kept as no-ops" block) alone — that one predates
   this change and isn't part of this chain.

`handleAccountIdentityChange`'s `render(false)` call became `render()` (the
`loadAccountData` parameter it gated no longer has any effect — `render()`
now takes no arguments); the comment was updated to describe what the
synchronous re-render is actually for now (resyncing signed-in-dependent
Preferences/Notifications UI, not suppressing account loaders that don't
exist anymore).

## Deleted files

- `src/services/api-keys.ts` — sole importer was `UnifiedSettings.ts`.
- `src/services/mcp-clients.ts` — sole importer was `UnifiedSettings.ts`
  (+ one test, handled below).
- `src/services/api-plan-limit-notices.ts` — sole importer was
  `UnifiedSettings.ts` (found during the sweep above, not in the original
  spec's file list — see finding 1).

## CSS — `src/styles/main.css`

One contiguous block, `/* ---- API Keys Settings Tab ---- */` through the end
of `/* ---- Connected MCP clients (Pro tier) ---- */` (old lines
25679–26091), including the `.api-plan-limit-notice*` rules sandwiched
between them (same reasoning as finding 1 — that CSS only ever painted
inside these two tabs). Grepped all of `src/styles/*.css`; only `main.css`
had any of these classes.

## `src/app/pro-activation-controller.ts` + `src/components/ProActivationInterstitial.ts`

Not in the spec's file list, found while checking who else called
`.open('mcp-clients')` before deleting the tab id from the type union — one
real call site: the Pro-activation "Finish setup" power-step's "Set up MCP"
deep-link pointer (`openMcpClients`), wired only when `hasFeature('mcpAccess')`.
With the MCP Clients tab gone, that pointer would deep-link to a tab
`UnifiedSettings` no longer renders (previously handled by a click-time
re-check that fell back to the plain Settings tab — a defensive branch for
exactly this kind of drift, now unreachable itself). Removed:

- `openMcpClients` from `ProActivationFlowOptions` (`ProActivationInterstitial.ts`).
- The `add('mcpClients', ..., options.openMcpClients)` pointer registration
  in `buildPowerExtra`.
- The `openMcpClients: hasFeature('mcpAccess') ? () => {...} : undefined`
  wiring block in `pro-activation-controller.ts`'s `buildFlowOptions`, and
  the now-unused `hasFeature` import there.

Left the `components.proActivation.steps.power.pointers.mcpClients`
translation key in all 29 locale files untouched — an unused i18n string is
harmless, and editing 29 JSON files for one dead key is disproportionate to
the benefit (no test enforces "every key is used"; only key-parity across
locales is guarded, which this doesn't affect).

## `src/components/settings-types.ts`

Removed `'api-keys' | 'mcp-clients'` from the `UnifiedSettingsTabId` union —
unlike `'billing'` (removed as a tab in task 13 but kept in the union because
`event-handlers.ts` still calls `.open('billing')` as a live, intentionally-
soft-falling-back deep link), these two had zero remaining call sites once
the Pro-activation pointer above was removed, so the type could go too.

# Test files touched

Grepped `tests/` for the same token set plus the actual import paths
(`@/services/api-keys`, `@/services/mcp-clients`, `@/services/api-plan-limit-notices`)
since a plain string grep for `ApiKey`/`McpClient` pulls in a lot of
unrelated server-gateway/`validateApiKey` noise. Real hits, and what was done
with each:

- **Deleted whole file** (100% about the removed feature):
  `tests/api-keys.test.mts` (`generateKey()` unit tests — the function no
  longer exists), `tests/api-plan-limit-notices-ui.test.mts` (wiring-existence
  assertions for the deleted plan-limit-notices subsystem),
  `tests/unified-settings-active-tab.test.mjs` (#5611 — `open()`'s
  mcp-clients-availability gating no longer exists in source; its 2
  incidental #6380 source-selection-baseline tests were strictly redundant
  with the much more thorough real-DOM coverage already in
  `tests/dom/unified-settings-sources-live-apply.test.mts`),
  `tests/dom/unified-settings-account-handoff.test.mts` (every mock, type,
  and assertion in this file was api-keys/mcp-clients/plan-limit-notices
  account-handoff behavior; no unrelated content to keep).
- **Surgical removal** (file covers other things too):
  `tests/unified-settings-account-handoff.test.mjs` (root `.mjs` — deleted
  the `'UnifiedSettings account handoff'` describe block, kept the unrelated
  `'BusinessSeatsSection account handoff'` block and dropped the now-unused
  `settingsSource` read); `tests/convex-auth-handoff.test.mts` (deleted 3
  `it()` blocks that were 100% about `createApiKey`/`acknowledgePlanLimitNotice`,
  trimmed the two generic-guard `cases` arrays down to their one remaining
  real entry, `listBusinessSeats`, dropped the now-dead imports);
  `tests/mcp-quota.test.mjs` (deleted the one `it()` that imported
  `normalizeQuotaLimit` from the deleted `mcp-clients.ts`; the rest of the
  file tests the untouched server-side `api/user/_mcp-quota.ts` endpoint);
  `tests/pro-activation-controller.test.mts` (deleted the 3 `it()` blocks
  entirely about `options.openMcpClients`, kept the unrelated command-search
  pointer test); `tests/dom/unified-settings-theater-presets.test.mts` and
  `tests/dom/unified-settings-sources-live-apply.test.mts` (dropped the 3
  now-pointless `vi.mock('@/services/api-keys' | 'api-plan-limit-notices' |
  'mcp-clients', ...)` blocks — those modules are no longer imported by
  `UnifiedSettings.ts` at all, so mocking them was dead scaffolding; every
  other test in both files is genuinely about theater presets / source
  live-apply, untouched); `tests/funnel-analytics-policy.test.mjs` (root
  cause of the analytics.ts cleanup above — dropped `'api-action'` from the
  typed-event-catalog check and deleted the 2 `it()` blocks that policed the
  now-deleted `trackApiAction` vocabulary; the file's other ~10 tests, about
  checkout/Umami/DebugBear funnel tracking, are untouched).
- **`e2e/pro-activation.spec.ts`** (Playwright, not part of `test:data`/`test:dom` —
  found by grepping the whole repo, not just `tests/`, for `mcpClients`):
  dropped the harness's `openMcpClients`/`openApiKeys` opener injection and
  the assertion that the power step's third pointer is a "Set up MCP" deep
  link — that pointer no longer renders (see the ProActivationInterstitial
  change above). Not runtime-verified (no Playwright browser/dev-server in
  this environment); the edit mirrors the exact pattern already applied to
  the equivalent Node-side assertions in `tests/pro-activation-controller.test.mts`,
  which are runtime-verified.

**Confirmed NOT touched, checked and are false-positive greps:**
`src/components/McpConnectModal.ts` (an unrelated "Connect MCP" *widget*
feature — external MCP server URLs for the widget-builder, not the Settings
account-scoped MCP-clients OAuth list), `src/services/entitlements.ts`'s
`apiAccess`/`mcpAccess` catalog fields (server-driven entitlement schema,
dormant/harmless per the "leave server infra alone" instruction — same class
as `convex/apiKeys.ts`/`convex/mcpProTokens.ts`, confirmed untouched),
`tests/premium-stock-gateway.test.mts`/`tests/usage-telemetry-emission.test.mts`
(server-gateway entitlement tests; their `apiAccess`/`mcpAccess` hits are
unrelated fixture fields on `EntitlementState`, and one stale comment in each
still cites `src/services/api-keys.ts` as the origin of the `wm_`+40-hex key
shape — cosmetically stale now but a server-side-gateway file, out of scope,
noted here rather than fixed).

# Not touched (server/Convex infra, dormant by design)

Per the task's explicit instruction: `convex/apiKeys.ts`, `convex/mcpProTokens.ts`,
`convex/apiPlanLimitNotices.ts`, `convex/apiPlanLimitUsage.ts`,
`convex/apiPlanLimitEmails.ts`, `api/oauth/`, `api/internal/_mcp-grant-*`,
`server/_shared/pro-mcp-*`, `server/gateway.ts`'s gate call sites, and
`api/user/_mcp-quota.ts`/`api/mcp/_quota.ts` (still exercised by the
untouched half of `tests/mcp-quota.test.mjs`). All left exactly as-is —
unreachable from the client now, zero risk leaving them, same precedent as
`api/_latest-brief.ts` in the prior panel-removal task.

Also not touched: `docs/api-keys.mdx` and the "API Keys tabs" mention in
`docs/COMMUNITY-PROMOTION-GUIDE.md` — both describe the upstream
worldmonitor.app SaaS product's still-live, still-billed API Keys feature,
not this fork's dashboard. Same "docs/*.mdx reachability" bucket task 27
already swept and deliberately left for a separate pass, not bundled into
feature-removal work.

# Verification

1. `npx tsc --noEmit -p tsconfig.json` — clean.
2. `npx tsc --noEmit -p tsconfig.api.json` — clean (server/API code untouched,
   as expected).
3. `npm run build` — clean (only the pre-existing, ignorable >1200kB chunk
   warning). Required a `node scripts/source-attribution.mjs --write` after
   deleting the 3 service files — the manifest's reference count for
   `api.worldmonitor.app` dropped from "+18 more" to "+17 more" (one fewer
   file mentioning that host), which is the expected, correct fallout of the
   deletion, not noise.
4. Targeted test files, all passing:
   - `npx tsx --test tests/unified-settings-account-handoff.test.mjs
     tests/mcp-quota.test.mjs tests/convex-auth-handoff.test.mts
     tests/pro-activation-controller.test.mts` → 58/58 pass.
   - `npx tsx --test tests/funnel-analytics-policy.test.mjs` → 15/15 pass.
   - `npx tsx --test tests/a11y-issue-5059-invariants.test.mjs` → 25/26 pass;
     the 1 failure (`renders Plan & billing as its own signed-in tab and
     panel`) is confirmed pre-existing via `git stash` (identical failure,
     identical assertion, before and after this change) — task 13 removed
     the billing tab weeks ago and this test was never updated; unrelated to
     this task, not fixed here.
   - `npx vitest run tests/dom/unified-settings-theater-presets.test.mts
     tests/dom/unified-settings-sources-live-apply.test.mts
     tests/dom/notifications-settings-web-push.test.mts --config
     vitest.dom.config.mts` → 30/30 pass.
5. Full `npm run test:data`, diffed against a `git stash` baseline exactly
   like task 28's method (stash, run, note counts, unstash, run again,
   `comm` the sorted per-test failure-line lists):
   - Baseline (stashed / pre-change): 24021 tests, 243 failing.
   - First pass after the UnifiedSettings/CSS/service edits alone: 24001
     tests, 244 failing — a genuine +1 new failure
     (`funnel-analytics-policy.test.mjs`'s "API outcome telemetry is bounded
     to successful key lifecycle actions"), traced to the dead
     `trackApiAction` chain in `analytics.ts` (finding 4 above). Fixed at the
     root (deleted the dead vocabulary + the policy test asserting it),
     not by weakening or deleting an otherwise-valid test.
   - Final pass after that fix: 23999 tests, 243 failing — `comm` on the
     sorted failure-line sets between baseline and final shows **zero lines
     unique to either side**: the exact same 243 failures, byte-for-byte,
     before and after. The 22 fewer total tests is the expected count from
     the deleted/trimmed test files above; zero regressions, zero
     accidentally-fixed tests.
6. `git diff --stat public/sitemap.xml` after each `npm run build` showed the
   expected timestamp-only regeneration noise; `git checkout -- public/sitemap.xml`
   run after both builds to keep it out of the final diff.
