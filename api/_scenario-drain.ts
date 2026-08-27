/**
 * Scenario queue drain — Edge-safe, single-invocation version of
 * scripts/scenario-worker.mjs, for an external cron to hit directly
 * (docs/tasks/abdullah/22-github-actions-minutes-exhausted.md, option 2).
 *
 * Not an import of scripts/scenario-worker.mjs: that file is a Node CLI
 * (process.argv entrypoint guard, SIGTERM handler, node:url) and none of
 * that runs on Vercel's Edge runtime. The queue logic below is copied, not
 * shared — same precedent as SCENARIO_TEMPLATES already being a documented
 * "keep in sync" duplicate of server/worldmonitor/supply-chain/v1/scenario-templates.ts.
 * If you change one drain loop's semantics, change both.
 *
 * Budget is 20s, not the CLI's 4 minutes — Vercel Edge Functions on Hobby
 * are capped around 25s execution. A job left in scenario-queue:processing
 * when this budget runs out is not lost: requeueOrphanedJobs() below moves
 * it back to pending on the *next* invocation, the same self-healing crash
 * recovery the CLI worker already relies on. Upstash's REST BLMOVE does not
 * honor its blocking-timeout argument (returns null immediately on an empty
 * queue, confirmed in the CLI worker) — so this never actually blocks
 * waiting for a job, which is what makes a 20s Edge budget safe to use at
 * all instead of just failing on the first empty-queue poll.
 *
 * Auth: same RELAY_SHARED_SECRET internal-cron pattern as every other
 * ops-admin endpoint here (see server/_shared/internal-auth.ts) — this is
 * not a new secret to provision.
 */

export const config = { runtime: 'edge' };

import { authenticateInternalRequest } from '../server/_shared/internal-auth';
import { getRedisCredentials } from './_upstash-json.js';

const QUEUE_KEY = 'scenario-queue:pending';
const PROCESSING_KEY = 'scenario-queue:processing';
const RESULT_TTL_SECONDS = 86_400; // 24 h
// Real ceiling under Edge's own ~25s execution limit — leaves headroom for
// the function's cold-start + response serialization, not just compute.
const MAX_RUN_MS = 20_000;

type ScenarioJob = { jobId: string; scenarioId: string; iso2: string | null; enqueuedAt: number };

// Inline copy of SCENARIO_TEMPLATES — keep in sync with
// scripts/scenario-worker.mjs and server/worldmonitor/supply-chain/v1/scenario-templates.ts.
const SCENARIO_TEMPLATES: Array<{
  id: string;
  affectedChokepointIds: string[];
  disruptionPct: number;
  durationDays: number;
  affectedHs2: string[] | null;
  costShockMultiplier: number;
}> = [
  { id: 'taiwan-strait-full-closure', affectedChokepointIds: ['taiwan_strait'], disruptionPct: 100, durationDays: 30, affectedHs2: ['84', '85', '87'], costShockMultiplier: 1.45 },
  { id: 'suez-bab-simultaneous', affectedChokepointIds: ['suez', 'bab_el_mandeb'], disruptionPct: 80, durationDays: 60, affectedHs2: null, costShockMultiplier: 1.35 },
  { id: 'panama-drought-50pct', affectedChokepointIds: ['panama'], disruptionPct: 50, durationDays: 90, affectedHs2: null, costShockMultiplier: 1.22 },
  { id: 'hormuz-tanker-blockade', affectedChokepointIds: ['hormuz_strait'], disruptionPct: 100, durationDays: 14, affectedHs2: ['27', '29'], costShockMultiplier: 2.10 },
  { id: 'russia-baltic-grain-suspension', affectedChokepointIds: ['bosphorus', 'dover_strait'], disruptionPct: 100, durationDays: 180, affectedHs2: ['10', '12'], costShockMultiplier: 1.55 },
  { id: 'us-tariff-escalation-electronics', affectedChokepointIds: [], disruptionPct: 0, durationDays: 365, affectedHs2: ['85'], costShockMultiplier: 1.50 },
];

// ── Redis helpers (Upstash REST API) — identical to scripts/scenario-worker.mjs ──

