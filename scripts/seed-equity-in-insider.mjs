#!/usr/bin/env node
// Insider and promoter trades (SEBI PIT disclosures) for India's NIFTY 50.
import { loadEnvFile } from './_seed-utils.mjs';
import * as IN from './shared/equity/adapters/in.mjs';
import { runEquityCompanySeed } from './shared/equity/registry.mjs';

loadEnvFile(import.meta.url);

runEquityCompanySeed({
  cc: 'IN',
  dataset: 'insider',
  sourceVersion: 'nse-pit-v1',
  ttlSeconds: 14 * 86_400,
  maxStaleMin: 1440,
  createContext: IN.createContext,
  fetchCompany: IN.fetchInsider,
});
