# Task: Verify de-paywall end-to-end (do this last)

## Why
Final check after `01-byok-panels.md` is done — confirms nothing was missed and nothing regressed.

## What to do
1. `npm run dev` with a real Groq or OpenRouter key set via Settings → Intelligence → "Your Own AI Key" (browser-side, not `.env.local`).
2. Click through every panel that was previously `premium: 'locked'` — confirm each renders real output, not the lock CTA.
3. `grep -rn "premium: 'locked'" src/config/panels.ts` — confirm the only remaining entries (if any) are ones genuinely still blocked on the Railway-infra items (news feed digest, telegram-feed, gpsjam, oref-alerts) or the B4 alt-data-source panels not yet done, not something that should already be unlocked.
4. Confirm `ProBanner` doesn't mount anywhere (should already be fully removed — this is a regression check, not new work).

## Verify
Report back (in this file, or wherever Akul wants status) which panels are confirmed fully working vs which are still legitimately blocked and why.
