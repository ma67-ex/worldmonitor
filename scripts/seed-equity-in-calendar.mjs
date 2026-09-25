#!/usr/bin/env node
// Upcoming NSE board meetings for the next 30 days (results, dividends, fund raising).
import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { parseBoardMeetings } from './shared/equity/in-parsers.mjs';
import { createNseSession } from './shared/equity/nse-client.mjs';
import { equityKey, loadUniverse } from './shared/equity/registry.mjs';

loadEnvFile(import.meta.url);

const DAYS_AHEAD = 30;
const fmt = (d) => `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;

async function fetchAll() {
  const from = new Date();
  const to = new Date(from.getTime() + DAYS_AHEAD * 86_400_000);
  const res = await createNseSession().getJson(`api/corporate-board-meetings?index=equities&from_date=${fmt(from)}&to_date=${fmt(to)}`);
  if (!res.ok) throw new Error(`board meetings ${res.status}`);
  const members = new Set(loadUniverse('IN').map((c) => c.symbol));
  const bySymbol = new Map();
  for (const row of Array.isArray(res.data) ? res.data : []) {
    const [meeting] = parseBoardMeetings([row]);
    if (!meeting) continue;
    const symbol = String(row.bm_symbol ?? '').trim();
    const key = `${symbol}|${meeting.date}`;
    const prev = bySymbol.get(key);
    // One row per company and date; keep the most specific purpose.
    if (!prev || (meeting.purpose !== 'Board Meeting Intimation' && prev.purpose === 'Board Meeting Intimation')) {
      bySymbol.set(key, { symbol, name: String(row.sm_name ?? '').trim(), inUniverse: members.has(symbol), ...meeting });
    }
  }
  const meetings = [...bySymbol.values()].sort((a, b) => a.date.localeCompare(b.date) || Number(b.inUniverse) - Number(a.inUniverse));
  return { country: 'IN', from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), meetings };
}

runSeed('equity', 'calendar-in', equityKey('calendar', 'IN'), fetchAll, {
  ttlSeconds: 3 * 86_400,
  validateFn: (d) => Array.isArray(d?.meetings),
  declareRecords: (d) => d?.meetings?.length ?? 0,
  zeroIsValid: true,
  sourceVersion: 'nse-board-meetings-v1',
  schemaVersion: 1,
  maxStaleMin: 1440,
}).catch((err) => { console.error('FATAL:', err.message || err); process.exit(1); });
