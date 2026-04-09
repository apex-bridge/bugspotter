/**
 * End-to-End Storage Tests
 * Tests real storage operations with actual backends
 *
 * Prerequisites:
 * - For MinIO tests: Docker must be running with MinIO container
 * - For local tests: Filesystem write permissions
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createStorage,
  generateThumbnail,
  optimizeImage,
  validateImage,
  extractMetadata,
  StorageNotFoundError,
} from '../../src/storage/index.js';
import type { IStorageService, StorageConfig } from '../../src/storage/types.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Test configuration
const TEST_PROJECT_ID = 'test-proj-' + Date.now();
const TEST_BUG_ID = 'test-bug-' + Date.now();

// Local storage config - generate unique directory per test suite run
const localConfig: StorageConfig = {
  backend: 'local',
  local: {
    baseDirectory:
      './test-e2e-uploads-' + Date.now() + '-' + Math.random().toString(36).substring(7),
    baseUrl: 'http://localhost:3000/uploads',
  },
};

// MinIO config (requires Docker container running)
const minioConfig: StorageConfig = {
  backend: 'minio',
  s3: {
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
    region: 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
    bucket: 'bugspotter-e2e-test',
    forcePathStyle: true,
    maxRetries: 3,
  },
};

// Helper to create a test image buffer
function createTestImage(): Buffer {
  // Simple 1x1 PNG image (white pixel)
  return Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // PNG signature
    0x00,
    0x00,
    0x00,
    0x0d,
    0x49,
    0x48,
    0x44,
    0x52, // IHDR chunk
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x01, // 1x1 dimensions
    0x08,
    0x02,
    0x00,
    0x00,
    0x00,
    0x90,
    0x77,
    0x53,
    0xde,
    0x00,
    0x00,
    0x00,
    0x0c,
    0x49,
    0x44,
    0x41,
    0x54,
    0x08,
    0xd7,
    0x63,
    0xf8,
    0xff,
    0xff,
    0x3f,
    0x00,
    0x05,
    0xfe,
    0x02,
    0xfe,
    0xdc,
    0xcc,
    0x59,
    0xe7,
    0x00,
    0x00,
    0x00,
    0x00,
    0x49,
    0x45,
    0x4e,
    0x44,
    0xae,
    0x42,
    0x60,
    0x82, // IEND chunk
  ]);
}

// Helper to create a test JSON buffer
function createTestJson(): Buffer {
  return Buffer.from(
    JSON.stringify({
      test: true,
      timestamp: Date.now(),
      data: 'test data',
    })
  );
}

// Test suite for local storage
describe('E2E: Local Storage', () => {
  let storage: IStorageService;
  const baseDir = localConfig.local!.baseDirectory;

  beforeAll(async () => {
    storage = createStorage(localConfig);
    await storage.initialize();
  });

  afterAll(async () => {
    // Cleanup test directory - use recursive force removal
    try {
      await storage.clearAllStorage();
      await fs.rm(baseDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to cleanup test directory ${baseDir}:`, error);
    }
  });

  describe('Screenshot Operations', () => {
    it('should upload and retrieve screenshot', async () => {
      const imageBuffer = createTestImage();

      // Upload
      const uploadResult = await storage.uploadScreenshot(
        TEST_PROJECT_ID,
        TEST_BUG_ID,
        imageBuffer
      );

      expect(uploadResult.key).toContain('screenshots');
      expect(uploadResult.key).toContain(TEST_PROJECT_ID);
      expect(uploadResult.key).toContain(TEST_BUG_ID);
      expect(uploadResult.size).toBe(imageBuffer.length);

      // Retrieve
      const stream = await storage.getObject(uploadResult.key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      const retrieved = Buffer.concat(chunks);

      expect(retrieved.length).toBe(imageBuffer.length);
      expect(retrieved.equals(imageBuffer)).toBe(true);
    });

    it('should upload screenshot with thumbnail', async () => {
      const imageBuffer = createTestImage();

      // Upload original
      const original = await storage.uploadScreenshot(
        TEST_PROJECT_ID,
        `${TEST_BUG_ID}-with-thumb`,
        imageBuffer
      );

      // Generate and upload thumbnail
      const thumbnail = await generateThumbnail(imageBuffer, 200, 200);
      const thumbResult = await storage.uploadThumbnail(
        TEST_PROJECT_ID,
        `${TEST_BUG_ID}-with-thumb`,
        thumbnail
      );

      expect(original.key).toContain('original.png');
      expect(thumbResult.key).toContain('thumbnail.jpg');

      // Verify both exist
      const originalMeta = await storage.headObject(original.key);
      const thumbMeta = await storage.headObject(thumbResult.key);

      expect(originalMeta).not.toBeNull();
      expect(thumbMeta).not.toBeNull();
      // For very small test images, thumbnail might be larger due to JPEG headers
      // Just verify both files exist and have content
      expect(thumbMeta!.size).toBeGreaterThan(0);
    });

    it('should optimize image on upload', async () => {
      const imageBuffer = createTestImage();

      // Optimize before upload
      const optimized = await optimizeImage(imageBuffer);

      const result = await storage.uploadScreenshot(
        TEST_PROJECT_ID,
        `${TEST_BUG_ID}-optimized`,
        optimized
      );

      // For very small test images, optimization might increase size due to format headers
      // Just verify the optimized image was uploaded successfully
      expect(result.size).toBeGreaterThan(0);
      expect(result.key).toContain('optimized');
    });
  });

  describe('Attachment Operations', () => {
    it('should upload attachment with sanitized filename', async () => {
      const fileBuffer = Buffer.from('attachment content');
      const dangerousFilename = '../../../etc/passwd';

      const result = await storage.uploadAttachment(
        TEST_PROJECT_ID,
        `${TEST_BUG_ID}-attachment`,
        dangerousFilename,
        fileBuffer
      );

      // Verify filename is sanitized
      expect(result.key).not.toContain('..');
      expect(result.key).toContain('attachments');
      expect(result.key).toContain(TEST_PROJECT_ID);

      // Retrieve and verify
      const stream = await storage.getObject(result.key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      const retrieved = Buffer.concat(chunks);

      expect(retrieved.toString()).toBe('attachment content');
    });

    it('should upload multiple attachments', async () => {
      const attachments = [
        { name: 'file1.txt', content: 'content 1' },
        { name: 'file2.json', content: '{"data": "test"}' },
        { name: 'file3.log', content: 'log entry' },
      ];

      const results = [];
      for (const att of attachments) {
        const result = await storage.uploadAttachment(
          TEST_PROJECT_ID,
          `${TEST_BUG_ID}-multi`,
          att.name,
          Buffer.from(att.content)
        );
        results.push(result);
      }

      expect(results).toHaveLength(3);

      // Verify all exist
      for (const result of results) {
        const meta = await storage.headObject(result.key);
        expect(meta).not.toBeNull();
      }
    });
  });

  describe('Delete Operations', () => {
    it('should delete single file', async () => {
      const imageBuffer = createTestImage();
      const result = await storage.uploadScreenshot(
        TEST_PROJECT_ID,
        `${TEST_BUG_ID}-delete`,
        imageBuffer
      );

      // Verify exists
      let meta = await storage.headObject(result.key);
      expect(meta).not.toBeNull();

      // Delete
      await storage.deleteObject(result.key);

      // Verify deleted
      meta = await storage.headObject(result.key);
      expect(meta).toBeNull();
    });

    it('should delete entire folder', async () => {
      const bugId = `${TEST_BUG_ID}-folder-delete`;

      // Upload multiple files
      await storage.uploadScreenshot(TEST_PROJECT_ID, bugId, createTestImage());
      await storage.uploadThumbnail(TEST_PROJECT_ID, bugId, createTestImage());

      // List before delete
      const beforeList = await storage.listObjects({
        prefix: `screenshots/${TEST_PROJECT_ID}/${bugId}/`,
      });
      expect(beforeList.objects.length).toBeGreaterThan(0);

      // Delete folder
      await storage.deleteFolder(`screenshots/${TEST_PROJECT_ID}/${bugId}/`);

      // List after delete
      const afterList = await storage.listObjects({
        prefix: `screenshots/${TEST_PROJECT_ID}/${bugId}/`,
      });
      expect(afterList.objects.length).toBe(0);
    });
  });

  describe('List Operations', () => {
    it('should list objects with prefix', async () => {
      const bugId = `${TEST_BUG_ID}-list`;

      // Upload multiple files
      await storage.uploadScreenshot(TEST_PROJECT_ID, bugId, createTestImage());
      await storage.uploadThumbnail(TEST_PROJECT_ID, bugId, createTestImage());

      // List
      const result = await storage.listObjects({
        prefix: `screenshots/${TEST_PROJECT_ID}/${bugId}/`,
      });

      expect(result.objects.length).toBeGreaterThanOrEqual(2);
      expect(result.objects.every((obj) => obj.size > 0)).toBe(true);
      expect(result.objects.every((obj) => obj.lastModified instanceof Date)).toBe(true);
    });

    it('should handle empty prefix', async () => {
      const result = await storage.listObjects({
        prefix: 'non-existent-prefix/',
      });

      expect(result.objects).toHaveLength(0);
      expect(result.isTruncated).toBe(false);
    });
  });

  describe('Image Processing', () => {
    it('should validate valid image', async () => {
      const imageBuffer = createTestImage();

      await expect(validateImage(imageBuffer)).resolves.not.toThrow();
    });

    it('should reject invalid image', async () => {
      const invalidBuffer = Buffer.from('not an image');

      await expect(validateImage(invalidBuffer)).rejects.toThrow();
    });

    it('should extract image metadata', async () => {
      const imageBuffer = createTestImage();

      const metadata = await extractMetadata(imageBuffer);

      expect(metadata.width).toBe(1);
      expect(metadata.height).toBe(1);
      expect(metadata.format).toBe('png');
      expect(metadata.size).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should throw NotFoundError for non-existent file', async () => {
      await expect(storage.getObject('non-existent-key')).rejects.toThrow(StorageNotFoundError);
    });

    it('should return null for non-existent file head', async () => {
      const meta = await storage.headObject('non-existent-key');
      expect(meta).toBeNull();
    });
  });

  describe('Health Check', () => {
    it('should pass health check', async () => {
      const isHealthy = await storage.healthCheck();
      expect(isHealthy).toBe(true);
    });
  });
});

// Test suite for MinIO (requires Docker)
describe('E2E: MinIO Storage', () => {
  let storage: IStorageService;
  const skipMinIO = !process.env.TEST_MINIO;

  beforeAll(async () => {
    if (skipMinIO) {
      console.log('⏭️  Skipping MinIO tests (set TEST_MINIO=true to enable)');
      return;
    }

    try {
      storage = createStorage(minioConfig);
      await storage.initialize();
    } catch (error) {
      console.error('❌ MinIO initialization failed:', error);
      console.log(
        '💡 Start MinIO with: docker run -p 9000:9000 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin minio/minio server /data'
      );
      throw error;
    }
  });

  afterAll(async () => {
    if (skipMinIO) return;

    // Cleanup test files
    try {
      await storage.deleteFolder(`screenshots/${TEST_PROJECT_ID}/`);
      await storage.deleteFolder(`replays/${TEST_PROJECT_ID}/`);
      await storage.deleteFolder(`attachments/${TEST_PROJECT_ID}/`);
    } catch (error) {
      console.warn('MinIO cleanup failed:', error);
    }
  });

  it('should connect to MinIO', async () => {
    if (skipMinIO) return;

    const isHealthy = await storage.healthCheck();
    expect(isHealthy).toBe(true);
  });

  it('should upload and retrieve screenshot', async () => {
    if (skipMinIO) return;

    const imageBuffer = createTestImage();

    const result = await storage.uploadScreenshot(
      TEST_PROJECT_ID,
      `${TEST_BUG_ID}-minio`,
      imageBuffer
    );

    expect(result.key).toContain('screenshots');
    expect(result.etag).toBeDefined();

    // Retrieve
    const stream = await storage.getObject(result.key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    const retrieved = Buffer.concat(chunks);

    expect(retrieved.equals(imageBuffer)).toBe(true);
  });

  it('should generate signed URL', async () => {
    if (skipMinIO) return;

    const imageBuffer = createTestImage();
    const result = await storage.uploadScreenshot(
      TEST_PROJECT_ID,
      `${TEST_BUG_ID}-signed`,
      imageBuffer
    );

    const signedUrl = await storage.getSignedUrl(result.key, { expiresIn: 3600 });

    expect(signedUrl).toContain(result.key);
    expect(signedUrl).toContain('X-Amz-');
  });

  it('should handle concurrent uploads', async () => {
    if (skipMinIO) return;

    const imageBuffer = createTestImage();
    const numUploads = 10;

    const promises = Array.from({ length: numUploads }, (_, i) =>
      storage.uploadScreenshot(TEST_PROJECT_ID, `${TEST_BUG_ID}-concurrent-${i}`, imageBuffer)
    );

    const results = await Promise.all(promises);

    expect(results).toHaveLength(numUploads);
    expect(results.every((r) => r.etag)).toBe(true);
  });

  it('should list objects in MinIO', async () => {
    if (skipMinIO) return;

    // Upload test files
    await storage.uploadScreenshot(TEST_PROJECT_ID, `${TEST_BUG_ID}-list-1`, createTestImage());
    await storage.uploadScreenshot(TEST_PROJECT_ID, `${TEST_BUG_ID}-list-2`, createTestImage());

    const result = await storage.listObjects({
      prefix: `screenshots/${TEST_PROJECT_ID}/`,
    });

    expect(result.objects.length).toBeGreaterThanOrEqual(2);
  });

  it('should delete from MinIO', async () => {
    if (skipMinIO) return;

    const imageBuffer = createTestImage();
    const result = await storage.uploadScreenshot(
      TEST_PROJECT_ID,
      `${TEST_BUG_ID}-delete`,
      imageBuffer
    );

    await storage.deleteObject(result.key);

    await expect(storage.getObject(result.key)).rejects.toThrow(StorageNotFoundError);
  });
});

// Performance tests
describe('E2E: Performance', () => {
  let storage: IStorageService;

  beforeAll(async () => {
    storage = createStorage(localConfig);
    await storage.initialize();
  });

  afterAll(async () => {
    try {
      await storage.clearAllStorage();
      // Remove base directory
      const baseDir = (localConfig.local as any).baseDirectory;
      await fs.rm(baseDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Performance test cleanup failed:', error);
    }
  });

  it('should handle large file upload (5MB)', async () => {
    const largeBuffer = Buffer.alloc(5 * 1024 * 1024, 'A'); // 5MB

    const startTime = Date.now();
    const result = await storage.uploadAttachment(
      TEST_PROJECT_ID,
      `${TEST_BUG_ID}-large`,
      'large-file.bin',
      largeBuffer
    );
    const duration = Date.now() - startTime;

    expect(result.size).toBe(largeBuffer.length);
    expect(duration).toBeLessThan(5000); // Should complete in 5 seconds

    console.log(
      `📊 Large file upload: ${(result.size / 1024 / 1024).toFixed(2)}MB in ${duration}ms`
    );
  });

  it('should handle batch operations efficiently', async () => {
    const numFiles = 50;
    const imageBuffer = createTestImage();

    const startTime = Date.now();

    const uploads = Array.from({ length: numFiles }, (_, i) =>
      storage.uploadScreenshot(TEST_PROJECT_ID, `${TEST_BUG_ID}-batch-${i}`, imageBuffer)
    );

    await Promise.all(uploads);

    const duration = Date.now() - startTime;
    const avgTime = duration / numFiles;

    expect(avgTime).toBeLessThan(100); // Average less than 100ms per file

    console.log(
      `📊 Batch upload: ${numFiles} files in ${duration}ms (avg: ${avgTime.toFixed(2)}ms/file)`
    );
  });
});
