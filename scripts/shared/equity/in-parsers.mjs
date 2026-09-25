// @ts-check
/**
 * Pure parsers for NSE (India) responses. No network, no Redis — every function
 * takes a raw response and returns the normalized equity-terminal shape, so each
 * one is tested against recorded fixtures in tests/fixtures/equity-in/.
 *
 * Money is stored in absolute INR unless a field name says otherwise
 * (FII/DII flows are ₹ crore, which is how NSE publishes them).
 */

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

/** "16-JUL-2026", "17-Jul-2026 19:50:03" or "2026-06-30" → "2026-07-16" (null if unparseable). */
export function nseDate(value) {
  if (typeof value !== 'string') return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = value.trim().match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/);
  if (!m) return null;
  const month = MONTHS[/** @type {keyof typeof MONTHS} */ (m[2].toUpperCase())];
  return month ? `${m[3]}-${month}-${m[1].padStart(2, '0')}` : null;
}

/** "17-Jul-2026 19:50:03" (IST) → ISO timestamp with +05:30, else the bare date. */
export function nseDateTime(value) {
  const date = nseDate(value);
  if (!date) return null;
  const t = String(value).match(/(\d{2}):(\d{2})(?::(\d{2}))?\s*$/);
  return t ? `${date}T${t[1]}:${t[2]}:${t[3] ?? '00'}+05:30` : date;
}

/** "1,234.5" / "-" / null → number | null */
export function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned.toLowerCase() === 'nil') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const round = (n, dp = 2) => (n == null ? null : Math.round(n * 10 ** dp) / 10 ** dp);
const byDateDesc = (key) => (a, b) => String(b[key] ?? '').localeCompare(String(a[key] ?? ''));

// ─── Universe ───────────────────────────────────────────────────────────────

/** NSE index constituent CSV (nsearchives …/ind_nifty50list.csv). */
export function parseUniverseCsv(csv) {
  const lines = String(csv).trim().split(/\r?\n/);
  const header = splitCsvLine(lines.shift() || '').map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iName = col('company name'), iIndustry = col('industry'), iSymbol = col('symbol'), iSeries = col('series'), iIsin = col('isin code');
  if (iSymbol < 0) throw new Error('universe CSV missing Symbol column');
  return lines
    .map(splitCsvLine)
    .filter((cells) => cells[iSymbol] && (iSeries < 0 || cells[iSeries].trim() === 'EQ'))
    .map((cells) => {
      const symbol = cells[iSymbol].trim();
      return {
        symbol,
        yahooSymbol: `${symbol}.NS`,
        name: cells[iName]?.trim() || symbol,
        sector: cells[iIndustry]?.trim() || null,
        isin: cells[iIsin]?.trim() || null,
      };
    });
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ─── XBRL (flat NSE filings: results, integrated filings, shareholding) ─────

/**
 * Flat fact extraction: `{ name: { contextRef: value } }`, namespace prefix dropped.
 * NSE's filing XBRL has no nesting inside facts, so one regex pass is enough.
 */
export function parseXbrlFacts(xml) {
  /** @type {Record<string, Record<string, string>>} */
  const facts = {};
  const re = /<([\w-]+):(\w+)\b([^>]*)>([^<]*)<\/\1:\2>/g;
  for (const m of String(xml).matchAll(re)) {
    const ctx = m[3].match(/contextRef="([^"]+)"/)?.[1];
    if (!ctx) continue;
    (facts[m[2]] ??= {})[ctx] = m[4].trim();
  }
  return facts;
}

/**
 * Results layout, from which elements a filing carries. Banks and life insurers
 * file under their own SEBI formats with no RevenueFromOperations at all.
 * @returns {'standard' | 'bank' | 'life-insurer'}
 */
export function resultsFormat(facts) {
  if (facts.InterestEarned?.OneD != null) return 'bank';
  if (facts.NetPremiumIncome?.OneD != null || facts.GrossPremiumIncome?.OneD != null) return 'life-insurer';
  return 'standard';
}

