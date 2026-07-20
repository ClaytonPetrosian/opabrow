export const HISTORY_LIMIT = 100;

export type HistoryEntry = {
  url: string;
  title: string;
  visitedAt: number;
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Renderer persists the source of truth locally; this protects the native menu IPC boundary.
export function sanitizeHistoryEntries(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];

  const seenUrls = new Set<string>();
  const entries: HistoryEntry[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { url, title, visitedAt } = item as Partial<HistoryEntry>;
    if (typeof url !== 'string' || !isHttpUrl(url) || seenUrls.has(url)) continue;

    seenUrls.add(url);
    entries.push({
      url,
      title: typeof title === 'string' && title.trim() ? title.trim() : new URL(url).hostname,
      visitedAt: typeof visitedAt === 'number' && Number.isFinite(visitedAt) ? visitedAt : Date.now()
    });

    if (entries.length === HISTORY_LIMIT) break;
  }

  return entries;
}