async function redisCmd(url: string, token: string, cmd: string, args: unknown[]): Promise<unknown> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([cmd.toUpperCase(), ...args]),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Redis ${cmd} HTTP ${resp.status}`);
  const body = (await resp.json()) as { result: unknown };
  return body.result;
}

async function redisGet(url: string, token: string, key: string): Promise<unknown> {
  const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!resp.ok) return null;
  const body = (await resp.json()) as { result?: string };
  return body.result ? JSON.parse(body.result) : null;
}

async function redisSetex(url: string, token: string, key: string, ttl: number, value: string): Promise<void> {
  await redisCmd(url, token, 'setex', [key, ttl, value]);
}

async function redisLrem(url: string, token: string, key: string, value: string): Promise<void> {
  await redisCmd(url, token, 'lrem', [key, 1, value]);
}

async function redisPipelineGet(url: string, token: string, keys: string[]): Promise<Array<unknown | null>> {
  if (keys.length === 0) return [];
  const pipeline = keys.map((k) => ['GET', k]);
  const resp = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(pipeline),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Redis pipeline HTTP ${resp.status}`);
  const results = (await resp.json()) as Array<{ result: string | null }>;
  return results.map((r) => {
    if (!r?.result) return null;
    try {
      return JSON.parse(r.result);
    } catch {
      return null;
    }
  });
}

// ── Scenario computation — identical to scripts/scenario-worker.mjs ──

