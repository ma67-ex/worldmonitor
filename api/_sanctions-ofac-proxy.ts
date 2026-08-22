// Free alt-source for the sanctions-pressure panel (task 04,
// docs/tasks/abdullah/04-sanctions-pressure.md). OFAC's SDN entities feed
// (sanctionslistservice.ofac.treas.gov/entities) is genuinely CORS-open but
// is a ~111MB bulk XML dump, not a paginated JSON API -- not fetchable from
// a browser panel. This edge function fetches it server-side ONCE per cache
// TTL, streams the XML and reduces it to a small per-country/per-program
// aggregate, and caches that small JSON in Redis so every other request
// (the overwhelming majority) is a cache hit with no upstream fetch at all.
//
// Streaming (ReadableStream + incremental buffer scanning) instead of
// buffering the whole response is deliberate: this is an Edge Function, not
// a Node serverless function, and Edge isolates have real memory ceilings --
// holding a 111MB string plus regex match state would risk exceeding them.
//
// scripts/seed-sanctions-pressure.mjs already solves a version of this
// problem for the same fork (real `sax` streaming parser, a richer output
// shape) but it's a Node script meant for the deferred Railway seed-infra,
// not something this Vercel Edge Function can import: `sax` reaches for
// Node's `Buffer`/`require('stream')` internally, which Edge Runtime does
// not reliably provide, and Akul's decision for this task explicitly rules
// out adding a Node (non-edge) function for it (12-function cap). Hand-rolled
// buffer scanning below uses only Web-standard APIs (fetch/ReadableStream/
// TextDecoder/String) that Edge Runtime guarantees, at the cost of a
// simpler/coarser aggregate than the seeder produces.
// @ts-expect-error — JS module, no declaration file
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
// @ts-expect-error — JS module, no declaration file
import { jsonResponse } from './_json-response.js';
import { cachedFetchJson } from '../server/_shared/redis';

export const config = { runtime: 'edge' };

const OFAC_ENTITIES_URL = 'https://sanctionslistservice.ofac.treas.gov/entities';
const REDIS_KEY = 'sanctions:ofac-country-aggregate:v1';
// OFAC republishes this feed multiple times a week, not multiple times a
// day -- 24h keeps the 111MB fetch rare without staling designations badly.
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const NEGATIVE_TTL_SECONDS = 30 * 60;
// ponytail: bail out with whatever's aggregated so far past this budget
// rather than risk the Edge Function's own execution ceiling killing the
// request uncleanly. Raise this (and the cachedFetchJson timeoutMs below,
// which must stay above it) if production shows the real 111MB transfer
// regularly needs longer -- unverified from this environment, see the task's
// status note for why.
const PARSE_TIME_BUDGET_MS = 45_000;
// SDN entries carry no "date added" field the aggregate keeps -- the closest
// live signal is the most recent per-designation datePublished on the
// entity's <sanctionsList> membership. Republication could in principle
// bump this without a genuinely new designation; treating it as "new this
// window" is a best-effort heuristic, not a guarantee (documented in the
// task's status notes).
const NEW_ENTRY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

interface CountryAggregate {
  countryName: string;
  entryCount: number;
  newEntryCount: number;
  vesselCount: number;
  aircraftCount: number;
}

interface ProgramAggregate {
  program: string;
  entryCount: number;
  newEntryCount: number;
}

interface OfacAggregateResult {
  fetchedAt: number;
  datasetDate: string | null;
  totalCount: number;
  newEntryCount: number;
  vesselCount: number;
  aircraftCount: number;
  countries: CountryAggregate[];
  programs: ProgramAggregate[];
  partial: boolean;
}

function extractEntityFields(block: string): {
  entityType: string;
  countries: Set<string>;
  programs: Set<string>;
  mostRecentDate: string | null;
} {
  const typeMatch = block.match(/<entityType[^>]*>([^<]*)<\/entityType>/);
  const entityType = typeMatch?.[1]?.trim() || 'Entity';

  const countries = new Set<string>();
  for (const m of block.matchAll(/<country[^>]*>([^<]*)<\/country>/g)) {
    const name = m[1]?.trim();
    if (name) countries.add(name);
  }

  const programs = new Set<string>();
  for (const m of block.matchAll(/<sanctionsProgram[^>]*>([^<]*)<\/sanctionsProgram>/g)) {
    const name = m[1]?.trim();
    if (name) programs.add(name);
  }

  let mostRecentDate: string | null = null;
  for (const m of block.matchAll(/datePublished="([\d-]+)"/g)) {
    const d = m[1];
    if (d && (!mostRecentDate || d > mostRecentDate)) mostRecentDate = d;
  }

  return { entityType, countries, programs, mostRecentDate };
}

