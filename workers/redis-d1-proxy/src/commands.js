// Redis command implementations backed by D1 (see ../schema.sql).
//
// Each handler mirrors the real Redis command's return shape closely enough for
// server/_shared/redis.ts and server/_shared/rate-limit.ts to work unmodified —
// those two files (plus api/_rate-limit-fallback.js) are the actual contract;
// this is not a general-purpose Redis clone.
//
// Known simplification: POST /multi-exec runs its commands sequentially through
// this same dispatch table, not inside one SQL transaction (D1's Workers binding
// exposes `batch()` for independent prepared statements, not read-modify-write
// chains like LPUSH's head/tail counter update). The one real caller of
// multi-exec, prependCachedJsonList's LREM+LPUSH+LTRIM+EXPIRE sequence, is a
// single-writer-per-key cache list — the missing atomicity is a narrow race
// between two concurrent writers to the same key, not a correctness hole for
// this app's read-mostly traffic. Upgrade path: add real BEGIN/COMMIT once D1
// exposes it from the Workers API, or move list writes behind a Durable Object.

const NOT_FOUND = Symbol('not-found');

function now() {
  return Date.now();
}

async function getMeta(db, key) {
  const row = await db.prepare('SELECT type, expires_at FROM meta WHERE key = ?').bind(key).first();
  if (!row) return null;
  if (row.expires_at != null && row.expires_at <= now()) return null; // lazily expired; cron sweep reclaims storage
  return row;
}

// Preserves an existing key's TTL across a value-only mutation (INCR, HSET,
// LPUSH, ...) — matches Redis, where only SET-family commands touch expiry.
async function touchMeta(db, key, type, expiresAt = null) {
  await db.prepare(
    'INSERT INTO meta (key, type, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET type = excluded.type',
  ).bind(key, type, expiresAt).run();
}

// SET-family commands must overwrite any existing TTL (to the new one, or to
// no TTL at all) rather than preserve it — the opposite of touchMeta above.
async function setMetaAndExpiry(db, key, type, expiresAt) {
  await db.prepare(
    'INSERT INTO meta (key, type, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET type = excluded.type, expires_at = excluded.expires_at',
  ).bind(key, type, expiresAt).run();
}

async function deleteKeyEverywhere(db, key) {
  await db.batch([
    db.prepare('DELETE FROM meta WHERE key = ?').bind(key),
    db.prepare('DELETE FROM str WHERE key = ?').bind(key),
    db.prepare('DELETE FROM hash WHERE key = ?').bind(key),
    db.prepare('DELETE FROM list WHERE key = ?').bind(key),
    db.prepare('DELETE FROM list_bounds WHERE key = ?').bind(key),
    db.prepare('DELETE FROM set_member WHERE key = ?').bind(key),
    db.prepare('DELETE FROM zset WHERE key = ?').bind(key),
    db.prepare('DELETE FROM geo WHERE key = ?').bind(key),
  ]);
}

function parseExpireFlags(rest) {
  // SET key value [EX seconds] [PX ms] [NX] [XX] — this app only ever sends EX
  // (server/_shared/redis.ts:244), but parse the small subset real callers use.
  let expiresAt = null;
  let nx = false;
  let xx = false;
  for (let i = 0; i < rest.length; i++) {
    const tok = String(rest[i]).toUpperCase();
    if (tok === 'EX') { expiresAt = now() + Number(rest[++i]) * 1000; }
    else if (tok === 'PX') { expiresAt = now() + Number(rest[++i]); }
    else if (tok === 'NX') { nx = true; }
    else if (tok === 'XX') { xx = true; }
  }
  return { expiresAt, nx, xx };
}

// --- string ---

// Single JOIN instead of a meta lookup + a separate str lookup — GET is the
// hottest command in the whole system (every cache read goes through it).
async function cmdGet(db, [key]) {
  const row = await db.prepare(
    'SELECT s.value AS value, m.type AS type, m.expires_at AS expires_at FROM str s JOIN meta m ON m.key = s.key WHERE s.key = ?',
  ).bind(key).first();
  if (!row || row.type !== 'string') return null;
  if (row.expires_at != null && row.expires_at <= now()) return null;
  return row.value;
}

