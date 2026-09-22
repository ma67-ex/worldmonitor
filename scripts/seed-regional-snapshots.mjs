#!/usr/bin/env node
// @ts-check
/**
 * Regional Intelligence snapshot seeder.
 *
 * Computes a RegionalSnapshot per region using deterministic scoring across
 * seven balance axes, derives a regime label, scores actors, evaluates
 * structured trigger thresholds, builds normalized scenario sets, resolves
 * pre-built transmission templates, and persists to Redis with idempotency.
 *
 * Phase 1 (PR2): LLM narrative layer added. One structured-JSON call per
 * region via generateRegionalNarrative(), ship-empty on any failure. The
 * 'global' region is skipped inside the generator. Provider + model flow
 * through SnapshotMeta.narrative_provider / narrative_model.
 *
 * Architecture, engineering, and scoring: the Regional Intelligence upgrade
 * spec and its appendices (ship to docs/internal/ in the main repo; not
 * present in every worktree — see PR #2940 description).
 *
 * Run via the seed bundle (recommended) or directly:
 *   node scripts/seed-regional-snapshots.mjs
 */

import { pathToFileURL } from 'node:url';

import {
  loadEnvFile,
  getRedisCredentials,
  writeExtraKeyWithMeta,
  acquireLockSafely,
  releaseLock,
  extendExistingTtl,
} from './_seed-utils.mjs';
// Use scripts/shared mirror rather than the repo-root shared/ folder: the
// Railway bundle service sets rootDirectory=scripts, so `../shared/` resolves
// to filesystem / on deploy and the import fails with ERR_MODULE_NOT_FOUND.
// scripts/shared/* is kept in sync with shared/* via tests.
import { REGIONS, GEOGRAPHY_VERSION, getRegion } from './shared/geography.js';

import { computeBalanceVector, SCORING_VERSION } from './regional-snapshot/balance-vector.mjs';
import { buildRegimeState } from './regional-snapshot/regime-derivation.mjs';
import { scoreActors } from './regional-snapshot/actor-scoring.mjs';
import { evaluateTriggers } from './regional-snapshot/trigger-evaluator.mjs';
import { buildScenarioSets } from './regional-snapshot/scenario-builder.mjs';
import { resolveTransmissions } from './regional-snapshot/transmission-templates.mjs';
import { collectEvidence } from './regional-snapshot/evidence-collector.mjs';
import { buildPreMeta, buildFinalMeta } from './regional-snapshot/snapshot-meta.mjs';
import { diffRegionalSnapshot, inferTriggerReason } from './regional-snapshot/diff-snapshot.mjs';
import { persistSnapshot, readLatestSnapshot } from './regional-snapshot/persist-snapshot.mjs';
import { ALL_INPUT_KEYS, ALL_META_KEYS } from './regional-snapshot/freshness.mjs';
import { generateSnapshotId, unwrapEnvelope, getCaseFileText } from './regional-snapshot/_helpers.mjs';
import { generateRegionalNarrative, emptyNarrative } from './regional-snapshot/narrative.mjs';
import { emitRegionalAlerts } from './regional-snapshot/alert-emitter.mjs';
import { buildMobilityState } from './regional-snapshot/mobility.mjs';
import { recordRegimeTransition } from './regional-snapshot/regime-history.mjs';

loadEnvFile(import.meta.url);

const SEED_META_KEY = 'intelligence:regional-snapshots';

/**
 * Read every input key + every metaKey companion in a single pipeline.
 * metaKeys carry {fetchedAt, recordCount} for inputs whose data payload
 * has no top-level timestamp (mobility sources). See freshness.mjs.
 *
 * @returns {Promise<{ sources: Record<string, any>, metaSources: Record<string, any> }>}
 */
