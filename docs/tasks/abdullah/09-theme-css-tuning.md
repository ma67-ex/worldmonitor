**STATUS: OPTIONAL — no deadline, do last**

# Task: Theme CSS tuning pass

## Why
Flagged as open since the original rebrand plan (`docs/plans/2026-08-15-001-feat-sitrep-rebrand-depaywall-plan.md`) but explicitly optional — the current dark/monospace/OSINT-terminal theme (`src/config/brand.ts` + the SITREP theme file) is already close to the target identity Akul confirmed (keep the existing dark/monospace aesthetic, re-theme within it, not a new visual language). This is a polish pass, not a blocker for anything else in the queue.

## What to do
1. Load `/impeccable` and `/emil-design-eng` (already referenced in the original plan for this exact step) before touching anything — they set the bar for what "intentional" vs "AI-slop default" looks like for this kind of dashboard/tool UI.
2. Run `npm run dev`, look at the app as it actually renders now — header, panel chrome, map, badges (including the new DEFCON-level badge in the header) — against the SITREP identity in `brand.ts`.
3. Check contrast (impeccable's 4.5:1 body-text rule) across the panel grid, especially any panel added since the rebrand (Canada roads layer, BYOK settings section) — new panels sometimes inherit default styling that doesn't quite match the token system.
4. Any changes go through CSS custom properties in the existing token files (`src/styles/sitrep-theme.css` / `src/styles/main.css` etc.) — don't invent a new theming mechanism, match how `happy-theme.css` already does full `:root` token overrides.

## Verify
- Visual check in both the dark theme states the app supports (check `index.html`'s pre-paint skeleton hex values still match if you touch core tokens — it's a separate hardcoded copy, easy to drift out of sync).
- `npm run typecheck` clean (CSS-only changes shouldn't break this, but confirm nothing else got touched).
- Mobile breakpoint check (logo swaps to `.logo-mobile` — panel-layout.ts:961 per the original rebrand notes).
