# 29 — api-route-exceptions.json is required by 2 checks with contradictory rules

Found 2026-09-03 while cleaning up 105 genuinely-stale entries in `api/api-route-exceptions.json` (pre-consolidation route files from the original 2026-08-15/16 Hobby-12-function dispatcher work, never removed — that cleanup is done and safe, see the commit history). 7 of those entries turned out to be load-bearing for a *different* check, and putting them back to unblock that check reintroduces the original violation in the first check. Both are real, neither is a quick fix — flagging for you rather than guessing at a resolution under time pressure.

## The conflict

`scripts/enforce-sebuf-api-contract.mjs` (→ `npm run lint:api-contract`) requires every entry's `path` to point at a file that **physically exists** (`existsSync`).

`scripts/enforce-rate-limit-policies.mjs` (→ `npm run lint:rate-limit-policies`) reads the same file and treats every entry's `path` as a **valid rate-limit-policy key**, purely via string transform (`api/mcp-proxy.ts` → `/api/mcp-proxy`) — no file-existence check at all. Its own comment explains why: "top-level Vercel Edge Functions registered as non-proto exceptions... can still register a rate-limit policy that's enforced in-handler via `checkScopedRateLimit`."

7 routes are caught in the middle — they're real, live, currently-served endpoints (confirmed via `vercel.json` rewrites, all route to `api/misc-gateway/[name].ts` or `api/misc-gateway2/[...path].ts`), but their original standalone files were folded into the dispatcher during the Hobby-12 consolidation and no longer exist on disk:

- `api/ask.ts` (NLWeb protocol)
- `api/a2a.ts` (Agent-to-Agent JSON-RPC)
- `api/mcp-proxy.ts`
- `api/docs-mcp.ts`
- `api/youtube/live.js`
- `api/reverse-geocode.js`
- `api/skills/fetch-agentskills.ts`

Each has a real `ENDPOINT_RATE_POLICIES` entry in `server/_shared/rate-limit.ts` (that's the whole point — some of these hit external LLM/API costs and need a tighter-than-global limit). Removing them from `api-route-exceptions.json` (to satisfy `lint:api-contract`) makes `lint:rate-limit-policies` flag them as orphaned policy keys pointing nowhere. Keeping them (to satisfy `lint:rate-limit-policies`) makes `lint:api-contract` flag them as pointing to a deleted file. **No entry in `api-route-exceptions.json` can satisfy both checks simultaneously as currently written.**

Likely explains part of why `Lint Code` has been failing in CI for a while undetected: `npm run lint` chains scripts with `&&`, and `lint:api-contract` ran (and failed, on the other 98 truly-dead entries) before `lint:rate-limit-policies` ever got a chance to run — so this second conflict may have been silently present since the original consolidation, never actually exercised in CI.

## Current state (2026-09-03)

Restored these exact 7 entries verbatim (same path/category/reason/owner as before my cleanup) so `lint:rate-limit-policies` passes and their real rate limits stay enforced — that's the higher-stakes side to protect (a missing rate limit on an external-LLM-backed endpoint is a real cost/abuse surface; a lint failure is not). This means `lint:api-contract` still fails on exactly these 7 (down from 105) — a known, scoped, harmless failure, not a random pile of stale references anymore.

**Real fix, not done here** (needs a methodology call, not a mechanical edit):
1. Add a field to exception entries — e.g. `"servedVia": "dispatcher"` — that `enforce-sebuf-api-contract.mjs` accepts as satisfying "exists" (check the dispatcher's REGISTRY object contains the route instead of `existsSync`), while `enforce-rate-limit-policies.mjs` keeps working exactly as it does now (it only reads `path`, ignores unknown fields).
2. OR: give `enforce-rate-limit-policies.mjs` its own smaller manifest (e.g. `server/_shared/rate-limit-legacy-routes.json`) instead of overloading `api-route-exceptions.json` for two different jobs — cleaner separation, more files to keep in sync.
3. OR: check whether these 7 rate-limit policies could instead be enforced by string-matching the request path directly in `api/misc-gateway/[name].ts`/`api/misc-gateway2/[...path].ts`'s own dispatch logic (since that's where the request actually lands now) rather than depending on `api-route-exceptions.json` as a policy registry at all — might make the whole cross-check unnecessary.

Whichever you pick, verify against BOTH `npm run lint:api-contract` and `npm run lint:rate-limit-policies` before calling it done — that's the whole reason this went undetected as long as it did.

**Note for whoever picks this up**: `enforce-rate-limit-policies.mjs` and a couple of other `tsx`-invoked scripts fail on this repo's local checkout path (`/Users/ak/Desktop/claude code/...` — literal space in the directory name causes a double-URL-encoding bug in tsx's ESM resolver, `%20` → `%2520`). Confirmed this is 100% local-environment-only (reproduces identically against unmodified `main`, unrelated to any code change) — it will not occur in CI (no space in the runner's checkout path). If you hit `ERR_MODULE_NOT_FOUND` with `%2520` in the URL on any `tsx`-invoked script, that's this bug, not a real regression — verify via `gh run` logs or a space-free path instead of trusting the local run.
