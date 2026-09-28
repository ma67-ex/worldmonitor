-- D1 schema for redis-d1-proxy: an Upstash-REST-compatible surface over D1.
-- One `meta` row per key tracks type + expiry uniformly (mirrors Redis: TTL/EXPIRE/
-- DEL/EXISTS/TYPE work the same regardless of the value's structure). Each Redis
-- type gets its own table so range/member queries stay index-backed instead of
-- deserializing a blob per read.
--
-- Apply with: wrangler d1 execute redis-d1-proxy --file=schema.sql

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  type TEXT NOT NULL,       -- 'string' | 'hash' | 'list' | 'set' | 'zset' | 'geo'
  expires_at INTEGER        -- epoch ms; NULL = no expiry
);
CREATE INDEX IF NOT EXISTS idx_meta_expires ON meta(expires_at);

CREATE TABLE IF NOT EXISTS str (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hash (
  key TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (key, field)
);

-- LPUSH/RPUSH grow `pos` in opposite directions from a per-key head/tail counter
-- (list_bounds) so both ends insert in O(1) without renumbering existing rows.
CREATE TABLE IF NOT EXISTS list (
  key TEXT NOT NULL,
  pos INTEGER NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (key, pos)
);

CREATE TABLE IF NOT EXISTS list_bounds (
  key TEXT PRIMARY KEY,
  head INTEGER NOT NULL DEFAULT 0,
  tail INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS set_member (
  key TEXT NOT NULL,
  member TEXT NOT NULL,
  PRIMARY KEY (key, member)
);

CREATE TABLE IF NOT EXISTS zset (
  key TEXT NOT NULL,
  member TEXT NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY (key, member)
);
CREATE INDEX IF NOT EXISTS idx_zset_score ON zset(key, score);

-- GEOSEARCH ... BYBOX is a plain lat/lon range query here (see geoSearchByBox
-- in server/_shared/redis.ts) — no geohash needed for the box case this app uses.
CREATE TABLE IF NOT EXISTS geo (
  key TEXT NOT NULL,
  member TEXT NOT NULL,
  lon REAL NOT NULL,
  lat REAL NOT NULL,
  PRIMARY KEY (key, member)
);
