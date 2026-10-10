/**
 * Entry point for God's Eye View on the map. Always-available button, plus a pulsing
 * hint once the user has zoomed in far enough to want street-level detail.
 * Kept tiny on purpose: the Cesium-backed GodsEyeView is only imported on click.
 */
import './../styles/gods-eye.css';
import type { GodsEyePoint } from './GodsEyeView';

export const GODS_EYE_HINT_ZOOM = 8;

export interface GodsEyeEntryHost {
  /** Current map camera, or null while the renderer is not ready. */
  getView: () => { lat: number; lon: number; zoom: number } | null;
  getPoints: () => GodsEyePoint[];
  /** Move the underlying map to where the user left God's Eye View. */
  restoreView: (lat: number, lon: number, zoom: number) => void;
}

const EYE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';

export class GodsEyeEntry {
  private readonly button = document.createElement('button');
  private view: { close: () => void } | null = null;
  private opening = false;

  constructor(private readonly container: HTMLElement, private readonly host: GodsEyeEntryHost) {
    this.button.type = 'button';
    this.button.className = 'gev-entry';
    this.button.title = "God's Eye View: 3D terrain at this spot";
    const icon = document.createElement('span');
    icon.style.display = 'inline-flex';
    icon.insertAdjacentHTML('beforeend', EYE_ICON);
    const label = document.createElement('span');
    label.textContent = "God's Eye";
    this.button.append(icon, label);
    this.button.addEventListener('click', () => void this.open());
  }

  /** Idempotent: re-appends the button if a renderer swap cleared the container. */
  attach(): void {
    if (!this.button.isConnected) this.container.appendChild(this.button);
  }

  onZoom(zoom: number): void {
    this.attach();
    this.button.classList.toggle('gev-hint', zoom >= GODS_EYE_HINT_ZOOM);
  }

  destroy(): void {
    this.view?.close();
    this.button.remove();
  }

  private async open(): Promise<void> {
    const start = this.host.getView();
    if (!start || this.view || this.opening) return;
    this.opening = true;
    try {
      const { GodsEyeView } = await import('./GodsEyeView');
      const view = new GodsEyeView(this.container, {
        ...start,
        points: this.host.getPoints,
        onClose: ({ lat, lon, zoom }) => {
          this.view = null;
          this.button.hidden = false;
          this.host.restoreView(lat, lon, zoom);
        },
      });
      this.view = view;
      this.button.hidden = true;
      await view.open();
    } finally {
      this.opening = false;
    }
  }
}
