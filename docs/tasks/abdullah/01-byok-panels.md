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
