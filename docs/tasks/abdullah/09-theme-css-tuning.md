**STATUS: DONE — 2026-08-22**

Loaded `/impeccable` per the task's own instruction, focused specifically on the 2 areas it named (DEFCON badge, BYOK settings section) rather than a full redesign pass — this is a tuning pass, not a rebrand. Found real, evidenced contrast bugs, all caused by the SITREP rebrand's accent-color change (green → amber `#f0a828`) breaking pairings that were tuned for the old color:

1. **`.pizzint-defcon`** (the header DEFCON badge the task explicitly names) — `var(--accent)` text on `var(--text-ghost)` background measured **2.03:1** in light theme (dark theme was fine at 4.79:1). Switched to `var(--text)`, which clears both themes by a wide margin (7.95:1 / 9.07:1) — `src/styles/main.css`.
2. **`.pizzint-location-status.spike` / `.high` / `.nominal`** (PizzINT panel's per-location status pills, same component family as the DEFCON badge) — `var(--accent)` text on the saturated `--defcon-1`/`-2`/`-4` backgrounds measured **1.94:1 / 1.70:1 / 1.26:1** — badly broken, not just borderline. Switched to `#000`, which clears 4.5:1 against every defcon background in both themes (the sibling `.elevated` rule already used a dark color here and was unaffected). `src/styles/main.css`.
3. **"Your Own AI Key" (BYOK) inputs** (`preferences-content.ts`'s `.us-userkey-input`, the exact "new panels sometimes inherit default styling" case the task predicted) — had ZERO CSS rule anywhere in the codebase, rendering as bare unstyled white browser input boxes inside an otherwise all-dark modal. Not a contrast-ratio technicality, a glaringly obvious "doesn't match the token system" bug. Added a rule mirroring the sibling `.us-notif-slack-input` pattern already used elsewhere in the same `.unified-settings-modal` (same `--settings-*` tokens, same shape) — deliberately reused the existing pattern rather than inventing one. `src/styles/main.css`.
4. **`.wm-input::placeholder`** in `src/styles/settings-window.css` (the *desktop* settings window's own separate API-key input, different file/surface from #3) — hardcoded `rgba(255, 255, 255, 0.2)` measured **~1.9:1** against its composited input background. Switched to `var(--settings-text-secondary)`, matching every other secondary-text usage in that file (6.85:1).

All 4 fixes are CSS-only, go through existing tokens (`var(--text)`, `var(--settings-text-secondary)`) or a token-consistent literal with a comment explaining why (the two `#000` cases — no existing token reliably clears 4.5:1 against saturated defcon reds/oranges in both themes; verified `var(--bg)` fails the same way `var(--accent)` did). Nothing invented: no new CSS variables, no new theming mechanism, matches `happy-theme.css`'s and the rest of `main.css`'s existing per-theme override conventions.

**Verified live**, not just computed: ran `npm run dev`, confirmed via computed styles / DOM inspection that `.pizzint-defcon` resolves to the new colors, and visually confirmed the BYOK inputs render as themed dark fields (screenshot showed plain white boxes before, dark-token-matched fields after). Checked the mobile breakpoint (375px) — logo swap and layout intact, no regression. Didn't touch the Canada roads layer (a MapLibre paint-property layer, not text UI — no contrast surface to check there) or `index.html`'s pre-paint skeleton hex values (untouched since no core `:root` token definitions changed, only which existing token a few component rules reference).

`npm run typecheck` clean, `npm run build` clean.

---

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
