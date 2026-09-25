// @ts-check
/**
 * Equity terminal: country adapters, Redis key names, universe loading, and the
 * rotating per-company seeder wrapper.
 *
 * Keys: `equity:<dataset>:v1:<CC>` is a market-wide summary (one row per company),
 * `equity:<dataset>:v1:<CC>:<SYMBOL>` holds one company's full detail.
 */
import { readFileSync } from 'node:fs';

import { readSeedSnapshot, runSeed } from '../../_seed-utils.mjs';

export const equityKey = (dataset, cc, symbol) =>
  symbol ? `equity:${dataset}:v1:${cc}:${symbol}` : `equity:${dataset}:v1:${cc}`;

/** @param {string} cc ISO country code, e.g. 'IN' */
export function loadUniverse(cc) {
  const file = new URL(`../../../shared/equity-universe/${cc.toLowerCase()}.json`, import.meta.url);
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed.companies) || parsed.companies.length === 0) {
    throw new Error(`equity universe ${cc} is empty`);
  }
  return parsed.companies;
}

/**
 * Rotate through `companies` starting at `cursor`, stopping at the deadline.
 * Exported for tests; the seeder wrapper below is the only production caller.
 *
 * @template T
 * @param {{ companies: any[], cursor: number, deadline: number, now?: () => number,
 *           work: (company: any) => Promise<T | null> }} args
 */
export async function rotateCompanies({ companies, cursor, deadline, now = Date.now, work }) {
  /** @type {Map<string, T>} */
  const results = new Map();
  const failed = [];
  const n = companies.length;
  const start = ((cursor % n) + n) % n;
  let visited = 0;
  while (visited < n && now() < deadline) {
    const company = companies[(start + visited) % n];
    visited += 1;
    try {
      const result = await work(company);
      if (result) results.set(company.symbol, result);
      else failed.push(company.symbol);
    } catch (err) {
      failed.push(company.symbol);
      console.warn(`  [equity] ${company.symbol}: ${/** @type {Error} */ (err).message}`);
    }
  }
  return { results, failed, visited, nextCursor: (start + visited) % n };
}

/**
 * Seeder for one (country, dataset) pair with per-company keys.
 *
 * Each run refreshes as many companies as fit in `budgetMs` (seed-all.yml kills a
 * seeder at 90s) and carries a cursor so the next run continues where this one
 * stopped. Companies not refreshed this run keep their last-good key: their extra
 * key resolves to zero records and runSeed extends its TTL instead of writing.
 *
 * `fetchCompany(ctx, company, previousDetail)` returns `{ detail, summary }`, or null
 * when the upstream had nothing usable.
 *
 * @param {{ cc: string, dataset: string, sourceVersion: string, ttlSeconds: number,
 *           maxStaleMin: number, budgetMs?: number, createContext: () => any,
 *           fetchCompany: (ctx: any, company: any, previous: any) => Promise<{ detail: any, summary: any } | null> }} spec
 */
export function runEquityCompanySeed(spec) {
  const { cc, dataset, sourceVersion, ttlSeconds, maxStaleMin, budgetMs = 55_000 } = spec;
  const companies = loadUniverse(cc);
  const summaryKey = equityKey(dataset, cc);

  async function fetchAll() {
    const startedAt = Date.now();
    const previous = await readSeedSnapshot(summaryKey);
    const ctx = spec.createContext();
    const { results, failed, visited, nextCursor } = await rotateCompanies({
      companies,
      cursor: Number(previous?.cursor) || 0,
      deadline: startedAt + budgetMs,
      work: async (company) => {
        const prevDetail = await readSeedSnapshot(equityKey(dataset, cc, company.symbol));
        return spec.fetchCompany(ctx, company, prevDetail);
      },
    });
    if (results.size === 0) {
      // Nothing fresh: fail so runSeed keeps last-good data instead of re-stamping it as new.
      throw new Error(`${cc} ${dataset}: 0/${visited} companies refreshed (failed: ${failed.slice(0, 5).join(', ')})`);
    }
    const updatedAt = new Date().toISOString();
    /** @type {Record<string, any>} */
    const summaries = { ...(previous?.companies ?? {}) };
    /** @type {Record<string, any>} */
    const details = {};
    for (const [symbol, { detail, summary }] of results) {
      summaries[symbol] = { ...summary, updatedAt };
      details[symbol] = { ...detail, symbol, country: cc, updatedAt };
    }
    // Drop companies that left the index.
    const members = new Set(companies.map((c) => c.symbol));
    for (const symbol of Object.keys(summaries)) if (!members.has(symbol)) delete summaries[symbol];
    console.log(`  [equity] ${cc} ${dataset}: refreshed ${results.size}, failed ${failed.length}, visited ${visited}/${companies.length} in ${Date.now() - startedAt}ms`);
    return {
      country: cc,
      dataset,
      updatedAt,
      cursor: nextCursor,
      coverage: { total: companies.length, withData: Object.keys(summaries).length, refreshedThisRun: results.size, failedThisRun: failed.length },
      companies: summaries,
      details,
    };
  }

  return runSeed('equity', `${dataset}-${cc.toLowerCase()}`, summaryKey, fetchAll, {
    ttlSeconds,
    validateFn: (d) => d && Object.keys(d.companies ?? {}).length > 0,
    publishTransform: ({ details: _details, ...rest }) => rest,
    declareRecords: (d) => Object.keys(d?.companies ?? {}).length,
    sourceVersion,
    schemaVersion: 1,
    maxStaleMin,
    extraKeys: companies.map((c) => ({
      key: equityKey(dataset, cc, c.symbol),
      ttl: ttlSeconds,
      transform: (d) => d?.details?.[c.symbol] ?? null,
      declareRecords: (detail) => (detail ? 1 : 0),
      skipWhenEmpty: true,
    })),
  }).catch((err) => {
    console.error('FATAL:', err.message || err);
    process.exit(1);
  });
}