async function cmdSet(db, [key, value, ...rest]) {
  const { expiresAt, nx, xx } = parseExpireFlags(rest);
  if (nx || xx) {
    const existing = await getMeta(db, key);
    if (nx && existing) return null;
    if (xx && !existing) return null;
  }
  // SET must overwrite any existing TTL (Redis semantics) — setMetaAndExpiry,
  // not touchMeta, and the two writes are independent so they run in parallel.
  await Promise.all([
    setMetaAndExpiry(db, key, 'string', expiresAt),
    db.prepare(
      'INSERT INTO str (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).bind(key, String(value)).run(),
  ]);
  return 'OK';
}

async function cmdSetnx(db, [key, value]) {
  const existing = await getMeta(db, key);
  if (existing) return 0;
  await touchMeta(db, key, 'string', null);
  await db.prepare('INSERT INTO str (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, String(value)).run();
  return 1;
}

async function cmdSetex(db, [key, seconds, value]) {
  await cmdSet(db, [key, value, 'EX', seconds]);
  return 'OK';
}

async function cmdPsetex(db, [key, ms, value]) {
  await cmdSet(db, [key, value, 'PX', ms]);
  return 'OK';
}

async function cmdGetset(db, [key, value]) {
  const prev = await cmdGet(db, [key]);
  await cmdSet(db, [key, value]);
  return prev;
}

async function cmdDel(db, keys) {
  let count = 0;
  for (const key of keys) {
    const existing = await getMeta(db, key);
    if (existing) count++;
    await deleteKeyEverywhere(db, key);
  }
  return count;
}

async function cmdMget(db, keys) {
  return Promise.all(keys.map((k) => cmdGet(db, [k])));
}

async function cmdMset(db, args) {
  for (let i = 0; i < args.length; i += 2) {
    await cmdSet(db, [args[i], args[i + 1]]);
  }
  return 'OK';
}

// Atomic single-statement increment (SQLite does the arithmetic, not a JS
// read-modify-write) instead of a separate GET + computed SET: fixes a real
// lost-update race under concurrent callers to the same key — the exact
// shape the rate-limit fallback's INCR hits on every request. Still needs
// ONE read first: a key whose TTL passed but the 15-min cron sweep hasn't
// reclaimed yet must start a fresh window (value=by, no stale TTL carried
// forward), not add to the old value sitting in `str` — that table has no
// idea it's logically expired, only `meta` does. Cuts the hot path from 5
// sequential round-trips (original) to 1 read + 2 writes run in parallel.
async function cmdIncrby(db, [key, byRaw]) {
  const by = Number(byRaw ?? 1);
  if (!Number.isFinite(by)) throw new Error('value is not an integer or out of range');
  const meta = await getMeta(db, key); // null: missing OR lazily expired — either way, fresh window
  const [, row] = await Promise.all([
    meta ? touchMeta(db, key, 'string', null) : setMetaAndExpiry(db, key, 'string', null),
    meta
      ? db.prepare(
          `INSERT INTO str (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = CAST(str.value AS INTEGER) + ?
           RETURNING value`,
        ).bind(key, String(by), by).first()
      : db.prepare(
          'INSERT INTO str (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value RETURNING value',
        ).bind(key, String(by)).first(),
  ]);
  const next = Number(row.value);
  if (!Number.isFinite(next)) throw new Error('value is not an integer or out of range');
  return next;
}

async function cmdAppend(db, [key, value]) {
  const existing = (await cmdGet(db, [key])) ?? '';
  const next = existing + String(value);
  await cmdSet(db, [key, next]);
  return next.length;
}

async function cmdStrlen(db, [key]) {
  const existing = await cmdGet(db, [key]);
  return existing == null ? 0 : String(existing).length;
}

async function cmdExists(db, keys) {
  let count = 0;
  for (const key of keys) {
    if (await getMeta(db, key)) count++;
  }
  return count;
}

async function cmdType(db, [key]) {
  const meta = await getMeta(db, key);
  return meta ? meta.type : 'none';
}

async function cmdTtl(db, [key]) {
  const meta = await getMeta(db, key);
  if (!meta) return -2;
  if (meta.expires_at == null) return -1;
  return Math.max(0, Math.ceil((meta.expires_at - now()) / 1000));
}

// Single conditional UPDATE instead of a read-then-write: 0 rows affected
// covers both "key doesn't exist" and "NX blocked by an existing TTL" in one
// round-trip — the same fixedWindowLimit hot path as INCR above.
async function cmdExpire(db, [key, secondsRaw, ...flags]) {
  const nx = flags.map((f) => String(f).toUpperCase()).includes('NX');
  const expiresAt = now() + Number(secondsRaw) * 1000;
  const res = await db.prepare(
    nx
      ? 'UPDATE meta SET expires_at = ? WHERE key = ? AND expires_at IS NULL'
      : 'UPDATE meta SET expires_at = ? WHERE key = ?',
  ).bind(expiresAt, key).run();
  return res.meta?.rows_written ? 1 : 0;
}

async function cmdPexpire(db, [key, msRaw, ...flags]) {
  return cmdExpire(db, [key, Number(msRaw) / 1000, ...flags]);
}

// --- hash ---

async function cmdHset(db, [key, ...fieldValues]) {
  await touchMeta(db, key, 'hash', null);
  let added = 0;
  for (let i = 0; i < fieldValues.length; i += 2) {
    const res = await db.prepare(
      'INSERT INTO hash (key, field, value) VALUES (?, ?, ?) ON CONFLICT(key, field) DO UPDATE SET value = excluded.value',
    ).bind(key, fieldValues[i], String(fieldValues[i + 1])).run();
    if (res.meta?.rows_written) added++;
  }
  return added;
}

async function cmdHget(db, [key, field]) {
  const meta = await getMeta(db, key);
  if (!meta) return null;
  const row = await db.prepare('SELECT value FROM hash WHERE key = ? AND field = ?').bind(key, field).first();
  return row ? row.value : null;
}

async function cmdHmget(db, [key, ...fields]) {
  const meta = await getMeta(db, key);
  if (!meta) return fields.map(() => null);
  const { results } = await db.prepare(
    `SELECT field, value FROM hash WHERE key = ? AND field IN (${fields.map(() => '?').join(',')})`,
  ).bind(key, ...fields).all();
  const byField = new Map(results.map((r) => [r.field, r.value]));
  return fields.map((f) => byField.get(f) ?? null);
}

async function cmdHmset(db, [key, ...fieldValues]) {
  await cmdHset(db, [key, ...fieldValues]);
  return 'OK';
}

async function cmdHgetall(db, [key]) {
  const meta = await getMeta(db, key);
  if (!meta) return [];
  const { results } = await db.prepare('SELECT field, value FROM hash WHERE key = ?').bind(key).all();
  return results.flatMap((r) => [r.field, r.value]);
}

async function cmdHdel(db, [key, ...fields]) {
  let count = 0;
  for (const field of fields) {
    const res = await db.prepare('DELETE FROM hash WHERE key = ? AND field = ?').bind(key, field).run();
    if (res.meta?.rows_written) count++;
  }
  return count;
}

async function cmdHkeys(db, [key]) {
  const { results } = await db.prepare('SELECT field FROM hash WHERE key = ?').bind(key).all();
  return results.map((r) => r.field);
}

async function cmdHvals(db, [key]) {
  const { results } = await db.prepare('SELECT value FROM hash WHERE key = ?').bind(key).all();
  return results.map((r) => r.value);
}

async function cmdHexists(db, [key, field]) {
  const row = await db.prepare('SELECT 1 FROM hash WHERE key = ? AND field = ?').bind(key, field).first();
  return row ? 1 : 0;
}

async function cmdHlen(db, [key]) {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM hash WHERE key = ?').bind(key).first();
  return row?.c ?? 0;
}

// --- list (LPUSH/RPUSH grow list_bounds.head/tail apart; LRANGE reads pos ASC) ---

async function getBounds(db, key) {
  const row = await db.prepare('SELECT head, tail FROM list_bounds WHERE key = ?').bind(key).first();
  return row ?? { head: 0, tail: 0 };
}

async function cmdLpush(db, [key, ...values]) {
  await touchMeta(db, key, 'list', null);
  let { head, tail } = await getBounds(db, key);
  for (const value of values) {
    head -= 1;
    await db.prepare('INSERT INTO list (key, pos, value) VALUES (?, ?, ?)').bind(key, head, String(value)).run();
  }
  await db.prepare(
    'INSERT INTO list_bounds (key, head, tail) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET head = excluded.head, tail = excluded.tail',
  ).bind(key, head, tail).run();
  return tail - head;
}

async function cmdRpush(db, [key, ...values]) {
  await touchMeta(db, key, 'list', null);
  let { head, tail } = await getBounds(db, key);
  for (const value of values) {
    await db.prepare('INSERT INTO list (key, pos, value) VALUES (?, ?, ?)').bind(key, tail, String(value)).run();
    tail += 1;
  }
  await db.prepare(
    'INSERT INTO list_bounds (key, head, tail) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET head = excluded.head, tail = excluded.tail',
  ).bind(key, head, tail).run();
  return tail - head;
}

async function cmdLrange(db, [key, startRaw, stopRaw]) {
  const { results } = await db.prepare('SELECT pos, value FROM list WHERE key = ? ORDER BY pos ASC').bind(key).all();
  const n = results.length;
  let start = Number(startRaw);
  let stop = Number(stopRaw);
  if (start < 0) start = Math.max(0, n + start);
  if (stop < 0) stop = n + stop;
  stop = Math.min(n - 1, stop);
  if (start > stop) return [];
  return results.slice(start, stop + 1).map((r) => r.value);
}

async function cmdLlen(db, [key]) {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM list WHERE key = ?').bind(key).first();
  return row?.c ?? 0;
}

async function cmdLpop(db, [key]) {
  const row = await db.prepare('SELECT pos, value FROM list WHERE key = ? ORDER BY pos ASC LIMIT 1').bind(key).first();
  if (!row) return null;
  await db.prepare('DELETE FROM list WHERE key = ? AND pos = ?').bind(key, row.pos).run();
  return row.value;
}

async function cmdRpop(db, [key]) {
  const row = await db.prepare('SELECT pos, value FROM list WHERE key = ? ORDER BY pos DESC LIMIT 1').bind(key).first();
  if (!row) return null;
  await db.prepare('DELETE FROM list WHERE key = ? AND pos = ?').bind(key, row.pos).run();
  return row.value;
}

async function cmdLtrim(db, [key, startRaw, stopRaw]) {
  const kept = await cmdLrange(db, [key, startRaw, stopRaw]);
  // Rewrite the list as a fresh RPUSH sequence — simplest way to keep `pos`
  // contiguous without per-row renumbering math for a bounded (LTRIM-capped) list.
  await db.batch([
    db.prepare('DELETE FROM list WHERE key = ?').bind(key),
    db.prepare('DELETE FROM list_bounds WHERE key = ?').bind(key),
  ]);
  if (kept.length > 0) await cmdRpush(db, [key, ...kept]);
  return 'OK';
}

async function cmdLrem(db, [key, countRaw, value]) {
  const count = Number(countRaw);
  const { results } = await db.prepare('SELECT pos, value FROM list WHERE key = ? ORDER BY pos ASC').bind(key).all();
  const matches = results.filter((r) => r.value === String(value));
  const toDelete = count === 0 ? matches : matches.slice(0, Math.abs(count));
  for (const row of toDelete) {
    await db.prepare('DELETE FROM list WHERE key = ? AND pos = ?').bind(key, row.pos).run();
  }
  return toDelete.length;
}

// --- set ---

async function cmdSadd(db, [key, ...members]) {
  await touchMeta(db, key, 'set', null);
  let added = 0;
  for (const member of members) {
    const res = await db.prepare('INSERT OR IGNORE INTO set_member (key, member) VALUES (?, ?)').bind(key, member).run();
    if (res.meta?.rows_written) added++;
  }
  return added;
}

async function cmdSrem(db, [key, ...members]) {
  let count = 0;
  for (const member of members) {
    const res = await db.prepare('DELETE FROM set_member WHERE key = ? AND member = ?').bind(key, member).run();
    if (res.meta?.rows_written) count++;
  }
  return count;
}

async function cmdSmembers(db, [key]) {
  const { results } = await db.prepare('SELECT member FROM set_member WHERE key = ?').bind(key).all();
  return results.map((r) => r.member);
}

async function cmdSismember(db, [key, member]) {
  const row = await db.prepare('SELECT 1 FROM set_member WHERE key = ? AND member = ?').bind(key, member).first();
  return row ? 1 : 0;
}

async function cmdScard(db, [key]) {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM set_member WHERE key = ?').bind(key).first();
  return row?.c ?? 0;
}

// --- zset ---

async function cmdZadd(db, [key, ...scoreMembers]) {
  await touchMeta(db, key, 'zset', null);
  let added = 0;
  for (let i = 0; i < scoreMembers.length; i += 2) {
    const res = await db.prepare(
      'INSERT INTO zset (key, member, score) VALUES (?, ?, ?) ON CONFLICT(key, member) DO UPDATE SET score = excluded.score',
    ).bind(key, scoreMembers[i + 1], Number(scoreMembers[i])).run();
    if (res.meta?.rows_written) added++;
  }
  return added;
}

async function cmdZrem(db, [key, ...members]) {
  let count = 0;
  for (const member of members) {
    const res = await db.prepare('DELETE FROM zset WHERE key = ? AND member = ?').bind(key, member).run();
    if (res.meta?.rows_written) count++;
  }
  return count;
}

async function cmdZrange(db, [key, startRaw, stopRaw]) {
  const { results } = await db.prepare('SELECT member FROM zset WHERE key = ? ORDER BY score ASC').bind(key).all();
  return sliceRedisRange(results.map((r) => r.member), Number(startRaw), Number(stopRaw));
}

async function cmdZrevrange(db, [key, startRaw, stopRaw]) {
  const { results } = await db.prepare('SELECT member FROM zset WHERE key = ? ORDER BY score DESC').bind(key).all();
  return sliceRedisRange(results.map((r) => r.member), Number(startRaw), Number(stopRaw));
}

async function cmdZrangebyscore(db, [key, minRaw, maxRaw]) {
  const min = minRaw === '-inf' ? -Infinity : Number(minRaw);
  const max = maxRaw === '+inf' ? Infinity : Number(maxRaw);
  const { results } = await db.prepare('SELECT member, score FROM zset WHERE key = ? ORDER BY score ASC').bind(key).all();
  return results.filter((r) => r.score >= min && r.score <= max).map((r) => r.member);
}

async function cmdZscore(db, [key, member]) {
  const row = await db.prepare('SELECT score FROM zset WHERE key = ? AND member = ?').bind(key, member).first();
  return row ? String(row.score) : null;
}

async function cmdZcard(db, [key]) {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM zset WHERE key = ?').bind(key).first();
  return row?.c ?? 0;
}

async function cmdZrandmember(db, [key]) {
  const { results } = await db.prepare('SELECT member FROM zset WHERE key = ?').bind(key).all();
  if (results.length === 0) return null;
  return results[Math.floor(Math.random() * results.length)].member;
}

function sliceRedisRange(items, startRaw, stopRaw) {
  const n = items.length;
  const start = startRaw < 0 ? Math.max(0, n + startRaw) : startRaw;
  let stop = stopRaw < 0 ? n + stopRaw : stopRaw;
  stop = Math.min(n - 1, stop);
  if (start > stop) return [];
  return items.slice(start, stop + 1);
}

// --- geo (box search only — the one shape server/_shared/redis.ts:geoSearchByBox sends) ---

const KM_PER_DEGREE_LAT = 110.574;

async function cmdGeoadd(db, [key, ...lonLatMembers]) {
  await touchMeta(db, key, 'geo', null);
  let added = 0;
  for (let i = 0; i < lonLatMembers.length; i += 3) {
    const res = await db.prepare(
      'INSERT INTO geo (key, member, lon, lat) VALUES (?, ?, ?, ?) ON CONFLICT(key, member) DO UPDATE SET lon = excluded.lon, lat = excluded.lat',
    ).bind(key, lonLatMembers[i + 2], Number(lonLatMembers[i]), Number(lonLatMembers[i + 1])).run();
    if (res.meta?.rows_written) added++;
  }
  return added;
}

function haversineKm(lon1, lat1, lon2, lat2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// GEOSEARCH key FROMLONLAT lon lat BYBOX width height km [ASC|DESC] COUNT n
async function cmdGeosearch(db, [key, fromlonlat, lonRaw, latRaw, bybox, widthRaw, heightRaw, _unit, order, countKw, countRaw]) {
  if (String(fromlonlat).toUpperCase() !== 'FROMLONLAT' || String(bybox).toUpperCase() !== 'BYBOX') {
    throw new Error('GEOSEARCH: only FROMLONLAT ... BYBOX is supported');
  }
  const lon = Number(lonRaw);
  const lat = Number(latRaw);
  const widthKm = Number(widthRaw);
  const heightKm = Number(heightRaw);
  const latDelta = heightKm / 2 / KM_PER_DEGREE_LAT;
  const lonDelta = widthKm / 2 / (KM_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180) || 1);
  const { results } = await db.prepare(
    'SELECT member, lon, lat FROM geo WHERE key = ? AND lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?',
  ).bind(key, lon - lonDelta, lon + lonDelta, lat - latDelta, lat + latDelta).all();
  const withDist = results.map((r) => ({ member: r.member, dist: haversineKm(lon, lat, r.lon, r.lat) }));
  withDist.sort((a, b) => (String(order).toUpperCase() === 'DESC' ? b.dist - a.dist : a.dist - b.dist));
  const count = String(countKw).toUpperCase() === 'COUNT' ? Number(countRaw) : withDist.length;
  return withDist.slice(0, count).map((r) => r.member);
}

async function cmdGeopos(db, [key, ...members]) {
  const out = [];
  for (const member of members) {
    const row = await db.prepare('SELECT lon, lat FROM geo WHERE key = ? AND member = ?').bind(key, member).first();
    out.push(row ? [String(row.lon), String(row.lat)] : null);
  }
  return out;
}

async function cmdGeodist(db, [key, m1, m2]) {
  const p1 = await db.prepare('SELECT lon, lat FROM geo WHERE key = ? AND member = ?').bind(key, m1).first();
  const p2 = await db.prepare('SELECT lon, lat FROM geo WHERE key = ? AND member = ?').bind(key, m2).first();
  if (!p1 || !p2) return null;
  return String(haversineKm(p1.lon, p1.lat, p2.lon, p2.lat) * 1000); // Redis default unit: meters
}

// --- misc ---

async function cmdPing() { return 'PONG'; }
async function cmdEcho(_db, [msg]) { return msg; }
async function cmdInfo() { return 'redis_version:redis-d1-proxy'; }
async function cmdDbsize(db) {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM meta').first();
  return row?.c ?? 0;
}
async function cmdPublish() { return 0; } // no subscribers reachable over stateless HTTP
async function cmdScan(db, [_cursorRaw, ...rest]) {
  // Simplified single-pass SCAN: always returns cursor "0" (done) plus every
  // matching key. Fine for this app's admin/debug-only SCAN usage; not safe
  // to rely on for a keyspace scan under concurrent writers.
  const matchIdx = rest.findIndex((t) => String(t).toUpperCase() === 'MATCH');
  const pattern = matchIdx >= 0 ? rest[matchIdx + 1] : null;
  const { results } = await db.prepare('SELECT key FROM meta').all();
  const keys = results.map((r) => r.key).filter((k) => !pattern || sqliteGlobToRegExp(pattern).test(k));
  return ['0', keys];
}
function sqliteGlobToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

export const COMMANDS = {
  GET: cmdGet, SET: cmdSet, DEL: cmdDel, MGET: cmdMget, MSET: cmdMset, SCAN: cmdScan,
  TTL: cmdTtl, EXPIRE: cmdExpire, PEXPIRE: cmdPexpire, EXISTS: cmdExists, TYPE: cmdType,
  HGET: cmdHget, HSET: cmdHset, HDEL: cmdHdel, HGETALL: cmdHgetall, HMGET: cmdHmget,
  HMSET: cmdHmset, HKEYS: cmdHkeys, HVALS: cmdHvals, HEXISTS: cmdHexists, HLEN: cmdHlen,
  LPUSH: cmdLpush, RPUSH: cmdRpush, LPOP: cmdLpop, RPOP: cmdRpop, LRANGE: cmdLrange,
  LLEN: cmdLlen, LTRIM: cmdLtrim, LREM: cmdLrem,
  SADD: cmdSadd, SREM: cmdSrem, SMEMBERS: cmdSmembers, SISMEMBER: cmdSismember, SCARD: cmdScard,
  ZADD: cmdZadd, ZREM: cmdZrem, ZRANGE: cmdZrange, ZRANGEBYSCORE: cmdZrangebyscore,
  ZREVRANGE: cmdZrevrange, ZSCORE: cmdZscore, ZCARD: cmdZcard, ZRANDMEMBER: cmdZrandmember,
  GEOADD: cmdGeoadd, GEOSEARCH: cmdGeosearch, GEOPOS: cmdGeopos, GEODIST: cmdGeodist,
  INCR: (db, [key]) => cmdIncrby(db, [key, 1]), DECR: (db, [key]) => cmdIncrby(db, [key, -1]),
  INCRBY: cmdIncrby, DECRBY: (db, [key, by]) => cmdIncrby(db, [key, -Number(by)]),
  PING: cmdPing, ECHO: cmdEcho, INFO: cmdInfo, DBSIZE: cmdDbsize,
  PUBLISH: cmdPublish,
  SETNX: cmdSetnx, SETEX: cmdSetex, PSETEX: cmdPsetex, GETSET: cmdGetset,
  APPEND: cmdAppend, STRLEN: cmdStrlen,
};

// Same rejected set as docker/redis-rest-proxy.mjs, and the same error text —
// api/_rate-limit-fallback.js regex-matches `Command not allowed: (EVAL|EVALSHA|SCRIPT)`
// to switch @upstash/ratelimit onto its non-Lua fixed-window path (INCR+EXPIRE NX+TTL,
// all implemented above), so this message must stay byte-for-byte identical.
const REJECTED = new Set(['EVAL', 'EVALSHA', 'SCRIPT', 'FLUSHALL', 'FLUSHDB', 'CONFIG', 'DEBUG', 'SLAVEOF', 'SUBSCRIBE']);

export async function runCommand(db, args) {
  const cmd = String(args[0]).toUpperCase();
  if (REJECTED.has(cmd)) throw new Error(`Command not allowed: ${cmd}`);
  const handler = COMMANDS[cmd];
  if (!handler) throw new Error(`Command not allowed: ${cmd}`);
  return handler(db, args.slice(1));
}

export const __internal = { getMeta, NOT_FOUND };
