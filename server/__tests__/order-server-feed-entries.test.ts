import { describe, it, expect } from 'vitest';
import { orderServerFeedEntries } from '../worldmonitor/news/v1/_feeds';

type Entry = { category: string; feed: { name: string; deadlinePriority?: number } };

function entry(category: string, name: string, deadlinePriority?: number): Entry {
  return { category, feed: { name, deadlinePriority } };
}

describe('orderServerFeedEntries', () => {
  it('interleaves no-priority feeds across categories instead of draining one category at a time', () => {
    // 3 feeds in the front category, 1 each in two trailing categories --
    // the shape that starved africa/latam/asia/energy/thinktanks/crisis/
    // layoffs in production: a big category first, small ones declared last.
    const entries = [
      entry('politics', 'p1'),
      entry('politics', 'p2'),
      entry('politics', 'p3'),
      entry('africa', 'a1'),
      entry('latam', 'l1'),
    ];

    const ordered = orderServerFeedEntries(entries).map((e) => e.feed.name);

    // Old behavior (declaration order) would be p1,p2,p3,a1,l1 -- a1/l1 only
    // reachable after all of politics finishes. Round-robin must reach both
    // trailing categories' single feed before politics' third.
    expect(ordered.indexOf('a1')).toBeLessThan(ordered.indexOf('p3'));
    expect(ordered.indexOf('l1')).toBeLessThan(ordered.indexOf('p3'));
    expect(ordered).toHaveLength(5);
    expect(new Set(ordered)).toEqual(new Set(['p1', 'p2', 'p3', 'a1', 'l1']));
  });

  it('still runs explicit deadlinePriority feeds first, highest first', () => {
    const entries = [
      entry('politics', 'normal'),
      entry('crisis', 'urgent', 10),
      entry('crisis', 'less-urgent', 5),
    ];

    const ordered = orderServerFeedEntries(entries).map((e) => e.feed.name);
    expect(ordered).toEqual(['urgent', 'less-urgent', 'normal']);
  });

  it('preserves within-category feed order at each round-robin rank', () => {
    const entries = [
      entry('politics', 'p1'),
      entry('politics', 'p2'),
      entry('africa', 'a1'),
      entry('africa', 'a2'),
    ];

    const ordered = orderServerFeedEntries(entries).map((e) => e.feed.name);
    // rank 0: p1, a1 (order between categories not asserted); rank 1: p2, a2
    expect(ordered.indexOf('p1')).toBeLessThan(ordered.indexOf('p2'));
    expect(ordered.indexOf('a1')).toBeLessThan(ordered.indexOf('a2'));
    expect(ordered.indexOf('p2')).toBeGreaterThanOrEqual(2);
    expect(ordered.indexOf('a2')).toBeGreaterThanOrEqual(2);
  });
});
