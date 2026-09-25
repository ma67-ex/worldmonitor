/**
 * The 45-country primary-stock-index enum, duplicated from
 * shared/openapi-filter-param-contracts.json's `marketCountryStockIndexes`.
 *
 * Edge Functions cannot import JSON via import attributes and cannot read the
 * filesystem, so this stays a same-directory helper instead of an import of
 * the JSON file. Keep in sync with that file (or with
 * scripts/_country-stock-index-registry.mjs, which reads it for seeding) if
 * a country is added or removed from the enum.
 */
export const GLOBAL_COUNTRY_INDEXES = {
  AE: { symbol: 'DFMGI.AE', name: 'DFM General' },
  AR: { symbol: '^MERV', name: 'MERVAL' },
  AT: { symbol: '^ATX', name: 'ATX' },
  AU: { symbol: '^AXJO', name: 'ASX 200' },
  BE: { symbol: '^BFX', name: 'BEL 20' },
  BR: { symbol: '^BVSP', name: 'Bovespa' },
  CA: { symbol: '^GSPTSE', name: 'TSX Composite' },
  CH: { symbol: '^SSMI', name: 'SMI' },
  CL: { symbol: '^IPSA', name: 'IPSA' },
  CN: { symbol: '000001.SS', name: 'SSE Composite' },
  CZ: { symbol: '^PX', name: 'PX Prague' },
  DE: { symbol: '^GDAXI', name: 'DAX' },
  DK: { symbol: '^OMXC25', name: 'OMX Copenhagen 25' },
  EG: { symbol: '^EGX30.CA', name: 'EGX 30' },
  ES: { symbol: '^IBEX', name: 'IBEX 35' },
  FI: { symbol: '^OMXH25', name: 'OMX Helsinki 25' },
  FR: { symbol: '^FCHI', name: 'CAC 40' },
  GB: { symbol: '^FTSE', name: 'FTSE 100' },
  HK: { symbol: '^HSI', name: 'Hang Seng' },
  HU: { symbol: '^BUX', name: 'BUX' },
  ID: { symbol: '^JKSE', name: 'Jakarta Composite' },
  IE: { symbol: '^ISEQ', name: 'ISEQ Overall' },
  IL: { symbol: '^TA125.TA', name: 'TA-125' },
  IN: { symbol: '^BSESN', name: 'BSE Sensex' },
  IT: { symbol: 'FTSEMIB.MI', name: 'FTSE MIB' },
  JP: { symbol: '^N225', name: 'Nikkei 225' },
  KR: { symbol: '^KS11', name: 'KOSPI' },
  MX: { symbol: '^MXX', name: 'IPC Mexico' },
  MY: { symbol: '^KLSE', name: 'KLCI' },
  NL: { symbol: '^AEX', name: 'AEX' },
  NO: { symbol: '^OSEAX', name: 'Oslo All Share' },
  NZ: { symbol: '^NZ50', name: 'NZX 50' },
  PE: { symbol: '^SPBLPGPT', name: 'S&P Lima' },
  PH: { symbol: 'PSEI.PS', name: 'PSEi' },
  PL: { symbol: '^WIG20', name: 'WIG 20' },
  PT: { symbol: '^PSI20', name: 'PSI 20' },
  RU: { symbol: 'IMOEX.ME', name: 'MOEX' },
  SA: { symbol: '^TASI.SR', name: 'Tadawul' },
  SE: { symbol: '^OMX', name: 'OMX Stockholm 30' },
  SG: { symbol: '^STI', name: 'STI' },
  TH: { symbol: '^SET.BK', name: 'SET' },
  TR: { symbol: 'XU100.IS', name: 'BIST 100' },
  TW: { symbol: '^TWII', name: 'TAIEX' },
  US: { symbol: '^GSPC', name: 'S&P 500' },
  ZA: { symbol: '^J203.JO', name: 'JSE All Share' },
};