/**
 * Quarterly results from any NSE results XBRL: in-bse-fin (pre-2025) or in-capmkt
 * (SEBI integrated filings), in the standard, banking or life-insurance layout.
 * Context `OneD` is always the reported quarter. `revenue` means the layout's
 * top line: revenue from operations, interest earned (banks) or net premium
 * income (life insurers). `ebitda` is only derived for the standard layout.
 */
export function parseResultsXbrl(xml) {
  const facts = parseXbrlFacts(xml);
  const q = (name) => facts[name]?.OneD;
  const n = (name) => num(q(name));
  const first = (...names) => {
    for (const name of names) {
      const v = n(name);
      if (v != null) return v;
    }
    return null;
  };
  const periodEnd = q('DateOfEndOfReportingPeriod');
  if (!periodEnd) return null;
  const format = resultsFormat(facts);
  const nature = q('NatureOfReportStandaloneConsolidated') ?? '';
  const base = {
    format,
    periodStart: q('DateOfStartOfReportingPeriod') ?? null,
    periodEnd,
    quarter: q('ReportingQuarter') ?? null,
    consolidated: /consolidated/i.test(nature) && !/standalone/i.test(nature),
    audited: /^audited/i.test(q('WhetherResultsAreAuditedOrUnaudited') ?? ''),
    currency: 'INR',
    otherIncome: n('OtherIncome'),
    totalIncome: n('Income'),
    paidUpCapital: n('PaidUpValueOfEquityShareCapital'),
    faceValue: n('FaceValueOfEquityShareCapital'),
  };

  if (format === 'bank') {
    const interestEarned = n('InterestEarned');
    const interestExpended = n('InterestExpended');
    return {
      ...base,
      revenue: interestEarned,
      netInterestIncome: interestEarned != null && interestExpended != null ? interestEarned - interestExpended : null,
      operatingProfit: n('OperatingProfitBeforeProvisionAndContingencies'),
      provisions: n('ProvisionsOtherThanTaxAndContingencies'),
      expenses: n('ExpenditureExcludingProvisionsAndContingencies'),
      financeCosts: interestExpended,
      depreciation: null,
      ebitda: null,
      pbt: n('ProfitLossFromOrdinaryActivitiesBeforeTax'),
      tax: n('TaxExpense'),
      pat: first('ProfitLossForThePeriod', 'ProfitLossFromOrdinaryActivitiesAfterTax'),
      patOwners: first('ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates', 'ProfitLossForThePeriod'),
      eps: first('BasicEarningsPerShareAfterExtraordinaryItems', 'BasicEarningsPerShareBeforeExtraordinaryItems'),
      dilutedEps: first('DilutedEarningsPerShareAfterExtraordinaryItems', 'DilutedEarningsPerShareBeforeExtraordinaryItems'),
    };
  }

  if (format === 'life-insurer') {
    const pat = first('ProfitLossAfterTaxAndExtraordinaryItems', 'ProfitLossAfterTaxBeforeExtraordinaryItems');
    const eps = first(
      'BasicAndDilutedEPSAfterExtraordinaryItemsNetOfTaxExpenseForThePeriodNotToBeAnnualized',
      'BasicAndDilutedEPSBeforeExtraordinaryItemsNetOfTaxExpenseForThePeriodNotToBeAnnualized',
    );
    return {
      ...base,
      revenue: n('NetPremiumIncome'),
      grossPremium: n('GrossPremiumIncome'),
      investmentIncome: n('IncomeFromInvestmentsNet'),
      expenses: n('Expenses'),
      financeCosts: null,
      depreciation: null,
      ebitda: null,
      pbt: n('ProfitLossBeforeTax'),
      tax: n('ProvisionsForTaxes'),
      pat,
      patOwners: pat,
      eps,
      dilutedEps: eps,
    };
  }

  const pbt = n('ProfitBeforeTax');
  const financeCosts = n('FinanceCosts');
  const depreciation = n('DepreciationDepletionAndAmortisationExpense');
  return {
    ...base,
    revenue: n('RevenueFromOperations'),
    expenses: n('Expenses'),
    financeCosts,
    depreciation,
    // Derived, not reported: PBT + finance costs + D&A.
    ebitda: pbt != null ? pbt + (financeCosts ?? 0) + (depreciation ?? 0) : null,
    pbt,
    tax: n('TaxExpense'),
    pat: n('ProfitLossForPeriod'),
    patOwners: n('ProfitOrLossAttributableToOwnersOfParent'),
    eps: n('BasicEarningsLossPerShareFromContinuingOperations'),
    dilutedEps: n('DilutedEarningsLossPerShareFromContinuingOperations'),
  };
}

