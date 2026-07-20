import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type DownloadState = 'progressing' | 'completed' | 'failed';

export type DownloadEntry = {
  id: string;
  url: string;
  filename: string;
  savePath: string;
  receivedBytes: number;
  totalBytes: number;
  state: DownloadState;
  createdAt: number;
};

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AppSession = {
  url: string | null;
  opacity: number;
  alwaysOnTop: boolean;
  mobileMode: boolean;
  bounds: WindowBounds | null;
  downloads: DownloadEntry[];
};

const DEFAULT_SESSION: AppSession = {
  url: null,
  opacity: 1,
  alwaysOnTop: false,
  mobileMode: false,
  bounds: null,
  downloads: []
};
const DOWNLOAD_LIMIT = 30;

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeBounds(value: unknown): WindowBounds | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height } = value as Partial<WindowBounds>;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    ![x, y, width, height].every(Number.isFinite)
  ) {
    return null;
  }
  if (width < 120 || height < 100) return null;
  return { x, y, width, height };
}

function sanitizeDownloads(value: unknown): DownloadEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: DownloadEntry[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Partial<DownloadEntry>;
    if (
      typeof entry.id !== 'string' ||
      seen.has(entry.id) ||
      !isHttpUrl(entry.url) ||
      typeof entry.filename !== 'string' ||
      typeof entry.savePath !== 'string' ||
      !['progressing', 'completed', 'failed'].includes(String(entry.state)) ||
      typeof entry.createdAt !== 'number'
    ) {
      continue;
    }

    seen.add(entry.id);
    entries.push({
      id: entry.id,
      url: entry.url,
      filename: entry.filename,
      savePath: entry.savePath,
      receivedBytes: typeof entry.receivedBytes === 'number' ? Math.max(0, entry.receivedBytes) : 0,
      totalBytes: typeof entry.totalBytes === 'number' ? Math.max(0, entry.totalBytes) : 0,
      state: entry.state as DownloadState,
      createdAt: entry.createdAt
    });
    if (entries.length === DOWNLOAD_LIMIT) break;
  }

  return entries;
}

export function sanitizeSession(value: unknown): AppSession {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SESSION };
  const session = value as Partial<AppSession>;
  return {
    url: isHttpUrl(session.url) ? session.url : null,
    opacity: typeof session.opacity === 'number' && Number.isFinite(session.opacity)
      ? Math.min(1, Math.max(0.1, session.opacity))
      : DEFAULT_SESSION.opacity,
    alwaysOnTop: session.alwaysOnTop === true,
    mobileMode: session.mobileMode === true,
    bounds: sanitizeBounds(session.bounds),
    // 进程重启时没有可继续复用的 DownloadItem，遗留中的任务应明确显示为失败。
    downloads: sanitizeDownloads(session.downloads).map((entry) =>
      entry.state === 'progressing' ? { ...entry, state: 'failed' } : entry
    )
  };
}

export function sanitizeSessionPatch(value: unknown): Partial<AppSession> {
  if (!value || typeof value !== 'object') return {};
  const patch = value as Partial<AppSession>;
  const next: Partial<AppSession> = {};
  if (isHttpUrl(patch.url)) next.url = patch.url;
  if (typeof patch.opacity === 'number' && Number.isFinite(patch.opacity)) next.opacity = Math.min(1, Math.max(0.1, patch.opacity));
  if (typeof patch.alwaysOnTop === 'boolean') next.alwaysOnTop = patch.alwaysOnTop;
  if (typeof patch.mobileMode === 'boolean') next.mobileMode = patch.mobileMode;
  return next;
}

export class SessionStore {
  private data: AppSession = { ...DEFAULT_SESSION };
  private writeTimer: NodeJS.Timeout | null = null;
  private writePromise: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      this.data = sanitizeSession(JSON.parse(await readFile(this.filePath, 'utf8')) as unknown);
    } catch {
      this.data = { ...DEFAULT_SESSION };
    }
  }

  getSnapshot(): AppSession {
    return structuredClone(this.data);
  }

  update(patch: Partial<AppSession>): void {
    this.data = sanitizeSession({ ...this.data, ...patch });
    this.scheduleWrite();
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
      this.queueWrite();
    }
    await this.writePromise;
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.queueWrite();
    }, 250);
  }

  private queueWrite(): void {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writePromise = this.writePromise
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, snapshot, 'utf8');
      });
  }
}
