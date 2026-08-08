/**
 * Derive media URLs from storage keys at read time.
 *
 * `screenshot_url` / `replay_url` are columns that historically held a
 * *presigned* URL, written once by the screenshot worker. A presigned URL is
 * temporary and encodes the storage endpoint, so persisting one makes both
 * properties permanent: the row keeps a URL that expires, and that names a host
 * which may no longer exist.
 *
 * Both failure modes were live. After the 2026-08-04 host move, 133 of 138
 * reports pointed at a deleted bucket and could not self-heal; the handful of
 * rows written afterwards carried a 6-day expiry and would have started
 * returning 403 with no way back.
 *
 * The keys do not have either problem - they are stable and say nothing about
 * where the bucket lives - so URLs are now generated per request from the key.
 * The share endpoint already worked this way; this brings the report read paths
 * in line with it.
 *
 * Signing is a local HMAC with no network call, so doing it per row on a listing
 * page is cheap.
 */

import { config } from '../../config.js';
import { getLogger } from '../../logger.js';
import type { IStorageService } from '../../storage/types.js';

const logger = getLogger();

/** The subset of a bug report this module reads and rewrites. */
export interface MediaKeyed {
  screenshot_key?: string | null;
  thumbnail_key?: string | null;
  replay_key?: string | null;
  screenshot_url?: string | null;
  thumbnail_url?: string | null;
  replay_url?: string | null;
}

/**
 * `T` with the three URL fields present rather than optional.
 *
 * They are optional on {@link MediaKeyed} because a row arrives without them,
 * but this module always writes all three, so returning a bare `T` would make
 * callers narrow fields that are guaranteed to be there.
 */
export type WithMediaUrls<T> = Omit<T, 'screenshot_url' | 'thumbnail_url' | 'replay_url'> & {
  screenshot_url: string | null;
  thumbnail_url: string | null;
  replay_url: string | null;
};

async function sign(
  storage: IStorageService,
  key: string | null | undefined,
  expiresIn: number
): Promise<string | null> {
  if (!key) {
    return null;
  }
  try {
    return await storage.getSignedUrl(key, { expiresIn });
  } catch (err) {
    // Signing is a local HMAC, so this does not fire for an object that no
    // longer exists - that URL signs fine and 404s on use, which is #287 and
    // needs a HEAD before signing or a UI-side empty state, not a change here.
    // What this catches is a signer that cannot produce a URL at all (missing
    // credentials, a malformed key). Fail soft to null: a listing page should
    // render without the thumbnail rather than 500 on one bad row.
    logger.warn('Could not sign media URL', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Return a copy of `report` with media URLs freshly derived from its keys.
 *
 * A row whose key is null gets a null URL - notably this *discards* any stale
 * value in the corresponding `*_url` column, which is the point.
 */
export async function withFreshMediaUrls<T extends MediaKeyed>(
  report: T,
  storage: IStorageService
): Promise<WithMediaUrls<T>> {
  const expiresIn = config.shareToken.presignedUrlExpirationSeconds;
  const [screenshot_url, thumbnail_url, replay_url] = await Promise.all([
    sign(storage, report.screenshot_key, expiresIn),
    sign(storage, report.thumbnail_key, expiresIn),
    sign(storage, report.replay_key, expiresIn),
  ]);
  return { ...report, screenshot_url, thumbnail_url, replay_url };
}

/** Batch form of {@link withFreshMediaUrls} for listing endpoints. */
export async function withFreshMediaUrlsMany<T extends MediaKeyed>(
  reports: T[],
  storage: IStorageService
): Promise<WithMediaUrls<T>[]> {
  return Promise.all(reports.map((r) => withFreshMediaUrls(r, storage)));
}
