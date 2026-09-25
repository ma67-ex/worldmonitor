#!/usr/bin/env node
// Quarterly shareholding pattern (promoter, FII, DII, mutual funds, retail) for India's NIFTY 50.
import { loadEnvFile } from './_seed-utils.mjs';
import * as IN from './shared/equity/adapters/in.mjs';
import { runEquityCompanySeed } from './shared/equity/registry.mjs';

loadEnvFile(import.meta.url);

runEquityCompanySeed({
  cc: 'IN',
  dataset: 'shareholding',
  sourceVersion: 'nse-shareholding-v1',
  ttlSeconds: 45 * 86_400,
  maxStaleMin: 1440,
  createContext: IN.createContext,
  fetchCompany: IN.fetchShareholding,
});
