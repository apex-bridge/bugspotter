/**
 * Storage Service Tests
 * Tests for S3 and local storage implementations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StorageService } from '../../src/storage/storage-service.js';
import { LocalStorageService } from '../../src/storage/local-storage.js';
import {
  createStorage,
  createStorageFromEnv,
  validateStorageConfig,
  StorageError,
  StorageNotFoundError,
} from '../../src/storage/index.js';
import type { S3Config, LocalConfig, StorageConfig } from '../../src/storage/types.js';

// Mock AWS SDK
vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: vi.fn().mockImplementation(() => ({
      send: vi.fn(),
      destroy: vi.fn(),
    })),
    PutObjectCommand: vi.fn(),
    GetObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
    DeleteObjectsCommand: vi.fn(),
    HeadObjectCommand: vi.fn(),
    ListObjectsV2Command: vi.fn(),
    CreateBucketCommand: vi.fn(),
    HeadBucketCommand: vi.fn(),
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed-url.example.com'),
}));

describe('Storage Factory', () => {
  describe('createStorage', () => {
    it('should create S3 storage service', () => {
      const config: StorageConfig = {
        backend: 's3',
        s3: {
          region: 'us-east-1',
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
          bucket: 'test-bucket',
        },
      };

      const storage = createStorage(config);
      expect(storage).toBeInstanceOf(StorageService);
    });

    it('should create MinIO storage service', () => {
      const config: StorageConfig = {
        backend: 'minio',
        s3: {
          endpoint: 'http://localhost:9000',
          region: 'us-east-1',
          accessKeyId: 'minioadmin',
          secretAccessKey: 'minioadmin',
          bucket: 'test-bucket',
          forcePathStyle: true,
        },
      };

      const storage = createStorage(config);
      expect(storage).toBeInstanceOf(StorageService);
    });

    it('should create local storage service', () => {
      const config: StorageConfig = {
        backend: 'local',
        local: {
          baseDirectory: './test-uploads',
          baseUrl: 'http://localhost:3000/uploads',
        },
      };

      const storage = createStorage(config);
      expect(storage).toBeInstanceOf(LocalStorageService);
    });

    it('should throw error for invalid backend', () => {
      const config = {
        backend: 'invalid',
      } as unknown as StorageConfig;

      expect(() => createStorage(config)).toThrow(StorageError);
    });

    it('should throw error when S3 config missing for S3 backend', () => {
      const config: StorageConfig = {
        backend: 's3',
      };

      expect(() => createStorage(config)).toThrow(StorageError);
    });

    it('should throw error when local config missing for local backend', () => {
      const config: StorageConfig = {
        backend: 'local',
      };

      expect(() => createStorage(config)).toThrow(StorageError);
    });
  });

  describe('createStorageFromEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should create local storage by default', () => {
      process.env.STORAGE_BACKEND = 'local';
      process.env.STORAGE_BASE_DIR = './test-uploads';
      process.env.STORAGE_BASE_URL = 'http://localhost:3000/uploads';

      const storage = createStorageFromEnv();
      expect(storage).toBeInstanceOf(LocalStorageService);
    });

    it('should create S3 storage from env vars', () => {
      process.env.STORAGE_BACKEND = 's3';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_ACCESS_KEY = 'test-key';
      process.env.S3_SECRET_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';

      const storage = createStorageFromEnv();
      expect(storage).toBeInstanceOf(StorageService);
    });

    it('should throw error when required S3 env vars missing', () => {
      process.env.STORAGE_BACKEND = 's3';
      // Missing S3_REGION, S3_ACCESS_KEY, etc.

      expect(() => createStorageFromEnv()).toThrow(StorageError);
    });
  });

  describe('validateStorageConfig', () => {
    it('should validate valid S3 config', () => {
      const config: StorageConfig = {
        backend: 's3',
        s3: {
          region: 'us-east-1',
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
          bucket: 'test-bucket',
        },
      };

      const errors = validateStorageConfig(config);
      expect(errors).toHaveLength(0);
    });

    it('should validate valid local config', () => {
      const config: StorageConfig = {
        backend: 'local',
        local: {
          baseDirectory: './uploads',
          baseUrl: 'http://localhost:3000/uploads',
        },
      };

      const errors = validateStorageConfig(config);
      expect(errors).toHaveLength(0);
    });

    it('should return errors for missing S3 config', () => {
      const config: StorageConfig = {
        backend: 's3',
      };

      const errors = validateStorageConfig(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('S3 configuration is required');
    });

    it('should return errors for incomplete S3 config', () => {
      const config: StorageConfig = {
        backend: 's3',
        s3: {
          region: 'us-east-1',
          accessKeyId: '',
          secretAccessKey: '',
          bucket: '',
        },
      };

      const errors = validateStorageConfig(config);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should return errors for invalid backend', () => {
      const config = {
        backend: 'invalid',
      } as unknown as StorageConfig;

      const errors = validateStorageConfig(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Unsupported storage backend');
    });

    it('should validate S3 numeric constraints', () => {
      const config: StorageConfig = {
        backend: 's3',
        s3: {
          region: 'us-east-1',
          accessKeyId: 'test',
          secretAccessKey: 'test',
          bucket: 'test',
          maxRetries: -1,
          timeout: 500,
        },
      };

      const errors = validateStorageConfig(config);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});

describe('StorageService (S3)', () => {
  let storage: StorageService;
  let s3Config: S3Config;

  beforeEach(() => {
    s3Config = {
      region: 'us-east-1',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      bucket: 'test-bucket',
    };
    storage = new StorageService(s3Config);
  });

  describe('Path building', () => {
    it('should build correct screenshot path', async () => {
      const projectId = 'proj-123';
      const bugId = 'bug-456';
      const buffer = Buffer.from('test image');

      // Mock S3 client send method
      const mockSend = vi.fn().mockResolvedValue({ ETag: 'test-etag' });
      (storage as any).client.send = mockSend;

      const result = await storage.uploadScreenshot(projectId, bugId, buffer);

      // Verify the key path in the result
      expect(result.key).toBe('screenshots/proj-123/bug-456/original.png');
      expect(mockSend).toHaveBeenCalled();
    });

    it('should build correct thumbnail path', async () => {
      const projectId = 'proj-123';
      const bugId = 'bug-456';
      const buffer = Buffer.from('thumbnail');

      const mockSend = vi.fn().mockResolvedValue({ ETag: 'test-etag' });
      (storage as any).client.send = mockSend;

      const result = await storage.uploadThumbnail(projectId, bugId, buffer);

      expect(result.key).toBe('screenshots/proj-123/bug-456/thumbnail.jpg');
      expect(mockSend).toHaveBeenCalled();
    });

    it('should build correct attachment path with sanitized filename', async () => {
      const projectId = 'proj-123';
      const bugId = 'bug-456';
      const filename = '../../../etc/passwd'; // Path traversal attempt
      const buffer = Buffer.from('attachment data');

      const mockSend = vi.fn().mockResolvedValue({ ETag: 'test-etag' });
      (storage as any).client.send = mockSend;

      const result = await storage.uploadAttachment(projectId, bugId, filename, buffer);

      // Verify filename is sanitized
      expect(result.key).not.toContain('..');
      expect(result.key).toMatch(/^attachments\/proj-123\/bug-456\//);
      expect(mockSend).toHaveBeenCalled();
    });
  });

  describe('Upload operations', () => {
    it('should return upload result with correct structure', async () => {
      const mockSend = vi.fn().mockResolvedValue({ ETag: '"test-etag"' });
      (storage as any).client.send = mockSend;

      const buffer = Buffer.from('test data');
      const result = await storage.uploadScreenshot('proj-1', 'bug-1', buffer);

      expect(result).toMatchObject({
        key: expect.any(String),
        url: expect.any(String),
        size: buffer.length,
        etag: expect.any(String),
        contentType: expect.any(String),
      });
    });

    it('should generate signed URLs instead of public URLs', async () => {
      const mockSend = vi.fn().mockResolvedValue({ ETag: '"test-etag"' });
      (storage as any).client.send = mockSend;

      const buffer = Buffer.from('test data');
      const result = await storage.uploadScreenshot('proj-1', 'bug-1', buffer);

      // Verify URL is signed (from mocked getSignedUrl)
      expect(result.url).toBe('https://signed-url.example.com');
      // Verify it's NOT a plain public URL
      expect(result.url).not.toMatch(/^https:\/\/.*\.r2\.cloudflarestorage\.com\/[^?]+$/);
    });

    it('should include 6-day expiration in signed URLs', async () => {
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const mockSend = vi.fn().mockResolvedValue({ ETag: '"test-etag"' });
      (storage as any).client.send = mockSend;

      const buffer = Buffer.from('test data');
      await storage.uploadScreenshot('proj-1', 'bug-1', buffer);

      // Verify getSignedUrl was called with 6-day expiration
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          expiresIn: 6 * 24 * 60 * 60, // 6 days in seconds (S3 Signature v4 max is 7 days)
        })
      );
    });

    it('should use custom expiration from environment variable', async () => {
      // Set custom expiration using vi.stubEnv
      vi.stubEnv('SIGNED_URL_EXPIRATION_SECONDS', '86400'); // 1 day

      try {
        // Create new storage instance to pick up env var
        const customStorage = new StorageService(s3Config);

        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
        const mockSend = vi.fn().mockResolvedValue({ ETag: '"test-etag"' });
        (customStorage as any).client.send = mockSend;

        const buffer = Buffer.from('test data');
        await customStorage.uploadScreenshot('proj-1', 'bug-1', buffer);

        // Verify getSignedUrl was called with custom expiration
        expect(getSignedUrl).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({
            expiresIn: 86400, // 1 day in seconds
          })
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('should use default when environment variable is invalid (NaN)', async () => {
      vi.stubEnv('SIGNED_URL_EXPIRATION_SECONDS', 'not-a-number');

      try {
        const customStorage = new StorageService(s3Config);

        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
        const mockSend = vi.fn().mockResolvedValue({ ETag: '"test-etag"' });
        (customStorage as any).client.send = mockSend;

        const buffer = Buffer.from('test data');
        await customStorage.uploadScreenshot('proj-1', 'bug-1', buffer);

        // Should fallback to default 6 days (S3 Signature v4 max is 7 days)
        expect(getSignedUrl).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({
            expiresIn: 6 * 24 * 60 * 60,
          })
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('should use default when environment variable is negative', async () => {
      vi.stubEnv('SIGNED_URL_EXPIRATION_SECONDS', '-3600');

      try {
        const customStorage = new StorageService(s3Config);

        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
        const mockSend = vi.fn().mockResolvedValue({ ETag: '"test-etag"' });
        (customStorage as any).client.send = mockSend;

        const buffer = Buffer.from('test data');
        await customStorage.uploadScreenshot('proj-1', 'bug-1', buffer);

        // Should fallback to default 6 days (S3 Signature v4 max is 7 days)
        expect(getSignedUrl).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({
            expiresIn: 6 * 24 * 60 * 60,
          })
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('should use default when environment variable is zero', async () => {
      vi.stubEnv('SIGNED_URL_EXPIRATION_SECONDS', '0');

      try {
        const customStorage = new StorageService(s3Config);

        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
        const mockSend = vi.fn().mockResolvedValue({ ETag: '"test-etag"' });
        (customStorage as any).client.send = mockSend;

        const buffer = Buffer.from('test data');
        await customStorage.uploadScreenshot('proj-1', 'bug-1', buffer);

        // Should fallback to default 6 days (S3 Signature v4 max is 7 days)
        expect(getSignedUrl).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.objectContaining({
            expiresIn: 6 * 24 * 60 * 60,
          })
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('should retry on failure', async () => {
      const networkError = new Error('Network error') as Error & { code?: string };
      networkError.code = 'ECONNRESET'; // Matches RetryPredicates.isStorageError

      const mockSend = vi
        .fn()
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({ ETag: '"success"' });

      (storage as any).client.send = mockSend;

      const buffer = Buffer.from('test');
      const result = await storage.uploadScreenshot('proj-1', 'bug-1', buffer);

      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(result.etag).toBe('"success"');
    });

    it('should throw error after max retries', async () => {
      const networkError = new Error('Persistent error') as Error & { code?: string };
      networkError.code = 'ETIMEDOUT'; // Matches RetryPredicates.isStorageError

      const mockSend = vi.fn().mockRejectedValue(networkError);
      (storage as any).client.send = mockSend;
      (storage as any).config.maxRetries = 2;

      const buffer = Buffer.from('test');

      await expect(storage.uploadScreenshot('proj-1', 'bug-1', buffer)).rejects.toThrow();
      expect(mockSend).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  describe('Delete operations', () => {
    it('should delete single object', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      (storage as any).client.send = mockSend;

      await storage.deleteObject('test-key');

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should delete folder with multiple objects', async () => {
      const mockSend = vi
        .fn()
        .mockResolvedValueOnce({
          Contents: [{ Key: 'folder/file1.txt' }, { Key: 'folder/file2.txt' }],
          IsTruncated: false,
        })
        .mockResolvedValueOnce({ Deleted: [{}, {}] });

      (storage as any).client.send = mockSend;

      await storage.deleteFolder('folder/');

      expect(mockSend).toHaveBeenCalledTimes(2); // List + Delete
    });
  });

  describe('List operations', () => {
    it('should list objects with prefix', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        Contents: [
          { Key: 'prefix/file1.txt', Size: 100, LastModified: new Date() },
          { Key: 'prefix/file2.txt', Size: 200, LastModified: new Date() },
        ],
        IsTruncated: false,
      });

      (storage as any).client.send = mockSend;

      const result = await storage.listObjects({ prefix: 'prefix/' });

      expect(result.objects).toHaveLength(2);
      expect(result.isTruncated).toBe(false);
    });
  });

  describe('Health check', () => {
    it('should return true when bucket is accessible', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      (storage as any).client.send = mockSend;

      const result = await storage.healthCheck();

      expect(result).toBe(true);
    });

    it('should return false when bucket is not accessible', async () => {
      const mockSend = vi.fn().mockRejectedValue(new Error('Access denied'));
      (storage as any).client.send = mockSend;

      const result = await storage.healthCheck();

      expect(result).toBe(false);
    });
  });
});

describe('LocalStorageService', () => {
  let storage: LocalStorageService;
  let localConfig: LocalConfig;
  let testDir: string;

  beforeEach(() => {
    // Generate unique directory per test for proper isolation
    testDir = './test-uploads-' + Date.now() + '-' + Math.random().toString(36).substring(7);
    localConfig = {
      baseDirectory: testDir,
      baseUrl: 'http://localhost:3000/uploads',
    };
    storage = new LocalStorageService(localConfig);
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await storage.clearAllStorage();
      // Also remove the base directory itself
      const fs = await import('node:fs/promises');
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Log cleanup errors for debugging but don't fail tests
      console.warn(`Failed to cleanup test directory ${testDir}:`, error);
    }
  });

  describe('Initialize', () => {
    it('should create base directory', async () => {
      await storage.initialize();
      const healthy = await storage.healthCheck();
      expect(healthy).toBe(true);
    });
  });

  describe('Upload and retrieve', () => {
    it('should upload and retrieve file', async () => {
      await storage.initialize();

      const buffer = Buffer.from('test content');
      const result = await storage.uploadScreenshot('proj-1', 'bug-1', buffer);

      expect(result.key).toBe('screenshots/proj-1/bug-1/original.png');
      expect(result.size).toBe(buffer.length);

      const stream = await storage.getObject(result.key);
      const chunks: Buffer[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }

      const retrieved = Buffer.concat(chunks);
      expect(retrieved.toString()).toBe('test content');
    });

    it('should throw NotFoundError for non-existent file', async () => {
      await storage.initialize();

      await expect(storage.getObject('non-existent-key')).rejects.toThrow(StorageNotFoundError);
    });
  });

  describe('Head object', () => {
    it('should return metadata for existing file', async () => {
      await storage.initialize();

      const buffer = Buffer.from('test');
      const result = await storage.uploadScreenshot('proj-1', 'bug-1', buffer);

      const metadata = await storage.headObject(result.key);

      expect(metadata).not.toBeNull();
      expect(metadata?.size).toBe(buffer.length);
      expect(metadata?.key).toBe(result.key);
    });

    it('should return null for non-existent file', async () => {
      await storage.initialize();

      const metadata = await storage.headObject('non-existent');

      expect(metadata).toBeNull();
    });
  });

  describe('Delete operations', () => {
    it('should delete single file', async () => {
      await storage.initialize();

      const buffer = Buffer.from('test');
      const result = await storage.uploadScreenshot('proj-1', 'bug-1', buffer);

      await storage.deleteObject(result.key);

      const metadata = await storage.headObject(result.key);
      expect(metadata).toBeNull();
    });

    it('should delete folder recursively', async () => {
      await storage.initialize();

      // Upload multiple files
      await storage.uploadScreenshot('proj-1', 'bug-1', Buffer.from('test1'));
      await storage.uploadThumbnail('proj-1', 'bug-1', Buffer.from('test2'));

      await storage.deleteFolder('screenshots/proj-1');

      // Verify files are deleted
      const list = await storage.listObjects({ prefix: 'screenshots/proj-1' });
      expect(list.objects).toHaveLength(0);
    });
  });

  describe('List objects', () => {
    it('should list files in folder', async () => {
      await storage.initialize();

      await storage.uploadScreenshot('proj-1', 'bug-1', Buffer.from('test1'));
      await storage.uploadScreenshot('proj-1', 'bug-2', Buffer.from('test2'));

      const result = await storage.listObjects({ prefix: 'screenshots/proj-1' });

      expect(result.objects.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty list for non-existent folder', async () => {
      await storage.initialize();

      const result = await storage.listObjects({ prefix: 'non-existent/' });

      expect(result.objects).toHaveLength(0);
      expect(result.isTruncated).toBe(false);
    });
  });

  describe('S3 Checksum Auto-Detection', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should auto-detect B2 endpoint and disable checksums', () => {
      process.env.STORAGE_BACKEND = 's3';
      process.env.S3_REGION = 'us-west-002';
      process.env.S3_ACCESS_KEY = 'test-key';
      process.env.S3_SECRET_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_ENDPOINT = 'https://s3.us-west-002.backblazeb2.com';

      const storage = createStorageFromEnv();
      expect(storage).toBeInstanceOf(StorageService);
      // Verify disableChecksums is set to true through internal config
      const s3Storage = storage as StorageService;
      expect(s3Storage['config'].disableChecksums).toBe(true);
    });

    it('should auto-detect R2 endpoint and disable checksums', () => {
      process.env.STORAGE_BACKEND = 's3';
      process.env.S3_REGION = 'auto';
      process.env.S3_ACCESS_KEY = 'test-key';
      process.env.S3_SECRET_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_ENDPOINT = 'https://abc123.r2.cloudflarestorage.com';

      const storage = createStorageFromEnv();
      expect(storage).toBeInstanceOf(StorageService);
      const s3Storage = storage as StorageService;
      expect(s3Storage['config'].disableChecksums).toBe(true);
    });

    it('should NOT auto-detect AWS S3 endpoint (keep checksums enabled)', () => {
      process.env.STORAGE_BACKEND = 's3';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_ACCESS_KEY = 'test-key';
      process.env.S3_SECRET_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_ENDPOINT = 'https://s3.us-east-1.amazonaws.com';

      const storage = createStorageFromEnv();
      expect(storage).toBeInstanceOf(StorageService);
      const s3Storage = storage as StorageService;
      expect(s3Storage['config'].disableChecksums).toBe(false);
    });

    it('should NOT auto-detect MinIO endpoint (keep checksums enabled)', () => {
      process.env.STORAGE_BACKEND = 's3';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_ACCESS_KEY = 'minioadmin';
      process.env.S3_SECRET_KEY = 'minioadmin';
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_ENDPOINT = 'http://localhost:9000';

      const storage = createStorageFromEnv();
      expect(storage).toBeInstanceOf(StorageService);
      const s3Storage = storage as StorageService;
      expect(s3Storage['config'].disableChecksums).toBe(false);
    });

    it('should respect explicit S3_DISABLE_CHECKSUMS=true (overrides auto-detect)', () => {
      process.env.STORAGE_BACKEND = 's3';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_ACCESS_KEY = 'test-key';
      process.env.S3_SECRET_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_ENDPOINT = 'https://s3.us-east-1.amazonaws.com'; // AWS endpoint
      process.env.S3_DISABLE_CHECKSUMS = 'true'; // Explicit override

      const storage = createStorageFromEnv();
      expect(storage).toBeInstanceOf(StorageService);
      const s3Storage = storage as StorageService;
      expect(s3Storage['config'].disableChecksums).toBe(true);
    });

    it('should respect explicit S3_DISABLE_CHECKSUMS=false (overrides auto-detect)', () => {
      process.env.STORAGE_BACKEND = 's3';
      process.env.S3_REGION = 'us-west-002';
      process.env.S3_ACCESS_KEY = 'test-key';
      process.env.S3_SECRET_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_ENDPOINT = 'https://s3.us-west-002.backblazeb2.com'; // B2 endpoint
      process.env.S3_DISABLE_CHECKSUMS = 'false'; // Explicit override

      const storage = createStorageFromEnv();
      expect(storage).toBeInstanceOf(StorageService);
      const s3Storage = storage as StorageService;
      expect(s3Storage['config'].disableChecksums).toBe(false);
    });

    it('should handle case-insensitive B2 endpoint detection', () => {
      process.env.STORAGE_BACKEND = 's3';
      process.env.S3_REGION = 'us-west-002';
      process.env.S3_ACCESS_KEY = 'test-key';
      process.env.S3_SECRET_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_ENDPOINT = 'https://s3.us-west-002.BackBlazeB2.COM'; // Mixed case

      const storage = createStorageFromEnv();
      expect(storage).toBeInstanceOf(StorageService);
      const s3Storage = storage as StorageService;
      expect(s3Storage['config'].disableChecksums).toBe(true);
    });

    it('should handle case-insensitive R2 endpoint detection', () => {
      process.env.STORAGE_BACKEND = 's3';
      process.env.S3_REGION = 'auto';
      process.env.S3_ACCESS_KEY = 'test-key';
      process.env.S3_SECRET_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_ENDPOINT = 'https://abc123.R2.CloudflareStorage.COM'; // Mixed case

      const storage = createStorageFromEnv();
      expect(storage).toBeInstanceOf(StorageService);
      const s3Storage = storage as StorageService;
      expect(s3Storage['config'].disableChecksums).toBe(true);
    });

    it('should handle missing endpoint (no auto-detect, defaults to false)', () => {
      process.env.STORAGE_BACKEND = 's3';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_ACCESS_KEY = 'test-key';
      process.env.S3_SECRET_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';
      // No S3_ENDPOINT set

      const storage = createStorageFromEnv();
      expect(storage).toBeInstanceOf(StorageService);
      const s3Storage = storage as StorageService;
      expect(s3Storage['config'].disableChecksums).toBe(false);
    });

    it('should handle empty string endpoint (no auto-detect, defaults to false)', () => {
      process.env.STORAGE_BACKEND = 's3';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_ACCESS_KEY = 'test-key';
      process.env.S3_SECRET_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_ENDPOINT = '';

      const storage = createStorageFromEnv();
      expect(storage).toBeInstanceOf(StorageService);
      const s3Storage = storage as StorageService;
      expect(s3Storage['config'].disableChecksums).toBe(false);
    });
  });

  describe('S3 Configuration Defaults', () => {
    it('should default to virtual-hosted style for R2 (forcePathStyle omitted)', () => {
      process.env.STORAGE_BACKEND = 'r2';
      process.env.S3_REGION = 'auto';
      process.env.S3_ACCESS_KEY = 'test-key';
      process.env.S3_SECRET_KEY = 'test-secret';
      process.env.S3_BUCKET = 'bugspotter-uploads';
      process.env.S3_ENDPOINT = 'https://abc123.r2.cloudflarestorage.com';

      const storage = createStorageFromEnv();
      expect(storage).toBeInstanceOf(StorageService);
      const s3Storage = storage as StorageService;
      // forcePathStyle is omitted (undefined), AWS SDK defaults to virtual-hosted style
      expect(s3Storage['config'].forcePathStyle).toBeUndefined();
    });

    it('should default to virtual-hosted style for AWS S3 (forcePathStyle omitted)', () => {
      process.env.STORAGE_BACKEND = 's3';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_ACCESS_KEY = 'test-key';
      process.env.S3_SECRET_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';
      delete process.env.S3_ENDPOINT;

      const storage = createStorageFromEnv();
      expect(storage).toBeInstanceOf(StorageService);
      const s3Storage = storage as StorageService;
      // forcePathStyle is omitted (undefined), AWS SDK defaults to virtual-hosted style
      expect(s3Storage['config'].forcePathStyle).toBeUndefined();
    });

    it('should default to virtual-hosted style for all S3-compatible providers (forcePathStyle omitted)', () => {
      process.env.STORAGE_BACKEND = 's3';
      process.env.S3_REGION = 'us-west-002';
      process.env.S3_ACCESS_KEY = 'test-key';
      process.env.S3_SECRET_KEY = 'test-secret';
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_ENDPOINT = 'https://s3.us-west-002.backblazeb2.com';

      const storage = createStorageFromEnv();
      expect(storage).toBeInstanceOf(StorageService);
      const s3Storage = storage as StorageService;
      // forcePathStyle is omitted (undefined), AWS SDK defaults to virtual-hosted style
      // Tests can still override by passing config directly with forcePathStyle=true for MinIO
      expect(s3Storage['config'].forcePathStyle).toBeUndefined();
    });
  });
});
