#!/usr/bin/env node
// Rewrites shared/equity-universe/<cc>.json from the exchange's published constituent list.
// Index membership changes a few times a year; run by hand after a rebalance and commit the diff.
import { writeFileSync } from 'node:fs';
import { createNseSession } from './shared/equity/nse-client.mjs';
import { parseUniverseCsv } from './shared/equity/in-parsers.mjs';

const SOURCES = {
  IN: {
    index: 'NIFTY 50',
    url: 'https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv',
    load: async (url) => {
      const res = await createNseSession().getText(url);
      if (!res.ok) throw new Error(`NSE constituent CSV: ${res.status}`);
      return parseUniverseCsv(res.data);
    },
  },
};

const cc = (process.argv[2] || '').toUpperCase();
const source = SOURCES[cc];
if (!source) {
  console.error(`usage: node scripts/refresh-equity-universe.mjs <${Object.keys(SOURCES).join('|')}>`);
  process.exit(1);
}
const companies = await source.load(source.url);
if (companies.length < 10) throw new Error(`only ${companies.length} constituents parsed; refusing to overwrite`);
const out = { country: cc, index: source.index, source: source.url, refreshedAt: new Date().toISOString().slice(0, 10), companies };
writeFileSync(new URL(`../shared/equity-universe/${cc.toLowerCase()}.json`, import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log(`${cc}: ${companies.length} companies written`);
