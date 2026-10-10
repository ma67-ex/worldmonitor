export interface WorldAirport {
  iata: string;
  icao: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  elevFt: number;
  tz: string;
}

const DATA_URL = '/data/airports.json';
const CACHE_NAME = 'wm-airports-v1';

let loading: Promise<WorldAirport[]> | null = null;

async function fetchRows(): Promise<unknown> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(DATA_URL);
    if (hit) return await hit.json();
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`airports ${res.status}`);
    await cache.put(DATA_URL, res.clone());
    return await res.json();
  } catch {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`airports ${res.status}`);
    return res.json();
  }
}

/** Fetched once per session (and persisted in the Cache API across visits). */
export function loadWorldAirports(): Promise<WorldAirport[]> {
  loading ??= fetchRows().then((raw) => {
    const rows = (raw as { rows: [string, string, string, string, string, number, number, number, string][] }).rows;
    return rows.map(([iata, icao, name, city, country, lat, lon, elevFt, tz]) => ({ iata, icao, name, city, country, lat, lon, elevFt, tz }));
  }).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Current local time, UTC offset and day/night flag at an airport's IANA timezone. */
export function airportLocalTime(tz: string, now = new Date()): { time: string; date: string; offset: string; isDay: boolean } {
  let fmt = formatters.get(tz);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'shortOffset' });
    } catch {
      fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'shortOffset' });
    }
    formatters.set(tz, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return {
    time: `${String(hour).padStart(2, '0')}:${p.minute}`,
    date: `${p.weekday} ${p.day} ${p.month}`,
    offset: p.timeZoneName ?? 'UTC',
    isDay: hour >= 6 && hour < 18,
  };
}
