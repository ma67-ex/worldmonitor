#!/usr/bin/env -S npx tsx
// Builds the news digest OFF the request path and writes it straight to the
// same cache key the live RPC reads (news:digest:v1:<variant>:<lang>).
//
// Why this exists: buildDigest() fetches/parses 50-100+ RSS feeds. On a cold
// cache (a fresh Redis backend, or the first request after a deploy bumps
// the feed cache-key prefix), that legitimately takes longer than Vercel's
// request-time budget allows (OVERALL_DEADLINE_MS, 10s) — verified live:
// batching the per-feed cache reads and doubling fetch concurrency both
// shipped as real improvements but neither closed it, because the digest is
// fetch-bound across many feeds, not cache-bound. Building it here instead —
// a long-lived Railway process with no platform response-time ceiling — lets
// it actually wait out every feed once, so user requests hit a warm cache
// instead of racing a live rebuild against a deadline.
//
// Run by scripts/ais-relay.cjs on a schedule (see startNewsDigestSeedLoop).
// Manual run: npx tsx scripts/seed-news-digest.mts
import { loadEnvFile } from './_seed-utils.mjs';
import { buildDigest } from '../server/worldmonitor/news/v1/list-feed-digest';
import { setCachedJson } from '../server/_shared/redis';

loadEnvFile(import.meta.url);

// Railway has no per-request deadline, unlike the live Vercel path — long
// enough to genuinely finish every feed from a stone-cold cache, short
// enough that a truly hung upstream doesn't wedge the relay's child-process
// slot for this loop indefinitely (ais-relay.cjs's execFile also enforces
// its own ~5min ceiling as a second, harder backstop).
const SEED_DEADLINE_MS = 4 * 60 * 1000;
const DIGEST_TTL_SECONDS = 900; // matches listFeedDigest's cachedFetchJson TTL

// Scoped to the 'full' variant (worldmonitor.app main dashboard) and the two
// languages seed-insights.mjs's China-coverage path depends on. The other
// site variants (tech/finance/commodity/happy) have their own much smaller
// feed lists and haven't shown this symptom — add them here if they do.
const TARGETS: Array<{ variant: string; lang: string }> = [
  { variant: 'full', lang: 'en' },
  { variant: 'full', lang: 'zh' },
];

async function seedOne(variant: string, lang: string): Promise<void> {
  const t0 = Date.now();
  const key = `news:digest:v1:${variant}:${lang}`;
  const result = await buildDigest(variant, lang, SEED_DEADLINE_MS);
  const totalItems = Object.values(result.categories).reduce((sum, b) => sum + b.items.length, 0);
  const durSec = ((Date.now() - t0) / 1000).toFixed(1);

  if (totalItems === 0) {
    // Don't overwrite a possibly-still-valid cache entry with an empty one —
    // matches listFeedDigest's own "return totalItems > 0 ? result : null"
    // gate. Whatever's already cached (even if stale) keeps serving until
    // its TTL lapses or a later run here succeeds.
    console.warn(`  ${variant}/${lang}: 0 items after ${durSec}s — leaving existing cache entry untouched`);
    return;
  }

  await setCachedJson(key, result, DIGEST_TTL_SECONDS);
  const categoryCount = Object.keys(result.categories).length;
  console.log(`  ${variant}/${lang}: ${totalItems} items across ${categoryCount} categories in ${durSec}s — cached (TTL ${DIGEST_TTL_SECONDS}s)`);
}

async function main(): Promise<void> {
  console.log('=== news:digest Seed ===');
  let hadFailure = false;
  for (const { variant, lang } of TARGETS) {
    try {
      await seedOne(variant, lang);
    } catch (err) {
      hadFailure = true;
      console.error(`  ${variant}/${lang} FAILED:`, err instanceof Error ? err.message : err);
    }
  }
  if (hadFailure) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Seed error:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
