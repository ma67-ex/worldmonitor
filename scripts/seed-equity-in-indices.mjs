#!/usr/bin/env node
// Every NSE index (NIFTY 50, sectoral, INDIA VIX…) with breadth, P/E, P/B and yield.
import { loadEnvFile, runSeed } from './_seed-utils.mjs';
import { parseAllIndices } from './shared/equity/in-parsers.mjs';
import { createNseSession } from './shared/equity/nse-client.mjs';
import { equityKey } from './shared/equity/registry.mjs';

loadEnvFile(import.meta.url);

async function fetchAll() {
  const res = await createNseSession().getJson('api/allIndices');
  if (!res.ok) throw new Error(`allIndices ${res.status}`);
  return { country: 'IN', ...parseAllIndices(res.data) };
}

runSeed('equity', 'indices-in', equityKey('indices', 'IN'), fetchAll, {
  ttlSeconds: 3 * 86_400,
  validateFn: (d) => (d?.indices?.length ?? 0) > 10,
  declareRecords: (d) => d?.indices?.length ?? 0,
  sourceVersion: 'nse-allindices-v1',
  schemaVersion: 1,
  maxStaleMin: 720,
}).catch((err) => { console.error('FATAL:', err.message || err); process.exit(1); });
