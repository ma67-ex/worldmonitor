// @ts-check
/**
 * India (NSE) adapter for the equity terminal.
 *
 * Each `fetch*` takes the shared NSE session, one universe company and that
 * company's previous detail (for incremental work: XBRL filings already parsed
 * are never downloaded again), and returns `{ detail, summary }` or null.
 */
import { createNseSession } from '../nse-client.mjs';
import {
  parseAnnouncements,
  parseAnnualReports,
  parseBoardMeetings,
  parseInsiderTrades,
  parseResultFilings,
  parseResultsXbrl,
  parseShareholdingList,
  parseShareholdingXbrl,
  pickResultFilings,
  summarizePromoterActivity,
} from '../in-parsers.mjs';
import { ebitdaMarginPct, isSingleQuarter, trailingTwelveMonths, yearOverYear } from '../metrics.mjs';

export const country = 'IN';
export const currency = 'INR';
export const exchange = 'NSE';

export const createContext = () => ({ nse: createNseSession() });

const enc = encodeURIComponent;
const ddmmyyyy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
const daysAgo = (n, from = new Date()) => new Date(from.getTime() - n * 86_400_000);
const isoDay = (d) => d.toISOString().slice(0, 10);

// ─── Shareholding ───────────────────────────────────────────────────────────

const SHAREHOLDING_QUARTERS = 12;
const SHAREHOLDING_SPLIT_QUARTERS = 8;
const SHAREHOLDING_XBRL_PER_RUN = 1;
const isQuarterEnd = (date) => /-(03-31|06-30|09-30|12-31)$/.test(date ?? '');

export async function fetchShareholding({ nse }, company, previous) {
  const res = await nse.getJson(`api/corporate-share-holdings-master?index=equities&symbol=${enc(company.symbol)}`);
  if (!res.ok) throw new Error(`shareholding list ${res.status}`);
  const quarters = parseShareholdingList(res.data).slice(0, SHAREHOLDING_QUARTERS);
  if (quarters.length === 0) return null;

  // Category splits live in a ~500 KB XBRL per quarter; keep them across runs,
  // keyed by filing id so a revised filing replaces the original.
  /** @type {Record<string, any>} */
  const splits = {};
  for (const q of previous?.quarters ?? []) if (q.split && q.id) splits[q.id] = q.split;
  let fetched = 0;
  for (const q of quarters.slice(0, SHAREHOLDING_SPLIT_QUARTERS)) {
    if (splits[q.id] || !q.xbrlUrl || fetched >= SHAREHOLDING_XBRL_PER_RUN) continue;
    fetched += 1;
    const x = await nse.getText(q.xbrlUrl);
    const split = x.ok ? parseShareholdingXbrl(x.data) : null;
    if (split) splits[q.id] = split;
  }

  const detailQuarters = quarters.map(({ xbrlUrl: _x, ...q }, i) => ({
    ...q,
    split: i < SHAREHOLDING_SPLIT_QUARTERS ? splits[q.id] ?? null : null,
  }));
  const latest = detailQuarters[0];
  const s = latest.split ?? {};
  // Companies also file ad-hoc patterns (e.g. after an allotment); quarter-on-quarter
  // changes compare the two latest quarter-end filings only.
  const quarterEnds = detailQuarters.filter((q) => isQuarterEnd(q.date));
  const [qNow, qPrev] = quarterEnds;
  const change = (field) => (qNow?.split?.[field] != null && qPrev?.split?.[field] != null
    ? Math.round((qNow.split[field] - qPrev.split[field]) * 100) / 100
    : null);
  return {
    detail: { quarters: detailQuarters, source: 'NSE shareholding pattern (SEBI LODR Reg. 31)' },
    summary: {
      date: latest.date,
      promoterPct: latest.promoterPct,
      publicPct: latest.publicPct,
      fiiPct: s.fiiPct ?? null,
      diiPct: s.diiPct ?? null,
      mutualFundPct: s.mutualFundPct ?? null,
      retailPct: s.retailSmallPct != null && s.retailLargePct != null ? Math.round((s.retailSmallPct + s.retailLargePct) * 100) / 100 : null,
      promoterSharesPledged: s.promoterSharesPledged ?? null,
      asOfQuarterEnd: isQuarterEnd(latest.date),
      changeBasis: qNow && qPrev ? { from: qPrev.date, to: qNow.date } : null,
      promoterChangePp: qNow?.promoterPct != null && qPrev?.promoterPct != null ? Math.round((qNow.promoterPct - qPrev.promoterPct) * 100) / 100 : null,
      fiiChangePp: change('fiiPct'),
      diiChangePp: change('diiPct'),
    },
  };
}

