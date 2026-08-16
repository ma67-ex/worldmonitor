import type { PizzIntStatus, PizzIntLocation, PizzIntDefconLevel, GdeltTensionPair } from '@/types';
import { createLazyClient, getRpcBaseUrl } from '@/services/rpc-client';
import { createCircuitBreaker } from '@/utils';
import { getHydratedData } from '@/services/bootstrap';
import { t } from '@/services/i18n';
import type { GetPizzintStatusResponse, PizzintStatus as ProtoPizzintStatus, PizzintLocation as ProtoLocation, GdeltTensionPair as ProtoTensionPair } from '@/generated/client/worldmonitor/intelligence/v1/service_client';
import { IntelligenceServiceClient } from '@/services/generated-rpc-clients';

// ---- Sebuf client ----

const getClient = createLazyClient(() => new IntelligenceServiceClient(getRpcBaseUrl(), { fetch: (...args) => globalThis.fetch(...args) }));

// ---- Circuit breakers ----

const pizzintBreaker = createCircuitBreaker<PizzIntStatus>({
  name: 'PizzINT',
  maxFailures: 3,
  cooldownMs: 5 * 60 * 1000,
  cacheTtlMs: 30 * 60 * 1000,
  persistCache: true,
});

const gdeltBreaker = createCircuitBreaker<GdeltTensionPair[]>({
  name: 'GDELT Tensions',
  maxFailures: 3,
  cooldownMs: 5 * 60 * 1000,
  cacheTtlMs: 15 * 60 * 1000,
  persistCache: true,
});

// ---- Proto → legacy adapters ----

const DEFCON_LABELS: Record<number, string> = {
  1: 'components.pizzint.defconLabels.1',
  2: 'components.pizzint.defconLabels.2',
  3: 'components.pizzint.defconLabels.3',
  4: 'components.pizzint.defconLabels.4',
  5: 'components.pizzint.defconLabels.5',
};

const FRESHNESS_REVERSE: Record<string, 'fresh' | 'stale'> = {
  DATA_FRESHNESS_FRESH: 'fresh',
  DATA_FRESHNESS_STALE: 'stale',
};

const TREND_REVERSE: Record<string, 'rising' | 'stable' | 'falling'> = {
  TREND_DIRECTION_RISING: 'rising',
  TREND_DIRECTION_STABLE: 'stable',
  TREND_DIRECTION_FALLING: 'falling',
};

function toLocation(proto: ProtoLocation): PizzIntLocation {
  return {
    place_id: proto.placeId,
    name: proto.name,
    address: proto.address,
    current_popularity: proto.currentPopularity,
    percentage_of_usual: proto.percentageOfUsual || null,
    is_spike: proto.isSpike,
    spike_magnitude: typeof proto.spikeMagnitude === 'number' ? proto.spikeMagnitude : null,
    data_source: proto.dataSource,
    recorded_at: proto.recordedAt,
    data_freshness: FRESHNESS_REVERSE[proto.dataFreshness] || 'stale',
    is_closed_now: proto.isClosedNow,
    lat: proto.lat || undefined,
    lng: proto.lng || undefined,
  };
}

function toStatus(proto: ProtoPizzintStatus): PizzIntStatus {
  const level = (proto.defconLevel >= 1 && proto.defconLevel <= 5 ? proto.defconLevel : 5) as PizzIntDefconLevel;
  return {
    defconLevel: level,
    defconLabel: t(DEFCON_LABELS[level] ?? DEFCON_LABELS[5]!),
    aggregateActivity: proto.aggregateActivity,
    activeSpikes: proto.activeSpikes,
    locationsMonitored: proto.locationsMonitored,
    locationsOpen: proto.locationsOpen,
    lastUpdate: proto.updatedAt ? new Date(proto.updatedAt) : new Date(),
    dataFreshness: FRESHNESS_REVERSE[proto.dataFreshness] || 'stale',
    locations: proto.locations.map(toLocation),
  };
}

function toTensionPair(proto: ProtoTensionPair): GdeltTensionPair {
  return {
    id: proto.id,
    countries: [proto.countries[0] || '', proto.countries[1] || ''] as [string, string],
    label: proto.label,
    score: proto.score,
    trend: TREND_REVERSE[proto.trend] || 'stable',
    changePercent: proto.changePercent,
    region: proto.region,
  };
}