/**
 * Merge the two filing lists into one index of result filings, newest first.
 * Integrated filings (2025+) come as `{ data: [...] }`; the legacy list is a bare array.
 */
export function parseResultFilings(integratedJson, legacyJson) {
  const integrated = (Array.isArray(integratedJson) ? integratedJson : integratedJson?.data ?? [])
    .filter((r) => /financ/i.test(r.type ?? 'financ'))
    .map((r) => ({
      id: `IF-${r.seq_Id}`,
      periodEnd: nseDate(r.qe_Date),
      consolidated: r.consolidated === 'Consolidated',
      audited: /^audited/i.test(r.audited ?? ''),
      filedAt: nseDateTime(r.broadcast_Date),
      xbrlUrl: r.xbrl || null,
      revised: r.type_Sub && r.type_Sub !== 'Original',
    }));
  const legacy = (Array.isArray(legacyJson) ? legacyJson : [])
    .map((r) => ({
      id: `FR-${r.seqNumber}`,
      periodEnd: nseDate(r.toDate),
      consolidated: r.consolidated === 'Consolidated',
      audited: /^audited/i.test(r.audited ?? ''),
      filedAt: nseDateTime(r.broadCastDate),
      xbrlUrl: /^https?:/.test(r.xbrl ?? '') ? r.xbrl : null,
      revised: false,
    }));
  return [...integrated, ...legacy]
    .filter((f) => f.periodEnd && f.xbrlUrl)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || String(b.filedAt).localeCompare(String(a.filedAt)));
}

/**
 * One filing per (period, basis): the latest-filed one wins, so a revision
 * replaces the original instead of double-counting the quarter.
 */
export function pickResultFilings(filings, { consolidated, limit = 12 }) {
  const seen = new Set();
  const out = [];
  for (const f of filings) {
    if (f.consolidated !== consolidated || seen.has(f.periodEnd)) continue;
    seen.add(f.periodEnd);
    out.push(f);
    if (out.length >= limit) break;
  }
  return out;
}

// ─── Shareholding ───────────────────────────────────────────────────────────

/** `corporate-share-holdings-master`: quarterly promoter/public split + XBRL link. */
export function parseShareholdingList(json) {
  return (Array.isArray(json) ? json : [])
    .map((r) => ({
      id: String(r.recordId ?? ''),
      date: nseDate(r.date),
      promoterPct: num(r.pr_and_prgrp),
      publicPct: num(r.public_val),
      employeeTrustPct: num(r.employeeTrusts),
      filedAt: nseDateTime(r.broadcastDate),
      xbrlUrl: /^https?:/.test(r.xbrl ?? '') ? r.xbrl : null,
      revised: r.revisedData === 'Y',
    }))
    .filter((r) => r.date)
    .sort(byDateDesc('date'));
}

