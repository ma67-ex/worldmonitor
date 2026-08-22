**STATUS: DONE — 2026-08-22**

Neutralized every server-side gate at its single point of enforcement rather than touching each of the ~30 RPC handlers that call into them:

1. `server/gateway.ts` — `needsLegacyProBearerGate` hardcoded to `false` (was `PREMIUM_RPC_PATHS.has(pathname) && !isTierGated`). `PREMIUM_RPC_PATHS` itself left untouched — the client's `src/services/premium-fetch.ts` still reads it to decide when to attach a bearer, which is harmless now that the server never checks it.
2. `server/_shared/entitlement-check.ts` — `checkEntitlementDetailed()` rewritten to always return `{ response: null, entitlements: ... }`. `getRequiredTier()`'s map is untouched on purpose — a test (`entitlement-check.test.ts`) pins its return value as a "regression-lock against tier-2 revert," and the map still drives cache-tier classification elsewhere in `gateway.ts` (line ~2014), so removing it would be unrelated scope.
3. `server/_shared/premium-check.ts` — `resolvePremiumCallerIdentity()` wrapped: the real identity resolution (userId/kind, used for telemetry and the internal-MCP HMAC path) runs unchanged, but a deny outcome is now converted to `{ isPremium: true, kind: 'enterprise', quotaExempt: true }` instead of being returned as-is. This covers every one of the ~15 handlers that gate via `isCallerPremium`/`requirePremiumRpcAccess` in one place (`server/worldmonitor/**`, `api/_mcp-proxy.ts`, `api/me/_entitlement.ts`, `api/v2/shipping/webhooks/**`).
4. `server/_shared/pro-entitlement.ts` — `checkProEntitlement`/`checkTierProEntitlement` (used by `api/_notify.ts`, `api/_latest-brief.ts`, `api/discord/oauth/_start.ts`, `api/brief/_share-url.ts`, `api/slack/oauth/_start.ts`) now always return `{ allowed: true }`. This is a genuinely separate gate from `premium-check.ts` — same signal (Clerk role / Convex tier), different implementation, had to be found and killed independently.
5. `api/_widget-agent.ts` — had its own third, inline copy of the Clerk-role/Convex-tier check (not routed through either shared module). Any valid signed-in session now sets `isPro = true` directly; the legacy `X-Widget-Key`/`X-Pro-Key` tester-key branch was left alone since that's a separate secret-key mechanism for Akul's own relay infra, not a billing gate.

Left alone per the task's own scope: Clerk/Convex/Dodo SDKs, schema, and env plumbing — nothing was ripped out, just nothing on the request path blocks on it anymore.

**Verify:**
- `npm run typecheck` clean, `npm run typecheck:api` clean (the separate `tsconfig.api.json` pass — confirmed both, not just the root one), `npm run build` clean.
- **Not verified live against the production deploy** — no Convex/Redis credentials in this environment to run `vercel dev` against real infra. This push triggers Akul's existing GitHub→Vercel auto-deploy (per the rebrand plan doc), so the real live check is: after this lands, hit a previously-gated RPC (e.g. `/api/market/v1/analyze-stock`) with no auth header and confirm 200, not 402.
- **Ran the existing test suite as a sanity check (not requested by this task's verify section, did it anyway).** 12 tests now fail, all expected and all in the 3 files that pinned the *old* paywall-enforcing behavior as their explicit test subject: `entitlement-check.test.ts` (tier-403 assertions), `widget-agent-billing-denial.test.ts`, `summarize-article-handler-security.test.ts` ("Pro subscription required" assertions). These tests are testing the exact behavior this task removes — didn't rewrite them, since turning "strip the paywall" into "also rewrite the paywall's test suite" is real extra scope for an unattended pass. Flagging honestly rather than silently leaving a red test suite: if Akul wants these updated to assert the new always-allow behavior, that's a fast follow-up, not urgent since the code itself is correct.
- `config/panels.ts` still has `premium: 'locked'` on panels whose backend RPC is now unblocked server-side: `stock-backtest`, `daily-market-brief`, `global-procurement`, `trade-policy`, `latest-brief`, `wsb-ticker-scanner` (all also on README's "never scoped" list), plus `oref-sirens`/`telegram-intel` (desktop-only lock, and blocked separately on the deferred Railway seed infra anyway) and `forecast` (desktop-only trial lock). Per this task's own instruction, **not removing these** — verifying each panel actually renders real data end-to-end is separate panel-by-panel work.

---

# Task: Strip server-side premium entitlement checks

## Why
Client-side paywall gates (ProBanner, PRO badges, `premium: 'locked'` flags) are already removed for the panels that have a working path. But the server still 402s on its own: `server/gateway.ts`'s `PREMIUM_RPC_PATHS` gate and the "legacy Pro bearer gate" (`gateway.ts:1436-1497`), plus `server/_shared/entitlement-check.ts` / `premium-check.ts`, all still enforce WorldMonitor's Clerk/Convex billing entitlement on **this fork's own deployment**. Akul isn't running a paid product — this fork has no billing stack behind it — so these checks just block real requests against a Vercel deploy that owns its own data now (Redis/Upstash, self-generated `WM_SESSION_SECRET`). No new decision needed here: de-paywalling this fork is the whole point of the project, this is just finishing the job on the server side rather than only the client side.

## What to do
1. Find every call site gated by `PREMIUM_RPC_PATHS` in `server/gateway.ts` and remove/no-op the check (or make it always pass) — same file, same pattern as the "legacy Pro bearer gate" at `gateway.ts:1436-1497`.
2. `server/_shared/entitlement-check.ts` and `server/_shared/premium-check.ts` — find their exported check function(s) and make them return "entitled" unconditionally (don't delete the file/functions if other code imports the shape — check callers first).
3. Grep for `isCallerPremium` / `hasPremiumAccess` / `ENDPOINT_ENTITLEMENTS` across `server/` and `api/` — anywhere still reachable that could 402 a request this fork should be serving for free.
4. Leave the Clerk/Convex/Dodo billing plumbing itself in place (don't rip out the SDKs or schema) — just make sure nothing on the request path actually blocks on it. Ripping out the whole billing stack is a bigger, separate call Akul hasn't asked for.

## Verify
- `npm run typecheck` clean, `npm run build` clean (this touches `server/`, which has its own `tsconfig` gotchas per `sessions/worldmonitor/summary.md` — run the real build, not just `tsc --noEmit`).
- Live: hit a previously-gated RPC (something under the old `PREMIUM_RPC_PATHS` list) without any Pro/entitlement header and confirm real 200 data, not a 402.
- Grep `config/panels.ts` for any `premium: 'locked'` flags whose panel's backend RPC is one you just unblocked — if the client gate is still there but the server no longer needs it, flag it (don't silently remove client flags on panels you haven't verified end-to-end — that's still panel-by-panel work, separate scope).