async function readAllInputs() {
  const { url, token } = getRedisCredentials();
  const keys = [...ALL_INPUT_KEYS, ...ALL_META_KEYS];
  const pipeline = keys.map((k) => ['GET', k]);
  const resp = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(pipeline),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Redis pipeline read: HTTP ${resp.status}`);
  const results = await resp.json();

  /** @type {Record<string, any>} */
  const sources = {};
  /** @type {Record<string, any>} */
  const metaSources = {};
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const isInput = i < ALL_INPUT_KEYS.length;
    const target = isInput ? sources : metaSources;
    const raw = results[i]?.result;
    if (raw === null || raw === undefined) {
      target[key] = null;
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      // Input payloads written via the relay's envelopeWrite ({ _seed, data })
      // must be unwrapped to their flat shape so compute modules read the right
      // fields. seed-meta:* payloads are always flat and pass through untouched.
      target[key] = isInput ? unwrapEnvelope(parsed) : parsed;
    } catch {
      target[key] = null;
    }
  }
  return { sources, metaSources };
}

/**
 * Run the full compute pipeline for one region in the canonical order.
 *
 *   1. (sources already read by caller)
 *   2. (pre_meta already computed once by caller — see main(); it depends
 *      only on sources/metaSources, not regionId, so hoisting it out of this
 *      per-region function avoids computing the identical value 8x)
 *   3. balance vector
 *   4. actors
 *   5. triggers (BEFORE scenarios)
 *   6. scenarios (normalized)
 *   7. transmissions
 *   8. mobility (v1 adapter — airports, airspace, reroute_intensity, NOTAMs)
 *   9. evidence
 *   10. snapshot_id
 *   11. derive regime from the caller-supplied previous snapshot (batch-read
 *       once for all regions in main() — see readAllInputs/main)
 *   12. build snapshot-for-prompt (no narrative yet)
 *   13. LLM narrative call (ship-empty on failure; skipped for 'global')
 *   14. splice narrative into tentative snapshot
 *   15. diff → trigger_reason
 *   16. final_meta with narrative_provider/narrative_model
 *
 * @param {string} regionId
 * @param {Record<string, any>} sources
 * @param {Record<string, any>} metaSources
 * @param {ReturnType<typeof buildPreMeta>['pre']} pre - precomputed once in main()
 * @param {import('../shared/regions.types.js').RegionalSnapshot | null} previousSnapshot - batch-read once in main()
 */
async function computeSnapshot(regionId, sources, metaSources = {}, pre, previousSnapshot = null) {
  // Step 3: balance vector
  const { vector: balance } = computeBalanceVector(regionId, sources);

  // Step 4: actors
  const { actors, edges } = scoreActors(regionId, sources);

  // Step 5: triggers (before scenarios)
  const triggers = evaluateTriggers(regionId, sources, balance);

  // Step 6: scenarios (normalized to 1.0 per horizon)
  const scenarioSets = buildScenarioSets(regionId, sources, triggers);

  // Step 7: transmissions (matched to active triggers)
  const transmissionPaths = resolveTransmissions(regionId, triggers);

  // Step 8: mobility v1 — adapters over existing Redis inputs:
  // aviation:delays:{faa,intl}, aviation:notam:closures:v2,
  // intelligence:gpsjam:v2, military:flights:v1. Pure, never throws.
  // See Phase 2 PR2 notes in scripts/regional-snapshot/mobility.mjs.
  const mobility = buildMobilityState(regionId, sources);

  // Step 9: evidence chain
  const evidence = collectEvidence(regionId, sources);

  // Step 10: snapshot_id
  const snapshotId = generateSnapshotId();

  // Step 11: derive regime from the previous snapshot (batch-read once for
  // all regions in main() — see issue #172). Must happen before narrative
  // generation because the prompt consumes the regime label.
  const previous = previousSnapshot;
  const previousLabel = previous?.regime?.label ?? '';
  const regime = buildRegimeState(balance, previousLabel, '');

  // Step 12: snapshot-shaped input for the narrative prompt. The narrative
  // generator reads regime/balance/actors/scenarios/triggers/evidence from
  // this object and does NOT inspect `meta` or the placeholder narrative.
  // Meta here is a throwaway — the real meta is built after diff so
  // trigger_reason and narrative_* can flow in together.
  const snapshotForPrompt = {
    region_id: regionId,
    generated_at: Date.now(),
    meta: buildFinalMeta(pre, { snapshot_id: snapshotId, trigger_reason: 'scheduled_6h' }),
    regime,
    balance,
    actors,
    leverage_edges: edges,
    scenario_sets: scenarioSets,
    transmission_paths: transmissionPaths,
    triggers,
    mobility,
    evidence,
    narrative: emptyNarrative(),
  };

  // Step 13: LLM narrative. Ship-empty on any failure — the snapshot remains
  // valuable without the narrative, and the narrative generator itself
  // never throws. 'global' is skipped inside the generator.
  const region = getRegion(regionId);
  const narrativeResult = region
    ? await generateRegionalNarrative(region, snapshotForPrompt, evidence)
    : { narrative: emptyNarrative(), provider: '', model: '' };

  // Step 14: tentative snapshot with the real narrative spliced in.
  const tentativeSnapshot = {
    ...snapshotForPrompt,
    narrative: narrativeResult.narrative,
  };

  // Step 15: diff against previous for trigger_reason inference
  const diff = diffRegionalSnapshot(previous, tentativeSnapshot);
  const triggerReason = inferTriggerReason(diff);

  // Backfill the regime's transition_driver now that we have the diff-derived
  // trigger_reason. Step 11 built the regime object before the diff existed
  // so the driver was empty; patching here ensures both the persisted snapshot
  // AND the regime-history entry carry the real driver (PR #2981 review fix).
  if (diff.regime_changed && triggerReason !== 'scheduled_6h') {
    regime.transition_driver = triggerReason;
    tentativeSnapshot.regime = regime;
  }

  // Step 16: final_meta with diff-derived trigger_reason and narrative metadata
  const finalMeta = buildFinalMeta(pre, {
    snapshot_id: snapshotId,
    trigger_reason: triggerReason,
    narrative_provider: narrativeResult.provider,
    narrative_model: narrativeResult.model,
  });

  // Return the snapshot WITHOUT the diff. The diff is a runtime artifact for
  // alert emission; persisting it would leak a non-RegionalSnapshot field into
  // Redis and break Phase 1 proto codegen consumers.
  /** @type {import('../shared/regions.types.js').RegionalSnapshot} */
  const snapshot = { ...tentativeSnapshot, meta: finalMeta };
  return { snapshot, diff };
}

const SNAPSHOT_LOCK_DOMAIN = 'regional-snapshots';
// Covers worst-case sequential narrative-call runtime and exceeds the seed
// bundle's own 180s per-script timeout, so a timed-out run's lock self-clears
// before the next cron tick can be blocked by a stale holder (issue #174).
const SNAPSHOT_LOCK_TTL_MS = 4 * 60 * 1000;
// TTL for the summary key: 4x the 6h cron cadence (was 12h/2x — issue #174).
const SUMMARY_TTL_SECONDS = 24 * 60 * 60;
// Matches persist-snapshot.mjs's SNAPSHOT_TTL_SECONDS. Used to extend a
// region's last-known-good `:latest` pointer when compute fails transiently,
// so a single bad cron tick doesn't let good data expire (issue #174).
const REGION_TTL_EXTEND_SECONDS = 90 * 24 * 60 * 60;

/**
 * Named-argument wrapper around writeExtraKeyWithMeta's positional signature
 * `(key, data, ttlSec, recordCount, metaKey, metaTtlSec)`, where the ttlSec
 * value is passed twice (slots 3 and 6) — a foot-gun for a future refactor
 * that reorders args by position (issue #183). This is the only call site in
 * this file, so both ttl slots always share one value.
 */
function writeSummaryWithMeta({ key, data, ttlSec, recordCount, metaKey }) {
  return writeExtraKeyWithMeta(key, data, ttlSec, recordCount, metaKey, ttlSec);
}

async function main() {
  const t0 = Date.now();
  console.log(`[regional-snapshots] Starting compute for ${REGIONS.length} regions`);

  const runId = `${t0}-${Math.random().toString(16).slice(2, 8)}`;
  const lockResult = await acquireLockSafely(SNAPSHOT_LOCK_DOMAIN, runId, SNAPSHOT_LOCK_TTL_MS);
  if (!lockResult.locked) {
    if (lockResult.skipped) {
      console.warn('[regional-snapshots] Redis unavailable during lock acquisition; skipping run');
    } else {
      console.log('[regional-snapshots] Skipped: another run holds the lock');
    }
    return;
  }

  try {
    // Step 1: read all inputs once (shared across regions), plus seed-meta
    // companions for inputs whose payloads lack top-level timestamps.
    const { sources, metaSources } = await readAllInputs();
    const presentKeys = Object.entries(sources).filter(([, v]) => v !== null).length;
    const presentMetaKeys = Object.entries(metaSources).filter(([, v]) => v !== null).length;
    console.log(`[regional-snapshots] Read inputs: ${presentKeys}/${ALL_INPUT_KEYS.length} keys present, ${presentMetaKeys}/${ALL_META_KEYS.length} meta keys present`);

    // Pre-meta depends only on sources/metaSources, not regionId — compute
    // once instead of 8x inside the per-region loop (issue #192).
    const { pre } = buildPreMeta(sources, SCORING_VERSION, GEOGRAPHY_VERSION, metaSources);

    // Precompute the searchable case-file text once per forecast (not once
    // per region per compute module) — actor-scoring, balance-vector, and
    // scenario-builder all substring-search the same text via
    // getCaseFileText(), which memoizes onto f._caseFileText (issue #190).
    const fc = sources['forecast:predictions:v2'];
    if (Array.isArray(fc?.predictions)) {
      for (const f of fc.predictions) getCaseFileText(f);
    }

    // Batch-read every region's previous snapshot in parallel instead of
    // sequentially inside the per-region loop — regions are independent
    // (region-scoped keys), so 16 serial round-trips become concurrent
    // (issue #172).
    const previousByRegion = new Map();
    await Promise.all(REGIONS.map(async (region) => {
      const prev = await readLatestSnapshot(region.id).catch(() => null);
      previousByRegion.set(region.id, prev);
    }));

    let persisted = 0;
    let skipped = 0;
    let failed = 0;
    const summary = [];
    const failedRegions = [];

    // Phase A: compute every region's snapshot. Sequential on purpose — each
    // call makes one narrative LLM request, and firing all 8 concurrently
    // would multiply provider rate-limit risk for a wall-clock win that
    // doesn't matter (the LLM call dominates runtime, not the Redis I/O
    // parallelized below).
    const computed = [];
    for (const region of REGIONS) {
      try {
        const { snapshot, diff } = await computeSnapshot(region.id, sources, metaSources, pre, previousByRegion.get(region.id));
        computed.push({ region, snapshot, diff });
      } catch (err) {
        failed += 1;
        failedRegions.push({ region: region.id, error: String(/** @type {any} */ (err)?.message ?? err) });
        console.error(`[${region.id}] FAILED: ${/** @type {any} */ (err)?.message ?? err}`);
        // Best-effort: extend this region's last-known-good TTL so a
        // transient compute failure doesn't let good data expire before the
        // next cron tick (issue #174).
        await extendExistingTtl([`intelligence:snapshot:v1:${region.id}:latest`], REGION_TTL_EXTEND_SECONDS);
      }
    }

    // Phase B: persist all successfully computed snapshots in parallel — each
    // region's dedup key and write keys are region-scoped, so writes are
    // fully independent (issue #173).
    const persistOutcomes = await Promise.allSettled(
      computed.map(async ({ region, snapshot, diff }) => ({
        region,
        snapshot,
        diff,
        result: await persistSnapshot(snapshot),
      })),
    );

    for (const outcome of persistOutcomes) {
      if (outcome.status === 'rejected') {
        failed += 1;
        const reason = /** @type {any} */ (outcome.reason);
        failedRegions.push({ region: '?', error: String(reason?.message ?? reason) });
        console.error(`[regional-snapshots] persist threw: ${reason?.message ?? reason}`);
        continue;
      }

      const { region, snapshot, diff, result } = outcome.value;
      if (result.persisted) {
        persisted += 1;
        summary.push({
          region: region.id,
          regime: snapshot.regime.label,
          confidence: snapshot.meta.snapshot_confidence,
          active_triggers: snapshot.triggers.active.length,
          trigger_reason: snapshot.meta.trigger_reason,
        });
        console.log(`[${region.id}] persisted regime=${snapshot.regime.label} confidence=${snapshot.meta.snapshot_confidence} triggers=${snapshot.triggers.active.length} reason=${snapshot.meta.trigger_reason}`);

        // Emit state-change alerts for this diff. Best-effort — never blocks
        // or throws out of the main loop. Alerts are deduped on a 6h window
        // by wm:notif:scan-dedup:{eventType}:{hash}, matching the cron cadence.
        try {
          const alertResult = await emitRegionalAlerts(region, snapshot, diff);
          if (alertResult.events.length > 0) {
            console.log(`[${region.id}] alerts: ${alertResult.enqueued}/${alertResult.events.length} enqueued`);
          }
        } catch (alertErr) {
          const alertMsg = /** @type {any} */ (alertErr)?.message ?? alertErr;
          console.warn(`[${region.id}] alert emitter threw: ${alertMsg}`);
        }

        // Record a regime drift history entry iff this snapshot actually
        // changed the regime label. Steady-state snapshots produce no entry.
        // Best-effort — never blocks persist. See regime-history.mjs.
        try {
          const historyResult = await recordRegimeTransition(region, snapshot, diff);
          if (historyResult.recorded) {
            console.log(`[${region.id}] regime drift recorded: ${historyResult.entry?.previous_label || 'none'} → ${historyResult.entry?.label}`);
          }
        } catch (histErr) {
          const histMsg = /** @type {any} */ (histErr)?.message ?? histErr;
          console.warn(`[${region.id}] regime-history threw: ${histMsg}`);
        }
      } else {
        skipped += 1;
        console.log(`[${region.id}] skipped: ${result.reason}`);
      }
    }

    // Health policy:
    //   1. persisted > 0 && failed === 0: write the fresh summary + seed-meta.
    //   2. persisted === 0 && failed === 0: all regions dedup-skipped (e.g., a
    //      retry within the 15min idempotency bucket). Preserve the prior good
    //      summary by skipping the write entirely. api/health.js classifies an
    //      empty `regions: []` + `recordCount: 0` as EMPTY_DATA which flips the
    //      overall health to red, so overwriting on a no-op retry is actively
    //      harmful. The SUMMARY_TTL_SECONDS budget lets the next full run
    //      refresh the payload naturally.
    //   3. failed > 0: skip the meta write so /api/health flips to STALE after
    //      the maxStaleMin budget on persistent degradation instead of silently
    //      reporting OK. The bundle runner's freshness gate retries next cycle.
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (failed === 0 && persisted > 0) {
      await writeSummaryWithMeta({
        key: 'intelligence:regional-snapshots:summary:v1',
        data: { regions: summary, generatedAt: Date.now() },
        ttlSec: SUMMARY_TTL_SECONDS,
        recordCount: persisted,
        metaKey: `seed-meta:${SEED_META_KEY}`,
      });
      console.log(`[regional-snapshots] Done in ${elapsed}s: persisted=${persisted} skipped=${skipped} failed=0`);
      return;
    }

    if (failed === 0) {
      // All regions dedup-skipped. Preserve the prior summary and return cleanly.
      console.log(`[regional-snapshots] Done in ${elapsed}s: persisted=0 skipped=${skipped} failed=0 (all dedup-skipped, prior summary preserved)`);
      return;
    }

    console.error(`[regional-snapshots] Done in ${elapsed}s: persisted=${persisted} skipped=${skipped} failed=${failed}`);
    for (const f of failedRegions) {
      console.error(`  [${f.region}] ${f.error}`);
    }
    console.error('[regional-snapshots] Skipping seed-meta write due to partial failure. /api/health will reflect degradation after the stale budget.');
    // Throw instead of process.exit(1) so callers (e.g. seed-bundle-regional.mjs)
    // can catch and continue with other seeders. The isDirectRun guard below still
    // calls process.exit(1) for standalone invocations.
    throw new Error(`regional-snapshots: ${failed} region(s) failed`);
  } finally {
    await releaseLock(SNAPSHOT_LOCK_DOMAIN, runId);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error(`PUBLISH FAILED: ${err?.message || err}`);
    process.exit(1);
  });
}

export { main, computeSnapshot, readAllInputs };
