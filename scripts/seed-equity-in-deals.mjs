#!/usr/bin/env node
// NSE bulk, block and short deals: the latest session in full, plus 90 days of
// deals in NIFTY 50 companies for their company pages.
import { loadEnvFile, readSeedSnapshot, runSeed } from './_seed-utils.mjs';
import { parseLargeDeals } from './shared/equity/in-parsers.mjs';
import { createNseSession } from './shared/equity/nse-client.mjs';
import { equityKey, loadUniverse } from './shared/equity/registry.mjs';
import { mergeDealHistory } from './shared/equity/market.mjs';

loadEnvFile(import.meta.url);

const KEY = equityKey('deals', 'IN');

async function fetchAll() {
  const res = await createNseSession().getJson('api/snapshot-capital-market-largedeal');
  if (!res.ok) throw new Error(`largedeal ${res.status}`);
  const latest = parseLargeDeals(res.data);
  if (!latest.asOf) throw new Error('largedeal response has no as_on_date');
  const members = new Set(loadUniverse('IN').map((c) => c.symbol));
  const previous = await readSeedSnapshot(KEY);
  return mergeDealHistory(previous, latest, { members, keepDays: 90 });
}

runSeed('equity', 'deals-in', KEY, fetchAll, {
  ttlSeconds: 14 * 86_400,
  validateFn: (d) => Boolean(d?.latest?.asOf),
  declareRecords: (d) => (d?.latest?.bulk?.length ?? 0) + (d?.latest?.block?.length ?? 0) + (d?.latest?.short?.length ?? 0),
  zeroIsValid: true,
  sourceVersion: 'nse-largedeal-v1',
  schemaVersion: 1,
  maxStaleMin: 2880,
}).catch((err) => { console.error('FATAL:', err.message || err); process.exit(1); });
