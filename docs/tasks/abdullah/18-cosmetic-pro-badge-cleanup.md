**STATUS: DONE — 2026-08-24**

# Task: Remove 2 dead/stale paywall CTA remnants (cosmetic, no logic change)

## Why
Follow-up sweep after tasks 01-15. Two small leftover UI remnants of the old paywall, both now cosmetic-only dead code, not real gates.

## What changed
1. **`src/components/UnifiedSettings.ts`** — the API Keys tab had an `!hasFeature('apiAccess')` branch rendering an "Upgrade to API Starter" lock screen. `hasFeature()` was neutered to always return `true` in task 13, so this branch was unreachable. Removed the dead `if (!hasFeature('apiAccess'))` block (was ~lines 1364-1372). The adjacent "Sign In" branch (`!authState.user`, ~line 1354-1362) is untouched — that's a real auth requirement (API key must bind to a real account), not a paywall.
2. **`src/app/panel-layout.ts`** — the "⚡ Create interactive widget" add-panel CTA (`proBlock`) rendered a `PRO` badge (`proBadge` span, class `widget-pro-badge`) unconditionally. A nearby comment claimed it was auth-gated but no show/hide toggle existed anywhere — `api/_widget-agent.ts` was neutered in task 08, so nothing behind this CTA actually requires payment. Removed the `proBadge` element creation and its `appendChild` call (was ~lines 2716-2718, 2721). CTA's click behavior, icon, and label untouched. The separate MCP CTA's own `PRO` badge (`mcpBadge`, ~line 2746 onward) was out of scope for this task and left as-is.

## Verify
- Re-read both edited regions post-edit — clean, no leftover references to `hasFeature('apiAccess')` gate branch or `proBadge` in `panel-layout.ts`'s pro CTA block.
- `hasFeature` still has other real call sites in `UnifiedSettings.ts` (mcpAccess tab gating) — import left in place, still used.
- **Not run this task**: `npm run typecheck` / `npm run build` — no `Bash` tool available in this agent context. Both edits are pure markup/branch deletions with no new symbols, no signature changes, no dangling references left behind on inspection; low risk, but confirm with a real `npm run typecheck && npm run build` before considering this fully verified.

## Next
Nothing outstanding from this pair. If picking up more cosmetic sweeps, the MCP CTA's own `PRO` badge (`panel-layout.ts` ~line 2746) is the same pattern as fix 2 here and was deliberately left untouched — same class of stale badge if someone wants to chase it next.
