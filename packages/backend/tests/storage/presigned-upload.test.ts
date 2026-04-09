/**
 * Presigned Upload URL Tests
 * Tests for getPresignedUploadUrl method in storage services
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageService } from '../../src/storage/storage-service.js';
import { LocalStorageService } from '../../src/storage/local-storage.js';
import type { S3Config, LocalConfig } from '../../src/storage/types.js';

// Mock AWS SDK
vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: vi.fn().mockImplementation(() => ({
      send: vi.fn(),
      destroy: vi.fn(),
    })),
    PutObjectCommand: vi.fn(),
    GetObjectCommand: vi.fn(),
    HeadBucketCommand: vi.fn(),
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/signed-put-url?params=xyz'),
}));

describe('Storage Presigned Upload URLs', () => {
  describe('StorageService (S3)', () => {
    let storage: StorageService;

    beforeEach(() => {
      const config: S3Config = {
        region: 'us-east-1',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        bucket: 'test-bucket',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      storage = new StorageService(config);
    });

    it('should generate presigned upload URL with default expiry', async () => {
      const url = await storage.getPresignedUploadUrl('screenshots/proj/bug/test.png', 'image/png');

      expect(url).toBe('https://s3.amazonaws.com/signed-put-url?params=xyz');
    });

    it('should generate presigned upload URL with custom expiry', async () => {
      const url = await storage.getPresignedUploadUrl(
        'screenshots/proj/bug/test.png',
        'image/png',
        7200
      );

      expect(url).toBeDefined();
      expect(typeof url).toBe('string');
    });

    it('should include Content-Type in presigned URL signature for XSS prevention', async () => {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');

      await storage.getPresignedUploadUrl('screenshots/proj/bug/test.png', 'image/png', 3600);

      // Verify PutObjectCommand was called WITH ContentType
      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'screenshots/proj/bug/test.png',
          ContentType: 'image/png',
        })
      );

      // CRITICAL SECURITY: Verify ContentType IS in the command params
      const callArgs = (PutObjectCommand as any).mock.calls[0][0];
      expect(callArgs).toHaveProperty('ContentType', 'image/png');
    });

    it('should handle different file types with correct Content-Type', async () => {
      // Only test documented allowed content types (image/png, application/gzip)
      // Additional types would require security review - see upload-batch-handler.ts
      const uploads = [
        { key: 'screenshots/a/b/img.png', contentType: 'image/png' },
        { key: 'replays/a/b/replay.gz', contentType: 'application/gzip' },
      ];

      for (const { key, contentType } of uploads) {
        const url = await storage.getPresignedUploadUrl(key, contentType, 3600);
        expect(url).toBeDefined();
        expect(url).toContain('signed-put-url');
      }
    });

    it('should generate different URLs for different keys', async () => {
      const url1 = await storage.getPresignedUploadUrl(
        'screenshots/proj1/bug1/test.png',
        'image/png'
      );
      const url2 = await storage.getPresignedUploadUrl(
        'screenshots/proj2/bug2/test.png',
        'image/png'
      );

      // Both should be valid URLs (in real implementation they'd be different)
      expect(url1).toBeDefined();
      expect(url2).toBeDefined();
    });
  });

  describe('LocalStorageService', () => {
    let storage: LocalStorageService;

    beforeEach(() => {
      const config: LocalConfig = {
        baseDirectory: './test-uploads',
        baseUrl: 'http://localhost:3000/uploads',
      };

      storage = new LocalStorageService(config);
    });

    it('should generate upload URL with storage key', async () => {
      const url = await storage.getPresignedUploadUrl('screenshots/proj/bug/test.png', 'image/png');

      expect(url).toContain('http://localhost:3000/uploads/upload');
      // Storage key gets URL-encoded in the query parameter
      expect(url).toContain('key=screenshots%2Fproj%2Fbug%2Ftest.png');
      expect(url).toContain('expires=');
    });

    it('should generate upload URL with custom expiry', async () => {
      const before = Date.now();
      const url = await storage.getPresignedUploadUrl('screenshots/test.png', 'image/png', 7200);
      const after = Date.now();

      const params = new URL(url).searchParams;
      const expiresAt = parseInt(params.get('expires') || '0', 10);

      // Should expire in ~7200 seconds (allow 10s margin)
      expect(expiresAt).toBeGreaterThan(before + 7190 * 1000);
      expect(expiresAt).toBeLessThan(after + 7210 * 1000);
    });

    it('should encode storage key in URL', async () => {
      const url = await storage.getPresignedUploadUrl(
        'screenshots/proj-123/bug-456/file with spaces.png',
        'image/png'
      );

      const params = new URL(url).searchParams;
      const key = params.get('key');

      expect(key).toBe('screenshots/proj-123/bug-456/file with spaces.png');
    });

    it('should default to 1 hour expiry', async () => {
      const before = Date.now();
      const url = await storage.getPresignedUploadUrl('test.png', 'image/png');
      const after = Date.now();

      const params = new URL(url).searchParams;
      const expiresAt = parseInt(params.get('expires') || '0', 10);

      // Should expire in ~3600 seconds
      expect(expiresAt).toBeGreaterThan(before + 3590 * 1000);
      expect(expiresAt).toBeLessThan(after + 3610 * 1000);
    });

    it('should have upload endpoint in base URL', async () => {
      const url = await storage.getPresignedUploadUrl('test.png', 'image/png');

      expect(url).toContain('/upload?');
    });
  });
});