async function fetchOfacAggregate(): Promise<OfacAggregateResult | null> {
  const resp = await fetch(OFAC_ENTITIES_URL, {
    headers: { 'User-Agent': 'SITREP/1.0 (+https://github.com/AkulxSharma/worldmonitor)' },
  });
  if (!resp.ok || !resp.body) return null;

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const startedAt = Date.now();
  const nowMs = Date.now();

  let buffer = '';
  let datasetDate: string | null = null;
  let totalCount = 0;
  let newEntryCount = 0;
  let vesselCount = 0;
  let aircraftCount = 0;
  const countryAgg = new Map<string, CountryAggregate>();
  const programAgg = new Map<string, ProgramAggregate>();
  let partial = false;

  try {
    while (true) {
      if (Date.now() - startedAt > PARSE_TIME_BUDGET_MS) {
        partial = true;
        try { await reader.cancel(); } catch { /* best effort */ }
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      if (datasetDate === null) {
        const dateMatch = buffer.match(/<dataAsOf>([^<]*)<\/dataAsOf>/);
        if (dateMatch?.[1]) datasetDate = dateMatch[1].trim();
      }

      let start: number;
      // Bound buffer growth to one entity block at a time -- never holds the
      // full document, only whatever hasn't been consumed into an aggregate yet.
      while ((start = buffer.indexOf('<entity ')) !== -1) {
        const end = buffer.indexOf('</entity>', start);
        if (end === -1) break; // incomplete block -- wait for the next chunk
        const block = buffer.slice(start, end + '</entity>'.length);
        buffer = buffer.slice(end + '</entity>'.length);

        const { entityType, countries, programs, mostRecentDate } = extractEntityFields(block);
        totalCount++;
        const isNew = mostRecentDate !== null && (nowMs - Date.parse(mostRecentDate)) < NEW_ENTRY_WINDOW_MS;
        const isVessel = entityType === 'Vessel';
        const isAircraft = entityType === 'Aircraft';
        if (isNew) newEntryCount++;
        if (isVessel) vesselCount++;
        if (isAircraft) aircraftCount++;

        for (const countryName of countries) {
          let agg = countryAgg.get(countryName);
          if (!agg) {
            agg = { countryName, entryCount: 0, newEntryCount: 0, vesselCount: 0, aircraftCount: 0 };
            countryAgg.set(countryName, agg);
          }
          agg.entryCount++;
          if (isNew) agg.newEntryCount++;
          if (isVessel) agg.vesselCount++;
          if (isAircraft) agg.aircraftCount++;
        }

        for (const program of programs) {
          let pAgg = programAgg.get(program);
          if (!pAgg) {
            pAgg = { program, entryCount: 0, newEntryCount: 0 };
            programAgg.set(program, pAgg);
          }
          pAgg.entryCount++;
          if (isNew) pAgg.newEntryCount++;
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released by cancel() */ }
  }

  // A parse that produced nothing usable is indistinguishable from a fetch
  // that failed silently -- treat it the same way (don't cache an empty
  // result that would otherwise hide a real failure for a full TTL).
  if (totalCount === 0) return null;

  return {
    fetchedAt: Date.now(),
    datasetDate,
    totalCount,
    newEntryCount,
    vesselCount,
    aircraftCount,
    countries: Array.from(countryAgg.values()).sort((a, b) => b.entryCount - a.entryCount),
    programs: Array.from(programAgg.values()).sort((a, b) => b.entryCount - a.entryCount),
    partial,
  };
}

export default async function handler(req: Request): Promise<Response> {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (isDisallowedOrigin(req)) {
    return jsonResponse({ error: 'Origin not allowed' }, 403, corsHeaders);
  }

  const data = await cachedFetchJson<OfacAggregateResult>(
    REDIS_KEY,
    CACHE_TTL_SECONDS,
    fetchOfacAggregate,
    NEGATIVE_TTL_SECONDS,
    { timeoutMs: PARSE_TIME_BUDGET_MS + 15_000 },
  );

  if (!data) {
    return jsonResponse(
      { error: 'OFAC sanctions data temporarily unavailable' },
      503,
      { 'Cache-Control': 'no-cache, no-store', ...corsHeaders },
    );
  }

  return jsonResponse(data, 200, {
    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=21600, stale-if-error=86400',
    ...corsHeaders,
  });
}
