import { loadFromStorage, saveToStorage } from '@/utils';

const KEY = 'wm-broken-panels-last';

export function isBrokenPanelsLast(): boolean {
  return loadFromStorage<boolean>(KEY, false) === true;
}

/** Toggles the CSS `order` push for `.panel-errored`; visual only, saved panel order is untouched. */
export function applyBrokenPanelsLast(on = isBrokenPanelsLast()): void {
  document.body.classList.toggle('broken-panels-last', on);
}

export function setBrokenPanelsLast(on: boolean): void {
  saveToStorage(KEY, on);
  applyBrokenPanelsLast(on);
}
