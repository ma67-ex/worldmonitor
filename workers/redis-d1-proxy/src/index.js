// Cloudflare Worker: Upstash-REST-compatible surface over D1.
//
// Speaks the exact wire protocol docker/redis-rest-proxy.mjs does (this repo's
// own self-hosting proxy), so cutover is env-vars-only on both sides that talk
// to Redis directly: Vercel (UPSTASH_REDIS_REST_URL/TOKEN, read by
// server/_shared/redis.ts and server/_shared/rate-limit.ts) and Railway's
// ais-relay (scripts/ais-relay.cjs, same two env vars).
//
//   GET  /{command}/{arg1}/{arg2}/...
//   POST /              body: ["COMMAND", "arg1", ...]
//   POST /pipeline       body: [["CMD1", ...], ["CMD2", ...]]
//   POST /multi-exec     body: [["CMD1", ...], ["CMD2", ...]]   (see commands.js
//                         header comment for the multi-exec atomicity caveat)
//
// Auth: Bearer token compared with crypto-safe timing (env.REDIS_TOKEN).
import { runCommand } from './commands.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.subtle.timingSafeEqual
    ? crypto.subtle.timingSafeEqual(aBuf, bBuf)
    : aBuf.every((byte, i) => byte === bBuf[i]); // Workers runtime always has the above; fallback for tests only
}

async function checkAuth(request, env) {
  if (!env.REDIS_TOKEN) return true;
  const auth = request.headers.get('authorization') || '';
  const prefix = 'Bearer ';
  if (!auth.startsWith(prefix)) return false;
  return timingSafeEqual(auth.slice(prefix.length), env.REDIS_TOKEN);
}

async function runAndWrap(env, args) {
  try {
    const result = await runCommand(env.DB, args);
    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export default {
  async fetch(request, env) {
    if (!(await checkAuth(request, env))) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const url = new URL(request.url);

    try {
      if (request.method === 'POST' && url.pathname === '/') {
        const args = await request.json();
        const { result, error } = await runAndWrap(env, args);
        return jsonResponse(error ? { error } : { result }, error ? 500 : 200);
      }

      if (request.method === 'POST' && url.pathname === '/pipeline') {
        const commands = await request.json();
        const out = [];
        for (const cmd of commands) out.push(await runAndWrap(env, cmd));
        return jsonResponse(out);
      }

      if (request.method === 'POST' && url.pathname === '/multi-exec') {
        // Sequential, not a single SQL transaction — see commands.js header comment.
        const commands = await request.json();
        const out = [];
        for (const cmd of commands) out.push(await runAndWrap(env, cmd));
        return jsonResponse(out);
      }

      if (request.method === 'GET' && url.pathname === '/') {
        return jsonResponse('Welcome to redis-d1-proxy!');
      }

      if (request.method === 'GET' || request.method === 'POST') {
        const parts = url.pathname.slice(1).split('/').map(decodeURIComponent);
        if (parts.length === 0 || !parts[0]) return jsonResponse({ error: 'No command specified' }, 400);
        const { result, error } = await runAndWrap(env, parts);
        return jsonResponse(error ? { error } : { result }, error ? 500 : 200);
      }

      if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  },

  // Cron Trigger (wrangler.toml [triggers]): D1 has no native TTL, so expired
  // rows would otherwise sit forever. Sweep them out on a schedule instead of
  // paying a DELETE on every read.
  async scheduled(_event, env) {
    const cutoff = Date.now();
    const { results } = await env.DB.prepare('SELECT key FROM meta WHERE expires_at IS NOT NULL AND expires_at <= ?')
      .bind(cutoff).all();
    for (const row of results) {
      await runCommand(env.DB, ['DEL', row.key]);
    }
  },
};