const SHP_CATEGORIES = {
  promoterPct: 'ShareholdingOfPromoterAndPromoterGroup',
  publicPct: 'PublicShareholding',
  fiiPct: 'InstitutionsForeign',
  diiPct: 'InstitutionsDomestic',
  mutualFundPct: 'MutualFundsOrUTI',
  insurancePct: 'InsuranceCompanies',
  governmentPct: 'Governments',
  nonInstitutionPct: 'NonInstitutions',
  retailSmallPct: 'ResidentIndividualShareholdersHoldingNominalShareCapitalUpToRsTwoLakh',
  retailLargePct: 'ResidentIndividualShareholdersHoldingNominalShareCapitalInExcessOfRsTwoLakh',
  corporateBodiesPct: 'BodiesCorporate',
};

/** Shareholding-pattern XBRL: category split as percentages (NSE files fractions). */
export function parseShareholdingXbrl(xml) {
  const facts = parseXbrlFacts(xml);
  const pctOf = (category) => {
    const v = num(facts.ShareholdingAsAPercentageOfTotalNumberOfShares?.[`${category}_ContextI`]);
    return v == null ? null : round(v * 100, 2);
  };
  const date = facts.DateOfReport?.MainI ?? null;
  if (!date) return null;
  /** @type {Record<string, any>} */
  const out = { date };
  for (const [field, category] of Object.entries(SHP_CATEGORIES)) out[field] = pctOf(category);
  const yes = (name) => /^(yes|true)$/i.test(Object.values(facts[name] ?? {})[0] ?? '');
  out.promoterSharesPledged = yes('WhetherAnySharesHeldByPromotersAreEncumberedUnderPledged');
  out.totalShares = num(facts.NumberOfShares?.ShareholdingPattern_ContextI);
  return out;
}

// ─── Insider trading (SEBI PIT disclosures) ────────────────────────────────

export function parseInsiderTrades(json) {
  const rows = Array.isArray(json) ? json : json?.data ?? [];
  return rows
    .map((r) => {
      const buyQty = num(r.buyQuantity) ?? 0;
      const sellQty = num(r.sellquantity) ?? 0;
      return {
        id: String(r.did ?? r.pid ?? ''),
        date: nseDate(r.acqfromDt) ?? nseDate(r.date),
        disclosedAt: nseDateTime(r.date),
        person: String(r.acqName ?? '').trim(),
        category: String(r.personCategory ?? '').trim() || null,
        type: String(r.tdpTransactionType ?? '').trim() || null,
        mode: String(r.acqMode ?? '').trim() || null,
        security: String(r.secType ?? '').trim() || null,
        quantity: num(r.secAcq),
        value: num(r.secVal),
        buyQuantity: buyQty,
        sellQuantity: sellQty,
        holdingBefore: num(r.befAcqSharesNo),
        holdingAfter: num(r.afterAcqSharesNo),
        holdingPctBefore: num(r.befAcqSharesPer),
        holdingPctAfter: num(r.afterAcqSharesPer),
      };
    })
    .filter((r) => r.date && r.person)
    .sort(byDateDesc('date'));
}

/** Net promoter-group buying over a window (market purchases/sales only, gifts excluded). */
export function summarizePromoterActivity(trades, { sinceDate }) {
  let bought = 0;
  let sold = 0;
  for (const t of trades) {
    if (!t.date || t.date < sinceDate || !/promoter/i.test(t.category ?? '')) continue;
    if (!/^market/i.test(t.mode ?? '')) continue;
    if (/buy/i.test(t.type ?? '')) bought += t.value ?? 0;
    else if (/sell/i.test(t.type ?? '')) sold += t.value ?? 0;
  }
  return { bought, sold, net: bought - sold };
}

// ─── Filings, board meetings, annual reports ────────────────────────────────

const FILING_CATEGORY_RULES = [
  ['results', /financial result|integrated filing/i],
  ['board-meeting', /board meeting/i],
  ['dividend', /dividend|record date/i],
  ['concall', /con\.? ?call|conference call|analyst|investor meet|earnings call/i],
  ['presentation', /presentation/i],
  ['transcript', /transcript/i],
  ['rating', /credit rating/i],
  ['corporate-action', /allotment|buyback|bonus|split|rights|scheme of arrangement|merger|amalgamation|acquisition/i],
  ['governance', /shareholders meeting|agm|egm|postal ballot|appointment|resignation|cessation|auditor/i],
];

