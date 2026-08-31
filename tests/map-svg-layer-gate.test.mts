import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

import { LAYER_REGISTRY, isLayerToggleAllowed } from '../src/config/map-layer-definitions';
import type { MapLayers } from '../src/types';

// resilienceScore has carried no 'locked' marker since task 03 (2026-08-22,
// de-paywalled) — LAYER_REGISTRY has zero reachable locked map layers today
// (see tests/docs-stats-plan-layer-entitlement.test.mts). isLayerToggleAllowed
// is generic (keyed by whatever LAYER_REGISTRY says), so a synthetic locked
// layer is patched onto the registry for this file's duration instead of
// asserting something false about production config.
const LOCKED_KEY = 'zzzTestLockedLayer' as unknown as keyof MapLayers;
before(() => {
  (LAYER_REGISTRY as Record<string, unknown>)[LOCKED_KEY] = {
    key: LOCKED_KEY,
    icon: '',
    i18nSuffix: 'zzzTestLockedLayer',
    fallbackLabel: 'Test Locked Layer',
    renderers: ['flat'],
    deckGLOnly: true,
    premium: 'locked',
  };
});
after(() => {
  delete (LAYER_REGISTRY as Record<string, unknown>)[LOCKED_KEY];
});

const mapSrc = readFileSync(new URL('../src/components/Map.ts', import.meta.url), 'utf8');
const tier = { premium: false };

function extractMethods(): new () => {
  state: { layers: MapLayers; zoom: number };
  container: { querySelector: () => null };
  layerZoomOverrides: Record<string, boolean>;
  canToggleLayer: (layer: keyof MapLayers, currentlyEnabled: boolean | undefined) => boolean;
  onLayerChange?: (layer: keyof MapLayers, enabled: boolean, source: string) => void;
  scheduleRender(): void;
  render(): void;
  toggleLayer(layer: keyof MapLayers, source?: 'user' | 'programmatic'): void;
  enableLayer(layer: keyof MapLayers): void;
} {
  function extract(signature: string): string {
    const start = mapSrc.indexOf(signature);
    assert.ok(start >= 0, `Map must contain ${signature}`);
    const braceStart = mapSrc.indexOf('{', start);
    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < mapSrc.length; i++) {
      if (mapSrc[i] === '{') depth++;
      else if (mapSrc[i] === '}' && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    assert.ok(end > braceStart, `${signature} must have balanced braces`);
    return mapSrc.slice(start, end).replace(/^public\s+/, '');
  }

  const methods = [
    extract("public toggleLayer(layer: keyof MapLayers, source: 'user' | 'programmatic' = 'user'): void {"),
    extract('public enableLayer(layer: keyof MapLayers): void {'),
  ].join('\n');
  const js = ts.transpileModule(
    `const document = { querySelector: () => null };
     const MapComponent = { LAYER_ZOOM_THRESHOLDS: {}, ASYNC_DATA_LAYERS: new Set() };
     class MapHarness { ${methods} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } },
  ).outputText;
  return new Function(
    `${js}\nreturn MapHarness;`,
  )() as new () => {
    state: { layers: MapLayers; zoom: number };
    container: { querySelector: () => null };
    layerZoomOverrides: Record<string, boolean>;
    canToggleLayer: (layer: keyof MapLayers, currentlyEnabled: boolean | undefined) => boolean;
    onLayerChange?: (layer: keyof MapLayers, enabled: boolean, source: string) => void;
    scheduleRender(): void;
    render(): void;
    toggleLayer(layer: keyof MapLayers, source?: 'user' | 'programmatic'): void;
    enableLayer(layer: keyof MapLayers): void;
  };
}

const MapHarness = extractMethods();

function makeMap(initialLayers: Partial<MapLayers> = {}) {
  const changes: Array<[keyof MapLayers, boolean, string]> = [];
  const map = new MapHarness();
  map.state = {
    zoom: 3,
    layers: { [LOCKED_KEY]: false, ciiChoropleth: false, ...initialLayers } as MapLayers,
  };
  map.container = { querySelector: () => null };
  map.layerZoomOverrides = {};
  map.canToggleLayer = (layer, currentlyEnabled) => isLayerToggleAllowed(layer, currentlyEnabled === true, tier.premium);
  map.onLayerChange = (layer, enabled, source) => changes.push([layer, enabled, source]);
  map.scheduleRender = () => {};
  map.render = () => {};
  return { map, changes };
}

describe('SVG map premium layer toggle gate (#6045)', () => {
  it('blocks free activation but preserves stale locked-layer off-ramp', () => {
    tier.premium = false;
    const fresh = makeMap();
    fresh.map.toggleLayer(LOCKED_KEY);
    assert.equal(fresh.map.state.layers[LOCKED_KEY], false);
    assert.deepEqual(fresh.changes, []);

    const stale = makeMap({ [LOCKED_KEY]: true } as Partial<MapLayers>);
    stale.map.toggleLayer(LOCKED_KEY);
    assert.equal(stale.map.state.layers[LOCKED_KEY], false);
    assert.deepEqual(stale.changes, [[LOCKED_KEY, false, 'user']]);
  });

  it('keeps free layers available to free users', () => {
    tier.premium = false;
    const map = makeMap();
    map.map.toggleLayer('ciiChoropleth');
    assert.equal(map.map.state.layers.ciiChoropleth, true);
  });

  it('gates programmatic enableLayer with the same policy', () => {
    tier.premium = false;
    const free = makeMap();
    free.map.enableLayer(LOCKED_KEY);
    assert.equal(free.map.state.layers[LOCKED_KEY], false);

    tier.premium = true;
    const premium = makeMap();
    premium.map.enableLayer(LOCKED_KEY);
    assert.equal(premium.map.state.layers[LOCKED_KEY], true);
  });
});
