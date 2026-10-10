// Builds public/data/airports.json from the OpenFlights airports.dat (ODbL).
// Usage: node scripts/build-airports-data.mjs <path-to-airports.dat>
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2];
if (!src) throw new Error('usage: build-airports-data.mjs <airports.dat>');

const rows = [];
for (const line of readFileSync(src, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const f = [];
  const re = /("([^"]*)"|[^,]*)(,|$)/g;
  let m;
  while ((m = re.exec(line)) && f.length < 14) {
    f.push(m[2] !== undefined ? m[2] : m[1]);
    if (!m[3]) break;
  }
  const [, name, city, country, iata, icao, lat, lon, alt, , , tz, type] = f;
  if (type !== 'airport' || !iata || iata === '\\N' || !tz || tz === '\\N') continue;
  rows.push([iata, icao === '\\N' ? '' : icao, name, city, country, +Number(lat).toFixed(4), +Number(lon).toFixed(4), Math.round(Number(alt) || 0), tz]);
}
writeFileSync(new URL('../public/data/airports.json', import.meta.url), JSON.stringify({ v: 1, fields: ['iata', 'icao', 'name', 'city', 'country', 'lat', 'lon', 'elevFt', 'tz'], rows }));
console.log(`wrote ${rows.length} airports`);
