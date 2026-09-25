#!/usr/bin/env node
// Exchange announcements, board meetings and annual reports for India's NIFTY 50.
import { loadEnvFile } from './_seed-utils.mjs';
import * as IN from './shared/equity/adapters/in.mjs';
import { runEquityCompanySeed } from './shared/equity/registry.mjs';

loadEnvFile(import.meta.url);

runEquityCompanySeed({
  cc: 'IN',
  dataset: 'filings',
  sourceVersion: 'nse-announcements-v1',
  ttlSeconds: 14 * 86_400,
  maxStaleMin: 1440,
  createContext: IN.createContext,
  fetchCompany: IN.fetchFilings,
});
