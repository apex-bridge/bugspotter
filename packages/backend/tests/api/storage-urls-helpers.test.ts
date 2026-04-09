/**
 * Storage URL Helper Functions Tests
 * Unit tests for getThumbnailKey() helper function
 */

import { describe, it, expect } from 'vitest';
import { getThumbnailKey } from '../../src/api/utils/storage-helpers.js';

describe('getThumbnailKey()', () => {
  describe('Normal paths', () => {
    it('should generate thumbnail key for standard path', () => {
      const result = getThumbnailKey('screenshots/project-id/bug-id/image.png');
      expect(result).toBe('screenshots/project-id/bug-id/thumb-image.png');
    });

    it('should handle single directory', () => {
      const result = getThumbnailKey('screenshots/image.png');
      expect(result).toBe('screenshots/thumb-image.png');
    });

    it('should handle multiple nested directories', () => {
      const result = getThumbnailKey('a/b/c/d/e/image.png');
      expect(result).toBe('a/b/c/d/e/thumb-image.png');
    });

    it('should preserve file extensions', () => {
      const result = getThumbnailKey('screenshots/image.jpg');
      expect(result).toBe('screenshots/thumb-image.jpg');
    });

    it('should handle files with multiple dots', () => {
      const result = getThumbnailKey('screenshots/my.image.file.png');
      expect(result).toBe('screenshots/thumb-my.image.file.png');
    });
  });

  describe('Edge cases - No directory', () => {
    it('should handle filename with no directory', () => {
      const result = getThumbnailKey('image.png');
      expect(result).toBe('thumb-image.png');
    });

    it('should handle filename with no extension', () => {
      const result = getThumbnailKey('image');
      expect(result).toBe('thumb-image');
    });

    it('should handle filename with special characters', () => {
      const result = getThumbnailKey('my-image_2024.png');
      expect(result).toBe('thumb-my-image_2024.png');
    });
  });

  describe('Edge cases - Leading slash prevention', () => {
    it('should prevent leading slash when directory is empty string', () => {
      // This simulates: '/image.png'.substring(0, 0) => ''
      const result = getThumbnailKey('/image.png');
      expect(result).toBe('thumb-image.png');
      expect(result).not.toContain('//');
      expect(result.startsWith('/')).toBe(false);
    });

    it('should handle double slashes', () => {
      const result = getThumbnailKey('screenshots//image.png');
      // The function correctly handles this by finding the last slash
      // 'screenshots//image.png' -> dir='screenshots/', filename='image.png'
      // Result: 'screenshots//thumb-image.png'
      expect(result).toBe('screenshots//thumb-image.png');
    });
  });

  describe('Edge cases - Special scenarios', () => {
    it('should handle key ending with slash (malformed)', () => {
      const result = getThumbnailKey('screenshots/');
      expect(result).toBe('screenshots/thumb-');
    });

    it('should handle empty filename after last slash', () => {
      const result = getThumbnailKey('screenshots/folder/');
      expect(result).toBe('screenshots/folder/thumb-');
    });

    it('should handle very long paths', () => {
      const longPath =
        'screenshots/very/long/path/with/many/nested/directories/and/a/very/long/filename.png';
      const result = getThumbnailKey(longPath);
      expect(result).toBe(
        'screenshots/very/long/path/with/many/nested/directories/and/a/very/long/thumb-filename.png'
      );
    });

    it('should handle paths with spaces', () => {
      const result = getThumbnailKey('screenshots/my folder/my image.png');
      expect(result).toBe('screenshots/my folder/thumb-my image.png');
    });

    it('should handle paths with unicode characters', () => {
      const result = getThumbnailKey('screenshots/日本語/画像.png');
      expect(result).toBe('screenshots/日本語/thumb-画像.png');
    });
  });

  describe('Real-world scenarios', () => {
    it('should match actual S3 key format from bug reports', () => {
      const result = getThumbnailKey('screenshots/proj-123/bug-456/screenshot-1234567890.png');
      expect(result).toBe('screenshots/proj-123/bug-456/thumb-screenshot-1234567890.png');
    });

    it('should handle replay keys if mistakenly used', () => {
      const result = getThumbnailKey('replays/proj-123/bug-456/replay.json.gz');
      expect(result).toBe('replays/proj-123/bug-456/thumb-replay.json.gz');
    });
  });

  describe('Input validation', () => {
    it('should handle empty string', () => {
      const result = getThumbnailKey('');
      expect(result).toBe('thumb-');
    });

    it('should not mutate the original key', () => {
      const original = 'screenshots/image.png';
      const originalCopy = original;
      getThumbnailKey(original);
      expect(original).toBe(originalCopy);
    });
  });
});
