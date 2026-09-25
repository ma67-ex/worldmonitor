// @ts-check
/**
 * Minimal NSE (nseindia.com) client for equity seeders.
 *
 * NSE's /api/* JSON endpoints need the Akamai cookies set by a prior GET of the
 * home page, plus a same-site Referer. Without them every call returns 401/403
 * or an HTML "Access Denied" page. Verified reachable from GitHub Actions runners
 * on 2026-09-24, so no proxy is used.
 */

const ORIGIN = 'https://www.nseindia.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const BASE_HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json,text/html,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * @typedef {{ ok: true, status: number, data: any } | { ok: false, status: number | string }} NseResult
 * @typedef {{ minGapMs?: number, timeoutMs?: number, fetchImpl?: typeof fetch, sleepImpl?: (ms: number) => Promise<void>, now?: () => number }} NseSessionOptions
 */

/** Filing URLs come from NSE's own JSON; only ever follow them to NSE hosts. */
export function isNseUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'www.nseindia.com' || u.hostname === 'nsearchives.nseindia.com');
  } catch {
    return false;
  }
}

/** @param {NseSessionOptions} [opts] */
export function createNseSession(opts = {}) {
  const minGapMs = opts.minGapMs ?? 400;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const fetchImpl = opts.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const sleepImpl = opts.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());

  let cookie = '';
  let lastRequestAt = 0;
  let requests = 0;

  async function throttle() {
    const wait = lastRequestAt + minGapMs - now();
    if (wait > 0) await sleepImpl(wait);
    lastRequestAt = now();
    requests += 1;
  }

  async function handshake() {
    await throttle();
    const resp = await fetchImpl(`${ORIGIN}/`, { headers: BASE_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    const setCookies = typeof resp.headers.getSetCookie === 'function' ? resp.headers.getSetCookie() : [];
    cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    await resp.arrayBuffer().catch(() => {});
    return resp.ok && cookie !== '';
  }

  /**
   * @param {string} url absolute URL on nseindia.com or nsearchives.nseindia.com
   * @param {'json' | 'text'} as
   * @returns {Promise<NseResult>}
   */
  async function request(url, as) {
    if (!isNseUrl(url)) return { ok: false, status: 'blocked-host' };
    if (!cookie) await handshake();
    for (let attempt = 0; attempt < 2; attempt++) {
      await throttle();
      let resp;
      try {
        resp = await fetchImpl(url, {
          headers: { ...BASE_HEADERS, Cookie: cookie, Referer: `${ORIGIN}/` },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        return { ok: false, status: `network:${/** @type {any} */ (err)?.cause?.code || /** @type {any} */ (err)?.name || 'error'}` };
      }
      const text = await resp.text();
      if ((resp.status === 401 || resp.status === 403) && attempt === 0) {
        await handshake();
        continue;
      }
      if (!resp.ok) return { ok: false, status: resp.status };
      if (as === 'text') return { ok: true, status: resp.status, data: text };
      // A block page arrives as 200 text/html; treat anything that is not JSON as blocked.
      try {
        return { ok: true, status: resp.status, data: JSON.parse(text) };
      } catch {
        return { ok: false, status: 'non-json' };
      }
    }
    return { ok: false, status: 403 };
  }

  return {
    /** @param {string} path e.g. `api/fiidiiTradeReact` */
    getJson: (path) => request(`${ORIGIN}/${path.replace(/^\//, '')}`, 'json'),
    /** @param {string} url absolute archive URL (XBRL, CSV) */
    getText: (url) => request(url, 'text'),
    get requestCount() { return requests; },
  };
}
