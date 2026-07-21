import { describe, expect, it } from 'vitest';
import { sanitizeSession, sanitizeSessionPatch } from './session';

describe('session sanitization', () => {
  it('keeps only safe browser state', () => {
    expect(
      sanitizeSession({
        url: 'https://example.com',
        opacity: 1.5,
        alwaysOnTop: true,
        clickThrough: false,
        mobileMode: true,
        bounds: { x: 10, y: 20, width: 640, height: 480 },
        downloads: [{
          id: 'download-1',
          url: 'https://example.com/file.zip',
          filename: 'file.zip',
          savePath: '/tmp/file.zip',
          receivedBytes: 100,
          totalBytes: 200,
          state: 'completed',
          createdAt: 1
        }]
      })
    ).toMatchObject({
      url: 'https://example.com',
      opacity: 1,
      alwaysOnTop: true,
      clickThrough: false,
      mobileMode: true,
      bounds: { x: 10, y: 20, width: 640, height: 480 },
      downloads: [{ id: 'download-1', state: 'completed' }]
    });
  });

  it('rejects unsafe renderer patches', () => {
    expect(sanitizeSessionPatch({ url: 'file:///private', opacity: -4, alwaysOnTop: 'yes' })).toEqual({ opacity: 0.1 });
  });
});
