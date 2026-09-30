import { Panel, type PanelOptions } from './Panel';
import { unsafeRawHtml } from '@/utils/sanitize';

/** Panel backed by one bundled JSON file (see scripts/build-alt-data.mjs). Subclasses escape every dynamic value in render(). */
export abstract class StaticJsonPanel<T> extends Panel {
  protected data: T | null = null;

  constructor(options: PanelOptions, private readonly dataUrl: string) {
    super(options);
    void this.fetchData();
  }

  protected abstract render(data: T): string;

  protected repaint(): void {
    if (this.data) this.setSafeContent(unsafeRawHtml(this.render(this.data), 'static JSON panel; subclasses escape dynamic values'));
  }

  public async fetchData(): Promise<boolean> {
    try {
      const resp = await fetch(this.dataUrl, { signal: AbortSignal.timeout(8_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.data = (await resp.json()) as T;
      this.repaint();
      return true;
    } catch {
      this.showError('Data unavailable', () => { void this.fetchData(); }, 300);
      return false;
    }
  }
}
