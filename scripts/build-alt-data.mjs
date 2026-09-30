#!/usr/bin/env node
// Builds the slim static datasets behind the Congress Trading, POTUS and Mining panels:
//   public/data/congress.json  <- kadoa-org/congress-trading-monitor (MIT)
//   public/data/potus.json     <- CNN's Truth Social archive (ix.cnn.io)
//   public/data/mining.json    <- kadoa-org/world-mining-monitor (MIT)
// Usage: node scripts/build-alt-data.mjs [congress|potus|mining ...]   (default: all)
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const CONGRESS_RAW = 'https://raw.githubusercontent.com/kadoa-org/congress-trading-monitor/main/public/data/';
const MINING_RAW = 'https://raw.githubusercontent.com/kadoa-org/world-mining-monitor/main/public/data/';
const TRUTH_URL = 'https://ix.cnn.io/data/truth-social/truth_archive.json';

async function get(url, type = 'json') {
  const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
  return type === 'json' ? resp.json() : Buffer.from(await resp.arrayBuffer());
}

const write = (name, data) => {
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), ...data });
  return writeFile(fileURLToPath(new URL(`../public/data/${name}.json`, import.meta.url)), body)
    .then(() => console.log(`wrote ${name}.json (${body.length} bytes)`));
};

async function congress() {
  const [stats, filers, tickers, trades] = await Promise.all(
    ['stats', 'filers', 'tickers', 'trades'].map((n) => get(`${CONGRESS_RAW}${n}.json`)),
  );
  await write('congress', {
    source: 'https://github.com/kadoa-org/congress-trading-monitor',
    stats: {
      totalTrades: stats.totalTrades,
      totalFilers: stats.totalFilers,
      lateFilings: stats.lateFilings,
      estVolumeUsd: stats.estVolumeUsd,
      from: stats.dateRange.from,
      to: stats.dateRange.to,
      medianDaysToFile: stats.disclosureLag?.medianDaysToFile,
    },
    topFilers: filers
      .filter((f) => f.trade_count)
      .sort((a, b) => b.trade_count - a.trade_count)
      .slice(0, 15)
      .map((f) => ({ name: f.full_name, branch: f.branch, party: f.party, trades: f.trade_count, late: f.late_filings, volume: f.est_volume })),
    topTickers: tickers.slice(0, 15).map((t) => ({ ticker: t.ticker, trades: t.trade_count, filers: t.filer_count, buys: t.purchases, sells: t.sales, volume: t.est_volume })),
    latest: trades
      .filter((t) => t.ticker)
      .sort((a, b) => (b.filing_date || '').localeCompare(a.filing_date || '') || (b.transaction_date || '').localeCompare(a.transaction_date || ''))
      .slice(0, 60)
      .map((t) => ({ filer: t.filer_name, branch: t.branch, party: t.party, ticker: t.ticker, type: t.transaction_type, amount: t.amount_range_label, txDate: t.transaction_date, filed: t.filing_date, late: !!t.is_late, url: t.doc_url })),
  });
}

async function potus() {
  const posts = await get(TRUTH_URL);
  const byDay = {};
  for (const p of posts) {
    const day = p.created_at.slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
  }
  const days = Object.keys(byDay).sort().slice(-14);
  await write('potus', {
    source: TRUTH_URL,
    totalPosts: posts.length,
    perDay: days.map((d) => ({ day: d, posts: byDay[d] })),
    latest: [...posts]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 40)
      .map((p) => ({ at: p.created_at, text: p.content, url: p.url, replies: p.replies_count, reblogs: p.reblogs_count, likes: p.favourites_count })),
  });
}

const qKey = (q) => { const [a, b] = q.split(' '); return Number(b) * 10 + Number(a.slice(1)); };
// Consolidated is the headline basis; the rest only fill gaps so one mine never counts twice.
const BASIS_RANK = ['consolidated', 'contained', 'payable', 'attributable', 'equity'];

async function mining() {
  const dir = await mkdtemp(join(tmpdir(), 'mining-'));
  const file = join(dir, 'mining.db');
  await writeFile(file, await get(`${MINING_RAW}mining.db`, 'buffer'));
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare(`
    SELECT p.mine_id, m.name AS mine, p.company, m.country, p.commodity, p.value_normalized AS value,
           p.unit_normalized AS unit, p.calendar_period AS period, p.basis, p.source_url
    FROM production p JOIN mines m ON m.id = p.mine_id
    WHERE p.metric = 'production' AND p.period_type = 'quarterly'
      AND p.unit_normalized IN ('kt', 'koz') AND p.value_normalized IS NOT NULL
      AND p.calendar_period LIKE 'Q_ 20__'`).all();

  const best = new Map(); // one row per mine+commodity: latest period, best basis
  for (const r of rows) {
    const k = `${r.mine_id}|${r.commodity}`;
    const cur = best.get(k);
    const rank = (x) => [qKey(x.period), -(BASIS_RANK.indexOf(x.basis) + 1 || 99)];
    const [a1, a2] = rank(r); const [b1, b2] = cur ? rank(cur) : [-1, -1];
    if (!cur || a1 > b1 || (a1 === b1 && a2 > b2)) best.set(k, r);
  }
  const byCommodity = {};
  for (const r of best.values()) (byCommodity[r.commodity] ||= []).push(r);
  const commodities = Object.entries(byCommodity)
    .map(([commodity, list]) => ({
      commodity,
      unit: list[0].unit,
      mines: list.length,
      top: list.sort((a, b) => b.value - a.value).slice(0, 8)
        .map((r) => ({ mine: r.mine, company: r.company, country: r.country, value: r.value, period: r.period, url: r.source_url })),
    }))
    .filter((c) => c.mines >= 3)
    .sort((a, b) => b.mines - a.mines);

  const count = (sql) => db.prepare(sql).get().n;
  await write('mining', {
    source: 'https://github.com/kadoa-org/world-mining-monitor',
    stats: {
      records: count('SELECT COUNT(*) n FROM production'),
      companies: count('SELECT COUNT(DISTINCT company) n FROM production'),
      mines: count('SELECT COUNT(*) n FROM mines'),
    },
    commodities,
  });
  db.close();
}

const jobs = { congress, potus, mining };
const wanted = process.argv.slice(2);
for (const name of wanted.length ? wanted : Object.keys(jobs)) {
  if (!jobs[name]) throw new Error(`unknown dataset "${name}"`);
  await jobs[name]();
}
