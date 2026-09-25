// @ts-check
/** Pure merge helpers for market-wide equity seeders that keep rolling history. */

const DAY = 86_400_000;
const cutoff = (latestDate, keepDays) => new Date(Date.parse(latestDate) - keepDays * DAY).toISOString().slice(0, 10);

/**
 * Consecutive days (newest first) on which `series` kept the same sign.
 * @param {number[]} series newest first
 */
export function signStreak(series) {
  const first = series.find((v) => v != null && v !== 0);
  if (first == null) return { direction: null, days: 0 };
  const sign = Math.sign(first);
  let days = 0;
  for (const v of series) {
    if (v == null || Math.sign(v) !== sign) break;
    days += 1;
  }
  return { direction: sign > 0 ? 'buying' : 'selling', days };
}

/**
 * Add today's FII/DII row to the stored history (one row per date, today's
 * figures replace a provisional row for the same date) and derive streaks and
 * rolling sums.
 */
export function mergeFlowHistory(previous, today, { keepDays = 120 } = {}) {
  const row = {
    date: today.date,
    fiiBuy: today.fii.buy, fiiSell: today.fii.sell, fiiNet: today.fii.net,
    diiBuy: today.dii.buy, diiSell: today.dii.sell, diiNet: today.dii.net,
  };
  const byDate = new Map((previous?.history ?? []).map((r) => [r.date, r]));
  byDate.set(row.date, row);
  const since = cutoff(row.date, keepDays);
  const history = [...byDate.values()].filter((r) => r.date >= since).sort((a, b) => b.date.localeCompare(a.date));
  const sum = (field, n) => Math.round(history.slice(0, n).reduce((s, r) => s + (r[field] ?? 0), 0) * 100) / 100;
  return {
    country: 'IN',
    unit: 'INR crore',
    date: history[0].date,
    latest: history[0],
    rolling: {
      fiiNet5d: sum('fiiNet', 5), diiNet5d: sum('diiNet', 5),
      fiiNet20d: sum('fiiNet', 20), diiNet20d: sum('diiNet', 20),
      fiiNet60d: sum('fiiNet', 60), diiNet60d: sum('diiNet', 60),
    },
    streak: {
      fii: signStreak(history.map((r) => r.fiiNet)),
      dii: signStreak(history.map((r) => r.diiNet)),
    },
    history,
  };
}

/**
 * Keep the latest session's deals in full, and a rolling window of deals in
 * universe companies (the only ones with company pages).
 */
export function mergeDealHistory(previous, latest, { members, keepDays = 90 }) {
  const all = [...latest.bulk, ...latest.block, ...latest.short];
  const idOf = (d) => `${d.type}|${d.date}|${d.symbol}|${d.client}|${d.side}|${d.quantity}|${d.price}`;
  const byId = new Map((previous?.members ?? []).map((d) => [idOf(d), d]));
  for (const d of all) if (members.has(d.symbol)) byId.set(idOf(d), d);
  const since = cutoff(latest.asOf, keepDays);
  const memberDeals = [...byId.values()]
    .filter((d) => d.date && d.date >= since)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.value ?? 0) - (a.value ?? 0));
  const topByValue = [...latest.bulk, ...latest.block]
    .filter((d) => d.value != null)
    .sort((a, b) => b.value - a.value)
    .slice(0, 25);
  return {
    country: 'IN',
    currency: 'INR',
    latest,
    counts: { bulk: latest.bulk.length, block: latest.block.length, short: latest.short.length },
    topByValue,
    members: memberDeals,
  };
}
