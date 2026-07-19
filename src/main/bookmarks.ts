import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'parse5';

const execFileAsync = promisify(execFile);

export type BookmarkNode = BookmarkFolder | BookmarkItem;

export type BookmarkFolder = {
  id: string;
  type: 'folder';
  title: string;
  children: BookmarkNode[];
};

export type BookmarkItem = {
  id: string;
  type: 'bookmark';
  title: string;
  url: string;
};

type BookmarkDocument = {
  version: 1;
  items: BookmarkNode[];
};

type HtmlNode = {
  tagName?: string;
  nodeName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function titleForUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function createFolder(title: string, children: BookmarkNode[] = []): BookmarkFolder {
  return {
    id: randomUUID(),
    type: 'folder',
    title: title.trim() || 'Untitled folder',
    children
  };
}

function createBookmark(title: string, url: string): BookmarkItem {
  return {
    id: randomUUID(),
    type: 'bookmark',
    title: title.trim() || titleForUrl(url),
    url
  };
}

function sanitizeNode(value: unknown): BookmarkNode | null {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.title !== 'string') return null;

  if (value.type === 'bookmark' && typeof value.url === 'string' && isHttpUrl(value.url)) {
    return {
      id: typeof value.id === 'string' ? value.id : randomUUID(),
      type: 'bookmark',
      title: value.title.trim() || titleForUrl(value.url),
      url: value.url
    };
  }

  if (value.type === 'folder' && Array.isArray(value.children)) {
    return {
      id: typeof value.id === 'string' ? value.id : randomUUID(),
      type: 'folder',
      title: value.title.trim() || 'Untitled folder',
      children: value.children.map(sanitizeNode).filter((node): node is BookmarkNode => node !== null)
    };
  }

  return null;
}

function countBookmarks(node: BookmarkNode): number {
  if (node.type === 'bookmark') return 1;
  return node.children.reduce((count, child) => count + countBookmarks(child), 0);
}

function mergeFolder(target: BookmarkFolder, source: BookmarkFolder): { added: number; changed: boolean } {
  let added = 0;
  let changed = false;

  for (const sourceChild of source.children) {
    if (sourceChild.type === 'bookmark') {
      const duplicate = target.children.some(
        (targetChild) => targetChild.type === 'bookmark' && targetChild.url === sourceChild.url
      );
      if (!duplicate) {
        target.children.push(sourceChild);
        added += 1;
        changed = true;
      }
      continue;
    }

    const existingFolder = target.children.find(
      (targetChild): targetChild is BookmarkFolder =>
        targetChild.type === 'folder' && targetChild.title === sourceChild.title
    );
    if (existingFolder) {
      const result = mergeFolder(existingFolder, sourceChild);
      added += result.added;
      changed = changed || result.changed;
    } else {
      target.children.push(sourceChild);
      added += countBookmarks(sourceChild);
      changed = true;
    }
  }

  return { added, changed };
}

function removeUrl(nodes: BookmarkNode[], url: string): { nodes: BookmarkNode[]; removed: number } {
  let removed = 0;
  const filtered: BookmarkNode[] = [];

  for (const node of nodes) {
    if (node.type === 'bookmark') {
      if (node.url === url) removed += 1;
      else filtered.push(node);
      continue;
    }

    const result = removeUrl(node.children, url);
    removed += result.removed;
    filtered.push({ ...node, children: result.nodes });
  }

  return { nodes: filtered, removed };
}

function htmlTag(node: HtmlNode): string {
  return (node.tagName || node.nodeName || '').toLowerCase();
}

function htmlText(node: HtmlNode): string {
  const ownText = node.nodeName === '#text' ? node.value || '' : '';
  return `${ownText}${(node.childNodes || []).map(htmlText).join('')}`.replace(/\s+/g, ' ').trim();
}

function htmlAttribute(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((attribute) => attribute.name.toLowerCase() === name.toLowerCase())?.value;
}

function findHtmlTag(node: HtmlNode, tag: string, stopAtDl = false): HtmlNode | undefined {
  if (htmlTag(node) === tag) return node;
  for (const child of node.childNodes || []) {
    if (stopAtDl && htmlTag(child) === 'dl') continue;
    const found = findHtmlTag(child, tag, stopAtDl);
    if (found) return found;
  }
  return undefined;
}

function findFollowingDl(children: HtmlNode[], index: number): HtmlNode | undefined {
  for (let cursor = index + 1; cursor < children.length; cursor += 1) {
    const candidate = children[cursor];
    const tag = htmlTag(candidate);
    if (tag === 'dt') return undefined;
    if (tag === 'dl') return candidate;
    const nested = findHtmlTag(candidate, 'dl');
    if (nested) return nested;
  }
  return undefined;
}

function parseHtmlFolder(dl: HtmlNode): BookmarkNode[] {
  const children = dl.childNodes || [];
  const nodes: BookmarkNode[] = [];

  for (let index = 0; index < children.length; index += 1) {
    const item = children[index];
    if (htmlTag(item) !== 'dt') continue;

    const heading = findHtmlTag(item, 'h3', true);
    if (heading) {
      const nestedDl = findHtmlTag(item, 'dl') || findFollowingDl(children, index);
      nodes.push(createFolder(htmlText(heading), nestedDl ? parseHtmlFolder(nestedDl) : []));
      continue;
    }

    const link = findHtmlTag(item, 'a', true);
    const href = link ? htmlAttribute(link, 'href') : undefined;
    if (link && href && isHttpUrl(href)) nodes.push(createBookmark(htmlText(link), href));
  }

  return nodes;
}