export function categorizeFiling(subject, text = '') {
  const hay = `${subject} ${text}`;
  for (const [category, re] of FILING_CATEGORY_RULES) if (re.test(hay)) return category;
  return 'other';
}

export function parseAnnouncements(json, { textLimit = 400 } = {}) {
  return (Array.isArray(json) ? json : [])
    .map((r) => {
      const text = String(r.attchmntText ?? '').replace(/\s+/g, ' ').trim();
      return {
        id: String(r.seq_id ?? r.dt ?? ''),
        at: nseDateTime(r.an_dt ?? r.sort_date),
        subject: String(r.desc ?? '').trim(),
        category: categorizeFiling(r.desc ?? '', text),
        text: text.length > textLimit ? `${text.slice(0, textLimit - 1)}…` : text,
        url: /^https?:/.test(r.attchmntFile ?? '') ? r.attchmntFile : null,
        size: r.attFileSize || r.fileSize || null,
      };
    })
    .filter((r) => r.at)
    .sort(byDateDesc('at'));
}

export function parseBoardMeetings(json) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(json) ? json : []) {
    const date = nseDate(r.bm_date);
    const rawPurpose = String(r.bm_purpose ?? '').trim();
    // NSE sometimes puts the whole announcement sentence in bm_purpose.
    const purpose = rawPurpose.length > 60 ? 'Board Meeting' : rawPurpose;
    const key = `${date}|${purpose}`;
    if (!date || seen.has(key)) continue;
    seen.add(key);
    out.push({
      date,
      purpose,
      forResults: /financial result/i.test(`${rawPurpose} ${r.bm_desc ?? ''}`),
      forDividend: /dividend/i.test(`${rawPurpose} ${r.bm_desc ?? ''}`),
      description: String(r.bm_desc ?? '').replace(/\s+/g, ' ').trim(),
      announcedAt: nseDateTime(r.bm_timestamp),
    });
  }
  return out.sort(byDateDesc('date'));
}

export function parseAnnualReports(json) {
  const rows = Array.isArray(json) ? json : json?.data ?? [];
  return rows
    .map((r) => ({
      fromYear: num(r.fromYr),
      toYear: num(r.toYr),
      url: /^https?:/.test(r.fileName ?? '') ? r.fileName : null,
      publishedAt: nseDateTime(r.broadcast_dttm ?? r.disseminationDateTime),
      size: r.attFileSize || null,
    }))
    .filter((r) => r.url && r.toYear)
    .sort((a, b) => (b.toYear ?? 0) - (a.toYear ?? 0));
}

// ─── Market-wide ────────────────────────────────────────────────────────────

/** Bulk / block / short deals snapshot for the last trading day. */
export function parseLargeDeals(json) {
  const rows = (list, type) => (Array.isArray(list) ? list : []).map((r) => {
    const qty = num(r.qty);
    const price = num(r.watp);
    return {
      type,
      date: nseDate(r.date),
      symbol: String(r.symbol ?? '').trim(),
      name: String(r.name ?? '').trim(),
      client: String(r.clientName ?? '').trim(),
      side: /sell/i.test(r.buySell ?? '') ? 'SELL' : /buy/i.test(r.buySell ?? '') ? 'BUY' : null,
      quantity: qty,
      price,
      value: qty != null && price != null ? Math.round(qty * price) : null,
    };
  }).filter((r) => r.symbol);
  return {
    asOf: nseDate(json?.as_on_date),
    bulk: rows(json?.BULK_DEALS_DATA, 'bulk'),
    block: rows(json?.BLOCK_DEALS_DATA, 'block'),
    short: rows(json?.SHORT_DEALS_DATA, 'short'),
  };
}

