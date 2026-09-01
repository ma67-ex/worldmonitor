**STATUS: DONE — 2026-09-01**

# 27 — "Create Interactive Widget" / "Connect MCP" CTAs were `display:none` for every non-Pro user

Found continuing the sweep after task 26, per `CLAUDE.md`'s own hunting list item: "Checkout/billing UI ... widget tier quotas (`MAX_HTML_CHARS_PRO`) ... anything referencing Dodo/Clerk/Convex billing on the client side."

## What was wrong

`src/app/panel-layout.ts`'s dashboard "Add panel" grid creates two extra CTA buttons beyond the ordinary `+ Add panel` block: `proBlock` ("⚡ Create Interactive Widget", opens the AI widget builder) and `mcpBlock` ("⚡ Connect MCP", opens the MCP client connector). Both were wrapped in a real, live visibility gate:

```js
const applyProBlockGating = (isPro) => {
  for (const block of proBlocks) block.style.display = isPro ? '' : 'none';
};
const reapply = () => applyProBlockGating(hasPremiumAccess(getAuthState()));
reapply();
this.proBlockUnsubscribe = subscribeAuthState(reapply);
this.proBlockEntitlementUnsubscribe = onEntitlementChange(reapply);
```

`hasPremiumAccess()` (`src/services/panel-gating.ts:55`) only returns `true` for a real `WORLDMONITOR_API_KEY` secret (desktop/enterprise), `isProUser()` (Clerk role), or `authState.user?.role === 'pro'` (also Clerk) — none of which exist for a normal anonymous/free web user on this fork. So both buttons rendered with `display: none` for every ordinary visitor, permanently. This predates the fork (commit `0245ed53a`, 2026-03-26, and `7eb338dce`, 2026-04-30, both upstream — well before the 2026-08-15 rebrand/de-paywall work started).

Task 18 (2026-08-24) looked at this exact block and found `proBlock`'s stale "PRO" badge (`mcpBadge`-style span, unconditionally rendered) — removed it, and correctly noted "`api/_widget-agent.ts` was neutered in task 08, so nothing behind this CTA actually requires payment." But task 18's own writeup says "no show/hide toggle existed anywhere" for `proBlock` at the time — that's the part that was wrong: the toggle was there all along, a few lines further down in the same function (`applyProBlockGating`/`reapply`/the two subscriptions), just not adjacent to the badge task 18 was looking at. It went unnoticed for over a week across tasks 20/24/25/26.

`mcpBlock` never had its badge removed either — task 18 explicitly flagged it as "the same pattern... if someone wants to chase it next" and left it alone.

## Confirmed not a false alarm before touching anything