function parseChromeNode(value: unknown): BookmarkNode | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;

  if (value.type === 'url' && typeof value.url === 'string' && isHttpUrl(value.url)) {
    return createBookmark(typeof value.name === 'string' ? value.name : '', value.url);
  }

  if (value.type === 'folder' && Array.isArray(value.children)) {
    return createFolder(
      typeof value.name === 'string' ? value.name : '',
      value.children.map(parseChromeNode).filter((node): node is BookmarkNode => node !== null)
    );
  }

  return null;
}

function parseSafariNode(value: unknown): BookmarkNode | null {
  if (!isRecord(value)) return null;
  const type = value.WebBookmarkType;

  if (type === 'WebBookmarkTypeLeaf' && typeof value.URLString === 'string' && isHttpUrl(value.URLString)) {
    const uriDictionary = isRecord(value.URIDictionary) ? value.URIDictionary : undefined;
    const title = uriDictionary && typeof uriDictionary.title === 'string' ? uriDictionary.title : '';
    return createBookmark(title, value.URLString);
  }

  if (Array.isArray(value.Children)) {
    return createFolder(
      typeof value.Title === 'string' ? value.Title : '',
      value.Children.map(parseSafariNode).filter((node): node is BookmarkNode => node !== null)
    );
  }

  return null;
}

export function parseChromeBookmarks(value: unknown, profileName: string): BookmarkFolder {
  const roots = isRecord(value) && isRecord(value.roots) ? value.roots : {};
  const children = Object.values(roots)
    .map(parseChromeNode)
    .filter((node): node is BookmarkNode => node !== null);
  return createFolder(profileName, children);
}

export function parseSafariBookmarks(value: unknown): BookmarkFolder {
  const root = parseSafariNode(value);
  return createFolder('Safari', root?.type === 'folder' ? root.children : root ? [root] : []);
}

export function parseHtmlBookmarks(html: string, title = 'Imported HTML'): BookmarkFolder {
  const document = parse(html) as unknown as HtmlNode;
  const dl = findHtmlTag(document, 'dl');
  return createFolder(title, dl ? parseHtmlFolder(dl) : []);
}

export class BookmarkStore {
  private items: BookmarkNode[] = [];

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      const document = JSON.parse(content) as unknown;
      if (!isRecord(document) || !Array.isArray(document.items)) return;
      this.items = document.items.map(sanitizeNode).filter((node): node is BookmarkNode => node !== null);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') console.warn('Could not load bookmarks:', error);
    }
  }

  getItems(): BookmarkNode[] {
    return structuredClone(this.items);
  }

  async toggle(url: string, title: string): Promise<boolean> {
    if (!isHttpUrl(url)) throw new Error('Only HTTP(S) pages can be bookmarked.');
    const result = removeUrl(this.items, url);
    if (result.removed > 0) {
      this.items = result.nodes;
      await this.save();
      return false;
    }

    this.items.push(createBookmark(title, url));
    await this.save();
    return true;
  }

  async importFolder(folder: BookmarkFolder): Promise<number> {
    const existing = this.items.find(
      (item): item is BookmarkFolder => item.type === 'folder' && item.title === folder.title
    );
    const result = existing ? mergeFolder(existing, folder) : { added: countBookmarks(folder), changed: true };
    if (!existing) this.items.push(folder);
    if (result.changed) await this.save();
    return result.added;
  }

  async clear(): Promise<void> {
    this.items = [];
    await this.save();
  }

  private async save(): Promise<void> {
    const document: BookmarkDocument = { version: 1, items: this.items };
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(document, null, 2), 'utf8');
    await rename(temporaryPath, this.filePath);
  }
}

export async function importChromeBookmarksFromDisk(): Promise<BookmarkFolder> {
  const chromeDirectory = join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  const profiles = await readdir(chromeDirectory, { withFileTypes: true });
  const importedProfiles: BookmarkNode[] = [];

  for (const profile of profiles) {
    if (!profile.isDirectory()) continue;
    try {
      const bookmarksPath = join(chromeDirectory, profile.name, 'Bookmarks');
      const source = JSON.parse(await readFile(bookmarksPath, 'utf8')) as unknown;
      const parsed = parseChromeBookmarks(source, profile.name);
      if (parsed.children.length > 0) importedProfiles.push(parsed);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') console.warn(`Could not read Chrome profile ${profile.name}:`, error);
    }
  }

  if (importedProfiles.length === 0) throw new Error('No Chrome bookmarks were found.');
  return createFolder('Chrome', importedProfiles);
}

export async function importSafariBookmarksFromDisk(): Promise<BookmarkFolder> {
  const bookmarksPath = join(homedir(), 'Library', 'Safari', 'Bookmarks.plist');
  const { stdout } = await execFileAsync('plutil', ['-convert', 'json', '-o', '-', bookmarksPath], {
    maxBuffer: 10 * 1024 * 1024
  });
  const parsed = parseSafariBookmarks(JSON.parse(stdout) as unknown);
  if (parsed.children.length === 0) throw new Error('No Safari bookmarks were found.');
  return parsed;
}

export async function importHtmlBookmarksFromFile(filePath: string): Promise<BookmarkFolder> {
  const html = await readFile(filePath, 'utf8');
  const imported = parseHtmlBookmarks(html);
  if (imported.children.length === 0) throw new Error('No bookmarks were found in the selected HTML file.');
  return imported;
}
