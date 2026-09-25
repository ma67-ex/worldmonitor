// @ts-check
/** Country-agnostic financial math over normalized quarterly results. */

const MS_PER_DAY = 86_400_000;

/** True when a result covers a single quarter (80–100 days), not a half-year or year. */
export function isSingleQuarter(q) {
  if (!q?.periodStart || !q?.periodEnd) return false;
  const days = (Date.parse(q.periodEnd) - Date.parse(q.periodStart)) / MS_PER_DAY;
  return days >= 80 && days <= 100;
}

/** Same calendar quarter one year earlier, matched on the period-end month. */
function yearEarlier(periodEnd) {
  const d = new Date(`${periodEnd}T00:00:00Z`);
  return `${d.getUTCFullYear() - 1}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Month-granular distance between two YYYY-MM-DD period ends. */
function monthsBetween(later, earlier) {
  const a = new Date(`${later}T00:00:00Z`);
  const b = new Date(`${earlier}T00:00:00Z`);
  return (a.getUTCFullYear() - b.getUTCFullYear()) * 12 + (a.getUTCMonth() - b.getUTCMonth());
}

const pct = (now, before) => (now != null && before != null && before !== 0
  ? Math.round(((now - before) / Math.abs(before)) * 10_000) / 100
  : null);

/**
 * Trailing-twelve-month sums over the four most recent consecutive quarters.
 * Returns null unless four single quarters, each exactly three months apart, exist.
 *
 * @param {Array<{ periodStart: string, periodEnd: string, revenue: number|null, pat: number|null, patOwners?: number|null, eps: number|null, ebitda?: number|null }>} quarters newest first
 */
export function trailingTwelveMonths(quarters) {
  const q = quarters.filter(isSingleQuarter).slice(0, 4);
  if (q.length < 4) return null;
  for (let i = 1; i < 4; i++) if (monthsBetween(q[i - 1].periodEnd, q[i].periodEnd) !== 3) return null;
  const sum = (field) => (q.every((x) => x[field] != null) ? q.reduce((s, x) => s + x[field], 0) : null);
  const eps = sum('eps');
  return {
    periodEnd: q[0].periodEnd,
    revenue: sum('revenue'),
    ebitda: sum('ebitda'),
    pat: sum('pat'),
    patOwners: sum('patOwners'),
    eps: eps == null ? null : Math.round(eps * 100) / 100,
  };
}

/** Growth of the newest quarter over the same quarter a year earlier. */
export function yearOverYear(quarters) {
  const latest = quarters.find(isSingleQuarter);
  if (!latest) return null;
  const target = yearEarlier(latest.periodEnd);
  const prior = quarters.find((x) => isSingleQuarter(x) && x.periodEnd.slice(0, 7) === target);
  if (!prior) return null;
  return {
    periodEnd: latest.periodEnd,
    comparedTo: prior.periodEnd,
    revenuePct: pct(latest.revenue, prior.revenue),
    patPct: pct(latest.pat, prior.pat),
    epsPct: pct(latest.eps, prior.eps),
  };
}

/** Operating margin proxy: EBITDA / revenue, in percent. */
export function ebitdaMarginPct(q) {
  return q?.ebitda != null && q?.revenue ? Math.round((q.ebitda / q.revenue) * 10_000) / 100 : null;
}
