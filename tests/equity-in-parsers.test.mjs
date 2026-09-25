/**
 * NSE (India) equity-terminal parsers, checked against real responses recorded
 * on 2026-09-24 (tests/fixtures/equity-in/). Figures asserted here are the ones
 * published in Reliance's own filings, so a unit or field-mapping slip fails loudly.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  categorizeFiling,
  maxPainStrike,
  nseDate,
  nseDateTime,
  num,
  parseAllIndices,
  parseAnnouncements,
  parseAnnualReports,
  parseBoardMeetings,
  parseFiiDii,
  parseHolidays,
  parseInsiderTrades,
  parseLargeDeals,
  parseOptionChain,
  parseResultFilings,
  parseResultsXbrl,
  parseShareholdingList,
  parseShareholdingXbrl,
  parseUniverseCsv,
  pickResultFilings,
  summarizePromoterActivity,
} from '../scripts/shared/equity/in-parsers.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/equity-in/${name}`, import.meta.url), 'utf8');
const json = (name) => JSON.parse(fixture(name));

describe('primitives', () => {
  it('parses every NSE date shape', () => {
    assert.equal(nseDate('16-JUL-2026 19:24:44'), '2026-07-16');
    assert.equal(nseDate('17-Jul-2026'), '2026-07-17');
    assert.equal(nseDate('2026-06-30'), '2026-06-30');
    assert.equal(nseDate('-'), null);
    assert.equal(nseDateTime('24-Sep-2026 19:24:19'), '2026-09-24T19:24:19+05:30');
  });

  it('parses NSE number strings', () => {
    assert.equal(num('1,234.50'), 1234.5);
    assert.equal(num('-'), null);
    assert.equal(num(''), null);
    assert.equal(num(null), null);
  });
});

describe('parseUniverseCsv', () => {
  it('reads all 50 NIFTY constituents with Yahoo symbols', () => {
    const universe = parseUniverseCsv(fixture('nifty50.csv'));
    assert.equal(universe.length, 50);
    const reliance = universe.find((c) => c.symbol === 'RELIANCE');
    assert.deepEqual(reliance, {
      symbol: 'RELIANCE', yahooSymbol: 'RELIANCE.NS', name: 'Reliance Industries Ltd.', sector: 'Oil Gas & Consumable Fuels', isin: 'INE002A01018',
    });
  });
});

describe('financial results', () => {
  it('reads an integrated filing (in-capmkt taxonomy) in absolute INR', () => {
    const q = parseResultsXbrl(fixture('integrated-xbrl-RELIANCE.xml'));
    assert.equal(q.periodEnd, '2026-06-30');
    assert.equal(q.consolidated, true);
    assert.equal(q.audited, false);
    assert.equal(q.revenue, 3_118_500_000_000); // ₹3,11,850 cr
    assert.equal(q.pat, 231_960_000_000); // ₹23,196 cr
    assert.equal(q.patOwners, 209_460_000_000);
    assert.equal(q.eps, 15.48);
    assert.equal(q.ebitda, q.pbt + q.financeCosts + q.depreciation);
  });

  it('reads a legacy filing (in-bse-fin taxonomy) with the same field names', () => {
    const q = parseResultsXbrl(fixture('results-xbrl-RELIANCE.xml'));
    assert.equal(q.periodEnd, '2024-12-31');
    assert.equal(q.consolidated, true);
    assert.equal(q.revenue, 2_438_650_000_000);
    assert.equal(q.eps, 13.7);
  });

  it('merges both filing lists and keeps one filing per quarter and basis', () => {
    const filings = parseResultFilings(json('integrated-filing-list-RELIANCE.json'), json('financial-results-list-RELIANCE.json'));
    const consolidated = pickResultFilings(filings, { consolidated: true, limit: 12 });
    assert.equal(consolidated.length, 12);
    assert.equal(consolidated[0].periodEnd, '2026-06-30');
    assert.equal(new Set(consolidated.map((f) => f.periodEnd)).size, 12);
    assert.ok(consolidated.every((f) => f.consolidated && f.xbrlUrl.startsWith('https://nsearchives.nseindia.com/')));
    assert.ok(consolidated.slice(0, 6).every((f) => f.id.startsWith('IF-')), 'integrated filings cover 2025+');
  });

  it('lets a revision replace the original filing for the same quarter', () => {
    const filings = [
      { id: 'b', periodEnd: '2026-06-30', consolidated: true, filedAt: '2026-08-01', xbrlUrl: 'x' },
      { id: 'a', periodEnd: '2026-06-30', consolidated: true, filedAt: '2026-07-17', xbrlUrl: 'x' },
    ];
    assert.deepEqual(pickResultFilings(filings, { consolidated: true }).map((f) => f.id), ['b']);
  });
});

describe('shareholding', () => {
  it('lists quarters newest first with promoter/public split', () => {
    const list = parseShareholdingList(json('shareholding-RELIANCE.json'));
    assert.equal(list[0].date, '2026-06-30');
    assert.equal(list[0].promoterPct, 50.48);
    assert.equal(list[0].publicPct, 49.52);
    assert.match(list[0].xbrlUrl, /SHP_.*\.xml$/);
  });

  it('reads the category split from the shareholding XBRL as percentages', () => {
    const shp = parseShareholdingXbrl(fixture('shp-xbrl-RELIANCE.xml'));
    assert.equal(shp.date, '2026-06-30');
    assert.equal(shp.promoterPct, 50.48);
    assert.equal(shp.fiiPct, 17.2);
    assert.equal(shp.diiPct, 21.19);
    assert.equal(shp.mutualFundPct, 10.11);
    assert.equal(shp.promoterSharesPledged, false);
    assert.equal(shp.totalShares, 13_532_538_722);
  });
});

describe('insider trades', () => {
  it('normalizes PIT disclosures', () => {
    const trades = parseInsiderTrades(json('pit-RELIANCE.json'));
    assert.equal(trades.length, 20);
    assert.ok(trades.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date)));
    const first = trades[0];
    assert.equal(first.type, 'Sell');
    assert.equal(first.quantity, 2320);
    assert.equal(first.holdingAfter, 1600);
  });

  it('counts only promoter market trades toward net buying', () => {
    const trades = [
      { date: '2026-05-01', category: 'Promoter Group', mode: 'Market Purchase', type: 'Buy', value: 100 },
      { date: '2026-05-02', category: 'Promoter', mode: 'Market Sale', type: 'Sell', value: 30 },
      { date: '2026-05-03', category: 'Promoter', mode: 'Gift', type: 'Sell', value: 999 },
      { date: '2026-05-04', category: 'Immediate relative', mode: 'Market Sale', type: 'Sell', value: 999 },
      { date: '2025-01-01', category: 'Promoter', mode: 'Market Sale', type: 'Sell', value: 999 },
    ];
    assert.deepEqual(summarizePromoterActivity(trades, { sinceDate: '2026-01-01' }), { bought: 100, sold: 30, net: 70 });
  });
});

describe('filings', () => {
  it('parses announcements newest first with a category', () => {
    const list = parseAnnouncements(json('announcements-RELIANCE.json'));
    assert.equal(list.length, 25);
    assert.equal(list[0].at, '2026-09-24T19:24:19+05:30');
    assert.ok(list.some((a) => a.category === 'concall'));
    assert.ok(list.every((a) => a.text.length <= 400));
  });

  it('categorizes filing subjects', () => {
    assert.equal(categorizeFiling('Analysts/Institutional Investor Meet/Con. Call Updates'), 'concall');
    assert.equal(categorizeFiling('Credit Rating'), 'rating');
    assert.equal(categorizeFiling('Outcome of Board Meeting'), 'board-meeting');
    assert.equal(categorizeFiling('Updates'), 'other');
  });

  it('dedupes board meetings and flags results meetings', () => {
    const meetings = parseBoardMeetings(json('board-meetings-RELIANCE.json'));
    assert.equal(meetings[0].date, '2026-07-17');
    assert.ok(meetings[0].forResults);
    assert.ok(meetings.every((m) => m.purpose.length <= 60));
    const keys = meetings.map((m) => `${m.date}|${m.purpose}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('lists annual reports newest year first', () => {
    const reports = parseAnnualReports(json('annual-reports-RELIANCE.json'));
    assert.equal(reports[0].toYear, 2026);
    assert.match(reports[0].url, /^https:\/\/nsearchives\.nseindia\.com\/annual_reports\//);
  });
});

describe('market-wide', () => {
  it('parses FII/DII flows in ₹ crore', () => {
    assert.deepEqual(parseFiiDii(json('fiidii.json')), {
      date: '2026-09-24',
      fii: { buy: 13111.22, sell: 18138.58, net: -5027.36 },
      dii: { buy: 18196.9, sell: 13895.72, net: 4301.18 },
    });
  });

  it('parses bulk/block/short deals with a computed value', () => {
    const deals = parseLargeDeals(json('largedeal.json'));
    assert.equal(deals.asOf, '2026-09-24');
    assert.ok(deals.bulk.length > 0 && deals.block.length > 0);
    const d = deals.block[0];
    assert.equal(d.value, Math.round(d.quantity * d.price));
    assert.ok(['BUY', 'SELL'].includes(d.side));
  });

  it('parses all indices with breadth', () => {
    const idx = parseAllIndices(json('all-indices.json'));
    const nifty = idx.indices.find((i) => i.name === 'NIFTY 50');
    assert.equal(nifty.last, 23063.1);
    assert.equal(nifty.changePct, -1.64);
    assert.equal(nifty.pe, 19.5);
    assert.ok(idx.advances > 0 && idx.declines > 0);
  });

  it('parses the trading-holiday calendar', () => {
    const days = parseHolidays(json('holidays.json'));
    assert.ok(days.includes('2026-01-26'));
    assert.deepEqual(days, [...days].sort());
  });
});

describe('options', () => {
  it('parses one expiry of the NIFTY chain', () => {
    const chain = parseOptionChain(json('option-chain-NIFTY.json'));
    assert.equal(chain.underlying, 'NIFTY');
    assert.equal(chain.expiry, '2026-09-29');
    assert.equal(chain.rows.length, 20);
    assert.deepEqual(chain.rows.map((r) => r.strike), [...chain.rows.map((r) => r.strike)].sort((a, b) => a - b));
    assert.ok(chain.putCallRatio > 0);
  });

  it('finds the max-pain strike', () => {
    const rows = [
      { strike: 100, call: { openInterest: 0 }, put: { openInterest: 500 } },
      { strike: 110, call: { openInterest: 100 }, put: { openInterest: 100 } },
      { strike: 120, call: { openInterest: 500 }, put: { openInterest: 0 } },
    ];
    assert.equal(maxPainStrike(rows), 110);
  });
});

describe('results layouts for banks and insurers', () => {
  it('reads the banking layout: interest earned as top line, NII and pre-provision profit', () => {
    const q = parseResultsXbrl(fixture('integrated-xbrl-HDFCBANK.xml'));
    assert.equal(q.format, 'bank');
    assert.equal(q.periodEnd, '2026-06-30');
    assert.equal(q.revenue, 905_753_300_000);
    assert.equal(q.netInterestIncome, 905_753_300_000 - 476_256_300_000);
    assert.equal(q.operatingProfit, 309_960_000_000);
    assert.equal(q.pat, 203_826_900_000);
    assert.equal(q.patOwners, 192_447_100_000);
    assert.equal(q.eps, 12.5);
    assert.equal(q.ebitda, null);
  });

  it('reads the life-insurance layout: net premium as top line', () => {
    const q = parseResultsXbrl(fixture('integrated-xbrl-SBILIFE.xml'));
    assert.equal(q.format, 'life-insurer');
    assert.equal(q.consolidated, false);
    assert.equal(q.revenue, 200_782_091_000);
    assert.equal(q.grossPremium, 212_896_552_000);
    assert.equal(q.pat, 7_249_331_000);
    assert.equal(q.eps, 7.22);
  });

  it('keeps the standard layout for everyone else', () => {
    assert.equal(parseResultsXbrl(fixture('integrated-xbrl-RELIANCE.xml')).format, 'standard');
  });
});
