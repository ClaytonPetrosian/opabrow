import { describe, expect, it } from 'vitest';
import { sanitizeHistoryEntries } from './history';

describe('sanitizeHistoryEntries', () => {
  it('keeps valid recent web entries, normalizes missing titles, and deduplicates URLs', () => {
    expect(
      sanitizeHistoryEntries([
        { url: 'https://example.com/a', title: 'Example', visitedAt: 42 },
        { url: 'https://example.com/a', title: 'Duplicate', visitedAt: 43 },
        { url: 'https://example.org', title: '', visitedAt: 44 },
        { url: 'file:///private', title: 'Local', visitedAt: 45 }
      ])
    ).toEqual([
      { url: 'https://example.com/a', title: 'Example', visitedAt: 42 },
      { url: 'https://example.org', title: 'example.org', visitedAt: 44 }
    ]);
  });
});
