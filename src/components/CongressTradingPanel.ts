import { StaticJsonPanel } from './StaticJsonPanel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

interface Latest { filer: string; branch: string; party: string | null; ticker: string; type: string; amount: string | null; txDate: string | null; filed: string | null; late: boolean; url: string | null }
interface TopFiler { name: string; branch: string; party: string | null; trades: number; late: number; volume: number }
interface TopTicker { ticker: string; trades: number; filers: number; buys: number; sells: number; volume: number }
interface CongressData {
  generatedAt: string;
  source: string;
  stats: { totalTrades: number; totalFilers: number; lateFilings: number; estVolumeUsd: number; from: string; to: string; medianDaysToFile: number };
  topFilers: TopFiler[];
  topTickers: TopTicker[];
  latest: Latest[];
}

type Tab = 'latest' | 'filers' | 'tickers';

const S = 'calc(11px * var(--wm-panel-effective-scale, 1))';
const dim = 'color:var(--text-dim)';

function usd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n / 1e3)}K`;
}

function partyTag(party: string | null, branch: string): string {
  if (branch === 'executive') return 'EXEC';
  return party ? party.charAt(0).toUpperCase() : '?';
}

function partyColor(party: string | null): string {
  if (party?.startsWith('D')) return '#4a90e2';
  if (party?.startsWith('R')) return '#e74c3c';
  return '#95a5a6';
}

function isBuy(type: string): boolean {
  return /purchase|buy/i.test(type);
}

export class CongressTradingPanel extends StaticJsonPanel<CongressData> {
  private tab: Tab = 'latest';

  constructor() {
    super({
      id: 'congress-trading',
      title: 'Congress Trading',
      showCount: false,
      infoTooltip: 'Stock trades disclosed by US Senators, Representatives and executive-branch officials under the STOCK Act. Data: kadoa-org/congress-trading-monitor (MIT), built from House Clerk, Senate eFD and OGE filings.',
    }, '/data/congress.json');
    this.content.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-congress-tab]');
      if (!btn) return;
      this.tab = btn.dataset.congressTab as Tab;
      this.repaint();
    });
  }

  protected render(d: CongressData): string {
    const { stats } = d;

    const kpi = (label: string, value: string) =>
      `<div><div style="font-size:calc(16px * var(--wm-panel-effective-scale, 1));font-weight:700">${escapeHtml(value)}</div><div style="font-size:calc(9px * var(--wm-panel-effective-scale, 1));${dim}">${label}</div></div>`;

    const tabBtn = (id: Tab, label: string) =>
      `<button data-congress-tab="${id}" style="flex:1;padding:4px 0;font-size:${S};cursor:pointer;border:0;border-bottom:2px solid ${this.tab === id ? 'var(--accent, #2ecc71)' : 'transparent'};background:none;color:${this.tab === id ? 'inherit' : 'var(--text-dim)'}">${label}</button>`;

    let body = '';
    if (this.tab === 'latest') {
      body = d.latest.slice(0, 30).map((t) => {
        const buy = isBuy(t.type);
        const who = `<span style="color:${partyColor(t.party)};font-weight:600">${escapeHtml(partyTag(t.party, t.branch))}</span> ${escapeHtml(t.filer)}`;
        const link = t.url ? ` <a href="${escapeHtml(sanitizeUrl(t.url))}" target="_blank" rel="noopener noreferrer" style="${dim}">filing</a>` : '';
        return `<div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:${S}">
          <div style="display:flex;justify-content:space-between;gap:8px"><span>${who}</span><span style="font-weight:700;color:${buy ? '#2ecc71' : '#e74c3c'}">${buy ? 'BUY' : 'SELL'} ${escapeHtml(t.ticker)}</span></div>
          <div style="${dim}">${escapeHtml(t.amount ?? 'n/a')} · traded ${escapeHtml(t.txDate ?? '?')} · filed ${escapeHtml(t.filed ?? '?')}${t.late ? ' <span style="color:#e67e22">late</span>' : ''}${link}</div>
        </div>`;
      }).join('');
    } else if (this.tab === 'filers') {
      body = d.topFilers.map((f) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:${S}">
          <span><span style="color:${partyColor(f.party)};font-weight:600">${escapeHtml(partyTag(f.party, f.branch))}</span> ${escapeHtml(f.name)}</span>
          <span style="${dim}">${f.trades.toLocaleString()} trades · ${usd(f.volume)} · ${f.late.toLocaleString()} late</span></div>`).join('');
    } else {
      body = d.topTickers.map((t) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:${S}">
          <span style="font-weight:700">${escapeHtml(t.ticker)}</span>
          <span style="${dim}">${t.trades.toLocaleString()} trades · ${t.filers} filers · <span style="color:#2ecc71">${t.buys}B</span>/<span style="color:#e74c3c">${t.sells}S</span> · ${usd(t.volume)}</span></div>`).join('');
    }

    return `<div style="padding:10px 14px">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center;padding:8px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:8px">
        ${kpi('trades', stats.totalTrades.toLocaleString())}${kpi('filers', stats.totalFilers.toLocaleString())}${kpi('est. volume', usd(stats.estVolumeUsd))}${kpi('median days to file', String(stats.medianDaysToFile))}
      </div>
      <div style="display:flex;margin-bottom:6px">${tabBtn('latest', 'Latest')}${tabBtn('filers', 'Top filers')}${tabBtn('tickers', 'Top tickers')}</div>
      ${body}
      <div style="font-size:calc(9px * var(--wm-panel-effective-scale, 1));${dim};text-align:right;margin-top:6px">Data through ${escapeHtml(stats.to)} · <a href="${escapeHtml(d.source)}" target="_blank" rel="noopener noreferrer" style="${dim}">kadoa congress-trading-monitor</a></div>
    </div>`;
  }
}
