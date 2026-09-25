# Learnings Index

- [Dashboard panels overlap when a panel renders taller than its grid cell](2026-09-08-panel-grid-overlap-height-pin.md) — a `height` pin on a grid item doesn't size its track; use `height:100%` so the panel fills its grid area instead of overflowing it.
- [Bloomberg-style quote stats](2026-09-24-bloomberg-quote-stats-section.md) — Yahoo chart meta already had day/52W range + volume; parser dropped them
- [NSE equity data layer](2026-09-24-nse-equity-data-layer.md) — India terminal seeding: probe from the prod runner, XBRL is the real source, rotation + skipWhenEmpty per-company keys
- [docs:check drift vs a dirty tree](2026-09-24-docs-stats-drift-dirty-tree.md) — take count baselines from HEAD in a scratch worktree, not from a tree carrying another session's uncommitted work
