// @ts-check
// Shared helpers for snapshot compute modules.

import { randomUUID } from 'node:crypto';

import { stripSeedEnvelope } from '../_seed-envelope-source.mjs';

/** Clamp a number to the [lo, hi] range. */
export function clip(value, lo, hi) {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}

/** Safe numeric coercion with default fallback. Rejects partial numerics like "42abc". */
export function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Round to 3 decimal places — canonical rounding for scoring outputs. */
export function round(n) {
  return Math.round(n * 1000) / 1000;
}

/** Weighted average. Returns 0 if all weights are zero. */
export function weightedAverage(items, valueFn, weightFn) {
  let weighted = 0;
  let total = 0;
  for (const item of items) {
    const w = weightFn(item);
    weighted += valueFn(item) * w;
    total += w;
  }
  return total > 0 ? weighted / total : 0;
}

/** Percentile (0-100) of a numeric array. `p` is clamped to [0, 100]. */
export function percentile(values, p) {
  if (!values.length) return 0;
  const clampedP = clip(p, 0, 100);
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (clampedP / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/** Time-ordered id: hex timestamp + CSPRNG suffix. Not an RFC 4122 UUID. */
export function generateSnapshotId() {
  const t = Date.now().toString(16).padStart(12, '0');
  const r = randomUUID().replace(/-/g, '').slice(0, 12);
  return `${t}-${r}`;
}

/**
 * Lowercased, stringified case-file text for substring search — used by
 * actor-scoring, balance-vector (alliance cohesion), and scenario-builder
 * (fragmentation lane) to grep a forecast's caseFile for keywords.
 *
 * Memoizes onto `f._caseFileText` so a forecast stringified once (e.g. by
 * seed-regional-snapshots.mjs's main() precompute pass, which runs before
 * the per-region loop) is never re-stringified by any of the 3 consumers
 * across all 8 regions (issue #190). Callers that invoke a compute module
 * directly (unit tests, ad-hoc scripts) still get a correct on-demand value
 * — the memoization is an optimization, not a required precondition.
 *
 * @param {{ caseFile?: unknown; signals?: unknown; _caseFileText?: string } | null | undefined} f
 * @returns {string}
 */
export function getCaseFileText(f) {
  if (f && typeof f._caseFileText === 'string') return f._caseFileText;
  let text = '{}';
  try {
    text = JSON.stringify(f?.caseFile ?? f?.signals ?? {}).toLowerCase();
  } catch {
    text = '{}';
  }
  if (f && typeof f === 'object') f._caseFileText = text;
  return text;
}

/**
 * Unwrap the `{ _seed, data }` envelope written by the relay's envelopeWrite-based
 * seeders (cross-source-signals, forecasts, national-debt, transit-summaries, …)
 * so the compute modules — which read flat fields like `.signals`, `.predictions`,
 * `.entries`, `.summaries` — see the payload shape they were written for.
 *
 * Without this, `sources['intelligence:cross-source-signals:v1'].signals` is
 * `undefined` (the signals live at `.data.signals`), so coercive_pressure scored
 * 0 for every region and the regime engine reported a flat `calm` regardless of
 * actual conflict. Flat payloads (no `_seed`) pass through unchanged.
 *
 * Freshness classification (freshness.mjs) keeps working after the unwrap: every
 * enveloped input either declares a companion seed-meta key or carries its own
 * timestamp inside `data` (forecast `generatedAt`, debt `seededAt`, transit
 * `fetchedAt`) — and forecast:predictions:v2, whose `generatedAt` was hidden one
 * level down, now dates correctly instead of reading as present-but-undated.
 *
 * Uses the repo's canonical seed-envelope contract: only well-formed envelopes
 * with a numeric `_seed.fetchedAt` unwrap. Malformed `_seed` objects pass through
 * unchanged so seed-contract violations stay visible instead of being silently
 * accepted as valid regional inputs.
 *
 * @template T
 * @param {T} parsed
 * @returns {T | unknown}
 */
export function unwrapEnvelope(parsed) {
  return stripSeedEnvelope(parsed);
}
