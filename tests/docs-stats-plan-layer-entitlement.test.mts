/**
 * The free-tier map-layer entitlement gate (#5387).
 *
 * Public plan copy claimed the free tier included "all 56 map layers" while
 * `LAYER_REGISTRY.resilienceScore` was `premium: 'locked'` and denied to
 * non-premium users at three enforcement sites. The copy now quotes the
 * registry TOTAL and names the Pro-only layer instead of quoting a free count,
 * because a truthful free count is not derivable: `isSunsetLayer` drops
 * iranAttacks unless VITE_ENABLE_IRAN_ATTACKS=true, App.ts hides cyberThreats
 * unless VITE_ENABLE_CYBER_LAYER=true, and VARIANT_LAYER_ORDER means no single
 * site renders the whole registry.
 *
 * That phrasing is only true while resilienceScore is the ONLY web-locked
 * entry — and a count pin cannot notice a second lock, because the total does
 * not move when a layer flips to 'locked'. These tests drive both failure
 * branches with synthetic inputs so "the gate would have caught it" is
 * executed rather than asserted.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeStats,
  validatePlanLayerEntitlementCopy,
  PLAN_LAYER_COPY_SURFACES,
  PLAN_LAYER_PRO_ONLY_KEY,
  DOC_VALIDATORS,
} from '../scripts/docs-stats.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const REAL_STATS = computeStats();
const ONLY_LOCKED = { lockedLayerKeys: [PLAN_LAYER_PRO_ONLY_KEY] };

describe('locked-layer set', () => {
  it('derives no web-locked layer from the real registry (task 03: de-paywalled 2026-08-22)', () => {
    // The desktop-only `_desktop ? 'locked' : undefined` ternaries on
    // iranAttacks/gpsJamming must NOT count — plan copy describes the web.
    // resilienceScore itself carries no 'locked' marker any more either.
    assert.deepEqual(REAL_STATS.lockedLayerKeys, []);
    assert.equal(REAL_STATS.lockedLayerDefinitions, 0);
  });

  it('publishes no free-layer count, which would not be derivable', () => {
    // Regression guard for the original fix attempt: `layerDefinitions -
    // lockedLayerDefinitions` overstates the free count (sunset + env-gated
    // layers are reachable by nobody), so the stat must not come back.
    assert.equal((REAL_STATS as Record<string, unknown>).freeLayerDefinitions, undefined);
  });

  it('fires when a layer becomes Pro-locked while the copy still claims nothing is locked', () => {
    const failures = validatePlanLayerEntitlementCopy({ lockedLayerKeys: ['cables'] }, read);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /web-locks \[cables\]/);
    // The operator needs to be told WHICH copy now over-promises.
    for (const surface of PLAN_LAYER_COPY_SURFACES) assert.ok(failures[0].includes(surface));
  });
});

// The empty-lock-set branch is the PERMANENT real state since task 03, not a
// transient error case — validatePlanLayerEntitlementCopy checks the copy
// directly for the stale claim instead of just diffing against a fixed key.
describe('copy surfaces — de-paywalled (no locked layer)', () => {
  it('passes on the real repo — no surface still claims a Pro-only layer', () => {
    assert.deepEqual(validatePlanLayerEntitlementCopy(REAL_STATS, read), []);
  });

  it('fires when a surface regresses to the retired "except Resilience" claim', () => {
    const failures = validatePlanLayerEntitlementCopy(REAL_STATS, (p: string) =>
      p === 'docs/accounts.mdx'
        ? read(p).replace('58 map layers', '58 map layers (all but the Pro-only Resilience layer)')
        : read(p),
    );
    assert.equal(failures.length, 1);
    assert.match(failures[0], /docs\/accounts\.mdx: free-tier copy still claims a Pro-only map layer exists/);
  });

  it('reports a missing surface rather than passing it over', () => {
    const failures = validatePlanLayerEntitlementCopy(REAL_STATS, (p: string) => {
      if (p === 'docs/accounts.mdx') throw new Error('ENOENT');
      return read(p);
    });
    assert.deepEqual(failures, ['docs/accounts.mdx: file not found']);
  });
});

// Forward-compat path: if a layer is ever re-locked, PLAN_LAYER_PRO_ONLY_KEY
// gives the copy a stated target to name again. Real surfaces contain zero
// mentions of "Resilience" today (task 03 removed the carve-out everywhere,
// not just the qualifier), so this synthesizes a world where every surface
// WAS updated to name it except the one under test.
describe('copy surfaces — hypothetical single-lock scenario', () => {
  it('fires once per surface that stops naming the Pro-only layer', () => {
    for (const dropped of PLAN_LAYER_COPY_SURFACES) {
      // pro-test/src/locales/en.json legitimately says "Resilience" elsewhere
      // (neutral UI chip/stat labels, unrelated to pricing) even at baseline
      // — replaceAll guarantees the "dropped" surface truly has zero
      // mentions rather than assuming baseline absence.
      const failures = validatePlanLayerEntitlementCopy(ONLY_LOCKED, (p: string) =>
        p === dropped ? read(p).replaceAll('Resilience', 'Instability') : `${read(p)}\nResilience`,
      );
      assert.equal(failures.length, 1, `${dropped}: expected exactly one failure`);
      assert.match(failures[0], new RegExp(`^${dropped}: free-tier copy must name`));
    }
  });

  it('reports a missing surface rather than passing it over', () => {
    const failures = validatePlanLayerEntitlementCopy(ONLY_LOCKED, (p: string) => {
      if (p === 'docs/accounts.mdx') throw new Error('ENOENT');
      return `${read(p)}\nResilience`;
    });
    assert.deepEqual(failures, ['docs/accounts.mdx: file not found']);
  });
});

describe('--check wiring', () => {
  // A validator that is unit-tested but dropped from the CLI leaves the whole
  // suite green while the gate no longer runs. DOC_VALIDATORS is the wiring.
  it('runs the plan-layer entitlement gate as part of --check', () => {
    assert.ok(DOC_VALIDATORS.includes(validatePlanLayerEntitlementCopy));
  });

  it('exits 0 end to end on the real repo', () => {
    const result = spawnSync('node', ['scripts/docs-stats.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });
});
