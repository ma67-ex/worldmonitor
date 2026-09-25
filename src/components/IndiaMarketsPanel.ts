import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { getApiBaseUrl } from '@/services/runtime';
import { joinSafeHtml, safeHtml } from '@/utils/sanitize';

interface FlowRow { date: string; fiiNet: number; diiNet: number }
interface FlowsResponse {
  rolling: { fiiNet5d: number; diiNet5d: number };
  streak: { fii: { direction: string | null; days: number }; dii: { direction: string | null; days: number } };
  history: FlowRow[];
}
interface DealRow { date: string; symbol: string; name: string; side: string | null; value: number | null }
interface DealsResponse { topByValue: DealRow[] }
interface IndexRow { name: string; last: number; changePct: number }
interface IndicesResponse { indices: IndexRow[] }
interface MeetingRow { date: string; symbol: string; purpose: string }
interface CalendarResponse { meetings: MeetingRow[] }

interface EquityIndiaResponse {
  flows: FlowsResponse | null;
  deals: DealsResponse | null;
  indices: IndicesResponse | null;
  calendar: CalendarResponse | null;
}

const HEADLINE_INDICES = ['NIFTY 50', 'NIFTY BANK', 'NIFTY IT', 'INDIA VIX'];
/** `v` is already in ₹ crore (NSE FII/DII flows are published that way). */
const CR = (v: number) => `₹${(v / 1000).toFixed(2)}k cr`;
/** `v` is in absolute ₹ (deal value = quantity × price); convert to crore first. */
const RUPEES_TO_CR = (v: number) => `₹${(v / 1e7).toFixed(1)} cr`;
const changeClass = (v: number) => (v > 0 ? 'change-positive' : v < 0 ? 'change-negative' : 'change-neutral');

export class IndiaMarketsPanel extends Panel {
  private data: EquityIndiaResponse | null = null;
  private error: string | null = null;
  private loading = true;

  constructor() {
    super({ id: 'india-markets', title: 'India Markets', infoTooltip: 'FII/DII flows, large deals, NSE indices, and upcoming results for the NIFTY 50.' });
  }

  public async fetchData(): Promise<void> {
    try {
      const resp = await fetch(`${getApiBaseUrl()}/api/equity-india`, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.data = await resp.json() as EquityIndiaResponse;
      this.error = null;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!this.data) this.error = t('common.noDataShort');
      console.warn('[IndiaMarkets] Fetch error:', err);
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
    if (this.error || !this.data) {
      this.showError(this.error || t('common.noDataShort'), () => void this.fetchData());
      return;
    }

    const { flows, deals, indices, calendar } = this.data;
    if (!flows && !deals && !indices && !calendar) {
      this.setSafeContent(safeHtml`<div class="panel-empty">${t('common.noDataShort')}</div>`);
      return;
    }

    this.setSafeContent(safeHtml`
      <div class="india-markets">
        ${this.renderIndices(indices)}
        ${this.renderFlows(flows)}
        ${this.renderDeals(deals)}
        ${this.renderCalendar(calendar)}
      </div>
    `);
  }

  private renderIndices(indices: IndicesResponse | null) {
    if (!indices?.indices?.length) return safeHtml``;
    const rows = HEADLINE_INDICES
      .map((name) => indices.indices.find((i) => i.name === name))
      .filter((i): i is IndexRow => Boolean(i));
    if (rows.length === 0) return safeHtml``;
    return safeHtml`
      <div class="india-section india-indices">
        ${joinSafeHtml(rows.map((i) => safeHtml`
          <div class="india-index-tile">
            <div class="india-index-name">${i.name}</div>
            <div class="india-index-value">${i.last.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
            <div class="${changeClass(i.changePct)}">${i.changePct > 0 ? '+' : ''}${i.changePct.toFixed(2)}%</div>
          </div>
        `))}
      </div>
    `;
  }

  private renderFlows(flows: FlowsResponse | null) {
    const latest = flows?.history?.[0];
    if (!latest) return safeHtml``;
    const streakLabel = (s: { direction: string | null; days: number }) =>
      s.direction ? `${s.direction} ${s.days}d` : 'flat';
    return safeHtml`
      <div class="india-section india-flows">
        <div class="india-section-title">FII / DII Flows <span class="india-section-date">${latest.date}</span></div>
        <div class="india-flow-row">
          <span class="india-flow-label">FII</span>
          <span class="${changeClass(latest.fiiNet)}">${CR(latest.fiiNet)}</span>
          <span class="india-flow-streak">${streakLabel(flows.streak.fii)}</span>
        </div>
        <div class="india-flow-row">
          <span class="india-flow-label">DII</span>
          <span class="${changeClass(latest.diiNet)}">${CR(latest.diiNet)}</span>
          <span class="india-flow-streak">${streakLabel(flows.streak.dii)}</span>
        </div>
      </div>
    `;
  }

  private renderDeals(deals: DealsResponse | null) {
    if (!deals?.topByValue?.length) return safeHtml``;
    const top = deals.topByValue.slice(0, 5);
    return safeHtml`
      <div class="india-section india-deals">
        <div class="india-section-title">Top Bulk / Block Deals</div>
        ${joinSafeHtml(top.map((d) => safeHtml`
          <div class="india-deal-row">
            <span class="india-deal-symbol">${d.symbol}</span>
            <span class="india-deal-side ${d.side === 'BUY' ? 'change-positive' : 'change-negative'}">${d.side ?? '—'}</span>
            <span class="india-deal-value">${d.value != null ? RUPEES_TO_CR(d.value) : '—'}</span>
          </div>
        `))}
      </div>
    `;
  }

  private renderCalendar(calendar: CalendarResponse | null) {
    if (!calendar?.meetings?.length) return safeHtml``;
    const upcoming = calendar.meetings.filter((m) => m.purpose && /result/i.test(m.purpose)).slice(0, 5);
    if (upcoming.length === 0) return safeHtml``;
    return safeHtml`
      <div class="india-section india-calendar">
        <div class="india-section-title">Upcoming Results</div>
        ${joinSafeHtml(upcoming.map((m) => safeHtml`
          <div class="india-calendar-row">
            <span class="india-calendar-date">${m.date}</span>
            <span class="india-calendar-symbol">${m.symbol}</span>
          </div>
        `))}
      </div>
    `;
  }
}
