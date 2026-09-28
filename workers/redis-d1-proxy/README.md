# redis-d1-proxy

Free replacement for Upstash Redis's 500k-commands/month cap: a Cloudflare
Worker that speaks the same wire protocol as this repo's own self-hosting
proxy (`docker/redis-rest-proxy.mjs`), backed by D1 instead of a real Redis
process. Both `server/_shared/redis.ts` (Vercel) and `scripts/ais-relay.cjs`
(Railway) already talk to Redis purely over `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN` — cutover is env vars only, no app code changes.

Cloudflare free tier: ~100k Worker requests/day, ~100k D1 rows written/day
(5M read/day). Well above this app's own background load (see
`docs/tasks/` cost investigation — the always-on `ais-relay` seed loops are
the dominant baseline, not visitor traffic).

## What it does NOT do

- **No Lua** (`EVAL`/`EVALSHA`/`SCRIPT` rejected, same as the Docker proxy).
  `api/_rate-limit-fallback.js` already auto-detects this exact rejection
  and switches `@upstash/ratelimit` to a fixed-window fallback
  (`INCR`+`EXPIRE NX`+`TTL`) — implemented here, so rate limiting still
  works, just not sliding-window.
- **`multi-exec` is sequential, not a single SQL transaction.** D1's Workers
  binding doesn't expose a general read-modify-write transaction, only
  `batch()` for independent statements. The one real caller
  (`prependCachedJsonList`'s LREM+LPUSH+LTRIM+EXPIRE) is a single-writer-
  per-key cache list; the gap is a narrow race between two concurrent
  writers to the *same* key, not a correctness hole for this app's
  read-mostly traffic. See `src/commands.js` header comment.
- **`SUBSCRIBE` is rejected**, `PUBLISH` is a no-op (returns 0). Pub/sub
  doesn't fit a stateless HTTP-per-request model; nothing in this app uses
  it.
- **`SCAN` is a simplified single pass** (always returns cursor `"0"` with
  every match) — fine for admin/debug use, not a safe keyspace iterator
  under concurrent writers.

## Setup

```bash
npm install
npx wrangler login

npm run db:create               # prints the database_id — paste it into wrangler.toml
npm run db:migrate:local        # apply schema.sql for `wrangler dev`
npm run db:migrate              # apply schema.sql to the real (remote) D1 database

npx wrangler secret put REDIS_TOKEN   # same value you'll set as UPSTASH_REDIS_REST_TOKEN
```

## Local testing

```bash
npm test        # node:test against a real in-memory SQLite DB (d1-fake.mjs), no wrangler needed
npx wrangler dev # exercises the real D1 binding + Worker runtime
```

## Cutover (do NOT skip the order)

1. Deploy: `npm run deploy`. Note the Worker's `*.workers.dev` URL.
2. **Reseed before flipping traffic** — the new D1 database starts empty, and
   Upstash can't be exported while it's rate-limited (its own reads are
   capped too). Point a *local* shell at the new Worker and run the seeders:
   ```bash
   export UPSTASH_REDIS_REST_URL="https://<worker>.workers.dev"
   export UPSTASH_REDIS_REST_TOKEN="<the REDIS_TOKEN secret>"
   ./scripts/run-seeders.sh
   ```
3. Test a Vercel **preview** deployment against the new URL first — set
   `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` on the preview
   environment only, confirm panels populate, confirm
   `[rate-limit] EVAL/EVALSHA rejected` logs once and then goes quiet
   (fallback engaged, not erroring per-request).
4. Only after step 3 looks right: update the **production** Vercel env vars
   AND the Railway `ais-relay` service's env vars together — both write to
   Redis directly, so cutting over one without the other splits writes
   across two stores.
5. Watch `wrangler tail` and the Cloudflare dashboard for the first hour
   after cutover.
