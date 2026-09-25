#!/usr/bin/env node
// Last 12 quarters of results (revenue, EBITDA, profit, EPS) plus TTM and YoY for India's NIFTY 50.
import { loadEnvFile } from './_seed-utils.mjs';
import * as IN from './shared/equity/adapters/in.mjs';
import { runEquityCompanySeed } from './shared/equity/registry.mjs';

loadEnvFile(import.meta.url);

runEquityCompanySeed({
  cc: 'IN',
  dataset: 'financials',
  sourceVersion: 'nse-results-xbrl-v1',
  ttlSeconds: 45 * 86_400,
  maxStaleMin: 1440,
  createContext: IN.createContext,
  fetchCompany: IN.fetchFinancials,
});