// ─── Financial results ──────────────────────────────────────────────────────

const RESULT_QUARTERS = 12;
const RESULT_XBRL_PER_RUN = 3;
// Bump when parseResultsXbrl changes what it extracts: cached quarters from an
// older parser are re-downloaded and re-parsed instead of being kept forever.
export const RESULTS_PARSER_VERSION = 2;

export async function fetchFinancials({ nse }, company, previous) {
  const sym = enc(company.symbol);
  const integrated = await nse.getJson(`api/integrated-filing-results?index=equities&symbol=${sym}&period_ended=all&type=Integrated%20Filing-%20Financials`);
  if (!integrated.ok) throw new Error(`integrated filings ${integrated.status}`);
  // Pre-2025 results sit in the legacy list, which no longer changes: read it
  // only while history is still short.
  let legacy = null;
  const reusable = (previous?.quarters ?? []).filter((q) => q.parserVersion === RESULTS_PARSER_VERSION);
  if (reusable.length < RESULT_QUARTERS) {
    const l = await nse.getJson(`api/corporates-financial-results?index=equities&symbol=${sym}&period=Quarterly`);
    if (l.ok) legacy = l.data;
  }
  const filings = parseResultFilings(integrated.data, legacy);
  // Include index entries from the previous run so legacy quarters survive after
  // the legacy list stops being fetched.
  for (const q of reusable) {
    if (q.filingId && !filings.some((f) => f.id === q.filingId)) {
      filings.push({ id: q.filingId, periodEnd: q.periodEnd, consolidated: q.consolidated, filedAt: q.filedAt, xbrlUrl: null });
    }
  }
  const hasConsolidated = filings.some((f) => f.consolidated);
  const basis = hasConsolidated ? 'consolidated' : 'standalone';
  const wanted = pickResultFilings(
    filings.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || String(b.filedAt).localeCompare(String(a.filedAt))),
    { consolidated: hasConsolidated, limit: RESULT_QUARTERS },
  );

  const cached = new Map((previous?.basis === basis ? reusable : []).map((q) => [q.filingId, q]));
  const quarters = [];
  let fetched = 0;
  for (const f of wanted) {
    const hit = cached.get(f.id);
    if (hit) { quarters.push(hit); continue; }
    if (!f.xbrlUrl || fetched >= RESULT_XBRL_PER_RUN) continue;
    fetched += 1;
    const x = await nse.getText(f.xbrlUrl);
    const parsed = x.ok ? parseResultsXbrl(x.data) : null;
    if (parsed) quarters.push({ ...parsed, filingId: f.id, filedAt: f.filedAt, parserVersion: RESULTS_PARSER_VERSION });
  }
  if (quarters.length === 0) return null;
  quarters.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));

  const ttm = trailingTwelveMonths(quarters);
  const yoy = yearOverYear(quarters);
  const latest = quarters.find(isSingleQuarter) ?? quarters[0];
  return {
    detail: { currency, basis, quarters, ttm, yoy, source: 'NSE quarterly results (XBRL)' },
    summary: {
      currency,
      basis,
      format: latest.format ?? 'standard',
      latestPeriod: latest.periodEnd,
      revenue: latest.revenue,
      pat: latest.pat,
      eps: latest.eps,
      ebitdaMarginPct: ebitdaMarginPct(latest),
      ttmRevenue: ttm?.revenue ?? null,
      ttmPat: ttm?.pat ?? null,
      ttmEps: ttm?.eps ?? null,
      revenueYoYPct: yoy?.revenuePct ?? null,
      patYoYPct: yoy?.patPct ?? null,
      quartersAvailable: quarters.length,
    },
  };
}

