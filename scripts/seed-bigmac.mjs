#!/usr/bin/env node

import { loadEnvFile, CHROME_UA, runSeed, readSeedSnapshot, getSharedFxRates, SHARED_FX_FALLBACKS, allSettledWithConcurrency } from './_seed-utils.mjs';

const CANONICAL_KEY = 'economic:bigmac:v1';
const CACHE_TTL = 864000; // 10 days — weekly seed with 3-day cron-drift buffer
const EXA_CONCURRENCY = 6; // in-flight EXA searches; bounds the 50-country loop under runSeed's 240s deadline (see fetchBigMacPrices / #4994)

const FX_FALLBACKS = SHARED_FX_FALLBACKS;

// WoW validation thresholds
const MIN_WOW_AGE_MS = 6 * 24 * 60 * 60 * 1000; // 6 days minimum between snapshots
const WOW_ANOMALY_THRESHOLD = 20; // % change that signals a data bug

// USD price sanity range for a Big Mac globally
const USD_MIN = 1.50;
const USD_MAX = 12.00;

export const COUNTRIES = [
  // Americas
  { code: 'US', name: 'United States', currency: 'USD', flag: '🇺🇸' },
  { code: 'CA', name: 'Canada',        currency: 'CAD', flag: '🇨🇦' },
  { code: 'MX', name: 'Mexico',        currency: 'MXN', flag: '🇲🇽' },
  { code: 'BR', name: 'Brazil',        currency: 'BRL', flag: '🇧🇷' },
  { code: 'AR', name: 'Argentina',     currency: 'ARS', flag: '🇦🇷' },
  { code: 'CO', name: 'Colombia',      currency: 'COP', flag: '🇨🇴' },
  { code: 'CL', name: 'Chile',         currency: 'CLP', flag: '🇨🇱' },
  // Europe
  { code: 'GB', name: 'UK',            currency: 'GBP', flag: '🇬🇧' },
  { code: 'DE', name: 'Germany',       currency: 'EUR', flag: '🇩🇪' },
  { code: 'FR', name: 'France',        currency: 'EUR', flag: '🇫🇷' },
  { code: 'IT', name: 'Italy',         currency: 'EUR', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain',         currency: 'EUR', flag: '🇪🇸' },
  { code: 'CH', name: 'Switzerland',   currency: 'CHF', flag: '🇨🇭' },
  { code: 'NO', name: 'Norway',        currency: 'NOK', flag: '🇳🇴' },
  { code: 'SE', name: 'Sweden',        currency: 'SEK', flag: '🇸🇪' },
  { code: 'DK', name: 'Denmark',       currency: 'DKK', flag: '🇩🇰' },
  { code: 'PL', name: 'Poland',        currency: 'PLN', flag: '🇵🇱' },
  { code: 'CZ', name: 'Czechia',       currency: 'CZK', flag: '🇨🇿' },
  { code: 'HU', name: 'Hungary',       currency: 'HUF', flag: '🇭🇺' },
  { code: 'RO', name: 'Romania',       currency: 'RON', flag: '🇷🇴' },
  { code: 'UA', name: 'Ukraine',       currency: 'UAH', flag: '🇺🇦' },
  // Asia-Pacific
  { code: 'CN', name: 'China',         currency: 'CNY', flag: '🇨🇳' },
  { code: 'JP', name: 'Japan',         currency: 'JPY', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea',   currency: 'KRW', flag: '🇰🇷' },
  { code: 'AU', name: 'Australia',     currency: 'AUD', flag: '🇦🇺' },
  { code: 'NZ', name: 'New Zealand',   currency: 'NZD', flag: '🇳🇿' },
  { code: 'SG', name: 'Singapore',     currency: 'SGD', flag: '🇸🇬' },
  { code: 'HK', name: 'Hong Kong',     currency: 'HKD', flag: '🇭🇰' },
  { code: 'TW', name: 'Taiwan',        currency: 'TWD', flag: '🇹🇼' },
  { code: 'TH', name: 'Thailand',      currency: 'THB', flag: '🇹🇭' },
  { code: 'MY', name: 'Malaysia',      currency: 'MYR', flag: '🇲🇾' },
  { code: 'ID', name: 'Indonesia',     currency: 'IDR', flag: '🇮🇩' },
  { code: 'PH', name: 'Philippines',   currency: 'PHP', flag: '🇵🇭' },
  { code: 'VN', name: 'Vietnam',       currency: 'VND', flag: '🇻🇳' },
  { code: 'IN', name: 'India',         currency: 'INR', flag: '🇮🇳' },
  { code: 'PK', name: 'Pakistan',      currency: 'PKR', flag: '🇵🇰' },
  // Middle East
  { code: 'AE', name: 'UAE',           currency: 'AED', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia',  currency: 'SAR', flag: '🇸🇦' },
  { code: 'QA', name: 'Qatar',         currency: 'QAR', flag: '🇶🇦' },
  { code: 'KW', name: 'Kuwait',        currency: 'KWD', flag: '🇰🇼' },
  { code: 'BH', name: 'Bahrain',       currency: 'BHD', flag: '🇧🇭' },
  { code: 'OM', name: 'Oman',          currency: 'OMR', flag: '🇴🇲' },
  { code: 'EG', name: 'Egypt',         currency: 'EGP', flag: '🇪🇬' },
  { code: 'JO', name: 'Jordan',        currency: 'JOD', flag: '🇯🇴' },
  { code: 'LB', name: 'Lebanon',       currency: 'LBP', flag: '🇱🇧' },
  { code: 'IL', name: 'Israel',        currency: 'ILS', flag: '🇮🇱' },
  // Africa
  { code: 'ZA', name: 'South Africa',  currency: 'ZAR', flag: '🇿🇦' },
  { code: 'NG', name: 'Nigeria',       currency: 'NGN', flag: '🇳🇬' },
  { code: 'KE', name: 'Kenya',         currency: 'KES', flag: '🇰🇪' },
];

const FX_SYMBOLS = Object.fromEntries(
  [...new Set(COUNTRIES.map(c => c.currency))].map(ccy => [ccy, `${ccy}USD=X`])
);

// Handle both plain numbers and thousands-separated (480,000 LBP or 12,000 KRW)
const NUM = '\\d{1,3}(?:[,\\s]\\d{3})*(?:\\.\\d{1,3})?';
const CCY = 'USD|GBP|EUR|JPY|CHF|CNY|INR|AUD|CAD|NZD|BRL|MXN|ZAR|TRY|KRW|SGD|HKD|TWD|THB|IDR|NOK|SEK|DKK|PLN|CZK|HUF|RON|PHP|VND|MYR|PKR|ILS|ARS|COP|CLP|UAH|NGN|KES|AED|SAR|QAR|KWD|BHD|OMR|EGP|JOD|LBP';
const PRICE_PATTERNS = [
  new RegExp(`(${NUM})\\s*(${CCY})`, 'i'),
  new RegExp(`(${CCY})\\s*(${NUM})`, 'i'),
];

function parseNum(s) { return parseFloat(s.replace(/[,\s]/g, '')); }

function matchPrice(text, url) {
  for (const re of PRICE_PATTERNS) {
    const match = text.match(re);
    if (match) {
      const [price, currency] = /^\d/.test(match[1])
        ? [parseNum(match[1]), match[2].toUpperCase()]
        : [parseNum(match[2]), match[1].toUpperCase()];
      if (price > 0 && price < 10_000_000) return { price, currency, source: url || '' };
    }
  }
  return null;
}

// Free/self-hosted first (site:-restricted SearXNG search), Exa as fallback.
// Shaped to match Exa's { results: [{ summary, url }] } so processCountry's
// matchPrice() call needs no changes regardless of which path answered.
async function searchSearxng(query, includeDomains) {
  const baseUrl = process.env.SEARXNG_URL;
  if (!baseUrl) return null;

  const siteFilter = includeDomains?.length
    ? ` (${includeDomains.map(d => `site:${d}`).join(' OR ')})`
    : '';
  const url = new URL('/search', baseUrl);
  url.searchParams.set('q', query + siteFilter);
  url.searchParams.set('format', 'json');

  const resp = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    console.warn(`  SearXNG ${resp.status}`);
    return null;
  }
  const payload = await resp.json();
  const results = (payload.results || [])
    .filter(r => r.content)
    .map(r => ({ summary: r.content, url: r.url || '' }));
  return results.length ? { results } : null;
}

// The Economist publishes the actual Big Mac Index as open CSV data — free,
// no key, no scraping/guessing. Covers ~54 countries (missing e.g. Nigeria,
// Kenya, which fall back to the search ladder below). Refreshed by The
// Economist ~twice a year, which comfortably outpaces this seed's 10-day TTL.
const ECONOMIST_BIG_MAC_CSV_URL = 'https://raw.githubusercontent.com/TheEconomist/big-mac-data/master/output-data/big-mac-full-index.csv';

async function fetchEconomistBigMacIndex() {
  try {
    const resp = await fetch(ECONOMIST_BIG_MAC_CSV_URL, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) {
      console.warn(`  Economist Big Mac CSV ${resp.status}`);
      return new Map();
    }
    const text = await resp.text();
    const lines = text.trim().split('\n');
    const header = lines[0].split(',');
    const dateIdx = header.indexOf('date');
    const currencyIdx = header.indexOf('currency_code');
    const localPriceIdx = header.indexOf('local_price');
    const dollarPriceIdx = header.indexOf('dollar_price');

    let latestDate = '';
    const rows = [];
    for (const line of lines.slice(1)) {
      const cols = line.split(',');
      const date = cols[dateIdx];
      if (!date) continue;
      if (date > latestDate) latestDate = date;
      rows.push(cols);
    }

    const byCurrency = new Map();
    for (const cols of rows) {
      if (cols[dateIdx] !== latestDate) continue;
      const currency = cols[currencyIdx];
      const localPrice = parseFloat(cols[localPriceIdx]);
      const usdPrice = parseFloat(cols[dollarPriceIdx]);
      if (!currency || !Number.isFinite(localPrice) || !Number.isFinite(usdPrice)) continue;
      byCurrency.set(currency, { localPrice, usdPrice });
    }
    return byCurrency;
  } catch (err) {
    console.warn(`  Economist Big Mac CSV error: ${err.message}`);
    return new Map();
  }
}

async function searchExa(query, includeDomains = null) {
  const searxResult = await searchSearxng(query, includeDomains).catch((err) => {
    console.warn(`  SearXNG error: ${err.message}`);
    return null;
  });
  if (searxResult) return searxResult;

  const apiKey = (process.env.EXA_API_KEYS || process.env.EXA_API_KEY || '').split(/[\n,]+/)[0].trim();
  if (!apiKey) throw new Error('EXA_API_KEYS or EXA_API_KEY not set');

  const body = {
    query,
    numResults: 5,
    type: 'auto',
    contents: { summary: { query: 'What is the current Big Mac price in local currency and USD?' } },
  };
  if (includeDomains) body.includeDomains = includeDomains;

  const resp = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', 'User-Agent': CHROME_UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.warn(`  EXA ${resp.status}: ${text.slice(0, 100)}`);
    return null;
  }
  return resp.json();
}

// Resolve one country's Big Mac price. NEVER throws for an upstream/EXA failure —
// a failed lookup yields an `available: false` row so a single flaky country can
// never fail the whole run. Called concurrently (see fetchBigMacPrices).
async function processCountry(country, fxRates, searchExaFn, economistData) {
  const fxRate = fxRates[country.currency] ?? FX_FALLBACKS[country.currency] ?? null;
  let localPrice = null;
  let usdPrice = null;
  let sourceSite = '';

  const economistHit = economistData?.get(country.currency);
  if (economistHit) {
    // Authoritative source — skip search entirely for countries it covers.
    localPrice = economistHit.localPrice;
    usdPrice = economistHit.usdPrice;
    sourceSite = ECONOMIST_BIG_MAC_CSV_URL;
  } else {
    try {
      // Include currency code in query — helps EXA find per-country specialist pages
      const query = `Big Mac price ${country.name} ${country.currency}`;
      const SPECIALIST_SITES = ['theburgerindex.com', 'eatmyindex.com'];

      // Specialist Big Mac Index sites only — clean, verified per-country data
      const exaResult = await searchExaFn(query, SPECIALIST_SITES);

      if (exaResult?.results?.length) {
        for (const result of exaResult.results) {
          const summary = result?.summary;
          if (!summary || typeof summary !== 'string') continue;
          const hit = matchPrice(summary, result.url || '');
          if (hit?.currency === country.currency) {
            localPrice = hit.price;
            sourceSite = hit.source;
            break;
          }
        }
      }
    } catch (err) {
      console.warn(`    [${country.code}] EXA error: ${err.message}`);
    }

    usdPrice = localPrice !== null && fxRate ? +(localPrice * fxRate).toFixed(4) : null;
  }

  // Sanity check: Big Mac USD price must be in a plausible global range
  if (usdPrice !== null && (usdPrice < USD_MIN || usdPrice > USD_MAX)) {
    console.warn(`  [PRICE] ANOMALY ${country.flag} ${country.name}: $${usdPrice} out of range [$${USD_MIN}-$${USD_MAX}] — dropping price`);
    usdPrice = null;
    localPrice = null;
  }

  const status = localPrice !== null ? `${localPrice} ${country.currency} = $${usdPrice}` : 'N/A';
  console.log(`  ${country.flag} ${country.name} (${country.currency}): ${status}`);

  return {
    code: country.code,
    name: country.name,
    currency: country.currency,
    flag: country.flag,
    localPrice: localPrice !== null ? +localPrice.toFixed(4) : null,
    usdPrice,
    fxRate: fxRate || 0,
    sourceSite,
    available: usdPrice !== null,
  };
}

export async function fetchBigMacPrices(prevSnapshot, {
  searchExaFn = searchExa,
  getFxRatesFn = getSharedFxRates,
  getEconomistDataFn = fetchEconomistBigMacIndex,
  concurrency = EXA_CONCURRENCY,
} = {}) {
  const [fxRates, economistData] = await Promise.all([
    getFxRatesFn(FX_SYMBOLS, FX_FALLBACKS),
    getEconomistDataFn(),
  ]);

  // Fetch the 50 countries with BOUNDED CONCURRENCY. The runner (runSeed) caps the
  // whole fetch phase at 240s; a sequential loop of 50 EXA calls (≤15s each) breaches
  // that deadline the moment average latency exceeds 240/50 ≈ 4.8s, crashing the run
  // with a spurious exit-75 "Deploy Crashed!" alert (issue #4994). At concurrency 6
  // the worst case is ⌈50/6⌉ = 9 waves × 15s ≈ 135s — comfortably under the deadline.
  // Countries the Economist CSV already covers skip EXA/search entirely.
  const settled = await allSettledWithConcurrency(
    COUNTRIES,
    concurrency,
    (country) => processCountry(country, fxRates, searchExaFn, economistData),
  );
  const results = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    const c = COUNTRIES[i];
    console.warn(`    [${c.code}] processing failed: ${s.reason?.message || s.reason}`);
    return {
      code: c.code, name: c.name, currency: c.currency, flag: c.flag,
      localPrice: null, usdPrice: null,
      fxRate: fxRates[c.currency] ?? FX_FALLBACKS[c.currency] ?? 0,
      sourceSite: '', available: false,
    };
  });

  const withData = results.filter(r => r.usdPrice != null);
  const cheapest = withData.length ? withData.reduce((a, b) => a.usdPrice < b.usdPrice ? a : b).code : '';
  const mostExpensive = withData.length ? withData.reduce((a, b) => a.usdPrice > b.usdPrice ? a : b).code : '';

  // Compute WoW per country — requires at least 6 days between snapshots
  const prevAge = prevSnapshot?.fetchedAt ? Date.now() - new Date(prevSnapshot.fetchedAt).getTime() : 0;
  const hasPrevData = prevSnapshot?.countries?.length > 0;
  const prevTooRecent = prevAge > 0 && prevAge < MIN_WOW_AGE_MS;

  if (hasPrevData && prevTooRecent) {
    console.warn(`  [WoW] Skipping WoW — previous snapshot is only ${Math.round(prevAge / 3600000)}h old (need 144h+)`);
  }

  let wowAvailable = hasPrevData && !prevTooRecent;
  let suspiciousCount = 0;
  let suspiciousNames = '';

  if (wowAvailable) {
    const prevMap = Object.fromEntries(prevSnapshot.countries.map(c => [c.code, c.usdPrice]));
    const rawWowValues = []; // unfiltered — used for global anomaly check

    for (const r of results) {
      if (r.usdPrice != null && prevMap[r.code] != null && prevMap[r.code] > 0) {
        const raw = +((r.usdPrice - prevMap[r.code]) / prevMap[r.code] * 100).toFixed(2);
        rawWowValues.push(raw);
        if (Math.abs(raw) > WOW_ANOMALY_THRESHOLD) {
          console.warn(`  [WoW] ANOMALY ${r.flag} ${r.name}: ${raw}% (prev=$${prevMap[r.code]} now=$${r.usdPrice}) — hiding WoW for this country`);
          suspiciousCount++;
          suspiciousNames += (suspiciousNames ? ', ' : '') + `${r.name} ${raw}%`;
          r.wowPct = null;
        } else {
          r.wowPct = raw;
        }
      } else {
        r.wowPct = null;
      }
    }

    if (suspiciousCount > 0) {
      console.error(`  [WoW] ADMIN ALERT: ${suspiciousCount} country/ies had anomalous WoW (>±${WOW_ANOMALY_THRESHOLD}%): ${suspiciousNames}`);
    }

    // Global check uses unfiltered average — individual filtering bounds each value to ≤20%
    // so the filtered average can never exceed the threshold (dead check). Use raw values instead.
    const rawAvg = rawWowValues.length > 0
      ? +(rawWowValues.reduce((s, v) => s + v, 0) / rawWowValues.length).toFixed(2)
      : 0;
    if (Math.abs(rawAvg) > WOW_ANOMALY_THRESHOLD) {
      console.error(`  [WoW] ADMIN ALERT: Global WoW raw avg ${rawAvg}% exceeds ±${WOW_ANOMALY_THRESHOLD}% — disabling WoW entirely, likely systematic data bug`);
      wowAvailable = false;
    }
  }

  const wowCountries = wowAvailable ? results.filter(r => r.wowPct != null) : [];
  const wowAvgPct = wowCountries.length > 0
    ? +(wowCountries.reduce((s, r) => s + r.wowPct, 0) / wowCountries.length).toFixed(2)
    : 0;

  return {
    countries: results,
    fetchedAt: new Date().toISOString(),
    cheapestCountry: cheapest,
    mostExpensiveCountry: mostExpensive,
    wowAvgPct,
    wowAvailable,
    prevFetchedAt: wowAvailable ? (prevSnapshot.fetchedAt ?? '') : '',
  };
}

export function declareRecords(data) {
  return data?.countries?.filter(c => c.available).length || 0;
}

// Only run the seed when invoked directly (`node seed-bigmac.mjs`), not when
// imported by a test — matches the repo-wide seeder main-guard idiom.
const isMain = process.argv[1]?.endsWith('seed-bigmac.mjs');
if (isMain) {
  loadEnvFile(import.meta.url);
  const prevSnapshot = await readSeedSnapshot(CANONICAL_KEY);

  await runSeed('economic', 'bigmac', CANONICAL_KEY, () => fetchBigMacPrices(prevSnapshot), {
    ttlSeconds: CACHE_TTL,
    validateFn: (data) => data?.countries?.length > 0,
    recordCount: (data) => data?.countries?.filter(c => c.available).length || 0,
    declareRecords,
    sourceVersion: 'economist-bigmac-v1',
    schemaVersion: 1,
    maxStaleMin: 10080,
    extraKeys: prevSnapshot ? [{
      key: `${CANONICAL_KEY}:prev`,
      transform: () => prevSnapshot,  // write PRE-overwrite snapshot; ignore new data
      ttl: CACHE_TTL * 2,
      declareRecords,
    }] : undefined,
  });
}
