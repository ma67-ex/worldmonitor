# Abdullah — operating instructions for this fork

Read this first, then `summary.md` in this same folder for full context, then `README.md` for the task history. This file is the authority for how you work from here on — it supersedes the old "only add a task once Akul decides" rule in `README.md`. That rule is gone. Read the mission below and run with it.

## Mission

**Make every WorldMonitor Pro feature free on this fork. No pricing, no paywall, no sign-up required, anywhere.**

That's the whole scope. Not "the four tasks we already found" — the entire surface. If you find a locked panel, a sign-in wall, a "Upgrade to Pro" CTA, an API-key-required gate, a Clerk auth requirement, a Convex entitlement check, a checkout/billing flow remnant — anywhere in this codebase — it's in scope. Kill it. This fork isn't a SaaS Akul is running for revenue; it's his own personal geopolitical-intelligence tool. There is no reason anything in it should ever ask a user to pay or sign in.

Where to start hunting (not exhaustive — keep looking beyond this list):
- `grep -rn "premium: 'locked'" src/config/panels.ts` — any panel still flagged gets unlocked. Check whether it's a stale client-side gate (like `trade-policy` turned out to be — fixed by removing 3 redundant gates, no new data source needed) or a genuine missing data source (like `latest-brief`, which is tied to a real WorldMonitor Clerk account and needs its own real fix, not just a flag removal).
- `grep -rn "PREMIUM_RPC_PATHS\|requiresDirectLlmQuota\|isTierGated\|getRequiredTier" server/gateway.ts` — server-side gates. Most were neutralized 2026-08-22 (`server/_shared/entitlement-check.ts`, `premium-check.ts`, `pro-entitlement.ts`, `gateway.ts`'s `needsLegacyProBearerGate`). One gap already found and closed: `getRequiredTier()`'s map still drove `isTierGated` → forced an API key even after the other gates were stripped. Check for more gaps like that one — anywhere a request can still come back 401/402/403 for lack of Pro/sign-in.
- Any "Sign In to Unlock" / "Upgrade to Pro" CTA text anywhere in `src/components/`.
- Checkout/billing UI: `ProBanner`, `CommunityWidget`/Discord upsell, `.upgrade-pro-section`, widget tier quotas (`MAX_HTML_CHARS_PRO`), anything referencing Dodo/Clerk/Convex billing on the client side.
- `docs/tasks/abdullah/05-supply-chain-chokepoints.md`, `03-resilience-score.md` (already done, reference only), and the trade/tariffs remainder in `06` if anything's still open there.

## You have full authority. Do not wait for a decision from Akul.

Pick the approach, pick the data source, pick the methodology, pick the scope. If a call needs to be made (which alt-source to use, how to degrade gracefully when data's missing, whether to rewrite a test or delete it) — make it, document your reasoning in the task file the way `03`/`04`/`06`/`08`/`09` already do, and move on. Do not open a task file with "needs Akul's input" and stop. That pattern is retired.

**No exceptions — this includes infra decisions.** Railway (or anything else with a recurring cost) is yours to provision if it's the right fix. One real fact to weigh before you do: Railway kills unpaid/free-tier projects that go inactive, unlike Vercel/Upstash's genuinely-free tiers this fork already runs on — so if you stand up a Railway seed loop, make sure it's either on a plan that won't get killed, or accept that it may need reprovisioning later. That's a real operational cost of the choice, not a blocker on making it. Pick it, document why in the task file, move on.

## Critical gotcha: your pushes may not deploy. Verify, don't assume.

Found 2026-08-24: a full night of your work (6 commits, 2026-08-22) sat correctly on `origin/main` but **never actually deployed** — the live site kept serving the old bundle for two days. Root cause traced to Vercel: this project is on the Hobby plan, which has no team-member support, and Vercel's dashboard flags your account as "not on a team" — something about that combination appears to make Vercel skip auto-deploying your pushes specifically (not fully root-caused yet, only worked around).

**The workaround that worked**: a trivial commit pushed from Akul's own GitHub account triggered a fresh deploy that picked up everything on `main`, including all of your pending commits.

**What this means for you**: after you push, don't assume it's live. Verify against the real production alias (`https://worldmonitor-one-theta.vercel.app`), not just that the commit landed on `main`. Quick check: compare `main-<hash>.js` in the deployed `index.html` against what you'd expect from a fresh local build, or curl a change you just made directly (an endpoint, a CSS rule) and confirm it reflects your latest commit. If it doesn't match after a few minutes, say so plainly in your task-file update rather than marking something "done" — being wrong about deploy status is the one thing that's bitten this project twice now.

## Standing repo facts (from `sessions/worldmonitor/summary.md`, condensed)

- Vercel Hobby is capped at 12 deployed functions. WorldMonitor's real ~149-route `api/` surface is consolidated into 3 dispatcher files (`api/domain-gateway/[domain]/v1/[...rest].ts`, `api/misc-gateway/[name].ts`, `api/misc-gateway2/[...path].ts`) plus `vercel.json` rewrites. **New server-side endpoint → add it to one of these registries, don't create a new top-level Vercel function.**
- Vercel rewrites preserve the ORIGINAL client-facing pathname in `req.url` inside the target function, not the rewrite destination. Path-parsing bugs here have bitten this project before (`parts[N]` off-by-one). Read the comment at the top of `api/misc-gateway/[name].ts` before touching dispatcher logic.
- `scripts/source-attribution.mjs` hard-fails the build if you reference a new external hostname without a manifest entry. Run `node scripts/source-attribution.mjs --write` before pushing if you add a new external API call.
- `api/` has its own `tsconfig.api.json` — `npm run typecheck` (root) passing does NOT mean `npm run typecheck:api` passes. Run both. Also run the real `npm run build`, not just typecheck — a few build-time `.mjs` scripts aren't caught by either TS config.
- This repo has an auto-commit-and-push hook: every file save gets committed and pushed automatically. You don't need to manually `git commit`/`git push` — it already happens continuously. Just be aware your intermediate, half-finished states are pushed too, not just clean checkpoints.
- Dependency direction is enforced: `types → config → services → components → app`. Don't add a reverse import.
- PWA service worker precaches assets client-side. If you're verifying a UI change in a browser and it doesn't show up, check whether you're looking at a stale cached copy before concluding the deploy failed.
- No Redis/Convex credentials in your dev environment — you can't fully verify live-data paths locally. Ship typecheck+build clean, document what you couldn't verify, and say so honestly in the task file (same pattern already used in `04`/`08`).

## Where to log your work

Keep using `docs/tasks/abdullah/` — new numbered task files for new work, `**STATUS: DONE — <date>**` at the top when finished, update `README.md`'s index. This isn't for permission-seeking anymore, it's the record of what shipped and why, same as it's always been.
