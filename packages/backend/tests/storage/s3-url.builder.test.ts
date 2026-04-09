/**
 * S3UrlBuilder Tests
 * Unit tests for S3 URL generation
 */

import { describe, it, expect } from 'vitest';
import { S3UrlBuilder } from '../../src/storage/s3-url.builder.js';
import type { S3Config } from '../../src/storage/types.js';

describe('S3UrlBuilder', () => {
  describe('AWS S3 URLs (no custom endpoint)', () => {
    it('should build standard S3 URL with virtual-hosted style', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'my-bucket',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'my-bucket');
      const url = builder.buildObjectUrl('path/to/file.jpg');

      expect(url).toBe('https://my-bucket.s3.us-east-1.amazonaws.com/path/to/file.jpg');
    });

    it('should build S3 URL for us-east-1 region', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'test-bucket',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'test-bucket');
      const url = builder.buildObjectUrl('image.png');

      expect(url).toBe('https://test-bucket.s3.us-east-1.amazonaws.com/image.png');
    });

    it('should build S3 URL for different regions', () => {
      const config: S3Config = {
        region: 'eu-west-1',
        bucket: 'eu-bucket',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'eu-bucket');
      const url = builder.buildObjectUrl('data.json');

      expect(url).toBe('https://eu-bucket.s3.eu-west-1.amazonaws.com/data.json');
    });

    it('should handle keys with special characters', () => {
      const config: S3Config = {
        region: 'us-west-2',
        bucket: 'my-bucket',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'my-bucket');
      const url = builder.buildObjectUrl('path/to/file with spaces.pdf');

      expect(url).toBe('https://my-bucket.s3.us-west-2.amazonaws.com/path/to/file with spaces.pdf');
    });
  });

  describe('Custom Endpoint URLs (MinIO/R2)', () => {
    it('should build URL with custom endpoint (virtual-hosted style)', () => {
      const config: S3Config = {
        endpoint: 'https://minio.example.com',
        region: 'us-east-1',
        bucket: 'my-bucket',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'my-bucket');
      const url = builder.buildObjectUrl('file.txt');

      expect(url).toBe('https://my-bucket.minio.example.com/file.txt');
    });

    it('should build URL with custom endpoint and path style', () => {
      const config: S3Config = {
        endpoint: 'https://minio.example.com',
        region: 'us-east-1',
        bucket: 'my-bucket',
        forcePathStyle: true,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'my-bucket');
      const url = builder.buildObjectUrl('file.txt');

      expect(url).toBe('https://minio.example.com/my-bucket/file.txt');
    });

    it('should handle custom endpoint with port', () => {
      const config: S3Config = {
        endpoint: 'https://minio.local:9000',
        region: 'us-east-1',
        bucket: 'test',
        forcePathStyle: true,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'test');
      const url = builder.buildObjectUrl('object.bin');

      expect(url).toBe('https://minio.local:9000/test/object.bin');
    });

    it('should handle custom endpoint with trailing slash', () => {
      const config: S3Config = {
        endpoint: 'https://r2.cloudflare.com/',
        region: 'auto',
        bucket: 'my-r2-bucket',
        forcePathStyle: true,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'my-r2-bucket');
      const url = builder.buildObjectUrl('data.json');

      expect(url).toBe('https://r2.cloudflare.com/my-r2-bucket/data.json');
    });

    it('should handle custom endpoint without trailing slash', () => {
      const config: S3Config = {
        endpoint: 'https://storage.example.com',
        region: 'us-east-1',
        bucket: 'bucket',
        forcePathStyle: true,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'bucket');
      const url = builder.buildObjectUrl('file.pdf');

      expect(url).toBe('https://storage.example.com/bucket/file.pdf');
    });
  });

  describe('Edge Cases', () => {
    it('should handle nested paths', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'bucket',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'bucket');
      const url = builder.buildObjectUrl('level1/level2/level3/file.txt');

      expect(url).toBe('https://bucket.s3.us-east-1.amazonaws.com/level1/level2/level3/file.txt');
    });

    it('should handle keys with leading slash', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'bucket',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'bucket');
      const url = builder.buildObjectUrl('/leading-slash.txt');

      expect(url).toBe('https://bucket.s3.us-east-1.amazonaws.com//leading-slash.txt');
    });

    it('should handle empty key', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'bucket',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'bucket');
      const url = builder.buildObjectUrl('');

      expect(url).toBe('https://bucket.s3.us-east-1.amazonaws.com/');
    });

    it('should handle bucket names with dashes', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'my-special-bucket-123',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'my-special-bucket-123');
      const url = builder.buildObjectUrl('file.txt');

      expect(url).toBe('https://my-special-bucket-123.s3.us-east-1.amazonaws.com/file.txt');
    });
  });

  describe('MinIO Specific', () => {
    it('should build MinIO URL with HTTP', () => {
      const config: S3Config = {
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        bucket: 'local-bucket',
        forcePathStyle: true,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'local-bucket');
      const url = builder.buildObjectUrl('test.txt');

      expect(url).toBe('http://localhost:9000/local-bucket/test.txt');
    });

    it('should build MinIO URL with virtual-hosted style', () => {
      const config: S3Config = {
        endpoint: 'https://minio.prod.com',
        region: 'us-east-1',
        bucket: 'prod-bucket',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'prod-bucket');
      const url = builder.buildObjectUrl('data.csv');

      expect(url).toBe('https://prod-bucket.minio.prod.com/data.csv');
    });
  });

  describe('Cloudflare R2 Specific', () => {
    it('should build R2 URL with custom domain', () => {
      const config: S3Config = {
        endpoint: 'https://abc123.r2.cloudflarestorage.com',
        region: 'auto',
        bucket: 'my-r2-bucket',
        forcePathStyle: true,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3UrlBuilder(config, 'my-r2-bucket');
      const url = builder.buildObjectUrl('assets/logo.png');

      expect(url).toBe('https://abc123.r2.cloudflarestorage.com/my-r2-bucket/assets/logo.png');
    });
  });
});
