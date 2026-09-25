import type { MarketData } from '@/types';
import { formatPrice } from '@/utils';

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });

function range(low: number | undefined, high: number | undefined): string {
  return low != null && high != null ? `${formatPrice(low)} – ${formatPrice(high)}` : '—';
}

function rangeBar(price: number | null, low: number | undefined, high: number | undefined): string {
  if (price == null || low == null || high == null || high <= low) return '';
  const pct = Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100));
  return `<div class="quote-stats-bar" aria-hidden="true"><span style="left:${pct.toFixed(1)}%"></span></div>`;
}

/** Bloomberg-style quote stats block; empty string when the provider reported none. */
export function renderQuoteStats(stock: MarketData): string {
  const { price, dayHigh, dayLow, volume, fiftyTwoWeekHigh, fiftyTwoWeekLow } = stock;
  if ([dayHigh, dayLow, volume, fiftyTwoWeekHigh, fiftyTwoWeekLow].every((v) => v == null)) return '';

  const cell = (label: string, value: string, extra = '') =>
    `<div class="quote-stats-cell"><dt>${label}</dt><dd>${value}</dd>${extra}</div>`;

  return `
    <dl class="quote-stats">
      ${cell('Day range', range(dayLow, dayHigh), rangeBar(price, dayLow, dayHigh))}
      ${cell('52W range', range(fiftyTwoWeekLow, fiftyTwoWeekHigh), rangeBar(price, fiftyTwoWeekLow, fiftyTwoWeekHigh))}
      ${cell('Volume', volume != null ? compact.format(volume) : '—')}
      ${cell('From 52W high', price != null && fiftyTwoWeekHigh ? `${(((price - fiftyTwoWeekHigh) / fiftyTwoWeekHigh) * 100).toFixed(2)}%` : '—')}
    </dl>`;
}
