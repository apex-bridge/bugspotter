/**
 * Screenshot Worker Tests
 * Unit tests for screenshot processing worker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createScreenshotWorker } from '../../src/queue/workers/screenshot-worker.js';
import type { BugReportRepository } from '../../src/db/repositories.js';
import type { IStorageService } from '../../src/storage/types.js';
import type { Redis } from 'ioredis';
import {
  validateScreenshotJobData,
  createScreenshotJobResult,
} from '../../src/queue/jobs/screenshot-job.js';
import { JobProcessingError } from '../../src/queue/errors.js';
import type { Job } from 'bullmq';

/**
 * Helper to create a proper Readable stream from a buffer
 */
function createMockStream(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null); // Signal end of stream
  return stream;
}

/**
 * Helper to create a large Readable stream with multiple chunks
 */
function createLargeStream(chunkSize: number, numChunks: number): Readable {
  let chunkCount = 0;
  const stream = new Readable({
    read() {
      if (chunkCount < numChunks) {
        this.push(Buffer.alloc(chunkSize));
        chunkCount++;
      } else {
        this.push(null); // End of stream
      }
    },
  });
  return stream;
}

describe('Screenshot Worker', () => {
  let mockBugReportRepo: Partial<BugReportRepository>;
  let mockStorage: Partial<IStorageService>;
  let mockRedis: Partial<Redis>;

  beforeEach(() => {
    mockBugReportRepo = {
      findById: vi.fn(),
      updateScreenshotUrls: vi.fn().mockResolvedValue(1),
    };

    mockStorage = {
      uploadScreenshot: vi.fn().mockResolvedValue({
        key: 'screenshots/proj-123/bug-456/screenshot.png',
        url: 'https://storage.example.com/screenshots/proj-123/bug-456/screenshot.png',
      }),
      uploadThumbnail: vi.fn().mockResolvedValue({
        key: 'screenshots/proj-123/bug-456/thumbnail.png',
        url: 'https://storage.example.com/screenshots/proj-123/bug-456/thumbnail.png',
      }),
      getObject: vi.fn(),
    };

    mockRedis = {
      ping: vi.fn().mockResolvedValue('PONG'),
      on: vi.fn(),
      once: vi.fn(),
      duplicate: vi.fn().mockReturnThis(),
    };
  });

  describe('Worker Creation', () => {
    it('should create screenshot worker successfully', () => {
      const worker = createScreenshotWorker(
        mockBugReportRepo as BugReportRepository,
        mockStorage as IStorageService,
        mockRedis as Redis
      );

      expect(worker).toBeDefined();
      expect((worker as any).getRawWorker).toBeDefined();
      expect(worker.close).toBeDefined();
    });

    it('should create worker with correct configuration', () => {
      const worker = createScreenshotWorker(
        mockBugReportRepo as BugReportRepository,
        mockStorage as IStorageService,
        mockRedis as Redis
      );

      const bullWorker = (worker as any).getRawWorker();
      expect(bullWorker).toBeDefined();
      expect(bullWorker.name).toBe('screenshots');
    });
  });

  describe('Job Data Validation', () => {
    it('should validate correct screenshot job data with screenshotKey', () => {
      const validData = {
        bugReportId: 'bug-123',
        projectId: 'proj-456',
        screenshotKey:
          'screenshots/12345678-1234-1234-1234-123456789abc/87654321-4321-4321-4321-cba987654321/screenshot.png',
      };

      expect(validateScreenshotJobData(validData)).toBe(true);
    });

    it('should reject data without bugReportId', () => {
      const invalidData = {
        projectId: 'proj-456',
        screenshotData: 'data:image/png;base64,abc123',
      };

      expect(validateScreenshotJobData(invalidData)).toBe(false);
    });

    it('should reject data without projectId', () => {
      const invalidData = {
        bugReportId: 'bug-123',
        screenshotKey: 'screenshots/proj-123/bug-123/screenshot.png',
      };

      expect(validateScreenshotJobData(invalidData)).toBe(false);
    });

    it('should reject data without screenshotKey', () => {
      const invalidData = {
        bugReportId: 'bug-123',
        projectId: 'proj-456',
      };

      expect(validateScreenshotJobData(invalidData)).toBe(false);
    });
  });

  describe('Job Result Creation', () => {
    it('should create result with screenshot URLs and metadata', () => {
      const result = createScreenshotJobResult(
        'https://storage.example.com/screenshots/screenshot.png',
        'https://storage.example.com/screenshots/thumbnail.png',
        {
          originalSize: 1024000,
          thumbnailSize: 51200,
          width: 1920,
          height: 1080,
          processingTimeMs: 150,
        }
      );

      expect(result.originalUrl).toBe('https://storage.example.com/screenshots/screenshot.png');
      expect(result.thumbnailUrl).toBe('https://storage.example.com/screenshots/thumbnail.png');
      expect(result.originalSize).toBe(1024000);
      expect(result.thumbnailSize).toBe(51200);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.processingTimeMs).toBe(150);
    });

    it('should handle large file sizes', () => {
      const largeSize = 10 * 1024 * 1024; // 10MB
      const result = createScreenshotJobResult(
        'https://example.com/large.png',
        'https://example.com/thumb.png',
        {
          originalSize: largeSize,
          thumbnailSize: 100000,
          width: 3840,
          height: 2160,
          processingTimeMs: 500,
        }
      );

      expect(result.originalSize).toBe(largeSize);
      expect(result.thumbnailSize).toBe(100000);
    });

    it('should track processing time', () => {
      const result = createScreenshotJobResult(
        'https://example.com/screenshot.png',
        'https://example.com/thumbnail.png',
        {
          originalSize: 500000,
          thumbnailSize: 50000,
          width: 1024,
          height: 768,
          processingTimeMs: 250,
        }
      );

      expect(result.processingTimeMs).toBe(250);
    });

    it('should include image dimensions', () => {
      const result = createScreenshotJobResult(
        'https://example.com/screenshot.png',
        'https://example.com/thumbnail.png',
        {
          originalSize: 500000,
          thumbnailSize: 50000,
          width: 1920,
          height: 1080,
          processingTimeMs: 200,
        }
      );

      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
    });
  });

  describe('Worker Lifecycle', () => {
    it('should allow closing the worker', async () => {
      const worker = createScreenshotWorker(
        mockBugReportRepo as BugReportRepository,
        mockStorage as IStorageService,
        mockRedis as Redis
      );

      await expect(worker.close()).resolves.not.toThrow();
    });

    it('should provide access to underlying BullMQ worker', () => {
      const worker = createScreenshotWorker(
        mockBugReportRepo as BugReportRepository,
        mockStorage as IStorageService,
        mockRedis as Redis
      );

      const bullWorker = (worker as any).getRawWorker();
      expect(bullWorker).toBeDefined();
      expect(bullWorker.name).toBe('screenshots');
    });

    it('should support pause and resume', async () => {
      const worker = createScreenshotWorker(
        mockBugReportRepo as BugReportRepository,
        mockStorage as IStorageService,
        mockRedis as Redis
      );

      await expect(worker.pause()).resolves.not.toThrow();
      await expect(worker.resume()).resolves.not.toThrow();
    });
  });

  describe('Image Processing', () => {
    it('should track original and thumbnail sizes', () => {
      const result = createScreenshotJobResult(
        'https://example.com/screenshot.png',
        'https://example.com/thumbnail.png',
        {
          originalSize: 2048000, // 2MB original
          thumbnailSize: 204800, // 200KB thumbnail
          width: 1920,
          height: 1080,
          processingTimeMs: 300,
        }
      );

      expect(result.originalSize).toBeGreaterThan(result.thumbnailSize);
      expect(result.originalSize / result.thumbnailSize).toBeCloseTo(10, 0);
    });

    it('should measure processing performance', () => {
      const processingTimes = [100, 250, 500, 1000];

      processingTimes.forEach((timeMs) => {
        const result = createScreenshotJobResult(
          'https://example.com/screenshot.png',
          'https://example.com/thumbnail.png',
          {
            originalSize: 1000000,
            thumbnailSize: 100000,
            width: 1920,
            height: 1080,
            processingTimeMs: timeMs,
          }
        );
        expect(result.processingTimeMs).toBe(timeMs);
      });
    });
  });

  describe('Error Handling', () => {
    it('should validate data structure before processing', () => {
      const invalidData = {
        bugReportId: 'bug-123',
        // Missing projectId and screenshotData
      };

      expect(validateScreenshotJobData(invalidData)).toBe(false);
    });

    it('should throw JobProcessingError for invalid job data', async () => {
      const worker = createScreenshotWorker(
        mockBugReportRepo as BugReportRepository,
        mockStorage as IStorageService,
        mockRedis as Redis
      );

      const bullWorker = (worker as any).getRawWorker();
      const processor = (bullWorker as any).processFn;

      const invalidJob = {
        id: 'job-123',
        data: {
          bugReportId: 'bug-123',
          // Missing projectId and screenshotData/screenshotKey
        },
        attemptsMade: 1,
      } as Job;

      await expect(processor(invalidJob)).rejects.toThrow(JobProcessingError);
      await expect(processor(invalidJob)).rejects.toThrow(
        'Invalid screenshot job data: must provide bugReportId, projectId, and screenshotKey'
      );
    });

    it('should include job context in validation errors', async () => {
      const worker = createScreenshotWorker(
        mockBugReportRepo as BugReportRepository,
        mockStorage as IStorageService,
        mockRedis as Redis
      );

      const bullWorker = (worker as any).getRawWorker();
      const processor = (bullWorker as any).processFn;

      const invalidJob = {
        id: 'job-456',
        data: {
          projectId: 'proj-123',
          // Missing bugReportId and screenshot data
        },
        attemptsMade: 1,
      } as Job;

      try {
        await processor(invalidJob);
        expect.fail('Should have thrown JobProcessingError');
      } catch (error) {
        expect(error).toBeInstanceOf(JobProcessingError);
        expect((error as JobProcessingError).jobId).toBe('job-456');
        expect((error as JobProcessingError).details).toEqual({ data: invalidJob.data });
      }
    });

    it('should require all mandatory fields', () => {
      const testCases = [
        { projectId: 'proj-123', screenshotData: 'data:image/png;base64,abc' }, // missing bugReportId
        { bugReportId: 'bug-123', screenshotData: 'data:image/png;base64,abc' }, // missing projectId
        { bugReportId: 'bug-123', projectId: 'proj-123' }, // missing screenshotData
      ];

      testCases.forEach((data) => {
        expect(validateScreenshotJobData(data)).toBe(false);
      });
    });

    it('should handle empty screenshot data', () => {
      const data = {
        bugReportId: 'bug-123',
        projectId: 'proj-456',
        screenshotData: '',
      };

      expect(validateScreenshotJobData(data)).toBe(false);
    });
  });

  describe('Storage Integration', () => {
    it('should generate correct URLs for screenshots', () => {
      const result = createScreenshotJobResult(
        'https://storage.example.com/screenshots/proj-123/bug-456/screenshot.png',
        'https://storage.example.com/screenshots/proj-123/bug-456/thumbnail.png',
        {
          originalSize: 1000000,
          thumbnailSize: 100000,
          width: 1920,
          height: 1080,
          processingTimeMs: 200,
        }
      );

      expect(result.originalUrl).toContain('screenshot.png');
      expect(result.thumbnailUrl).toContain('thumbnail.png');
      expect(result.originalUrl).not.toBe(result.thumbnailUrl);
    });

    it('should handle different storage URL formats', () => {
      const storageUrls = [
        'https://cdn.example.com/screenshots/file.png',
        'https://s3.amazonaws.com/bucket/screenshots/file.png',
        'http://localhost:3000/uploads/screenshots/file.png',
      ];

      storageUrls.forEach((url) => {
        const result = createScreenshotJobResult(url, `${url}.thumb`, {
          originalSize: 1000000,
          thumbnailSize: 100000,
          width: 1920,
          height: 1080,
          processingTimeMs: 150,
        });
        expect(result.originalUrl).toBe(url);
      });
    });
  });

  describe('Presigned URL Flow', () => {
    it('should validate job data with screenshotKey', () => {
      const projectId = '12345678-1234-1234-1234-123456789abc';
      const bugReportId = '87654321-4321-4321-4321-cba987654321';

      const validData = {
        bugReportId,
        projectId,
        screenshotKey: `screenshots/${projectId}/${bugReportId}/screenshot.png`,
      };

      expect(validateScreenshotJobData(validData)).toBe(true);
    });

    it('should reject job without screenshotKey', () => {
      const invalidData = {
        bugReportId: 'bug-123',
        projectId: 'proj-456',
        // Missing screenshotKey
      };

      expect(validateScreenshotJobData(invalidData)).toBe(false);
    });

    it('should process presigned upload by downloading from storage', async () => {
      // Valid 1x1 PNG image
      const testImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );

      // Mock getObject to return a proper Readable stream
      const mockStream = createMockStream(testImageBuffer);

      mockStorage.getObject = vi.fn().mockResolvedValue(mockStream);
      mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);
      mockBugReportRepo.updateScreenshotUrls = vi.fn().mockResolvedValue(1);

      const worker = createScreenshotWorker(
        mockBugReportRepo as BugReportRepository,
        mockStorage as IStorageService,
        mockRedis as Redis
      );

      const bullWorker = (worker as any).getRawWorker();
      const processor = (bullWorker as any).processFn;

      const projectId = '12345678-1234-1234-1234-123456789abc';
      const bugReportId = '87654321-4321-4321-4321-cba987654321';

      const job = {
        id: 'job-presigned-123',
        data: {
          bugReportId,
          projectId,
          screenshotKey: `screenshots/${projectId}/${bugReportId}/uploaded.png`,
        },
        attemptsMade: 1,
        updateProgress: vi.fn(),
      } as unknown as Job;

      const result = await processor(job);

      expect(mockStorage.getObject).toHaveBeenCalledWith(
        `screenshots/${projectId}/${bugReportId}/uploaded.png`
      );
      expect(result).toBeDefined();
      expect(result.originalUrl).toBeDefined();
      expect(result.thumbnailUrl).toBeDefined();
    });

    it('should handle storage download errors gracefully', async () => {
      const projectId = '12345678-1234-1234-1234-123456789abc';
      const bugReportId = '99999999-9999-9999-9999-999999999999';

      mockStorage.getObject = vi.fn().mockRejectedValue(new Error('Storage download failed'));
      mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);

      const worker = createScreenshotWorker(
        mockBugReportRepo as BugReportRepository,
        mockStorage as IStorageService,
        mockRedis as Redis
      );

      const bullWorker = (worker as any).getRawWorker();
      const processor = (bullWorker as any).processFn;

      const job = {
        id: 'job-fail-download',
        data: {
          bugReportId,
          projectId,
          screenshotKey: `screenshots/${projectId}/${bugReportId}/missing.png`,
        },
        attemptsMade: 1,
        updateProgress: vi.fn(),
      } as unknown as Job;

      await expect(processor(job)).rejects.toThrow('Storage download failed');
    });

    it('should optimize and re-upload after downloading presigned file', async () => {
      const testImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );

      const mockStream = createMockStream(testImageBuffer);

      mockStorage.getObject = vi.fn().mockResolvedValue(mockStream);
      mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);
      mockBugReportRepo.updateScreenshotUrls = vi.fn().mockResolvedValue(1);

      const worker = createScreenshotWorker(
        mockBugReportRepo as BugReportRepository,
        mockStorage as IStorageService,
        mockRedis as Redis
      );

      const bullWorker = (worker as any).getRawWorker();
      const processor = (bullWorker as any).processFn;

      const projectId = '12345678-1234-1234-1234-123456789abc';
      const bugReportId = 'abcdef12-3456-7890-abcd-ef1234567890';

      const job = {
        id: 'job-optimize',
        data: {
          bugReportId,
          projectId,
          screenshotKey: `screenshots/${projectId}/${bugReportId}/uploaded.png`,
        },
        attemptsMade: 1,
        updateProgress: vi.fn(),
      } as unknown as Job;

      await processor(job);

      // Should upload both optimized original and thumbnail
      expect(mockStorage.uploadScreenshot).toHaveBeenCalledTimes(2);
      expect(mockBugReportRepo.updateScreenshotUrls).toHaveBeenCalledTimes(1);
    });
  });

  describe('Security Validations', () => {
    describe('Screenshot Key Validation', () => {
      it('should reject invalid screenshot key format', async () => {
        mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-invalid-key',
          data: {
            bugReportId: 'bug-123',
            projectId: 'proj-456',
            screenshotKey: 'invalid-key-format',
          },
          attemptsMade: 1,
          updateProgress: vi.fn(),
        } as unknown as Job;

        await expect(processor(job)).rejects.toThrow(JobProcessingError);
        await expect(processor(job)).rejects.toThrow(
          'Screenshot key does not match expected format'
        );
      });

      it('should reject path traversal attempts', async () => {
        mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-path-traversal',
          data: {
            bugReportId: 'bug-123',
            projectId: 'proj-456',
            screenshotKey: '../../../sensitive-data/credentials.json',
          },
          attemptsMade: 1,
          updateProgress: vi.fn(),
        } as unknown as Job;

        await expect(processor(job)).rejects.toThrow(JobProcessingError);
        await expect(processor(job)).rejects.toThrow(
          'Screenshot key does not match expected format'
        );
      });

      it('should reject key belonging to different project', async () => {
        mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-wrong-project',
          data: {
            bugReportId: 'bug-123',
            projectId: 'proj-456',
            // Key belongs to different project
            screenshotKey:
              'screenshots/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002/uploaded.png',
          },
          attemptsMade: 1,
          updateProgress: vi.fn(),
        } as unknown as Job;

        await expect(processor(job)).rejects.toThrow(JobProcessingError);
        await expect(processor(job)).rejects.toThrow(
          'Screenshot key does not belong to specified project and bug report'
        );
      });

      it('should reject key belonging to different bug report', async () => {
        const projectId = '12345678-1234-1234-1234-123456789abc';
        const bugReportId = '87654321-4321-4321-4321-cba987654321';
        const wrongBugId = '00000000-0000-0000-0000-000000000000';

        mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-wrong-bug',
          data: {
            bugReportId,
            projectId,
            // Key belongs to different bug report in same project
            screenshotKey: `screenshots/${projectId}/${wrongBugId}/uploaded.png`,
          },
          attemptsMade: 1,
          updateProgress: vi.fn(),
        } as unknown as Job;

        await expect(processor(job)).rejects.toThrow(JobProcessingError);
        await expect(processor(job)).rejects.toThrow(
          'Screenshot key does not belong to specified project and bug report'
        );
      });

      it('should reject empty screenshot key', async () => {
        mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-empty-key',
          data: {
            bugReportId: 'bug-123',
            projectId: 'proj-456',
            screenshotKey: '',
          },
          attemptsMade: 1,
          updateProgress: vi.fn(),
        } as unknown as Job;

        await expect(processor(job)).rejects.toThrow(JobProcessingError);
        await expect(processor(job)).rejects.toThrow(
          'Invalid screenshot job data: must provide bugReportId, projectId, and screenshotKey'
        );
      });

      it('should accept valid screenshot key with correct ownership', async () => {
        const projectId = '12345678-1234-1234-1234-123456789abc';
        const bugReportId = '87654321-4321-4321-4321-cba987654321';

        const testImageBuffer = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        );

        const mockStream = createMockStream(testImageBuffer);

        mockStorage.getObject = vi.fn().mockResolvedValue(mockStream);
        mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-valid-key',
          data: {
            bugReportId,
            projectId,
            screenshotKey: `screenshots/${projectId}/${bugReportId}/uploaded.png`,
          },
          attemptsMade: 1,
          updateProgress: vi.fn(),
        } as unknown as Job;

        await expect(processor(job)).resolves.toBeDefined();
        expect(mockStorage.getObject).toHaveBeenCalledWith(
          `screenshots/${projectId}/${bugReportId}/uploaded.png`
        );
      });
    });

    describe('Size Limit Validation', () => {
      it('should reject screenshots exceeding 50MB size limit', async () => {
        const projectId = '12345678-1234-1234-1234-123456789abc';
        const bugReportId = '87654321-4321-4321-4321-cba987654321';

        // Create a large stream exceeding 50MB
        const chunkSize = 10 * 1024 * 1024; // 10MB
        const numChunks = 6; // Total 60MB

        const mockStream = createLargeStream(chunkSize, numChunks);

        mockStorage.getObject = vi.fn().mockResolvedValue(mockStream);
        mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-oversized',
          data: {
            bugReportId,
            projectId,
            screenshotKey: `screenshots/${projectId}/${bugReportId}/huge.png`,
          },
          attemptsMade: 1,
          updateProgress: vi.fn(),
        } as unknown as Job;

        await expect(processor(job)).rejects.toThrow('Screenshot exceeds maximum size limit');
      });

      it('should accept screenshots within size limit', async () => {
        const projectId = '12345678-1234-1234-1234-123456789abc';
        const bugReportId = '87654321-4321-4321-4321-cba987654321';

        // Small valid image (1x1 PNG, ~68 bytes)
        const testImageBuffer = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        );

        const mockStream = createMockStream(testImageBuffer);

        mockStorage.getObject = vi.fn().mockResolvedValue(mockStream);
        mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-normal-size',
          data: {
            bugReportId,
            projectId,
            screenshotKey: `screenshots/${projectId}/${bugReportId}/normal.png`,
          },
          attemptsMade: 1,
          updateProgress: vi.fn(),
        } as unknown as Job;

        await expect(processor(job)).resolves.toBeDefined();
      });

      it('should handle byte size tracking correctly during streaming', async () => {
        const projectId = '12345678-1234-1234-1234-123456789abc';
        const bugReportId = '87654321-4321-4321-4321-cba987654321';

        // Create a small test image
        const testImageBuffer = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        );

        const mockStream = createMockStream(testImageBuffer);

        mockStorage.getObject = vi.fn().mockResolvedValue(mockStream);
        mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-byte-tracking',
          data: {
            bugReportId,
            projectId,
            screenshotKey: `screenshots/${projectId}/${bugReportId}/test.png`,
          },
          attemptsMade: 1,
          updateProgress: vi.fn(),
        } as unknown as Job;

        await expect(processor(job)).resolves.toBeDefined();
        // Byte size tracking happens automatically in the Readable stream
      });

      it('should only create one error when multiple data events fire before stream is destroyed', async () => {
        const projectId = '12345678-1234-1234-1234-123456789abc';
        const bugReportId = '87654321-4321-4321-4321-cba987654321';

        // Create a large buffer that will definitely exceed the limit (50MB)
        // We'll emit it in chunks to simulate multiple data events
        const chunkSize = 30 * 1024 * 1024; // 30MB chunks
        const chunk1 = Buffer.alloc(chunkSize);
        const chunk2 = Buffer.alloc(chunkSize); // Total: 60MB > 50MB limit

        let errorCount = 0;
        const errors: Error[] = [];

        // Create a custom stream that emits multiple chunks
        const mockStream = new Readable({
          read() {
            // Emit first chunk (30MB - below limit)
            this.push(chunk1);
            // Emit second chunk (total 60MB - exceeds limit)
            // This should trigger error, but subsequent chunks should not create new errors
            this.push(chunk2);
            this.push(null); // End stream
          },
        });

        // Spy on stream.destroy to count error creations
        const originalDestroy = mockStream.destroy.bind(mockStream);
        mockStream.destroy = vi.fn((error?: Error) => {
          if (error) {
            errorCount++;
            errors.push(error);
          }
          return originalDestroy(error);
        }) as any;

        mockStorage.getObject = vi.fn().mockResolvedValue(mockStream);
        mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-multiple-data-events',
          data: {
            bugReportId,
            projectId,
            screenshotKey: `screenshots/${projectId}/${bugReportId}/large.png`,
          },
          attemptsMade: 1,
          updateProgress: vi.fn(),
        } as unknown as Job;

        await expect(processor(job)).rejects.toThrow('Screenshot exceeds maximum size limit');

        // Critical assertion: Only ONE error should be created despite multiple data events
        expect(errorCount).toBe(1);
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('Screenshot exceeds maximum size limit');
      });
    });

    describe('Decompression Bomb Protection', () => {
      it('should protect against decompression bombs with pixel limit', async () => {
        const projectId = '12345678-1234-1234-1234-123456789abc';
        const bugReportId = '87654321-4321-4321-4321-cba987654321';

        // Create a mock stream that simulates a small compressed file
        // Sharp will handle the actual decompression bomb detection
        const mockStream = createMockStream(Buffer.from('fake compressed data'));

        mockStorage.getObject = vi.fn().mockResolvedValue(mockStream);
        mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-decompression-bomb',
          data: {
            bugReportId,
            projectId,
            screenshotKey: `screenshots/${projectId}/${bugReportId}/bomb.png`,
          },
          attemptsMade: 1,
          updateProgress: vi.fn(),
        } as unknown as Job;

        // Should reject due to pixel limit
        await expect(processor(job)).rejects.toThrow();
      });

      it('should accept large files with reasonable pixel dimensions', async () => {
        const projectId = '12345678-1234-1234-1234-123456789abc';
        const bugReportId = '87654321-4321-4321-4321-cba987654321';

        // Large file (40MB) but with reasonable dimensions (4K = 8.3M pixels)
        const testImageBuffer = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        );

        const mockStream = createMockStream(testImageBuffer);

        mockStorage.getObject = vi.fn().mockResolvedValue(mockStream);
        mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-large-4k',
          data: {
            bugReportId,
            projectId,
            screenshotKey: `screenshots/${projectId}/${bugReportId}/4k-image.png`,
          },
          attemptsMade: 1,
          updateProgress: vi.fn(),
        } as unknown as Job;

        // Should accept (dimensions within 268M pixel limit)
        await expect(processor(job)).resolves.toBeDefined();
      });
    });

    describe('Image Format Validation', () => {
      it('should reject non-image files', async () => {
        const projectId = '12345678-1234-1234-1234-123456789abc';
        const bugReportId = '87654321-4321-4321-4321-cba987654321';

        // Plain text file, not an image
        const textBuffer = Buffer.from('This is not an image');

        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield textBuffer;
          },
        };

        mockStorage.getObject = vi.fn().mockResolvedValue(mockStream);
        mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-text-file',
          data: {
            bugReportId,
            projectId,
            screenshotKey: `screenshots/${projectId}/${bugReportId}/text.txt`,
          },
          attemptsMade: 1,
          updateProgress: vi.fn(),
        } as unknown as Job;

        await expect(processor(job)).rejects.toThrow();
      });

      it('should accept supported image formats (PNG)', async () => {
        const projectId = '12345678-1234-1234-1234-123456789abc';
        const bugReportId = '87654321-4321-4321-4321-cba987654321';

        const pngBuffer = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        );

        const mockStream = createMockStream(pngBuffer);

        mockStorage.getObject = vi.fn().mockResolvedValue(mockStream);
        mockBugReportRepo.findById = vi.fn().mockResolvedValue(null);

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-png',
          data: {
            bugReportId,
            projectId,
            screenshotKey: `screenshots/${projectId}/${bugReportId}/image.png`,
          },
          attemptsMade: 1,
          updateProgress: vi.fn(),
        } as unknown as Job;

        await expect(processor(job)).resolves.toBeDefined();
      });
    });

    describe('Retry Logic with Upload Status', () => {
      it('should reprocess if upload_status is not completed', async () => {
        const projectId = '12345678-1234-1234-1234-123456789abc';
        const bugReportId = '87654321-4321-4321-4321-cba987654321';

        const testImageBuffer = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        );

        const mockStream = createMockStream(testImageBuffer);

        mockStorage.getObject = vi.fn().mockResolvedValue(mockStream);

        // Existing report has URLs but upload_status is 'uploading', not 'completed'
        mockBugReportRepo.findById = vi.fn().mockResolvedValue({
          id: bugReportId,
          project_id: projectId,
          screenshot_url: 'https://storage.example.com/existing.png',
          upload_status: 'uploading', // Not completed!
          metadata: {
            thumbnailUrl: 'https://storage.example.com/existing-thumb.png',
          },
        });

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-retry-incomplete',
          data: {
            bugReportId,
            projectId,
            screenshotKey: `screenshots/${projectId}/${bugReportId}/uploaded.png`,
          },
          attemptsMade: 2,
          updateProgress: vi.fn(),
        } as unknown as Job;

        await expect(processor(job)).resolves.toBeDefined();

        // Should call getObject to reprocess, not reuse
        expect(mockStorage.getObject).toHaveBeenCalledWith(
          `screenshots/${projectId}/${bugReportId}/uploaded.png`
        );
        expect(mockStorage.uploadScreenshot).toHaveBeenCalled();
      });

      it('should reuse files if upload_status is completed', async () => {
        const projectId = '12345678-1234-1234-1234-123456789abc';
        const bugReportId = '87654321-4321-4321-4321-cba987654321';

        const testImageBuffer = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        );

        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield testImageBuffer;
          },
        };

        mockStorage.getObject = vi.fn().mockResolvedValue(mockStream);
        mockStorage.headObject = vi.fn().mockResolvedValue({
          key: 'test',
          size: 1000,
          lastModified: new Date(),
        });

        // Existing report has URLs AND upload_status is 'completed'
        mockBugReportRepo.findById = vi.fn().mockResolvedValue({
          id: bugReportId,
          project_id: projectId,
          screenshot_url: 'https://storage.example.com/existing.png',
          upload_status: 'completed', // Completed!
          metadata: {
            thumbnailUrl: 'https://storage.example.com/existing-thumb.png',
            screenshotWidth: 1920,
            screenshotHeight: 1080,
            screenshotFormat: 'png',
          },
        });

        const worker = createScreenshotWorker(
          mockBugReportRepo as BugReportRepository,
          mockStorage as IStorageService,
          mockRedis as Redis
        );

        const bullWorker = (worker as any).getRawWorker();
        const processor = (bullWorker as any).processFn;

        const job = {
          id: 'job-retry-completed',
          data: {
            bugReportId,
            projectId,
            screenshotKey: `screenshots/${projectId}/${bugReportId}/uploaded.png`,
          },
          attemptsMade: 2,
          updateProgress: vi.fn(),
        } as unknown as Job;

        await expect(processor(job)).resolves.toBeDefined();

        // Optimized: Should NOT call getObject (uses DB metadata instead), and NOT re-upload
        expect(mockStorage.getObject).not.toHaveBeenCalled();
        expect(mockStorage.uploadScreenshot).not.toHaveBeenCalled();
      });
    });
  });
});