/** FII/DII provisional cash-market flows, ₹ crore. */
export function parseFiiDii(json) {
  const out = { date: null, fii: null, dii: null };
  for (const r of Array.isArray(json) ? json : []) {
    const flow = { buy: num(r.buyValue), sell: num(r.sellValue), net: num(r.netValue) };
    if (/fii|fpi/i.test(r.category ?? '')) out.fii = flow;
    else if (/dii/i.test(r.category ?? '')) out.dii = flow;
    out.date ??= nseDate(r.date);
  }
  return out;
}

export function parseAllIndices(json) {
  return {
    asOf: nseDateTime(json?.timestamp),
    advances: num(json?.advances),
    declines: num(json?.declines),
    unchanged: num(json?.unchanged),
    indices: (json?.data ?? []).map((r) => ({
      name: r.index,
      group: r.key ?? null,
      last: num(r.last),
      change: num(r.variation),
      changePct: num(r.percentChange),
      open: num(r.open),
      high: num(r.high),
      low: num(r.low),
      previousClose: num(r.previousClose),
      yearHigh: num(r.yearHigh),
      yearLow: num(r.yearLow),
      pe: num(r.pe),
      pb: num(r.pb),
      dividendYield: num(r.dy),
      advances: num(r.advances),
      declines: num(r.declines),
      change30dPct: num(r.perChange30d),
      change365dPct: num(r.perChange365d),
    })).filter((r) => r.name && r.last != null),
  };
}

export function parseHolidays(json) {
  const list = json?.CM ?? json?.CBM ?? [];
  return (Array.isArray(list) ? list : []).map((r) => nseDate(r.tradingDate)).filter(Boolean).sort();
}

// ─── Options ────────────────────────────────────────────────────────────────

/** option-chain-v3 for one expiry → strikes + PCR + max pain. */
export function parseOptionChain(json) {
  const records = json?.records;
  if (!records || !Array.isArray(records.data)) return null;
  const leg = (l) => (l ? {
    openInterest: num(l.openInterest) ?? 0,
    changeInOpenInterest: num(l.changeinOpenInterest) ?? 0,
    impliedVolatility: num(l.impliedVolatility),
    lastPrice: num(l.lastPrice),
    volume: num(l.totalTradedVolume) ?? 0,
  } : null);
  const rows = records.data
    .map((r) => ({ strike: num(r.strikePrice ?? r.CE?.strikePrice ?? r.PE?.strikePrice), call: leg(r.CE), put: leg(r.PE) }))
    .filter((r) => r.strike != null)
    .sort((a, b) => a.strike - b.strike);
  const callOi = rows.reduce((s, r) => s + (r.call?.openInterest ?? 0), 0);
  const putOi = rows.reduce((s, r) => s + (r.put?.openInterest ?? 0), 0);
  const first = records.data[0];
  return {
    underlying: first?.CE?.underlying ?? first?.PE?.underlying ?? null,
    underlyingValue: num(records.underlyingValue),
    expiry: nseDate(first?.expiryDates ?? records.expiryDates?.[0]),
    asOf: nseDateTime(records.timestamp),
    putCallRatio: callOi > 0 ? round(putOi / callOi, 3) : null,
    maxPain: maxPainStrike(rows),
    rows,
  };
}

/** Strike at which option writers pay out the least if the underlying expires there. */
export function maxPainStrike(rows) {
  let best = null;
  let bestPain = Infinity;
  for (const { strike: expiry } of rows) {
    let pain = 0;
    for (const r of rows) {
      pain += (r.call?.openInterest ?? 0) * Math.max(0, expiry - r.strike);
      pain += (r.put?.openInterest ?? 0) * Math.max(0, r.strike - expiry);
    }
    if (pain < bestPain) { bestPain = pain; best = expiry; }
  }
  return best;
}
