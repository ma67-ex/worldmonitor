/**
 * India adapter end-to-end over recorded fixtures: a fake NSE session answers
 * each endpoint from tests/fixtures/equity-in/, so the incremental caching
 * (XBRL fetched once per filing) is checked without the network.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { fetchFilings, fetchFinancials, fetchInsider, fetchShareholding } from '../scripts/shared/equity/adapters/in.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/equity-in/${name}`, import.meta.url), 'utf8');
const RELIANCE = { symbol: 'RELIANCE', yahooSymbol: 'RELIANCE.NS', name: 'Reliance Industries Ltd.' };

function fakeNse({ xbrl = fixture('integrated-xbrl-RELIANCE.xml') } = {}) {
  const log = [];
  const routes = [
    [/corporate-share-holdings-master/, () => JSON.parse(fixture('shareholding-RELIANCE.json'))],
    [/integrated-filing-results/, () => JSON.parse(fixture('integrated-filing-list-RELIANCE.json'))],
    [/corporates-financial-results/, () => JSON.parse(fixture('financial-results-list-RELIANCE.json'))],
    [/corporates-pit/, () => JSON.parse(fixture('pit-RELIANCE.json'))],
    [/corporate-announcements/, () => JSON.parse(fixture('announcements-RELIANCE.json'))],
    [/corporate-board-meetings/, () => JSON.parse(fixture('board-meetings-RELIANCE.json'))],
    [/annual-reports/, () => JSON.parse(fixture('annual-reports-RELIANCE.json'))],
  ];
  return {
    log,
    nse: {
      getJson: async (path) => {
        log.push(path);
        const hit = routes.find(([re]) => re.test(path));
        return hit ? { ok: true, status: 200, data: hit[1]() } : { ok: false, status: 404 };
      },
      getText: async (url) => {
        log.push(url);
        if (/SHP_/.test(url)) return { ok: true, status: 200, data: fixture('shp-xbrl-RELIANCE.xml') };
        return { ok: true, status: 200, data: xbrl };
      },
    },
  };
}

describe('India adapter', () => {
  it('shareholding: fetches one XBRL split per run and reuses it afterwards', async () => {
    const first = fakeNse();
    const run1 = await fetchShareholding({ nse: first.nse }, RELIANCE, null);
    assert.equal(run1.summary.date, '2026-06-30');
    assert.equal(run1.summary.fiiPct, 17.2);
    assert.equal(run1.summary.promoterPct, 50.48);
    assert.equal(first.log.filter((u) => /SHP_/.test(u)).length, 1);
    assert.ok(run1.detail.quarters.every((q) => !('xbrlUrl' in q)), 'archive URLs stay out of stored detail');

    const second = fakeNse();
    const run2 = await fetchShareholding({ nse: second.nse }, RELIANCE, run1.detail);
    assert.equal(run2.detail.quarters[0].split.fiiPct, 17.2, 'latest split carried over');
    assert.equal(second.log.filter((u) => /SHP_/.test(u)).length, 1, 'next quarter back-filled, latest not refetched');
  });

  it('shareholding: measures changes between quarter-end filings, skipping ad-hoc ones', async () => {
    const list = JSON.parse(fixture('shareholding-RELIANCE.json'));
    const adhoc = { ...list[0], date: '07-JUL-2026', recordId: 'adhoc-1', pr_and_prgrp: '49.00', public_val: '51.00' };
    const nse = {
      getJson: async () => ({ ok: true, status: 200, data: [adhoc, ...list] }),
      getText: async () => ({ ok: false, status: 404 }),
    };
    const res = await fetchShareholding({ nse }, RELIANCE, null);
    assert.equal(res.summary.date, '2026-07-07');
    assert.equal(res.summary.asOfQuarterEnd, false);
    assert.deepEqual(res.summary.changeBasis, { from: '2026-03-31', to: '2026-06-30' });
    assert.equal(res.summary.promoterChangePp, 0.48);
  });

  it('financials: caps XBRL downloads per run and never refetches a parsed filing', async () => {
    const first = fakeNse();
    const run1 = await fetchFinancials({ nse: first.nse }, RELIANCE, null);
    assert.equal(first.log.filter((u) => /xbrl/i.test(u) && u.startsWith('https')).length, 3);
    assert.equal(run1.detail.basis, 'consolidated');
    assert.equal(run1.detail.quarters.length, 3);
    assert.equal(run1.summary.currency, 'INR');

    const second = fakeNse();
    const run2 = await fetchFinancials({ nse: second.nse }, RELIANCE, run1.detail);
    assert.equal(run2.detail.quarters.length, 6);
    const refetched = second.log.filter((u) => run1.detail.quarters.some((q) => q.filingId && u.includes(q.filingId)));
    assert.equal(refetched.length, 0);
  });

  it('insider: keeps the last year and summarizes 90 days', async () => {
    const { nse } = fakeNse();
    const res = await fetchInsider({ nse }, RELIANCE, null, { now: new Date('2026-09-24T12:00:00Z') });
    assert.ok(res.detail.trades.every((t) => t.date >= '2025-09-24'));
    assert.equal(typeof res.summary.trades90d, 'number');
  });

  it('filings: refreshes annual reports weekly, not every run', async () => {
    const now = new Date('2026-09-24T12:00:00Z');
    const first = fakeNse();
    const run1 = await fetchFilings({ nse: first.nse }, RELIANCE, null, { now });
    assert.ok(first.log.some((p) => /annual-reports/.test(p)));
    assert.equal(run1.summary.latestAnnualReport.toYear, 2026);
    assert.match(first.log.find((p) => /corporate-announcements/.test(p)), /from_date=26-06-2026&to_date=24-09-2026/);

    const second = fakeNse();
    await fetchFilings({ nse: second.nse }, RELIANCE, run1.detail, { now: new Date('2026-09-25T12:00:00Z') });
    assert.ok(!second.log.some((p) => /annual-reports/.test(p)));
  });

  it('throws on an upstream failure so the rotation counts it as failed', async () => {
    const nse = { getJson: async () => ({ ok: false, status: 403 }), getText: async () => ({ ok: false, status: 403 }) };
    await assert.rejects(fetchShareholding({ nse }, RELIANCE, null), /403/);
  });
});
