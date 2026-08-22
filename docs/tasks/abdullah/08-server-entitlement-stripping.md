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
