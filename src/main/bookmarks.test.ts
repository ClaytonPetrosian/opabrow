import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BookmarkStore,
  parseChromeBookmarks,
  parseHtmlBookmarks,
  parseSafariBookmarks
} from './bookmarks';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('browser bookmark importers', () => {
  it('preserves Chrome folders and bookmark metadata', () => {
    const imported = parseChromeBookmarks(
      {
        roots: {
          bookmark_bar: {
            type: 'folder',
            name: 'Bookmarks bar',
            children: [
              {
                type: 'folder',
                name: 'Work',
                children: [{ type: 'url', name: 'opabrow', url: 'https://github.com/ClaytonPetrosian/opabrow' }]
              }
            ]
          }
        }
      },
      'Default'
    );

    expect(imported.title).toBe('Default');
    expect(imported.children[0]).toMatchObject({ type: 'folder', title: 'Bookmarks bar' });
    expect(imported.children[0]).toMatchObject({
      children: [{ type: 'folder', title: 'Work', children: [{ title: 'opabrow' }] }]
    });
  });

  it('preserves Safari folder and leaf bookmarks', () => {
    const imported = parseSafariBookmarks({
      WebBookmarkType: 'WebBookmarkTypeList',
      Children: [
        {
          WebBookmarkType: 'WebBookmarkTypeList',
          Title: 'Reading',
          Children: [
            {
              WebBookmarkType: 'WebBookmarkTypeLeaf',
              URLString: 'https://example.com/article',
              URIDictionary: { title: 'Article' }
            }
          ]
        }
      ]
    });

    expect(imported).toMatchObject({
      title: 'Safari',
      children: [{ type: 'folder', title: 'Reading', children: [{ title: 'Article' }] }]
    });
  });

  it('reads standard HTML bookmark folders without regular expressions', () => {
    const imported = parseHtmlBookmarks(`
      <!DOCTYPE NETSCAPE-Bookmark-file-1>
      <DL><p>
        <DT><H3>Design</H3>
        <DL><p>
          <DT><A HREF="https://example.com/design">Design reference</A>
          <DT><A HREF="javascript:alert('not-a-bookmark')">Ignore this</A>
        </DL><p>
      </DL><p>
    `);

    expect(imported).toMatchObject({
      children: [
        {
          type: 'folder',
          title: 'Design',
          children: [{ type: 'bookmark', title: 'Design reference', url: 'https://example.com/design' }]
        }
      ]
    });
    expect(imported.children[0]).toMatchObject({ children: [{ type: 'bookmark' }] });
  });

  it('merges repeated imports within the same folder without duplicating URLs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opabrow-bookmarks-'));
    temporaryDirectories.push(directory);
    const store = new BookmarkStore(join(directory, 'bookmarks.json'));
    const imported = parseHtmlBookmarks(`
      <DL><p><DT><H3>Links</H3><DL><p>
        <DT><A HREF="https://example.com">Example</A>
      </DL><p></DL><p>
    `);

    await store.importFolder(imported);
    const repeatedCount = await store.importFolder(imported);
    const reloaded = new BookmarkStore(join(directory, 'bookmarks.json'));
    await reloaded.load();

    expect(repeatedCount).toBe(0);
    expect(reloaded.getItems()).toMatchObject([
      { type: 'folder', title: 'Imported HTML', children: [{ title: 'Links', children: [{ url: 'https://example.com' }] }] }
    ]);
  });

  it('persists imported empty folders', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opabrow-bookmarks-'));
    temporaryDirectories.push(directory);
    const store = new BookmarkStore(join(directory, 'bookmarks.json'));

    await store.importFolder(parseHtmlBookmarks('<DL><p><DT><H3>Empty folder</H3></DL><p>'));

    const reloaded = new BookmarkStore(join(directory, 'bookmarks.json'));
    await reloaded.load();
    expect(reloaded.getItems()).toMatchObject([
      { type: 'folder', title: 'Imported HTML', children: [{ type: 'folder', title: 'Empty folder', children: [] }] }
    ]);
  });
});
