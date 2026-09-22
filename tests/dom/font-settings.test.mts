import { afterEach, describe, expect, it } from 'vitest';

import { applyFont } from '@/services/font-settings';

describe('font-settings applyFont', () => {
  afterEach(() => {
    delete document.documentElement.dataset.font;
  });

  it('sets data-font="system" when system is selected', () => {
    applyFont('system');
    expect(document.documentElement.dataset.font).toBe('system');
  });

  it('removes the data-font attribute entirely for mono (not an empty string)', () => {
    applyFont('system');
    applyFont('mono');
    expect(document.documentElement.hasAttribute('data-font')).toBe(false);
    expect(document.documentElement.dataset.font).toBeUndefined();
  });
});
