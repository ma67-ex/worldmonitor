import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FREE_MAX_PANELS,
  VARIANT_DEFAULTS,
  countFreePanelCapUsage,
  enforceFreePanelLimit,
  getEffectivePanelConfig,
  restoreFreeMapPanelAccess,
  restoreProGatedPanels,
  shouldDeferFreeTierEnforcement,
  userSetPanelEnabled,
} from '../src/config/panels.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function src(relPath: string): string {
  return readFileSync(resolve(root, relPath), 'utf-8');
}

describe('variant panel config resolution', () => {
  it('prefers the happy variant config over a duplicate full panel key', () => {
    const giving = getEffectivePanelConfig('giving', 'happy');

    assert.equal(giving.name, 'Global Giving');
    assert.equal(giving.enabled, true);
    assert.equal(giving.priority, 1);
  });

  it('preserves commodity and energy labels for shared supply-chain panels', () => {
    assert.equal(
      getEffectivePanelConfig('supply-chain', 'commodity').name,
      'Supply Chain & Logistics',
    );
    assert.equal(
      getEffectivePanelConfig('supply-chain', 'energy').name,
      'Chokepoints & Routes',
    );
  });

  it('does not inherit full desktop premium metadata for variant-specific supply-chain panels', () => {
    const panels = src('src/config/panels.ts');
    const definitionFor = (variant: string): string => {
      const match = panels.match(new RegExp(`const ${variant}_PANELS[\\s\\S]*?'supply-chain': \\{([^}]*)\\}`));
      assert.ok(match, `${variant}_PANELS must define supply-chain`);
      return match[1] ?? '';
    };

    assert.match(definitionFor('FULL'), /premium:\s*'enhanced'/);
    assert.doesNotMatch(definitionFor('COMMODITY'), /premium:/);
    assert.doesNotMatch(definitionFor('ENERGY'), /premium:/);
    assert.equal(getEffectivePanelConfig('supply-chain', 'commodity').premium, undefined);
    assert.equal(getEffectivePanelConfig('supply-chain', 'energy').premium, undefined);
  });

  it('still falls back to the cross-variant registry for panels outside a variant default set', () => {
    const forecast = getEffectivePanelConfig('forecast', 'happy');

    assert.equal(forecast.name, 'AI Forecasts');
    assert.equal(forecast.enabled, true);
  });

  it('applies variant overrides on top of the variant-specific base config', () => {
    const financeMap = getEffectivePanelConfig('map', 'finance');

    assert.equal(financeMap.name, 'Global Markets Map');
    assert.equal(financeMap.enabled, true);
    assert.equal(financeMap.priority, 1);
  });

  it('no longer clamps the map or panel count on this no-paywall fork', () => {
    const fullDefaults = Object.fromEntries(
      VARIANT_DEFAULTS.full.map((key) => [key, { ...getEffectivePanelConfig(key, 'full') }]),
    );

    const result = enforceFreePanelLimit(fullDefaults);

    // This fork has no paid tier to gate against — enforceFreePanelLimit no
    // longer disables anything itself, it only heals proGated leftovers from
    // a stale pre-this-change persisted state (see the legacy-heal tests
    // below). Every panel enabled going in stays enabled coming out.
    assert.equal(result.map?.enabled, true);
    assert.equal(countFreePanelCapUsage(result), countFreePanelCapUsage(fullDefaults));
  });

  it('restoreFreeMapPanelAccess restores a hidden map when over FREE_MAX_PANELS', () => {
    // restoreFreeMapPanelAccess is a separate, still-live safety net
    // (unrelated to this fork's removal of the count-cap) — built the
    // over-cap fixture directly instead of deriving it from
    // enforceFreePanelLimit, which no longer produces one.
    const stale: Record<string, { name: string; enabled: boolean; priority: number }> = {};
    for (let i = 0; i < FREE_MAX_PANELS + 1; i += 1) {
      const key = `p${String(i).padStart(2, '0')}`;
      stale[key] = { name: key, enabled: true, priority: 1 };
    }
    stale.map = { name: 'Map', enabled: false, priority: 0 };

    const restored = restoreFreeMapPanelAccess(stale);

    assert.equal(stale.map.enabled, false);
    assert.equal(restored.map?.enabled, true);
  });

  it('does not force-enable a manually hidden map when the free layout is exactly at FREE_MAX_PANELS', () => {
    const atCap: Record<string, { name: string; enabled: boolean; priority: number }> = {};
    for (let i = 0; i < FREE_MAX_PANELS; i += 1) {
      const key = `p${String(i).padStart(2, '0')}`;
      atCap[key] = { name: key, enabled: true, priority: 1 };
    }
    atCap.map = { name: 'Map', enabled: false, priority: 0 };

    const restored = restoreFreeMapPanelAccess(atCap);

    assert.equal(countFreePanelCapUsage(atCap), FREE_MAX_PANELS);
    assert.equal(restored.map?.enabled, false);
  });

  it('does not force-enable a manually hidden map when the free layout is under cap', () => {
    const underCap = {
      map: { ...getEffectivePanelConfig('map', 'full'), enabled: false },
      'live-news': getEffectivePanelConfig('live-news', 'full'),
    };

    const restored = restoreFreeMapPanelAccess(underCap);

    assert.equal(restored.map?.enabled, false);
  });

  it('no longer force-disables cw-* custom widgets on this no-paywall fork', () => {
    const original = {
      'cw-widget': { name: 'My widget', enabled: true, priority: 3 },
      'cw-hidden': { name: 'Hidden widget', enabled: false, priority: 3 },
      news: { name: 'News', enabled: true, priority: 1 },
    };

    const result = enforceFreePanelLimit(original);

    assert.deepEqual(result['cw-widget'], original['cw-widget']);
    assert.deepEqual(result['cw-hidden'], original['cw-hidden']);
    assert.deepEqual(result.news, original.news);
  });

  it('heals a panel a stale pre-fork clamp left proGated', () => {
    // Anyone who used this fork before the count-cap and cw-* gate were
    // removed may still have `proGated: true, enabled: false` persisted in
    // STORAGE_KEYS.panels from the old clamp. enforceFreePanelLimit's only
    // remaining job is undoing that leftover damage, same as it always did
    // for a user going Pro — there's just no free/Pro branch left to reach it
    // from.
    const legacy = {
      'cw-widget': { name: 'My widget', enabled: false, priority: 3, proGated: true },
      p40: { name: 'p40', enabled: false, priority: 1, proGated: true },
      news: { name: 'News', enabled: true, priority: 1 },
    };

    const result = enforceFreePanelLimit(legacy);

    assert.deepEqual(result['cw-widget'], { name: 'My widget', enabled: true, priority: 3 });
    assert.deepEqual(result.p40, { name: 'p40', enabled: true, priority: 1 });
    assert.deepEqual(result.news, legacy.news);
  });

  it('a user toggle takes ownership: a later deliberate hide survives a legacy-clamp heal', () => {
    // The marker means "the GATE owns this disable". If it survives a USER
    // re-enable, a later deliberate hide is indistinguishable from gate damage
    // and the next heal pass resurrects a panel the user chose to hide — then
    // cloud-syncs that resurrection to every device. Built the proGated
    // fixture directly rather than deriving it from enforceFreePanelLimit,
    // which no longer produces one itself.
    const clampedKey = 'q40';
    const clamped: Record<string, { name: string; enabled: boolean; priority: number; proGated?: boolean }> = {
      [clampedKey]: { name: clampedKey, enabled: false, priority: 1, proGated: true },
    };

    // 1. User re-enables it themselves (Cmd+K, settings toggle, undo-close).
    userSetPanelEnabled(clamped[clampedKey]!, true);
    assert.equal(clamped[clampedKey]?.proGated, undefined,
      'a user toggle transfers ownership away from the gate — the marker must go');

    // 2. Later, the user deliberately hides it.
    userSetPanelEnabled(clamped[clampedKey]!, false);

    // 3. A later heal pass must NOT resurrect it.
    assert.equal(restoreProGatedPanels(clamped)[clampedKey]?.enabled, false,
      'a panel the user hid after re-enabling it must stay hidden');
  });

  it('defers free-tier enforcement until both Clerk and the entitlement snapshot settle', () => {
    // Clerk still pending: always defer — a signed-in Pro user is
    // indistinguishable from an anonymous one.
    assert.equal(shouldDeferFreeTierEnforcement(true, false, false, false), true);
    // Clerk settled on a signed-in user, entitlement snapshot not yet
    // loaded: defer — isEntitled() is deterministically false until the
    // snapshot lands, so a Convex-only Pro subscriber would be clamped.
    assert.equal(shouldDeferFreeTierEnforcement(false, true, false, false), true);
    // Clerk settled, signed-in, entitlement loaded: enforce.
    assert.equal(shouldDeferFreeTierEnforcement(false, true, true, false), false);
    // Clerk settled, anonymous: enforce immediately.
    assert.equal(shouldDeferFreeTierEnforcement(false, false, false, false), false);
    // Grace deadline exceeded: never defer, whatever else is pending —
    // otherwise a snapshot that never arrives suspends the caps forever.
    assert.equal(shouldDeferFreeTierEnforcement(true, true, false, true), false);
  });

  it('does not use the canonical registry directly for entitlement or pro badge metadata', () => {
    const files = [
      'src/components/UnifiedSettings.ts',
      'src/app/search-manager.ts',
      'src/settings-window.ts',
    ];

    for (const file of files) {
      const text = src(file);
      assert.doesNotMatch(
        text,
        /isPanelEntitled\([^\n]*ALL_PANELS\[/,
        `${file} must resolve variant-specific panel config before entitlement checks`,
      );
      assert.doesNotMatch(
        text,
        /\(ALL_PANELS\[[^\]]+\]\s*\?\?[^)]*\)\.premium/,
        `${file} must resolve variant-specific panel config before PRO badge checks`,
      );
    }
  });

  it('standalone settings render uses resolved variant names instead of saved panel names', () => {
    const text = src('src/settings-window.ts');

    assert.match(
      text,
      /const resolvedPanel = ALL_PANELS\[key\] \? getEffectivePanelConfig\(key, SITE_VARIANT\) : panel;/,
      'settings-window render must resolve variant-specific panel config per entry',
    );
    assert.match(
      text,
      /getLocalizedPanelName\(key, resolvedPanel\.name \?\? panel\.name\)/,
      'settings-window render must prefer the resolved variant name before saved panel.name',
    );
  });
});
