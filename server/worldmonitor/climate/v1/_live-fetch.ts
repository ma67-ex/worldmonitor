/**
 * Live RSS/API fetch for climate news, ported from `scripts/seed-climate-news.mjs`
 * so `list-climate-news.ts` can serve fresh data when the seed key is cold —
 * never seeded, or its TTL expired with nothing to refresh it. Kept in lockstep
 * with the seed script's parsing rules; the seed script remains the primary,
 * more thorough path (it writes the canonical Redis key this handler reads first).
 */

import { decodeHtmlEntities } from '../../../../src/utils/html-entities';
import type { ClimateNewsItem } from '../../../../src/generated/server/worldmonitor/climate/v1/service_server';

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const RSS_MAX_BYTES = 500_000;
const MAX_ITEMS = 100;

interface FeedConfig {
  sourceName: string;
  url?: string;
  isApi?: boolean;
}

const FEEDS: FeedConfig[] = [
  { sourceName: 'Carbon Brief', url: 'https://www.carbonbrief.org/feed' },
  { sourceName: 'The Guardian Environment', url: 'https://www.theguardian.com/environment/climate-crisis/rss' },
  { sourceName: 'ReliefWeb Disasters', isApi: true },
  { sourceName: 'NASA Earth Observatory', url: 'https://earthobservatory.nasa.gov/feeds/earth-observatory.rss' },
  { sourceName: 'UNEP', url: 'https://www.unep.org/rss.xml' },
  { sourceName: 'Phys.org Earth Science', url: 'https://phys.org/rss-feed/earth-news/earth-sciences/' },
  { sourceName: 'Copernicus Climate', url: 'https://climate.copernicus.eu/rss.xml' },
  { sourceName: 'Inside Climate News', url: 'https://insideclimatenews.org/feed/' },
  { sourceName: 'Climate Central', url: 'https://www.climatecentral.org/rss' },
];

function stableHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function extractTag(block: string, tagName: string): string {
  const re = new RegExp(`<${tagName}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tagName}>`, 'i');
  return (block.match(re) || [])[1]?.trim() || '';
}

function cleanSummary(raw: string): string {
  return decodeHtmlEntities(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function parseDateMs(block: string): number {
  const raw = extractTag(block, 'pubDate')
    || extractTag(block, 'published')
    || extractTag(block, 'updated')
    || extractTag(block, 'dc:date');
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function extractLink(block: string): string {
  const direct = extractTag(block, 'link');
  if (direct) return decodeHtmlEntities(direct).trim();
  const href = (block.match(/<link[^>]*\bhref=(["'])(.*?)\1[^>]*\/?>/i) || [])[2] || '';
  return decodeHtmlEntities(href).trim();
}

export function parseRssItems(xml: string, sourceName: string): ClimateNewsItem[] {
  const bounded = xml.length > RSS_MAX_BYTES ? xml.slice(0, RSS_MAX_BYTES) : xml;
  const items: ClimateNewsItem[] = [];
  const seenIds = new Set<string>();

  const pushParsedItem = (block: string, summaryTags: string[]) => {
    const title = decodeHtmlEntities(extractTag(block, 'title'));
    const url = extractLink(block);
    const publishedAt = parseDateMs(block);
    const rawSummary = summaryTags.map((tag) => extractTag(block, tag)).find(Boolean) || '';
    if (!title || !url || !publishedAt) return;

    const id = `${stableHash(url)}-${publishedAt}`;
    if (seenIds.has(id)) return;
    seenIds.add(id);

    items.push({ id, title, url, sourceName, publishedAt, summary: cleanSummary(rawSummary) });
  };

  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(bounded)) !== null) {
    pushParsedItem(match[1]!, ['description', 'summary', 'content:encoded']);
  }

  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  while ((match = entryRe.exec(bounded)) !== null) {
    pushParsedItem(match[1]!, ['summary', 'content']);
  }

  return items;
}

async function fetchReliefWebApi(feed: FeedConfig): Promise<ClimateNewsItem[]> {
  const appname = (process.env.RELIEFWEB_APPNAME || process.env.RELIEFWEB_APP_NAME || '').trim();
  if (!appname) return [];
  const qs = `appname=${encodeURIComponent(appname)}&limit=20&preset=latest&filter[field]=theme.id&filter[value]=4590&fields[include][]=title&fields[include][]=url_alias&fields[include][]=date.created&fields[include][]=source`;
  const endpoints = [
    `https://api.reliefweb.int/v1/reports?${qs}`,
    `https://api.reliefweb.int/v2/reports?${qs}`,
  ];
  for (const url of endpoints) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': CHROME_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) continue;
      const data = await resp.json() as { data?: Array<{ fields?: { title?: string; url_alias?: string; date?: { created?: string } } }> };
      const items: ClimateNewsItem[] = [];
      for (const r of data.data || []) {
        const title = r.fields?.title || '';
        const itemUrl = r.fields?.url_alias ? `https://reliefweb.int${r.fields.url_alias}` : '';
        const publishedAt = r.fields?.date?.created ? new Date(r.fields.date.created).getTime() : 0;
        if (!title || !itemUrl || !publishedAt) continue;
        const id = `${stableHash(itemUrl)}-${publishedAt}`;
        items.push({ id, title, url: itemUrl, sourceName: feed.sourceName, publishedAt, summary: '' });
      }
      return items;
    } catch {
      // sentry-coverage-ok: tries the next endpoint; total failure yields [] below.
    }
  }
  return [];
}

async function fetchFeed(feed: FeedConfig): Promise<ClimateNewsItem[]> {
  try {
    if (feed.isApi) return await fetchReliefWebApi(feed);
    const resp = await fetch(feed.url!, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*', 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const xml = await resp.text();
    return parseRssItems(xml, feed.sourceName);
  } catch {
    // sentry-coverage-ok: one feed failing must not fail the aggregate fetch.
    return [];
  }
}

export async function fetchClimateNewsLive(): Promise<{ items: ClimateNewsItem[]; fetchedAt: number } | null> {
  const settled = await Promise.allSettled(FEEDS.map(fetchFeed));
  const allItems: ClimateNewsItem[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') allItems.push(...result.value);
  }
  if (allItems.length === 0) return null;

  allItems.sort((a, b) => b.publishedAt - a.publishedAt);

  const seenUrlHashes = new Set<string>();
  const deduped: ClimateNewsItem[] = [];
  for (const item of allItems) {
    const urlHash = stableHash(item.url);
    if (seenUrlHashes.has(urlHash)) continue;
    seenUrlHashes.add(urlHash);
    deduped.push(item);
    if (deduped.length >= MAX_ITEMS) break;
  }

  return { items: deduped, fetchedAt: Date.now() };
}
