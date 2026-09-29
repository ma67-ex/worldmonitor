#!/usr/bin/env node

import { loadEnvFile, CHROME_UA, runSeed, sleep } from './_seed-utils.mjs';
import { unwrapEnvelope } from './_seed-envelope-source.mjs';
import { fetchYahooJson } from './_yahoo-fetch.mjs';
loadEnvFile(import.meta.url);

const BREADTH_KEY = 'market:breadth-history:v1';
const BREADTH_TTL = 2592000; // 30 days
const HISTORY_LENGTH = 252; // trading days (~1 year)

// Barchart's $S5TW/$S5FI/$S5TH breadth symbols went behind an AWS WAF
// JavaScript challenge (confirmed live: the response is a challenge.js page,
// not the quote page, from every egress tried — not an IP block, so a proxy
// doesn't fix it). Compute the same three readings ourselves instead: pull
// the live S&P 500 constituent list from Wikipedia (public, unauthenticated)
// and, for each, fetch a year of daily closes via this repo's existing
// fetchYahooJson helper (already handles Yahoo's rate limiting + proxy
// fallback — see scripts/_yahoo-fetch.mjs) to compute whether the latest
// close sits above its own 20/50/200-day SMA. This runs via its own
// dedicated GitHub Actions workflow (seed-market-breadth.yml), not
// seed-all.yml's shard loop: ~500 staggered Yahoo calls takes several
// minutes, far past that workflow's 90s-per-script budget, and the 30-day
// TTL here means once/day is plenty anyway.
const SP500_LIST_URL = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';
const SMA_WINDOWS = { pctAbove20d: 20, pctAbove50d: 50, pctAbove200d: 200 };
// Yahoo throttles aggressively on high-volume egress (see _yahoo-fetch.mjs
// header) — 300ms is above this codebase's general 150ms staggering
// convention (AGENTS.md) because this script alone issues ~500 requests in
// one run, an order of magnitude more than any existing Yahoo caller.
const YAHOO_STAGGER_MS = 300;
// Below this fraction of constituents, the aggregate percentage is not
// trustworthy enough to publish — better to leave the last-good reading in
// place (runSeed's existing last-good preservation) than ship a skewed one.
const MIN_SUCCESS_FRACTION = 0.5;

