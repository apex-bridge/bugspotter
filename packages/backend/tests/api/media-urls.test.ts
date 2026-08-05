import { describe, it, expect, vi } from 'vitest';
import { withFreshMediaUrls, withFreshMediaUrlsMany } from '../../src/api/utils/media-urls.js';
import type { IStorageService } from '../../src/storage/types.js';

function fakeStorage(overrides: Partial<IStorageService> = {}): IStorageService {
  return {
    getSignedUrl: vi.fn(
      async (key: string) => `https://storage.example.com/${key}?X-Amz-Signature=fresh`
    ),
    ...overrides,
  } as unknown as IStorageService;
}

describe('withFreshMediaUrls', () => {
  it('discards a stale stored URL and derives a new one from the key', async () => {
    // The regression: rows written before the host move carry a presigned URL
    // pointing at a bucket that no longer exists. It must not survive.
    const report = {
      screenshot_key: 'screenshots/p/b/original.png',
      thumbnail_key: 'screenshots/p/b-thumb/original.png',
      replay_key: 'replays/p/b/replay.gz',
      screenshot_url: 'https://storage.yandexcloud.kz/dead-bucket/old.png?X-Amz-Signature=stale',
      replay_url: 'https://storage.yandexcloud.kz/dead-bucket/old.gz?X-Amz-Signature=stale',
    };

    const result = await withFreshMediaUrls(report, fakeStorage());

    expect(result.screenshot_url).not.toContain('yandexcloud');
    expect(result.replay_url).not.toContain('yandexcloud');
    expect(result.screenshot_url).toBe(
      'https://storage.example.com/screenshots/p/b/original.png?X-Amz-Signature=fresh'
    );
    expect(result.thumbnail_url).toContain('b-thumb');
    expect(result.replay_url).toContain('replay.gz');
  });

  it('nulls the URL when there is no key, even if a stale URL is stored', async () => {
    // A key-less row can only ever have a dead URL, so returning null lets the
    // UI show an honest empty state rather than a broken image.
    const result = await withFreshMediaUrls(
      {
        screenshot_key: null,
        replay_key: null,
        screenshot_url: 'https://storage.yandexcloud.kz/dead-bucket/old.png',
      },
      fakeStorage()
    );

    expect(result.screenshot_url).toBeNull();
    expect(result.replay_url).toBeNull();
    expect(result.thumbnail_url).toBeNull();
  });

  it('fails soft to null when the object is gone', async () => {
    // Lifecycle rules expire replays at 30 days while the row keeps its key,
    // so signing a dangling key must not fail the whole request.
    const storage = fakeStorage({
      getSignedUrl: vi.fn(async () => {
        throw new Error('NoSuchKey');
      }),
    });

    const result = await withFreshMediaUrls({ screenshot_key: 'gone.png' }, storage);
    expect(result.screenshot_url).toBeNull();
  });

  it('signs every row of a listing', async () => {
    const storage = fakeStorage();
    const rows = [
      { screenshot_key: 'a.png' },
      { screenshot_key: 'b.png' },
      { screenshot_key: null },
    ];

    const result = await withFreshMediaUrlsMany(rows, storage);

    expect(result[0].screenshot_url).toContain('a.png');
    expect(result[1].screenshot_url).toContain('b.png');
    expect(result[2].screenshot_url).toBeNull();
    // Two keys present, so two signatures - no wasted work on the null row.
    expect(storage.getSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('does not mutate the input row', async () => {
    const report = { screenshot_key: 'a.png', screenshot_url: 'stale' };
    await withFreshMediaUrls(report, fakeStorage());
    expect(report.screenshot_url).toBe('stale');
  });
});