// ---- Default / fallback values ----

const defaultStatus: PizzIntStatus = {
  defconLevel: 5,
  defconLabel: t('components.pizzint.defconLabels.5'),
  aggregateActivity: 0,
  activeSpikes: 0,
  locationsMonitored: 0,
  locationsOpen: 0,
  lastUpdate: new Date(),
  dataFreshness: 'stale',
  locations: []
};

// ---- pizzint.watch direct source (SITREP fork, no WorldMonitor backend) ----
// pizzint.watch sends no Access-Control-Allow-Origin, so the browser can't
// call it directly -- api/pizzint-proxy.js re-serves it same-origin with
// permissive CORS. See docs/plans/2026-08-15-...-plan.md.

interface PizzintWatchLocation {
  place_id: string;
  name: string;
  address: string;
  current_popularity: number;
  percentage_of_usual: number | null;
  is_spike: boolean;
  data_source: string;
  recorded_at: string;
  data_freshness: 'fresh' | 'stale';
  is_closed_now: boolean;
}

interface PizzintWatchResponse {
  success: boolean;
  data: PizzintWatchLocation[];
  overall_index: number;
  defcon_level: number;
  active_spikes: number;
  timestamp: string;
  data_freshness: 'fresh' | 'stale';
}

function fromPizzintWatch(raw: PizzintWatchResponse): PizzIntStatus {
  const level = (raw.defcon_level >= 1 && raw.defcon_level <= 5 ? raw.defcon_level : 5) as PizzIntDefconLevel;
  return {
    defconLevel: level,
    defconLabel: t(DEFCON_LABELS[level] ?? DEFCON_LABELS[5]!),
    aggregateActivity: raw.overall_index,
    activeSpikes: raw.active_spikes,
    locationsMonitored: raw.data.length,
    locationsOpen: raw.data.filter(l => !l.is_closed_now).length,
    lastUpdate: new Date(raw.timestamp),
    dataFreshness: raw.data_freshness,
    locations: raw.data.map(l => ({
      place_id: l.place_id,
      name: l.name,
      address: l.address,
      current_popularity: l.current_popularity,
      percentage_of_usual: l.percentage_of_usual,
      is_spike: l.is_spike,
      spike_magnitude: null,
      data_source: l.data_source,
      recorded_at: l.recorded_at,
      data_freshness: l.data_freshness,
      is_closed_now: l.is_closed_now,
    })),
  };
}

async function fetchFromPizzintWatch(): Promise<PizzIntStatus | null> {
  try {
    const resp = await fetch('/api/pizzint-proxy', { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return null;
    const raw = await resp.json() as PizzintWatchResponse;
    if (!raw.success || !Array.isArray(raw.data)) return null;
    return fromPizzintWatch(raw);
  } catch {
    return null;
  }
}

// ---- Public API ----

export async function fetchPizzIntStatus(): Promise<PizzIntStatus> {
  // Direct source first, not hydrated: the SITREP fork has no live backend
  // feeding the bootstrap hydration cache, so a hydrated 'pizzint' entry is
  // always a stale snapshot (browser-persisted from an earlier session) and
  // must never win over a fresh pizzint.watch fetch.
  const direct = await fetchFromPizzintWatch();
  if (direct && direct.locationsMonitored > 0) return direct;

  const hydrated = getHydratedData('pizzint') as GetPizzintStatusResponse | undefined;
  if (hydrated?.pizzint) return toStatus(hydrated.pizzint);

  return pizzintBreaker.execute(async () => {
    const resp: GetPizzintStatusResponse = await getClient().getPizzintStatus({ includeGdelt: false });
    if (!resp.pizzint) throw new Error('No PizzINT data');
    return toStatus(resp.pizzint);
  }, defaultStatus);
}

export async function fetchGdeltTensions(): Promise<GdeltTensionPair[]> {
  return gdeltBreaker.execute(async () => {
    const resp: GetPizzintStatusResponse = await getClient().getPizzintStatus({ includeGdelt: true });
    return resp.tensionPairs.map(toTensionPair);
  }, []);
}

export function getPizzIntStatus(): string {
  return pizzintBreaker.getStatus();
}

export function getGdeltStatus(): string {
  return gdeltBreaker.getStatus();
}