- `hasPremiumAccess()` genuinely can't return `true` for a normal fork user — traced all three of its branches (desktop secret, Clerk `isProUser()`, Clerk `role === 'pro'`); none apply to an anonymous/free web session on this deploy.
- Server side is already free: `api/_widget-agent.ts` (backs the widget builder) was neutered in task 08 (comment at line 132: "no billing stack behind this deploy — any signed-in..."). `api/mcp-proxy.ts` (backs the MCP connector) uses `isCallerPremium()` → `resolvePremiumCallerIdentity()` (`server/_shared/premium-check.ts:232-237`), which is hardcoded to always return `{ isPremium: true, ... }` fork-wide, also from task 08. So the client-side visibility gate was the ONLY remaining block — fixing it alone fully unlocks both features, no server change needed.
- Checked for an alternate free entry point before treating this as user-facing-broken: `ChatAnalystPanel.ts` can also dispatch the same `wm:open-widget-creator` event from its own "Create chart widget" action chip, but that panel is itself one of the 5 correctly-BYOK-gated panels (needs the user's own AI key) — not a substitute for the primary, always-discoverable Add-Panel grid button.

## Fix

`src/app/panel-layout.ts`:
- Removed the `applyProBlockGating`/`reapply` function and both subscriptions (`subscribeAuthState`, `onEntitlementChange`) — `proBlock` and `mcpBlock` are now appended to the grid with no visibility toggle at all, same as the plain `+ Add panel` block next to them.
- Removed the now-unused `proBlockUnsubscribe`/`proBlockEntitlementUnsubscribe` fields and their `destroy()` cleanup calls.
- Removed `mcpBlock`'s stale `widget-pro-badge` "PRO" span — same fix task 18 already applied to `proBlock`, applied here to close the pair out.
- `hasPremiumAccess`/`onEntitlementChange` imports both still have other real call sites in the file (panel gating, WebMCP `isPanelAllowed`, entitlement subscription for panels) — left in place, unused-import check confirmed clean.

## Verification

- New test: `tests/widget-builder.test.mjs`'s `panel-layout — Pro add-block CTAs render unconditionally (no paywall)` describe block (3 assertions: no `hasPremiumAccess`/`style.display` in the block-creation region, no `widget-pro-badge` in `mcpBlock`, no leftover `proBlockUnsubscribe`/`proBlockEntitlementUnsubscribe` handles) — replaces the old describe block that pinned the dual-subscription gating behavior being removed here. Confirmed it fails against the pre-fix code (`git stash` on just the two touched files) with 2 of 3 assertions failing, and passes clean after unstashing.
- `npx tsc --noEmit -p tsconfig.json` — clean
- `npm run typecheck:api` — clean (unrelated to this change, run per `CLAUDE.md`'s standing facts)
- `npm run build` — clean
- Full `tests/widget-builder.test.mjs` run: 214/214 pass (was 212/214 before the test rewrite, with the 2 failures being exactly the two assertions pinning the removed gating)
- Full `npm run test:data`, diffed against a `git stash` baseline on the same commit (both touched files stashed together so the baseline run is internally consistent — old source + old test): **24027 tests both runs, 235 failing both runs, identical failure set** (`comm` diff of sorted failure titles: zero additions, zero removals). Zero regressions.

## Found but not fixed — nothing else this session

Re-checked the rest of `CLAUDE.md`'s hunting list before stopping:
- `grep -rn "premium: 'locked'" src/config/panels.ts` — only `latest-brief` (5 duplicate config-object entries), confirmed still correctly gated (real Dodo→Convex→Railway chain, task 15's trace still holds).
- `server/gateway.ts`'s `isTierGated`/`getRequiredTier` — `ENDPOINT_ENTITLEMENTS` (`server/_shared/entitlement-check.ts:147`) still tier-gates 5 real RPC paths (`classify-event`, `get-country-intel-brief`, `analyze-stock`, `get-stock-analysis-history`, `list-sanctions-pressure`). Traced whether these still 401 anonymous callers: `checkEntitlementDetailed()` itself never denies (task 08), but the earlier `validateApiKey({forceKey: isTierGated && !sessionUserId})` gate at `server/gateway.ts:1211`/`1440-1503` still does — a bare anonymous request to these 5 paths still gets a real 401. Checked every client call site: `list-sanctions-pressure` (`src/services/sanctions-pressure.ts:245-264`) and `get-country-intel-brief` (`src/app/country-intel.ts:713`) both explicitly avoid calling the gated RPC for non-premium users, routing through a free OFAC-proxy/bootstrap path instead (task 04's fix) — the RPC gate is dead-but-intentional from the client's perspective, matching the documented BYOK/managed-LLM-spend split (`src/shared/premium-paths.ts`'s own comments) for the other 3 (`classify-event`, `analyze-stock`, `get-stock-analysis-history` — all BYOK panels, gated because the managed path spends real server-side LLM $, with BYOK as the free alternative, same class as `latest-brief`). Not a stale gate — real, intentional, already worked around client-side. Left alone.
- `WEB_PREMIUM_PANELS` (`src/app/panel-layout.ts:128`) vs `apiKeyPanels` (`src/config/panels.ts:1301`) vs `BYOK_GATED_PANELS` (`panel-layout.ts:147`) — all three sets match exactly post-task-26 (`stock-analysis`, `market-implications`, `regional-intelligence`, `deduction`, `chat-analyst`, plus `latest-brief` only in `WEB_PREMIUM_PANELS`, correctly — it has no BYOK fallback). No drift.
- `ResilienceWidget.ts`'s `"Upgrade to Pro to unlock resilience scores."` string — confirmed dead: `getGateReason()` is hardcoded to always return `PanelGateReason.NONE` with an explicit de-paywall comment (task 03). Unreachable, not a bug.
- `docs/pricing.mdx`, `docs/zh/pricing.mdx`, `docs/accounts.mdx`, `docs/architecture.mdx` — checked whether these are reachable on the live fork before treating any stale-sounding claim in them as a bug. They're not: `vercel.json:142` rewrites `/docs/:match*` to `https://worldmonitor.mintlify.dev/docs/:match*` — any visit to `/docs/*` on this fork's deployment serves the real upstream WorldMonitor's own hosted docs, never this repo's local `docs/*.mdx` files. Those files are dev-side reference source (and `scripts/generate-public-product-facts.mjs`/`docs-stats.mjs` do validate specific numeric claims in them against real code, which still passed — `node scripts/docs-stats.mjs --check`: "173 doc claims match code"), but they describe the real upstream commercial product's real pricing, not this fork's gate state, and nothing here serves them live. Out of scope, unlike `public/pricing.md` (task 25), which IS served live at `/pricing.md`.
- `src/services/checkout.ts`/`billing-state.ts`/`pro-activation-state.ts`/`checkout-return.ts`/`pro-banner-policy.ts` and the wider checkout subsystem (`checkout-attempt.ts`, `checkout-dialog-factory.ts`, `checkout-duplicate-dialog.ts`, `checkout-no-user-policy.ts`, `checkout-sentry-policy.ts`, `checkout-error-toast.ts`, `ProActivationChip.ts`, `ProActivationInterstitial.ts`, `payment-failure-banner.ts`, `billing.ts`) — large, still-wired subsystem. Did NOT do a wholesale rip-out this session: it backs `Panel.showLocked()`'s CTA (used only by `latest-brief`, correctly still gated per the mission's own documented exception) and the settings-window Pro-activation flow, both real/load-bearing for the one panel that's still legitimately paywalled. A full audit of every checkout-subsystem file for additional dead branches is a bigger, separate task — flagging for a future session rather than rushing a wide, risky diff into this one (depth-over-breadth, per this session's own instructions).
- `Panel.ts`'s `showLocked(features)` method (with its own `startCheckout()` call) — confirmed unreachable in production: its only call site is `panel-layout.ts`'s `lazyPanel`/`lazyImportedPanel`/`lazyDefaultPanel`'s `lockedFeatures` parameter, and grepped every one of the ~55 registration call sites in `createPanels()` — zero pass a `lockedFeatures` array. Dead plumbing, but only reachable from 2 test files (`panel-unlock-restore.test.mts`, `dom/panel-error-latch.test.mts`) that directly unit-test the method in isolation. Left alone this session: removing it means deciding whether to also strip the tests exercising it, a second small-but-separate cleanup, not folded in here to keep this task's diff reviewable and scoped to the one confirmed-live bug.