async function fetchSp500Symbols() {
  const resp = await fetch(SP500_LIST_URL, {
    headers: { 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Wikipedia S&P 500 list HTTP ${resp.status}`);
  const html = await resp.text();
  const tableStart = html.indexOf('id="constituents"');
  if (tableStart === -1) throw new Error('Wikipedia S&P 500 constituents table not found (page structure changed?)');
  const tableEnd = html.indexOf('</table>', tableStart);
  const tableHtml = html.slice(tableStart, tableEnd === -1 ? undefined : tableEnd);
  const rowRe = /<tr[^>]*>\s*<td[^>]*><a[^>]*>([A-Z.-]+)<\/a><\/td>/g;
  const symbols = [];
  let m;
  while ((m = rowRe.exec(tableHtml))) {
    // Yahoo uses '-' where Wikipedia lists '.' for dual-class tickers (BRK.B -> BRK-B).
    symbols.push(m[1].replace(/\./g, '-'));
  }
  if (symbols.length < 400) {
    throw new Error(`Only parsed ${symbols.length} S&P 500 symbols (expected ~500) — Wikipedia page structure likely changed`);
  }
  return symbols;
}

function computeSma(closes, window) {
  if (closes.length < window) return null;
  const slice = closes.slice(-window);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

async function fetchSymbolAboveSma(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
    // maxRetries=1 (not the helper's default 3): with ~500 symbols in one
    // run, a slow/broken single symbol retrying 3x with exponential backoff
    // costs minutes on its own. One retry is enough to absorb a transient
    // blip; a genuinely down symbol just drops out of the aggregate, which
    // MIN_SUCCESS_FRACTION guards against doing too much of.
    const chart = await fetchYahooJson(url, { label: symbol, maxRetries: 1, retryBaseMs: 2_000 });
    const closes = (chart?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter((v) => v != null);
    if (closes.length < 20) return null;
    const lastClose = closes[closes.length - 1];
    const above = {};
    for (const [field, window] of Object.entries(SMA_WINDOWS)) {
      const sma = computeSma(closes, window);
      above[field] = sma != null ? lastClose > sma : null;
    }
    return above;
  } catch {
    return null;
  }
}

async function readExistingHistory() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const resp = await fetch(`${url}/get/${encodeURIComponent(BREADTH_KEY)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return null;
    const { result } = await resp.json();
    return result ? unwrapEnvelope(JSON.parse(result)).data : null;
  } catch {
    return null;
  }
}

async function fetchAll() {
  const symbols = await fetchSp500Symbols();
  console.log(`  S&P 500 constituents: ${symbols.length} symbols`);

  // [aboveCount, validCount] per field — validCount can differ from
  // fetchedCount when a symbol has enough closes for a 20d SMA but not a
  // full 200d one (recent IPOs, spin-offs).
  const counts = { pctAbove20d: [0, 0], pctAbove50d: [0, 0], pctAbove200d: [0, 0] };
  let fetchedCount = 0;

  for (const symbol of symbols) {
    const above = await fetchSymbolAboveSma(symbol);
    if (above) {
      fetchedCount++;
      for (const field of Object.keys(SMA_WINDOWS)) {
        if (above[field] != null) {
          counts[field][1]++;
          if (above[field]) counts[field][0]++;
        }
      }
    }
    await sleep(YAHOO_STAGGER_MS);
  }

  console.log(`  Fetched ${fetchedCount}/${symbols.length} symbols`);
  if (fetchedCount < symbols.length * MIN_SUCCESS_FRACTION) {
    throw new Error(`Only fetched ${fetchedCount}/${symbols.length} symbols (below ${MIN_SUCCESS_FRACTION * 100}% threshold) — aborting rather than publish a skewed reading`);
  }

  const readings = {};
  for (const field of Object.keys(SMA_WINDOWS)) {
    const [above, valid] = counts[field];
    readings[field] = valid > 0 ? Math.round((above / valid) * 1000) / 10 : null;
  }
  console.log(`    20d=${readings.pctAbove20d ?? 'null'}% | 50d=${readings.pctAbove50d ?? 'null'}% | 200d=${readings.pctAbove200d ?? 'null'}%`);

  const existing = await readExistingHistory();
  const history = existing?.history ?? [];
  // ET trading day: Railway cron fires at 9 PM ET which is 01:00-02:00 UTC on
  // the NEXT calendar day, so UTC date would stamp today's session with
  // tomorrow's date. en-CA locale returns ISO YYYY-MM-DD; America/New_York
  // handles DST automatically.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

  const lastEntry = history.at(-1);
  if (lastEntry?.date === today) {
    lastEntry.pctAbove20d = readings.pctAbove20d ?? lastEntry.pctAbove20d;
    lastEntry.pctAbove50d = readings.pctAbove50d ?? lastEntry.pctAbove50d;
    lastEntry.pctAbove200d = readings.pctAbove200d ?? lastEntry.pctAbove200d;
    console.log(`  Updated existing entry for ${today}`);
  } else {
    history.push({
      date: today,
      pctAbove20d: readings.pctAbove20d,
      pctAbove50d: readings.pctAbove50d,
      pctAbove200d: readings.pctAbove200d,
    });
    console.log(`  Appended new entry for ${today} (history: ${history.length} days)`);
  }

  while (history.length > HISTORY_LENGTH) history.shift();

  return {
    updatedAt: new Date().toISOString(),
    current: {
      pctAbove20d: readings.pctAbove20d,
      pctAbove50d: readings.pctAbove50d,
      pctAbove200d: readings.pctAbove200d,
    },
    history,
  };
}

function validate(data) {
  return (
    data?.current != null &&
    Array.isArray(data?.history) &&
    data.history.length > 0
  );
}

export function declareRecords(data) {
  return Array.isArray(data?.history) ? data.history.length : 0;
}

runSeed('market', 'breadth-history', BREADTH_KEY, fetchAll, {
  validateFn: validate,
  ttlSeconds: BREADTH_TTL,

  declareRecords,
  schemaVersion: 1,
  maxStaleMin: 2880,
  sourceVersion: 'market-breadth-v1',
}).catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
