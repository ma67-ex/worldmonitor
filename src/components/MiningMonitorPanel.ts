import { StaticJsonPanel } from './StaticJsonPanel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

interface Mine { mine: string; company: string; country: string; value: number; period: string; url: string | null }
interface Commodity { commodity: string; unit: string; mines: number; top: Mine[] }
interface MiningData {
  generatedAt: string;
  source: string;
  stats: { records: number; companies: number; mines: number };
  commodities: Commodity[];
}

const dim = 'color:var(--text-dim)';
const S = 'calc(11px * var(--wm-panel-effective-scale, 1))';

export class MiningMonitorPanel extends StaticJsonPanel<MiningData> {
  private selected = 0;

  constructor() {
    super({
      id: 'mining-monitor',
      title: 'Mining Production',
      showCount: false,
      infoTooltip: 'Latest reported quarterly mine-level production by commodity. Data: kadoa-org/world-mining-monitor (MIT), extracted from company reports. Units differ by reporting basis; check the linked source.',
    }, '/data/mining.json');
    this.content.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-mining-idx]');
      if (!chip) return;
      this.selected = Number(chip.dataset.miningIdx);
      this.repaint();
    });
  }

  protected render(d: MiningData): string {
    const sel = d.commodities[this.selected] ?? d.commodities[0];
    if (!sel) return `<div style="padding:12px;${dim}">No data</div>`;
    const chips = d.commodities.map((c, i) => `<button data-mining-idx="${i}" style="padding:2px 8px;margin:0 4px 4px 0;font-size:${S};cursor:pointer;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:${c === sel ? 'rgba(255,255,255,0.15)' : 'none'};color:inherit">${escapeHtml(c.commodity)}</button>`).join('');
    const rows = sel.top.map((m) => {
      const link = m.url ? `<a href="${escapeHtml(sanitizeUrl(m.url))}" target="_blank" rel="noopener noreferrer" style="${dim}">source</a>` : '';
      return `<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:${S}">
        <span>${escapeHtml(m.mine)} <span style="${dim}">${escapeHtml(m.company)} · ${escapeHtml(m.country)}</span></span>
        <span><b>${m.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</b> ${escapeHtml(sel.unit)} <span style="${dim}">${escapeHtml(m.period)}</span> ${link}</span></div>`;
    }).join('');
    return `<div style="padding:10px 14px">
      <div style="font-size:${S};${dim};margin-bottom:6px">${d.stats.mines} mines · ${d.stats.companies} companies · ${d.stats.records.toLocaleString()} records</div>
      <div style="margin-bottom:4px">${chips}</div>
      ${rows}
    </div>`;
  }
}
