#!/usr/bin/env node
// FII/DII provisional cash-market flows (₹ crore) with a rolling 120-day history.
import { loadEnvFile, readSeedSnapshot, runSeed } from './_seed-utils.mjs';
import { parseFiiDii } from './shared/equity/in-parsers.mjs';
import { createNseSession } from './shared/equity/nse-client.mjs';
import { equityKey } from './shared/equity/registry.mjs';
import { mergeFlowHistory } from './shared/equity/market.mjs';

loadEnvFile(import.meta.url);

const KEY = equityKey('flows', 'IN');

async function fetchAll() {
  const res = await createNseSession().getJson('api/fiidiiTradeReact');
  if (!res.ok) throw new Error(`fiidii ${res.status}`);
  const today = parseFiiDii(res.data);
  if (!today.date || !today.fii || !today.dii) throw new Error('fiidii response missing FII or DII row');
  const previous = await readSeedSnapshot(KEY);
  return mergeFlowHistory(previous, today, { keepDays: 120 });
}

runSeed('equity', 'flows-in', KEY, fetchAll, {
  ttlSeconds: 14 * 86_400,
  validateFn: (d) => Array.isArray(d?.history) && d.history.length > 0,
  declareRecords: (d) => d?.history?.length ?? 0,
  sourceVersion: 'nse-fiidii-v1',
  schemaVersion: 1,
  maxStaleMin: 2880,
}).catch((err) => { console.error('FATAL:', err.message || err); process.exit(1); });
