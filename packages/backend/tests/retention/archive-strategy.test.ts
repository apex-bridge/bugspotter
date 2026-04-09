/**
 * Archive Strategy Tests
 * Tests for storage archival implementations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeletionArchiveStrategy } from '../../src/storage/archive-storage-service.js';
import type { BaseStorageService } from '../../src/storage/base-storage-service.js';
import type { ReportFiles } from '../../src/storage/archive-storage.interface.js';

describe('DeletionArchiveStrategy', () => {
  let strategy: DeletionArchiveStrategy;
  let mockStorage: BaseStorageService;

  beforeEach(() => {
    // Mock BaseStorageService
    mockStorage = {
      headObject: vi.fn(),
      deleteObject: vi.fn(),
    } as any;

    strategy = new DeletionArchiveStrategy(mockStorage);
  });

  describe('getStrategyName()', () => {
    it('should return "deletion"', () => {
      expect(strategy.getStrategyName()).toBe('deletion');
    });
  });

  describe('archiveReportFiles()', () => {
    it('should archive screenshot and replay files', async () => {
      const screenshotUrl =
        'https://s3.amazonaws.com/bucket/screenshots/project1/bug1/original.png';
      const replayUrl = 'https://s3.amazonaws.com/bucket/replays/project1/bug1/replay.json';

      vi.mocked(mockStorage.headObject)
        .mockResolvedValueOnce({
          key: 'screenshots/project1/bug1/original.png',
          size: 1024,
          lastModified: new Date(),
        })
        .mockResolvedValueOnce({
          key: 'replays/project1/bug1/replay.json',
          size: 2048,
          lastModified: new Date(),
        });

      vi.mocked(mockStorage.deleteObject).mockResolvedValue(undefined);

      const result = await strategy.archiveReportFiles(screenshotUrl, replayUrl);

      expect(result.filesArchived).toBe(2);
      expect(result.bytesArchived).toBe(3072);
      expect(result.errors).toHaveLength(0);
      expect(mockStorage.deleteObject).toHaveBeenCalledTimes(2);
    });

    it('should handle screenshot only', async () => {
      const screenshotUrl = 'screenshots/project1/bug1/original.png';

      vi.mocked(mockStorage.headObject).mockResolvedValue({
        size: 1024,
        lastModified: new Date(),
      });
      vi.mocked(mockStorage.deleteObject).mockResolvedValue(undefined);

      const result = await strategy.archiveReportFiles(screenshotUrl, null);

      expect(result.filesArchived).toBe(1);
      expect(result.bytesArchived).toBe(1024);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle replay only', async () => {
      const replayUrl = 'replays/project1/bug1/replay.json';

      vi.mocked(mockStorage.headObject).mockResolvedValue({
        size: 2048,
        lastModified: new Date(),
      });
      vi.mocked(mockStorage.deleteObject).mockResolvedValue(undefined);

      const result = await strategy.archiveReportFiles(null, replayUrl);

      expect(result.filesArchived).toBe(1);
      expect(result.bytesArchived).toBe(2048);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle null URLs gracefully', async () => {
      const result = await strategy.archiveReportFiles(null, null);

      expect(result.filesArchived).toBe(0);
      expect(result.bytesArchived).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockStorage.deleteObject).not.toHaveBeenCalled();
    });

    it('should collect errors without failing', async () => {
      const screenshotUrl = 'screenshots/broken.png';
      const replayUrl = 'replays/working.json';

      vi.mocked(mockStorage.headObject)
        .mockRejectedValueOnce(new Error('File not found'))
        .mockResolvedValueOnce({ key: 'test-key', size: 1024, lastModified: new Date() });

      vi.mocked(mockStorage.deleteObject).mockResolvedValue(undefined);

      const result = await strategy.archiveReportFiles(screenshotUrl, replayUrl);

      expect(result.filesArchived).toBe(1);
      expect(result.bytesArchived).toBe(1024);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].key).toBe(screenshotUrl);
      expect(result.errors[0].error).toContain('File not found');
    });

    it('should handle headObject returning null', async () => {
      const screenshotUrl = 'screenshots/unknown-size.png';

      vi.mocked(mockStorage.headObject).mockResolvedValue(null as any);
      vi.mocked(mockStorage.deleteObject).mockResolvedValue(undefined);

      const result = await strategy.archiveReportFiles(screenshotUrl, null);

      expect(result.filesArchived).toBe(1);
      expect(result.bytesArchived).toBe(0); // Size defaults to 0
      expect(result.errors).toHaveLength(0);
    });

    it('should extract key from full URL', async () => {
      const fullUrl = 'https://s3.amazonaws.com/bucket/path/to/file.png';

      vi.mocked(mockStorage.headObject).mockResolvedValue({
        size: 512,
        lastModified: new Date(),
      });
      vi.mocked(mockStorage.deleteObject).mockResolvedValue(undefined);

      await strategy.archiveReportFiles(fullUrl, null);

      expect(mockStorage.headObject).toHaveBeenCalledWith('bucket/path/to/file.png');
      expect(mockStorage.deleteObject).toHaveBeenCalledWith('bucket/path/to/file.png');
    });

    it('should use plain string as key if not a valid URL', async () => {
      const plainKey = 'path/to/file.png';

      vi.mocked(mockStorage.headObject).mockResolvedValue({
        size: 256,
        lastModified: new Date(),
      });
      vi.mocked(mockStorage.deleteObject).mockResolvedValue(undefined);

      await strategy.archiveReportFiles(plainKey, null);

      expect(mockStorage.headObject).toHaveBeenCalledWith(plainKey);
      expect(mockStorage.deleteObject).toHaveBeenCalledWith(plainKey);
    });
  });

  describe('archiveBatch()', () => {
    it('should archive multiple reports', async () => {
      const reports: ReportFiles[] = [
        { screenshotUrl: 'screenshots/1.png', replayUrl: 'replays/1.json' },
        { screenshotUrl: 'screenshots/2.png', replayUrl: null },
        { screenshotUrl: null, replayUrl: 'replays/3.json' },
      ];

      vi.mocked(mockStorage.headObject).mockResolvedValue({
        size: 1000,
        lastModified: new Date(),
      });
      vi.mocked(mockStorage.deleteObject).mockResolvedValue(undefined);

      const result = await strategy.archiveBatch(reports);

      expect(result.filesArchived).toBe(4); // 2 + 1 + 1
      expect(result.bytesArchived).toBe(4000); // 4 files * 1000 bytes
      expect(result.errors).toHaveLength(0);
      expect(mockStorage.deleteObject).toHaveBeenCalledTimes(4);
    });

    it('should handle empty batch', async () => {
      const result = await strategy.archiveBatch([]);

      expect(result.filesArchived).toBe(0);
      expect(result.bytesArchived).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockStorage.deleteObject).not.toHaveBeenCalled();
    });

    it('should aggregate errors from multiple reports', async () => {
      const reports: ReportFiles[] = [
        { screenshotUrl: 'good1.png', replayUrl: null },
        { screenshotUrl: 'bad1.png', replayUrl: null },
        { screenshotUrl: 'good2.png', replayUrl: null },
        { screenshotUrl: 'bad2.png', replayUrl: null },
      ];

      vi.mocked(mockStorage.headObject)
        .mockResolvedValueOnce({ key: 'test-key', size: 100, lastModified: new Date() })
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockResolvedValueOnce({ key: 'test-key', size: 200, lastModified: new Date() })
        .mockRejectedValueOnce(new Error('Error 2'));

      vi.mocked(mockStorage.deleteObject).mockResolvedValue(undefined);

      const result = await strategy.archiveBatch(reports);

      expect(result.filesArchived).toBe(2);
      expect(result.bytesArchived).toBe(300);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].key).toBe('bad1.png');
      expect(result.errors[1].key).toBe('bad2.png');
    });

    it('should continue processing after individual failures', async () => {
      const reports: ReportFiles[] = [
        { screenshotUrl: 'file1.png', replayUrl: null },
        { screenshotUrl: 'file2.png', replayUrl: null },
        { screenshotUrl: 'file3.png', replayUrl: null },
      ];

      vi.mocked(mockStorage.headObject)
        .mockResolvedValueOnce({ key: 'test-key', size: 100, lastModified: new Date() })
        .mockRejectedValueOnce(new Error('Failure'))
        .mockResolvedValueOnce({ key: 'test-key', size: 300, lastModified: new Date() });

      vi.mocked(mockStorage.deleteObject).mockResolvedValue(undefined);

      const result = await strategy.archiveBatch(reports);

      // Should process all 3, with 1 failure
      expect(result.filesArchived).toBe(2);
      expect(result.bytesArchived).toBe(400);
      expect(result.errors).toHaveLength(1);
    });
  });
});
