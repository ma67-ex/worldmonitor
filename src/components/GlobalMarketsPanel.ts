import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { getApiBaseUrl } from '@/services/runtime';
import { getCountryNameByCode } from '@/services/country-geometry';
import { joinSafeHtml, safeHtml } from '@/utils/sanitize';

interface CountryIndexRow {
  code: string;
  symbol: string;
  indexName: string;
  available: boolean;
  price: number | null;
  weekChangePercent: number | null;
  currency: string | null;
  fetchedAt: string | null;
}
interface GlobalMarketsResponse { countries: CountryIndexRow[] }

const changeClass = (v: number) => (v > 0 ? 'change-positive' : v < 0 ? 'change-negative' : 'change-neutral');

export class GlobalMarketsPanel extends Panel {
  private rows: CountryIndexRow[] = [];
  private error: string | null = null;
  private loading = true;

  constructor() {
    super({ id: 'global-markets', title: 'Global Markets', infoTooltip: 'Primary stock index for every country World Monitor tracks — 45 markets, sorted by weekly move.' });
  }

  public async fetchData(): Promise<void> {
    try {
      const resp = await fetch(`${getApiBaseUrl()}/api/global-markets`, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as GlobalMarketsResponse;
      this.rows = data.countries ?? [];
      this.error = null;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (this.rows.length === 0) this.error = t('common.noDataShort');
      console.warn('[GlobalMarkets] Fetch error:', err);
    } finally {
      this.loading = false;
      if (this.element?.isConnected) this.renderPanel();
    }
  }

  private renderPanel(): void {
    if (this.loading) {
      this.showLoading();
      return;
    }
    if (this.error || this.rows.length === 0) {
      this.showError(this.error || t('common.noDataShort'), () => void this.fetchData());
      return;
    }

    // Available markets first, ranked by the size of the weekly move; unavailable ones trail, alphabetically.
    const sorted = [...this.rows].sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      if (a.available && b.available) return Math.abs(b.weekChangePercent ?? 0) - Math.abs(a.weekChangePercent ?? 0);
      return a.code.localeCompare(b.code);
    });

    this.setSafeContent(safeHtml`
      <div class="global-markets-list">
        ${joinSafeHtml(sorted.map((r) => this.renderRow(r)))}
      </div>
    `);
  }

  private renderRow(r: CountryIndexRow) {
    const name = getCountryNameByCode(r.code) ?? r.code;
    if (!r.available || r.price == null || r.weekChangePercent == null) {
      return safeHtml`
        <div class="global-market-row global-market-row--unavailable">
          <span class="global-market-name">${name}</span>
          <span class="global-market-index">${r.indexName}</span>
          <span class="global-market-unavailable">no data</span>
        </div>
      `;
    }
    return safeHtml`
      <div class="global-market-row">
        <span class="global-market-name">${name}</span>
        <span class="global-market-index">${r.indexName}</span>
        <span class="global-market-price">${r.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}${r.currency ? ` ${r.currency}` : ''}</span>
        <span class="${changeClass(r.weekChangePercent)}">${r.weekChangePercent > 0 ? '+' : ''}${r.weekChangePercent.toFixed(2)}%</span>
      </div>
    `;
  }
}
