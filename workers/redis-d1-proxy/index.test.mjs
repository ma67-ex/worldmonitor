import { strict as assert } from 'node:assert';
import test from 'node:test';

import worker from './src/index.js';
import { makeFakeD1 } from './d1-fake.mjs';

function makeEnv({ token = 'test-token', db } = {}) {
  return { REDIS_TOKEN: token, DB: db ?? makeFakeD1() };
}

function req(path, { method = 'GET', body, token = 'test-token' } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`https://redis-d1-proxy.example.com${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

test('rejects requests without a valid bearer token', async () => {
  const env = makeEnv();
  const res = await worker.fetch(req('/get/foo', { token: 'wrong' }), env);
  assert.equal(res.status, 401);
});

test('GET/SET round-trip via path-style command', async () => {
  const env = makeEnv();
  const setRes = await worker.fetch(req('/set/greeting/hello', { method: 'POST' }), env);
  assert.deepEqual(await setRes.json(), { result: 'OK' });

  const getRes = await worker.fetch(req('/get/greeting'), env);
  assert.deepEqual(await getRes.json(), { result: 'hello' });
});

test('SET with EX seconds respects TTL on GET and TTL command', async () => {
  const env = makeEnv();
  await worker.fetch(req('/', { method: 'POST', body: ['SET', 'k', 'v', 'EX', '100'] }), env);
  const ttl = await worker.fetch(req('/', { method: 'POST', body: ['TTL', 'k'] }), env);
  const { result } = await ttl.json();
  assert.ok(result > 0 && result <= 100);
});

test('DEL removes a key so GET returns null and EXISTS is 0', async () => {
  const env = makeEnv();
  await worker.fetch(req('/', { method: 'POST', body: ['SET', 'k', 'v'] }), env);
  await worker.fetch(req('/', { method: 'POST', body: ['DEL', 'k'] }), env);
  const getRes = await worker.fetch(req('/', { method: 'POST', body: ['GET', 'k'] }), env);
  assert.deepEqual(await getRes.json(), { result: null });
  const existsRes = await worker.fetch(req('/', { method: 'POST', body: ['EXISTS', 'k'] }), env);
  assert.deepEqual(await existsRes.json(), { result: 0 });
});

test('INCR creates and increments a counter (fixed-window rate-limit path)', async () => {
  const env = makeEnv();
  const r1 = await worker.fetch(req('/', { method: 'POST', body: ['INCR', 'counter'] }), env);
  assert.deepEqual(await r1.json(), { result: 1 });
  const r2 = await worker.fetch(req('/', { method: 'POST', body: ['INCR', 'counter'] }), env);
  assert.deepEqual(await r2.json(), { result: 2 });
});

test('EXPIRE with NX only sets TTL when none exists — matches fixedWindowLimit\'s use', async () => {
  const env = makeEnv();
  await worker.fetch(req('/', { method: 'POST', body: ['INCR', 'k'] }), env);
  const first = await worker.fetch(req('/', { method: 'POST', body: ['EXPIRE', 'k', '60', 'NX'] }), env);
  assert.deepEqual(await first.json(), { result: 1 });
  const second = await worker.fetch(req('/', { method: 'POST', body: ['EXPIRE', 'k', '999', 'NX'] }), env);
  assert.deepEqual(await second.json(), { result: 0 });
  const ttl = await worker.fetch(req('/', { method: 'POST', body: ['TTL', 'k'] }), env);
  const { result } = await ttl.json();
  assert.ok(result <= 60);
});

test('LPUSH/LTRIM/LREM/LRANGE support prependCachedJsonList\'s sequence', async () => {
  const env = makeEnv();
  await worker.fetch(req('/', { method: 'POST', body: ['LPUSH', 'lst', 'a'] }), env);
  await worker.fetch(req('/', { method: 'POST', body: ['LPUSH', 'lst', 'b'] }), env);
  await worker.fetch(req('/', { method: 'POST', body: ['LPUSH', 'lst', 'c'] }), env);
  const range1 = await worker.fetch(req('/', { method: 'POST', body: ['LRANGE', 'lst', '0', '-1'] }), env);
  assert.deepEqual(await range1.json(), { result: ['c', 'b', 'a'] });

  await worker.fetch(req('/', { method: 'POST', body: ['LREM', 'lst', '0', 'b'] }), env);
  await worker.fetch(req('/', { method: 'POST', body: ['LTRIM', 'lst', '0', '0'] }), env);
  const range2 = await worker.fetch(req('/', { method: 'POST', body: ['LRANGE', 'lst', '0', '-1'] }), env);
  assert.deepEqual(await range2.json(), { result: ['c'] });
});

test('HMGET returns values in requested field order with nulls for misses', async () => {
  const env = makeEnv();
  await worker.fetch(req('/', { method: 'POST', body: ['HSET', 'h', 'a', '1', 'b', '2'] }), env);
  const res = await worker.fetch(req('/', { method: 'POST', body: ['HMGET', 'h', 'b', 'missing', 'a'] }), env);
  assert.deepEqual(await res.json(), { result: ['2', null, '1'] });
});

test('GEOADD + GEOSEARCH BYBOX returns members within the box, nearest first', async () => {
  const env = makeEnv();
  await worker.fetch(req('/', { method: 'POST', body: ['GEOADD', 'vessels', '-122.4', '37.7', 'near', '10', '10', 'far'] }), env);
  const res = await worker.fetch(req('/', {
    method: 'POST',
    body: ['GEOSEARCH', 'vessels', 'FROMLONLAT', '-122.4', '37.7', 'BYBOX', '50', '50', 'km', 'ASC', 'COUNT', '10'],
  }), env);
  assert.deepEqual(await res.json(), { result: ['near'] });
});

test('pipeline runs each command independently and reports per-command errors', async () => {
  const env = makeEnv();
  const res = await worker.fetch(req('/pipeline', {
    method: 'POST',
    body: [['SET', 'p', '1'], ['EVAL', 'return 1', '0']],
  }), env);
  const body = await res.json();
  assert.deepEqual(body[0], { result: 'OK' });
  assert.equal(body[1].error, 'Command not allowed: EVAL');
});

test('multi-exec runs prependCachedJsonList\'s LREM+LPUSH+LTRIM+EXPIRE sequence', async () => {
  const env = makeEnv();
  await worker.fetch(req('/', { method: 'POST', body: ['LPUSH', 'hist', 'old1'] }), env);
  const res = await worker.fetch(req('/multi-exec', {
    method: 'POST',
    body: [
      ['LREM', 'hist', '0', 'new'],
      ['LPUSH', 'hist', 'new'],
      ['LTRIM', 'hist', '0', '4'],
      ['EXPIRE', 'hist', '3600'],
    ],
  }), env);
  const body = await res.json();
  assert.equal(body.every((r) => !r.error), true);
  const range = await worker.fetch(req('/', { method: 'POST', body: ['LRANGE', 'hist', '0', '-1'] }), env);
  assert.deepEqual(await range.json(), { result: ['new', 'old1'] });
});

// EVAL/EVALSHA/SCRIPT rejection text must stay exact: api/_rate-limit-fallback.js
// regex-matches it to switch @upstash/ratelimit onto the non-Lua fallback.
test('EVAL is rejected with the exact message limitWithFallback detects', async () => {
  const env = makeEnv();
  const res = await worker.fetch(req('/', { method: 'POST', body: ['EVAL', 'return 1', '0'] }), env);
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error, 'Command not allowed: EVAL');
});

test('INCR on a key whose TTL passed (but the cron sweep has not run yet) starts a fresh window instead of adding to the stale value', async () => {
  const env = makeEnv();
  // Simulate a rate-limit counter that already hit 5 in the previous window,
  // then expired 1ms ago via PX — the row still physically exists until the
  // next scheduled() sweep, exactly like a live 60s window between cron runs.
  await worker.fetch(req('/', { method: 'POST', body: ['SET', 'stale-counter', '5', 'PX', '1'] }), env);
  await new Promise((r) => setTimeout(r, 5));
  const res = await worker.fetch(req('/', { method: 'POST', body: ['INCR', 'stale-counter'] }), env);
  assert.deepEqual(await res.json(), { result: 1 });
  // The fresh window must also be able to get a new TTL — a leftover non-null
  // expires_at here would permanently block EXPIRE NX until the next sweep.
  const ttl = await worker.fetch(req('/', { method: 'POST', body: ['TTL', 'stale-counter'] }), env);
  assert.deepEqual(await ttl.json(), { result: -1 });
});

test('SET on an existing key overwrites its TTL (removes it when no EX given), matching Redis', async () => {
  const env = makeEnv();
  await worker.fetch(req('/', { method: 'POST', body: ['SET', 'k', 'v1', 'EX', '999'] }), env);
  await worker.fetch(req('/', { method: 'POST', body: ['SET', 'k', 'v2'] }), env);
  const ttl = await worker.fetch(req('/', { method: 'POST', body: ['TTL', 'k'] }), env);
  assert.deepEqual(await ttl.json(), { result: -1 });
});

test('scheduled() sweeps expired keys', async () => {
  const db = makeFakeD1();
  const env = makeEnv({ db });
  await worker.fetch(req('/', { method: 'POST', body: ['SET', 'stale', 'v', 'PX', '1'] }), env);
  await new Promise((r) => setTimeout(r, 5));
  await worker.scheduled({}, env);
  const res = await worker.fetch(req('/', { method: 'POST', body: ['EXISTS', 'stale'] }), env);
  assert.deepEqual(await res.json(), { result: 0 });
});
