/**
 * Country-agnostic equity-terminal logic: TTM/YoY math, rolling market history,
 * and the per-company rotation used by every equity seeder.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ebitdaMarginPct, isSingleQuarter, trailingTwelveMonths, yearOverYear } from '../scripts/shared/equity/metrics.mjs';
import { mergeDealHistory, mergeFlowHistory, signStreak } from '../scripts/shared/equity/market.mjs';
import { equityKey, loadUniverse, rotateCompanies } from '../scripts/shared/equity/registry.mjs';

const q = (start, end, revenue, pat, eps) => ({ periodStart: start, periodEnd: end, revenue, pat, eps, ebitda: revenue / 5 });
const QUARTERS = [
  q('2026-04-01', '2026-06-30', 400, 40, 4),
  q('2026-01-01', '2026-03-31', 300, 30, 3),
  q('2025-10-01', '2025-12-31', 200, 20, 2),
  q('2025-07-01', '2025-09-30', 100, 10, 1),
  q('2025-04-01', '2025-06-30', 320, 32, 3.2),
];

describe('metrics', () => {
  it('recognizes single quarters only', () => {
    assert.equal(isSingleQuarter(QUARTERS[0]), true);
    assert.equal(isSingleQuarter(q('2025-04-01', '2026-03-31', 1, 1, 1)), false);
  });

  it('sums the four latest consecutive quarters', () => {
    assert.deepEqual(trailingTwelveMonths(QUARTERS), {
      periodEnd: '2026-06-30', revenue: 1000, ebitda: 200, pat: 100, patOwners: null, eps: 10,
    });
  });

  it('refuses TTM across a missing quarter', () => {
    assert.equal(trailingTwelveMonths([QUARTERS[0], QUARTERS[1], QUARTERS[3], QUARTERS[4]]), null);
  });

  it('compares with the same quarter a year earlier', () => {
    assert.deepEqual(yearOverYear(QUARTERS), {
      periodEnd: '2026-06-30', comparedTo: '2025-06-30', revenuePct: 25, patPct: 25, epsPct: 25,
    });
  });

  it('computes EBITDA margin', () => {
    assert.equal(ebitdaMarginPct(QUARTERS[0]), 20);
    assert.equal(ebitdaMarginPct({ ebitda: 1, revenue: 0 }), null);
  });
});

describe('flow history', () => {
  const day = (date, fiiNet, diiNet) => ({ date, fii: { buy: 1, sell: 1, net: fiiNet }, dii: { buy: 1, sell: 1, net: diiNet } });

  it('keeps one row per date and derives streaks and rolling sums', () => {
    let state = null;
    state = mergeFlowHistory(state, day('2026-09-22', -100, 50));
    state = mergeFlowHistory(state, day('2026-09-23', -200, 60));
    state = mergeFlowHistory(state, day('2026-09-24', -1, 70));
    state = mergeFlowHistory(state, day('2026-09-24', -300, 80)); // same date replaces
    assert.equal(state.history.length, 3);
    assert.equal(state.latest.fiiNet, -300);
    assert.equal(state.rolling.fiiNet5d, -600);
    assert.deepEqual(state.streak.fii, { direction: 'selling', days: 3 });
    assert.deepEqual(state.streak.dii, { direction: 'buying', days: 3 });
  });

  it('drops rows older than the window', () => {
    const state = mergeFlowHistory({ history: [{ date: '2026-01-01', fiiNet: 5 }] }, day('2026-09-24', 1, 1), { keepDays: 30 });
    assert.deepEqual(state.history.map((r) => r.date), ['2026-09-24']);
  });

  it('computes streaks from mixed signs', () => {
    assert.deepEqual(signStreak([5, 3, -1, 4]), { direction: 'buying', days: 2 });
    assert.deepEqual(signStreak([0, 0]), { direction: null, days: 0 });
  });
});

describe('deal history', () => {
  const deal = (date, symbol, value, type = 'bulk') => ({ type, date, symbol, client: 'C', side: 'BUY', quantity: 1, price: value, value });

  it('keeps the whole latest session and a rolling window for universe members only', () => {
    const members = new Set(['RELIANCE']);
    const first = mergeDealHistory(null, { asOf: '2026-09-23', bulk: [deal('2026-09-23', 'RELIANCE', 5), deal('2026-09-23', 'SMALLCO', 9)], block: [], short: [] }, { members });
    const second = mergeDealHistory(first, { asOf: '2026-09-24', bulk: [deal('2026-09-24', 'RELIANCE', 7)], block: [deal('2026-09-24', 'SMALLCO', 99, 'block')], short: [] }, { members });
    assert.deepEqual(second.members.map((d) => d.date), ['2026-09-24', '2026-09-23']);
    assert.ok(second.members.every((d) => d.symbol === 'RELIANCE'));
    assert.equal(second.topByValue[0].value, 99);
    assert.deepEqual(second.counts, { bulk: 1, block: 1, short: 0 });
  });
});

describe('registry', () => {
  it('names keys by dataset, country and symbol', () => {
    assert.equal(equityKey('shareholding', 'IN'), 'equity:shareholding:v1:IN');
    assert.equal(equityKey('shareholding', 'IN', 'TCS'), 'equity:shareholding:v1:IN:TCS');
  });

  it('loads the India universe', () => {
    const universe = loadUniverse('IN');
    assert.equal(universe.length, 50);
    assert.ok(universe.every((c) => c.symbol && c.yahooSymbol.endsWith('.NS')));
  });

  it('rotates from the cursor, stops at the deadline and wraps', async () => {
    const companies = ['A', 'B', 'C', 'D'].map((symbol) => ({ symbol }));
    let clock = 0;
    const seen = [];
    const run = await rotateCompanies({
      companies,
      cursor: 2,
      deadline: 3,
      now: () => clock,
      work: async (c) => { seen.push(c.symbol); clock += 1; return c.symbol === 'D' ? null : { ok: true }; },
    });
    assert.deepEqual(seen, ['C', 'D', 'A']);
    assert.deepEqual([...run.results.keys()], ['C', 'A']);
    assert.deepEqual(run.failed, ['D']);
    assert.equal(run.nextCursor, 1);
  });

  it('counts a throwing company as failed and keeps going', async () => {
    const run = await rotateCompanies({
      companies: [{ symbol: 'A' }, { symbol: 'B' }],
      cursor: 0,
      deadline: Infinity,
      work: async (c) => { if (c.symbol === 'A') throw new Error('boom'); return { ok: true }; },
    });
    assert.deepEqual(run.failed, ['A']);
    assert.deepEqual([...run.results.keys()], ['B']);
    assert.equal(run.nextCursor, 0);
  });
});
