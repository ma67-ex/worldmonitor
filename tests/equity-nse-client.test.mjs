import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createNseSession, isNseUrl } from '../scripts/shared/equity/nse-client.mjs';

function fakeResponse(status, body, cookies = []) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { getSetCookie: () => cookies },
    text: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function harness(script) {
  const calls = [];
  const sleeps = [];
  let clock = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, cookie: init?.headers?.Cookie, referer: init?.headers?.Referer });
    const next = script.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return next(url);
  };
  const session = createNseSession({
    fetchImpl,
    minGapMs: 400,
    sleepImpl: async (ms) => { sleeps.push(ms); clock += ms; },
    now: () => clock,
  });
  return { session, calls, sleeps };
}

describe('createNseSession', () => {
  it('handshakes once, then sends the cookie and referer', async () => {
    const { session, calls } = harness([
      () => fakeResponse(200, '<html>', ['nsit=abc; Path=/', 'bm_sv=xyz; Secure']),
      () => fakeResponse(200, '[{"a":1}]'),
      () => fakeResponse(200, '{"b":2}'),
    ]);
    assert.deepEqual(await session.getJson('api/one'), { ok: true, status: 200, data: [{ a: 1 }] });
    assert.deepEqual((await session.getJson('/api/two')).data, { b: 2 });
    assert.equal(calls[0].url, 'https://www.nseindia.com/');
    assert.equal(calls[1].url, 'https://www.nseindia.com/api/one');
    assert.equal(calls[1].cookie, 'nsit=abc; bm_sv=xyz');
    assert.equal(calls[1].referer, 'https://www.nseindia.com/');
    assert.equal(calls.length, 3, 'no second handshake while the cookie works');
  });

  it('re-handshakes once on 403, then succeeds', async () => {
    const { session, calls } = harness([
      () => fakeResponse(200, '', ['nsit=old']),
      () => fakeResponse(403, 'Access Denied'),
      () => fakeResponse(200, '', ['nsit=new']),
      () => fakeResponse(200, '[]'),
    ]);
    const res = await session.getJson('api/x');
    assert.equal(res.ok, true);
    assert.equal(calls[3].cookie, 'nsit=new');
  });

  it('gives up after a second 403 instead of looping', async () => {
    const { session } = harness([
      () => fakeResponse(200, '', ['nsit=a']),
      () => fakeResponse(403, 'Access Denied'),
      () => fakeResponse(200, '', ['nsit=b']),
      () => fakeResponse(403, 'Access Denied'),
    ]);
    assert.deepEqual(await session.getJson('api/x'), { ok: false, status: 403 });
  });

  it('treats a 200 HTML block page as a failure, not data', async () => {
    const { session } = harness([
      () => fakeResponse(200, '', ['nsit=a']),
      () => fakeResponse(200, '<HTML><TITLE>Access Denied</TITLE></HTML>'),
    ]);
    assert.deepEqual(await session.getJson('api/x'), { ok: false, status: 'non-json' });
  });

  it('spaces requests by the minimum gap', async () => {
    const { session, sleeps } = harness([
      () => fakeResponse(200, '', ['nsit=a']),
      () => fakeResponse(200, '[]'),
      () => fakeResponse(200, '[]'),
    ]);
    await session.getJson('api/a');
    await session.getJson('api/b');
    assert.ok(sleeps.length >= 2 && sleeps.every((ms) => ms > 0 && ms <= 400));
    assert.equal(session.requestCount, 3);
  });

  it('refuses to follow filing links off NSE hosts', async () => {
    const { session, calls } = harness([]);
    assert.deepEqual(await session.getText('https://evil.example/x.xml'), { ok: false, status: 'blocked-host' });
    assert.deepEqual(await session.getText('http://nsearchives.nseindia.com/x.xml'), { ok: false, status: 'blocked-host' });
    assert.equal(calls.length, 0);
    assert.equal(isNseUrl('https://nsearchives.nseindia.com/corporate/xbrl/a.xml'), true);
  });
});