// ─── Insider trades ─────────────────────────────────────────────────────────

export async function fetchInsider({ nse }, company, _previous, { now = new Date() } = {}) {
  const res = await nse.getJson(`api/corporates-pit?index=equities&symbol=${enc(company.symbol)}`);
  if (!res.ok) throw new Error(`pit ${res.status}`);
  const trades = parseInsiderTrades(res.data).filter((t) => t.date >= isoDay(daysAgo(365, now))).slice(0, 100);
  const since90 = isoDay(daysAgo(90, now));
  const recent = trades.filter((t) => t.date >= since90);
  const promoter = summarizePromoterActivity(trades, { sinceDate: since90 });
  return {
    detail: { trades, source: 'NSE SEBI (PIT) disclosures' },
    summary: {
      lastTradeDate: trades[0]?.date ?? null,
      trades90d: recent.length,
      buys90d: recent.filter((t) => /buy/i.test(t.type ?? '')).length,
      sells90d: recent.filter((t) => /sell/i.test(t.type ?? '')).length,
      pledgeEvents90d: recent.filter((t) => /pledge/i.test(t.type ?? '') || /pledge/i.test(t.mode ?? '')).length,
      promoterNetValue90d: promoter.net,
    },
  };
}

// ─── Filings: announcements, board meetings, annual reports ─────────────────

const ANNOUNCEMENT_DAYS = 90;
const ANNUAL_REPORT_REFRESH_DAYS = 7;

export async function fetchFilings({ nse }, company, previous, { now = new Date() } = {}) {
  const sym = enc(company.symbol);
  const ann = await nse.getJson(`api/corporate-announcements?index=equities&symbol=${sym}&from_date=${ddmmyyyy(daysAgo(ANNOUNCEMENT_DAYS, now))}&to_date=${ddmmyyyy(now)}`);
  if (!ann.ok) throw new Error(`announcements ${ann.status}`);
  const announcements = parseAnnouncements(ann.data).slice(0, 60);

  const bm = await nse.getJson(`api/corporate-board-meetings?index=equities&symbol=${sym}`);
  const boardMeetings = bm.ok ? parseBoardMeetings(bm.data).slice(0, 12) : previous?.boardMeetings ?? [];

  let annualReports = previous?.annualReports ?? [];
  const arAge = previous?.annualReportsCheckedAt ? now.getTime() - Date.parse(previous.annualReportsCheckedAt) : Infinity;
  let annualReportsCheckedAt = previous?.annualReportsCheckedAt ?? null;
  if (arAge > ANNUAL_REPORT_REFRESH_DAYS * 86_400_000) {
    const ar = await nse.getJson(`api/annual-reports?index=equities&symbol=${sym}`);
    if (ar.ok) {
      annualReports = parseAnnualReports(ar.data).slice(0, 10);
      annualReportsCheckedAt = now.toISOString();
    }
  }

  const today = isoDay(now);
  const nextMeeting = [...boardMeetings].reverse().find((m) => m.date >= today) ?? null;
  return {
    detail: { announcements, boardMeetings, annualReports, annualReportsCheckedAt, source: 'NSE corporate announcements' },
    summary: {
      latestAnnouncementAt: announcements[0]?.at ?? null,
      latestSubject: announcements[0]?.subject ?? null,
      announcements90d: announcements.length,
      nextBoardMeeting: nextMeeting ? { date: nextMeeting.date, purpose: nextMeeting.purpose, forResults: nextMeeting.forResults } : null,
      latestAnnualReport: annualReports[0] ? { toYear: annualReports[0].toYear, url: annualReports[0].url } : null,
    },
  };
}
