/**
 * Layer control "Select All": one click enables every visible, unlocked,
 * currently-off layer toggle and drives each one through its own `change`
 * handler — never the hidden (search-filtered), `data-layer-hidden`, or
 * premium-locked (disabled) rows.
 *
 * Lives under tests/dom/ because `bindLayerSelectAll` is DOM-only and the
 * module graph pulls `@/services/i18n`'s `import.meta.glob`, unreachable from
 * the `tsx --test` profile.
 */

import { describe, expect, it, vi } from 'vitest';

import { bindLayerSelectAll } from '@/config/map-layer-definitions';

function buildToggles(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="toggle-header">
      <button type="button" class="layer-select-all">Select All</button>
    </div>
    <div class="toggle-list">
      <div class="layer-toggle-row" data-layer="a">
        <label class="layer-toggle" data-layer="a"><input type="checkbox"></label>
      </div>
      <div class="layer-toggle-row" data-layer="b">
        <label class="layer-toggle" data-layer="b"><input type="checkbox" checked></label>
      </div>
      <div class="layer-toggle-row" data-layer="c" style="display:none">
        <label class="layer-toggle" data-layer="c"><input type="checkbox"></label>
      </div>
      <div class="layer-toggle-row" data-layer="d">
        <label class="layer-toggle" data-layer="d"><input type="checkbox" disabled></label>
      </div>
      <div class="layer-toggle-row" data-layer="e">
        <label class="layer-toggle" data-layer="e" data-layer-hidden><input type="checkbox"></label>
      </div>
    </div>`;
  return root;
}

describe('bindLayerSelectAll', () => {
  it('enables only the visible, unlocked, off toggles and fires change once each', () => {
    const toggles = buildToggles();
    const changed: string[] = [];
    toggles.querySelectorAll<HTMLInputElement>('.layer-toggle input').forEach((input) => {
      input.addEventListener('change', () => {
        changed.push(input.closest('.layer-toggle')!.getAttribute('data-layer')!);
      });
    });

    bindLayerSelectAll(toggles);
    (toggles.querySelector('.layer-select-all') as HTMLButtonElement).click();

    const state = (k: string) =>
      (toggles.querySelector(`.layer-toggle[data-layer="${k}"] input`) as HTMLInputElement).checked;

    expect(state('a')).toBe(true);   // was off + visible  -> on
    expect(state('b')).toBe(true);   // already on         -> untouched
    expect(state('c')).toBe(false);  // search-hidden      -> skipped
    expect(state('d')).toBe(false);  // premium-locked     -> skipped
    expect(state('e')).toBe(false);  // data-layer-hidden  -> skipped

    expect(changed).toEqual(['a']);  // exactly one change event, only for 'a'
  });

  it('is a no-op when the container has no select-all button', () => {
    const toggles = buildToggles();
    toggles.querySelector('.layer-select-all')!.remove();
    expect(() => bindLayerSelectAll(toggles)).not.toThrow();
  });
});
