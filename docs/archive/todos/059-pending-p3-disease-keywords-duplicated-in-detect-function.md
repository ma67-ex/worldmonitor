---
status: pending
priority: p3
issue_id: "059"
tags: [code-review, quality, seeding, disease-outbreaks, duplication, pr-2375]
dependencies: []
---

## Problem Statement

`scripts/seed-disease-outbreaks.mjs` maintains two parallel lists that overlap significantly: a `diseaseKeywords` array (or constant) and the keyword list embedded inside the `detectDisease()` function. Any update to supported disease keywords must be made in both places, or the two lists drift out of sync.

## Findings

- **File:** `scripts/seed-disease-outbreaks.mjs` — `diseaseKeywords` constant and `detectDisease()` function both enumerate disease names/keywords
- **Overlap:** The function's keyword list appears to be a superset or duplicate of `diseaseKeywords`
- **Impact:** Adding a new disease (e.g., MPOX variant) requires two edits; omitting one causes inconsistent behavior between any code that uses `diseaseKeywords` directly vs calls `detectDisease()`

## Proposed Solutions

**Option A: Remove standalone array, have detectDisease() be the single source (Recommended)**

If `diseaseKeywords` is only used to drive `detectDisease()`, inline the array into the function and export only the function.

- **Effort:** Small (consolidate + verify no other consumers of the array)
- **Risk:** Very low

**Option B: Make detectDisease() use the diseaseKeywords array**

```javascript
const DISEASE_KEYWORDS = ['mpox', 'ebola', 'cholera', ...];
function detectDisease(text) {
  return DISEASE_KEYWORDS.find(k => text.toLowerCase().includes(k)) || null;
}
```

- **Effort:** Trivial
- **Risk:** Very low — clean single source of truth

## Acceptance Criteria

- [ ] Disease keyword list exists in exactly one place
- [ ] `detectDisease()` uses that single list

## Work Log

- 2026-03-27: Identified by simplicity-reviewer agent during PR #2375 review.
- 2026-09-06: Left pending. Two issues found: (1) `detectDisease()` now lives in `scripts/_disease-outbreaks-helpers.mjs`, not `scripts/seed-disease-outbreaks.mjs` — out of this assignment's file scope. (2) The two lists are not pure duplicates as assumed: `diseaseKeywords` in `seed-disease-outbreaks.mjs` (line ~172) is a broad *relevance filter* for WHO/CDC/ONT items and includes generic non-disease-name terms (`outbreak`, `disease`, `virus`, `fever`, `flu`, `epidemic`, `infection`, `pathogen`) that must stay generic to catch outbreaks not on the specific-disease list; `detectDisease()`'s `known` list is a *disease-naming* classifier and deliberately excludes those generic terms (a generic word would wrongly "name" the disease as "Outbreak"/"Virus"). Merging them needs a design decision on how to keep the filter's generic-term coverage separate from the namer's specific-term list — flagging as `needs-decision` rather than guessing, and leaving pending given the cross-file scope constraint too.
