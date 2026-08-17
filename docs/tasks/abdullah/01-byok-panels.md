**STATUS: DONE — 2026-08-16**

Real gap found beyond the 5 panels themselves, fixed as part of this task: `panel-layout.ts`'s `WEB_PREMIUM_PANELS` lock-CTA gate and `Panel.ts`'s "PRO" badge are BOTH separate from `panels.ts`'s `premium` flag and neither checked `hasUserAiKey()` — so even the reference `market-implications` panel would've stayed visually locked for a BYOK user despite its data-loader branch working. Added `BYOK_GATED_PANELS` in `panel-layout.ts` (checked at both the lock-CTA and the PRO-badge sites) covering all 5: `market-implications`, `deduction`, `regional-intelligence`, `chat-analyst`, `stock-analysis`. Also added `onUserAiKeyChange()` pub/sub in `user-ai-keys.ts` so saving a key in Settings re-gates live, no reload needed.

Per-panel notes:
1. **Deduction** — mechanical, matches the reference pattern exactly. Verified live: real Groq 401 (fake key) round-tripped cleanly.
2. **Country intel brief** — mechanical; reused the `contextSnapshot` text already built client-side for the premium path, no new data-gathering needed. Not a discrete panel — no `panels.ts`/gating change needed. Verified live.
3. **Regional snapshots** — NOT mechanical. `RegionalSnapshot` is a real quantitative model (regime/balance/actors/scenarios/transmission) computed server-side; a bare LLM call can't reproduce it without inventing numbers. Scoped down: BYOK generates narrative sections only, grounded in real `signal-aggregator` data; every quantitative field stays empty and renders the board's own existing honest "Unavailable" states. Verified the unlock/gating live; the LLM leg itself didn't fire in this session because the dev signal-aggregator has zero accumulated clusters right now (confirmed via direct query, not a bug).
4. **WM Analyst chat** — one blocking completion instead of the SSE backend, no dashboard-control action parsing (real scoped-out gap). Grounded in the same `generateAIContext()` signal data. Verified live: real Groq 401 round-tripped cleanly.
5. **Stock analysis** — NOT mechanical, biggest gap of the 5. `AnalyzeStockResponse` mixes real computed technicals (MA/RSI/MACD, needs Yahoo price history that's CORS-blocked from the browser) with LLM narrative. Scoped like regional-intelligence: real current price/change from WorldMonitor's own free `list-market-quotes` endpoint, LLM narrative on top, technical fields tagged `provider: 'user-key'` and the technical-indicator grid in `StockAnalysisPanel.renderCard` skips rendering them entirely (an honest note instead of fabricated zeros). Verified the real quote fetch fires (3 real HTTP calls, correctly parsed); this dev environment's quotes come back empty (`SEED_UNAVAILABLE`, no Finnhub key here) so the Groq leg wasn't exercised live, same class of gap as regional-intelligence's.

All 5: `npm run typecheck` clean after each change. Nothing committed — local changes only, per session convention.

---

# Task: BYOK AI fallback — 5 remaining panels

## Why
This fork removes WorldMonitor's paid backend for LLM-generated panels. Instead of paying WorldMonitor, the user brings their own free-tier Groq or OpenRouter API key (stored in `localStorage` only, never touches our server), and the panel calls the provider directly from the browser.

## Reference implementation — already done, copy this pattern
- `src/services/market-implications.ts` — `generateMarketImplicationsFromUserKey()` builds a market-analyst system prompt and calls the BYOK service instead of `premiumFetch()`.
- `src/services/user-ai-keys.ts` — the shared BYOK layer: `hasUserAiKey()`, `generateStructuredCompletion()` (calls Groq/OpenRouter's OpenAI-compatible chat completions endpoint with `response_format: { type: 'json_object' }`), localStorage key storage.
- `src/app/data-loader.ts` — search `loadMarketImplications` for the wiring: checks `hasPremiumAccess() || hasUserAiKey()` before attempting the panel at all, then branches between the premium RPC path and the BYOK path.
- `src/config/panels.ts` — `market-implications` had its `premium: 'locked'` flag removed once the BYOK path worked.
- Settings UI is already built and shared across all panels: Settings → Intelligence → "Your Own AI Key" (two password inputs for Groq/OpenRouter, wired in `src/services/preferences-content.ts`).

## What to do
Apply the identical pattern to each of these 5 panels/features:
1. `DeductionPanel` (situation deduction)
2. Stock analysis — `src/services/stock-analysis.ts`
3. Country intel briefs
4. Regional snapshots
5. WM Analyst chat

For each: find its current `premiumFetch()`/paid-RPC call, write a `generateXFromUserKey()` sibling function using `user-ai-keys.ts`, gate on `hasPremiumAccess() || hasUserAiKey()`, remove the panel's `premium: 'locked'` flag in `panels.ts` once it works, write a real system prompt matching what the panel actually needs to produce.

## Verify
`npm run dev` with a real `GROQ_API_KEY` or `OPENROUTER_API_KEY` set in your own browser's settings UI (not `.env.local` — this is a client-side key). Confirm each panel renders real output instead of the "Sign in to Unlock" lock CTA.