async function computeScenario(url: string, token: string, scenarioId: string, iso2: string | null) {
  const template = SCENARIO_TEMPLATES.find((t) => t.id === scenarioId);
  if (!template) throw new Error(`Unknown scenario: ${scenarioId}`);

  const cpData = (await redisGet(url, token, 'supply_chain:chokepoints:v4').catch(() => null)) as
    | { chokepoints?: Array<{ id?: string; disruptionScore?: number }> }
    | null;

  const currentScores = new Map<string, number>();
  const cpArray = Array.isArray(cpData?.chokepoints) ? cpData!.chokepoints! : [];
  for (const cp of cpArray) {
    if (cp?.id && typeof cp.disruptionScore === 'number') currentScores.set(cp.id, cp.disruptionScore);
  }

  const SEEDED_REPORTERS = ['US', 'CN', 'RU', 'IR', 'IN', 'TW'];
  const reportersToCheck = iso2 ? [iso2] : SEEDED_REPORTERS;
  const impacts: Array<{ iso2: string; hs2: string; exposureScore: number; adjustedImpact: number; chokepointId: string }> = [];
  const isTariffShock = template.affectedChokepointIds.length === 0;
  const hs2Chapters = template.affectedHs2 ?? Array.from({ length: 99 }, (_, i) => String(i + 1).padStart(2, '0'));

  const allKeys: string[] = [];
  for (const reporter of reportersToCheck) {
    for (const hs2 of hs2Chapters) allKeys.push(`supply-chain:exposure:${reporter}:${hs2}:v1`);
  }

  const pipelineResults = await redisPipelineGet(url, token, allKeys);

  let idx = 0;
  for (const reporter of reportersToCheck) {
    for (const hs2 of hs2Chapters) {
      const data = pipelineResults[idx++] as
        | { iso2?: string; hs2?: string; exposures?: Array<{ chokepointId: string; exposureScore: number }>; vulnerabilityIndex?: number }
        | null;
      if (!data || !Array.isArray(data.exposures)) continue;

      if (isTariffShock) {
        const vulnScore = typeof data.vulnerabilityIndex === 'number' ? data.vulnerabilityIndex : 0;
        if (vulnScore > 0) {
          impacts.push({ iso2: reporter, hs2, exposureScore: vulnScore, adjustedImpact: vulnScore * template.costShockMultiplier, chokepointId: 'tariff' });
        }
        continue;
      }

      for (const entry of data.exposures) {
        if (!entry?.chokepointId || typeof entry.exposureScore !== 'number') continue;
        if (!template.affectedChokepointIds.includes(entry.chokepointId)) continue;
        const exposureScore = entry.exposureScore;
        const adjustedImpact = exposureScore * (template.disruptionPct / 100) * template.costShockMultiplier;
        if (exposureScore > 0) impacts.push({ iso2: reporter, hs2, exposureScore, adjustedImpact, chokepointId: entry.chokepointId });
      }
    }
  }

  const byCountry = new Map<string, number>();
  for (const item of impacts) byCountry.set(item.iso2, (byCountry.get(item.iso2) ?? 0) + item.adjustedImpact);

  const sorted = [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  const maxImpact = Math.max(sorted[0]?.[1] ?? 0, 1);
  const topImpactCountries = sorted.map(([countryIso2, totalImpact]) => ({
    iso2: countryIso2,
    totalImpact,
    impactPct: Math.min(Math.round((totalImpact / maxImpact) * 100), 100),
  }));

  return {
    scenarioId,
    template: {
      name: template.affectedChokepointIds.join('+') || 'tariff_shock',
      disruptionPct: template.disruptionPct,
      durationDays: template.durationDays,
      costShockMultiplier: template.costShockMultiplier,
    },
    affectedChokepointIds: template.affectedChokepointIds,
    currentDisruptionScores: Object.fromEntries(template.affectedChokepointIds.map((id) => [id, currentScores.get(id) ?? null])),
    topImpactCountries,
    affectedHs2: template.affectedHs2,
    scopedIso2: iso2,
    computedAt: Date.now(),
  };
}

const JOB_ID_RE = /^scenario:\d{13}:[a-z0-9]{8}$/;

async function requeueOrphanedJobs(url: string, token: string): Promise<number> {
  let count = 0;
  let moved: unknown;
  do {
    moved = await redisCmd(url, token, 'lmove', [PROCESSING_KEY, QUEUE_KEY, 'RIGHT', 'LEFT']).catch(() => null);
    if (moved) count++;
  } while (moved);
  return count;
}

export default async function handler(req: Request): Promise<Response> {
  const unauthorized = await authenticateInternalRequest(req, 'RELAY_SHARED_SECRET');
  if (unauthorized) return unauthorized;

  const creds = getRedisCredentials();
  if (!creds) {
    return new Response(JSON.stringify({ error: 'Redis not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const { url, token } = creds as { url: string; token: string };

  const requeued = await requeueOrphanedJobs(url, token);

  const runStartedAt = Date.now();
  let processed = 0;
  let queueEmptied = false;

  while (Date.now() - runStartedAt < MAX_RUN_MS) {
    let raw: unknown;
    try {
      // Upstash REST does not honor BLMOVE's blocking-timeout arg — returns
      // null immediately on an empty queue (confirmed in the CLI worker).
      raw = await redisCmd(url, token, 'blmove', [QUEUE_KEY, PROCESSING_KEY, 'LEFT', 'RIGHT', 30]);
    } catch {
      break; // transient Redis error — let the next invocation retry
    }

    if (!raw) {
      queueEmptied = true;
      break;
    }

    let job: ScenarioJob | null = null;
    try {
      job = JSON.parse(String(raw));
    } catch {
      await redisLrem(url, token, PROCESSING_KEY, String(raw)).catch(() => {});
      continue;
    }

    const { jobId, scenarioId, iso2 } = job!;
    if (
      typeof jobId !== 'string' || !JOB_ID_RE.test(jobId) ||
      typeof scenarioId !== 'string' ||
      (iso2 !== null && (typeof iso2 !== 'string' || !/^[A-Z]{2}$/.test(iso2)))
    ) {
      await redisLrem(url, token, PROCESSING_KEY, String(raw)).catch(() => {});
      continue;
    }

    const resultKey = `scenario-result:${jobId}`;
    const existing = await redisGet(url, token, resultKey).catch(() => null);
    if (existing) {
      await redisLrem(url, token, PROCESSING_KEY, String(raw)).catch(() => {});
      continue;
    }

    await redisSetex(url, token, resultKey, RESULT_TTL_SECONDS, JSON.stringify({ status: 'processing', startedAt: Date.now() })).catch(() => {});

    try {
      const result = await computeScenario(url, token, scenarioId, iso2);
      await redisSetex(url, token, resultKey, RESULT_TTL_SECONDS, JSON.stringify({ status: 'done', result, completedAt: Date.now() }));
      processed++;
    } catch {
      await redisSetex(url, token, resultKey, RESULT_TTL_SECONDS, JSON.stringify({ status: 'failed', error: 'computation_error', failedAt: Date.now() })).catch(() => {});
    } finally {
      await redisLrem(url, token, PROCESSING_KEY, String(raw)).catch(() => {});
    }
  }

  return new Response(
    JSON.stringify({ processed, requeued, queueEmptied, tookMs: Date.now() - runStartedAt }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
