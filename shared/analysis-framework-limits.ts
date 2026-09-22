// Single source of truth for the analytical-framework instructions length
// cap. Shared by src/services/analysis-framework-store.ts (client library
// validation) and api/skills/_fetch-agentskills.ts (server-side truncation),
// which cannot import from src/ directly.
export const MAX_INSTRUCTIONS_LEN = 2000;
