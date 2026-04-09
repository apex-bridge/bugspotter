/**
 * Storage utility functions
 * Shared helpers for storage key generation and manipulation
 */

/**
 * Generate thumbnail storage key from screenshot key
 * Handles edge cases like missing directory or malformed keys
 *
 * @param screenshotKey - Original screenshot storage key
 * @returns Thumbnail storage key
 *
 * @example
 * getThumbnailKey('screenshots/proj/bug/image.png') // => 'screenshots/proj/bug/thumb-image.png'
 * getThumbnailKey('image.png') // => 'thumb-image.png'
 */
export function getThumbnailKey(screenshotKey: string): string {
  const lastSlashIndex = screenshotKey.lastIndexOf('/');

  if (lastSlashIndex === -1) {
    // No directory, just filename
    return `thumb-${screenshotKey}`;
  }

  const dir = screenshotKey.substring(0, lastSlashIndex);
  const filename = screenshotKey.substring(lastSlashIndex + 1);

  // Ensure we don't create keys with leading slashes
  if (!dir) {
    return `thumb-${filename}`;
  }

  return `${dir}/thumb-${filename}`;
}
