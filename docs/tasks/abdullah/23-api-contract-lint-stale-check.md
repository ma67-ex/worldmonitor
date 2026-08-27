**STATUS: DONE — 2026-08-27**

# 23 — `lint:api-contract` false positives from the dispatcher consolidation

Picked up from `21-deferred-not-safe-swaps.md`'s open question: "which of these RPCs are actually wired to a live feature vs. dead generated code that should be deleted instead of gatewayed." Answer: **all of them are wired, none are dead.**

## What was actually wrong

`scripts/enforce-sebuf-api-contract.mjs` detects a domain's HTTP gateway by matching a literal file path: `api/<kebab-domain>/v<N>/[rpc].ts`. That pattern predates the Vercel Hobby 12-function-cap consolidation — those standalone files don't exist anymore, everything routes through `api/domain-gateway/[domain]/v1/[...rest].ts`'s `REGISTRY` instead. The linter had no way to see that, so it flagged all 35 consolidated domains as "generated service has no HTTP gateway."

Verified each of the 35 flagged domains (`aviation`, `batch`, `climate`, `conflict`, `consumer_prices`, `cyber`, `displacement`, `economic`, `forecast`, `giving`, `health`, `imagery`, `infrastructure`, `intelligence`, `leads`, `maritime`, `market`, `military`, `natural`, `news`, `positive_events`, `prediction`, `radiation`, `research`, `resilience`, `sanctions`, `scenario`, `seismology`, `shipping`, `supply_chain`, `thermal`, `trade`, `unrest`, `webcam`, `wildfire`) against `REGISTRY`'s keys in the dispatcher — exact match, zero dead code.

## Fix

Added a scan in `enforce-sebuf-api-contract.mjs`: before classifying files, grep every candidate `api/` file's source for `src/generated/server/worldmonitor/<domain>/v<N>/service_server` import paths and count each match as a live gateway, the same as the standalone-file pattern. Generic — picks up any current or future consolidated dispatcher, not hardcoded to `domain-gateway` specifically.

Verified: 144 → 109 violations (`git stash`/`stash pop` A-B compare against unmodified script). The 35 removed are exactly the false positives above.

## What's left (real, pre-existing, not touched)

109 violations remain, all pre-existing and unrelated to this fix:
- Dozens of stale `api-route-exceptions.json` entries pointing at files that no longer exist (mostly the old `api/mcp/*.ts` tree, consolidated elsewhere).
- The 3 dispatcher files themselves (`domain-gateway`, `misc-gateway`, `misc-gateway2`) aren't in the exceptions manifest, so they fail the "neither a gateway nor a listed exception" check.

Real scope, not attempted tonight: someone needs to decide, per stale entry, whether the file was deleted (remove the manifest entry) or moved (fix the path) — that's a manifest-cleanup pass, not a linter bug. Bigger than the false-positive gap this file set out to fix.
