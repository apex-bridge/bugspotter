/**
 * Unit tests for configuration validators
 * Tests all validation functions in config/validators.ts
 */

import { describe, it, expect } from 'vitest';
import {
  MIN_JWT_SECRET_LENGTH,
  MIN_PORT,
  MAX_PORT,
  MIN_TIMEOUT_MS,
  MIN_RATE_LIMIT_WINDOW_MS,
  MIN_S3_ACCESS_KEY_LENGTH,
  MIN_S3_SECRET_KEY_LENGTH,
  MAX_S3_BUCKET_NAME_LENGTH,
  MIN_S3_BUCKET_NAME_LENGTH,
  VALID_S3_BUCKET_PATTERN,
  VALID_AWS_REGIONS,
  validateNumber,
  validateDatabaseUrl,
  validateDatabasePoolConfig,
  validateJwtSecret,
  validateS3Credentials,
  validateS3BucketName,
  validateS3Region,
  validateS3Endpoint,
  validateS3ForcePathStyle,
  validateLocalStorageConfig,
  assertNonNegative,
  assertPositive,
  assertRange,
  assertMinimum,
  parseBooleanEnv,
} from '../../src/config/validators.js';

describe('Configuration Validators', () => {
  describe('Constants', () => {
    it('should have sensible constant values', () => {
      expect(MIN_JWT_SECRET_LENGTH).toBe(32);
      expect(MIN_PORT).toBe(1);
      expect(MAX_PORT).toBe(65535);
      expect(MIN_TIMEOUT_MS).toBe(1000);
      expect(MIN_RATE_LIMIT_WINDOW_MS).toBe(1000);
      expect(MIN_S3_ACCESS_KEY_LENGTH).toBe(16);
      expect(MIN_S3_SECRET_KEY_LENGTH).toBe(32);
      expect(MAX_S3_BUCKET_NAME_LENGTH).toBe(63);
      expect(MIN_S3_BUCKET_NAME_LENGTH).toBe(3);
    });

    it('should have valid S3 bucket patterns', () => {
      expect(VALID_S3_BUCKET_PATTERN.test('valid-bucket-123')).toBe(true);
      expect(VALID_S3_BUCKET_PATTERN.test('my.bucket')).toBe(true);
      expect(VALID_S3_BUCKET_PATTERN.test('-invalid')).toBe(false);
      expect(VALID_S3_BUCKET_PATTERN.test('invalid-')).toBe(false);
      expect(VALID_S3_BUCKET_PATTERN.test('Invalid')).toBe(false);
    });

    it('should have valid AWS regions', () => {
      expect(VALID_AWS_REGIONS).toContain('us-east-1');
      expect(VALID_AWS_REGIONS).toContain('eu-west-1');
      expect(VALID_AWS_REGIONS).toContain('ap-southeast-1');
      expect(VALID_AWS_REGIONS.length).toBeGreaterThan(20);
    });
  });

  describe('validateNumber', () => {
    it('should accept valid numbers within range', () => {
      expect(validateNumber(10, 'test', 1, 100)).toBeNull();
      expect(validateNumber(1, 'test', 1, 100)).toBeNull();
      expect(validateNumber(100, 'test', 1, 100)).toBeNull();
    });

    it('should reject NaN', () => {
      const error = validateNumber(NaN, 'test');
      expect(error).toContain('must be a valid number');
    });

    it('should reject numbers below minimum', () => {
      const error = validateNumber(0, 'test', 1);
      expect(error).toContain('must be at least 1');
    });

    it('should reject numbers above maximum', () => {
      const error = validateNumber(101, 'test', 1, 100);
      expect(error).toContain('must be at most 100');
    });

    it('should work without min/max constraints', () => {
      expect(validateNumber(10, 'test')).toBeNull();
      expect(validateNumber(-10, 'test')).toBeNull();
      expect(validateNumber(0, 'test')).toBeNull();
    });
  });

  describe('validateDatabaseUrl', () => {
    it('should accept valid PostgreSQL URLs', () => {
      const validUrls = [
        'postgres://user:pass@localhost:5432/dbname',
        'postgresql://user:pass@localhost:5432/dbname',
        'postgres://localhost/dbname',
        'postgresql://host.example.com:5432/mydb',
      ];

      validUrls.forEach((url) => {
        expect(validateDatabaseUrl(url)).toEqual([]);
      });
    });

    it('should reject empty URL', () => {
      const errors = validateDatabaseUrl('');
      expect(errors).toContain('DATABASE_URL is required');
    });

    it('should reject invalid protocol', () => {
      const errors = validateDatabaseUrl('mysql://localhost/dbname');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('valid PostgreSQL connection string');
    });

    it('should reject malformed URLs', () => {
      const invalidUrls = ['http://localhost', 'localhost:5432', 'not-a-url'];

      invalidUrls.forEach((url) => {
        const errors = validateDatabaseUrl(url);
        expect(errors.length).toBeGreaterThan(0);
      });
    });
  });

  describe('validateDatabasePoolConfig', () => {
    it('should accept valid pool configuration', () => {
      expect(validateDatabasePoolConfig(2, 10)).toEqual([]);
      expect(validateDatabasePoolConfig(1, 1)).toEqual([]);
      expect(validateDatabasePoolConfig(0, 5)).toEqual([]);
    });

    it('should reject min greater than max', () => {
      const errors = validateDatabasePoolConfig(10, 5);
      expect(errors).toContain('DB_POOL_MIN cannot be greater than DB_POOL_MAX');
    });
  });

  describe('validateJwtSecret', () => {
    it('should accept valid secrets in production', () => {
      const validSecret = 'a'.repeat(MIN_JWT_SECRET_LENGTH);
      expect(validateJwtSecret(validSecret, 'production')).toEqual([]);
    });

    it('should accept valid secrets in development', () => {
      const validSecret = 'a'.repeat(MIN_JWT_SECRET_LENGTH);
      expect(validateJwtSecret(validSecret, 'development')).toEqual([]);
    });

    it('should require secret in production', () => {
      const errors = validateJwtSecret('', 'production');
      expect(errors).toContain('JWT_SECRET is required in production');
    });

    it('should allow empty secret in development', () => {
      const errors = validateJwtSecret('', 'development');
      expect(errors).toEqual([]);
    });

    it('should reject short secrets', () => {
      const shortSecret = 'a'.repeat(MIN_JWT_SECRET_LENGTH - 1);
      const errors = validateJwtSecret(shortSecret, 'production');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('at least 32 characters');
    });
  });

  describe('validateS3Credentials', () => {
    describe('AWS S3', () => {
      it('should accept valid AWS S3 credentials (32+ chars)', () => {
        const validKey = 'a'.repeat(MIN_S3_ACCESS_KEY_LENGTH);
        const validSecret = 'a'.repeat(MIN_S3_SECRET_KEY_LENGTH);
        expect(validateS3Credentials(validKey, validSecret, 's3', undefined)).toEqual([]);
      });

      it('should reject short secret key for AWS S3 (< 32 chars)', () => {
        const validKey = 'a'.repeat(MIN_S3_ACCESS_KEY_LENGTH);
        const shortSecret = 'a'.repeat(MIN_S3_SECRET_KEY_LENGTH - 1);
        const errors = validateS3Credentials(validKey, shortSecret, 's3', undefined);
        expect(errors.some((e) => e.includes('at least 32 characters for AWS S3'))).toBe(true);
      });
    });

    describe('MinIO', () => {
      it('should accept MinIO credentials with 16+ chars', () => {
        const validKey = 'minioadmin123456'; // 16 chars
        const validSecret = 'minioadmin123456'; // 16 chars (MinIO allows shorter)
        expect(validateS3Credentials(validKey, validSecret, 's3', 'http://localhost:9000')).toEqual(
          []
        );
      });

      it('should accept MinIO credentials with 20+ chars', () => {
        const validKey = 'minioadmin1234567890'; // 20 chars
        const validSecret = 'minioadmin1234567890secretkey'; // 29 chars
        expect(validateS3Credentials(validKey, validSecret, 's3', 'http://localhost:9000')).toEqual(
          []
        );
      });

      it('should reject MinIO credentials < 16 chars', () => {
        const shortKey = 'minioadmin'; // 10 chars
        const shortSecret = 'minioadmin'; // 10 chars
        const errors = validateS3Credentials(shortKey, shortSecret, 's3', 'http://localhost:9000');
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('Cloudflare R2', () => {
      it('should accept R2 credentials with 16+ chars', () => {
        const validKey = 'r2accesskey12345'; // 16 chars
        const validSecret = 'r2secretkey12345'; // 16 chars
        expect(
          validateS3Credentials(
            validKey,
            validSecret,
            's3',
            'https://1234567890abcdef.r2.cloudflarestorage.com'
          )
        ).toEqual([]);
      });

      it('should accept R2 credentials with typical lengths', () => {
        const validKey = 'a'.repeat(32); // R2 access keys are typically 32 chars
        const validSecret = 'a'.repeat(64); // R2 secret keys are typically 64 chars
        expect(
          validateS3Credentials(
            validKey,
            validSecret,
            's3',
            'https://1234567890abcdef.r2.cloudflarestorage.com'
          )
        ).toEqual([]);
      });
    });

    describe('Backblaze B2', () => {
      it('should accept Backblaze B2 credentials (typically 25+ chars)', () => {
        const b2KeyId = '0'.repeat(25); // B2 key IDs are 25 chars
        const b2AppKey = 'K'.repeat(31); // B2 app keys are 31 chars
        expect(
          validateS3Credentials(
            b2KeyId,
            b2AppKey,
            's3',
            'https://s3.eu-central-003.backblazeb2.com'
          )
        ).toEqual([]); // B2 is S3-compatible
      });

      it('should accept Backblaze B2 with minimum length', () => {
        const validKey = 'a'.repeat(MIN_S3_ACCESS_KEY_LENGTH);
        const validSecret = 'a'.repeat(MIN_S3_ACCESS_KEY_LENGTH);
        expect(
          validateS3Credentials(
            validKey,
            validSecret,
            's3',
            'https://s3.us-west-004.backblazeb2.com'
          )
        ).toEqual([]); // S3-compatible
      });
    });

    describe('General validation', () => {
      it('should accept both credentials omitted', () => {
        expect(validateS3Credentials(undefined, undefined)).toEqual([]);
      });

      it('should reject only access key provided', () => {
        const errors = validateS3Credentials('valid-key', undefined);
        expect(errors).toContain(
          'S3_ACCESS_KEY and S3_SECRET_KEY must both be provided or both omitted'
        );
      });

      it('should reject only secret key provided', () => {
        const errors = validateS3Credentials(undefined, 'valid-secret');
        expect(errors).toContain(
          'S3_ACCESS_KEY and S3_SECRET_KEY must both be provided or both omitted'
        );
      });

      it('should reject short access key for all backends', () => {
        const shortKey = 'a'.repeat(MIN_S3_ACCESS_KEY_LENGTH - 1);
        const validSecret = 'a'.repeat(MIN_S3_SECRET_KEY_LENGTH);
        const errors = validateS3Credentials(shortKey, validSecret);
        expect(errors.some((e) => e.includes('S3_ACCESS_KEY must be at least'))).toBe(true);
      });
    });
  });

  describe('validateS3BucketName', () => {
    it('should accept valid bucket names', () => {
      const validNames = [
        'mybucket',
        'my-bucket',
        'my.bucket',
        'my-bucket-123',
        'abc',
        'a'.repeat(MAX_S3_BUCKET_NAME_LENGTH),
      ];

      validNames.forEach((name) => {
        expect(validateS3BucketName(name)).toEqual([]);
      });
    });

    it('should reject undefined bucket', () => {
      const errors = validateS3BucketName(undefined);
      expect(errors).toContain('S3_BUCKET is required');
    });

    it('should reject bucket name too short', () => {
      const errors = validateS3BucketName('ab');
      expect(errors.some((e) => e.includes('between 3 and 63 characters'))).toBe(true);
    });

    it('should reject bucket name too long', () => {
      const longName = 'a'.repeat(MAX_S3_BUCKET_NAME_LENGTH + 1);
      const errors = validateS3BucketName(longName);
      expect(errors.some((e) => e.includes('between 3 and 63 characters'))).toBe(true);
    });

    it('should reject bucket name with uppercase', () => {
      const errors = validateS3BucketName('MyBucket');
      expect(errors.some((e) => e.includes('lowercase letters'))).toBe(true);
    });

    it('should reject bucket name starting with dash', () => {
      const errors = validateS3BucketName('-mybucket');
      expect(errors.some((e) => e.includes('lowercase letters'))).toBe(true);
    });

    it('should reject bucket name ending with dash', () => {
      const errors = validateS3BucketName('mybucket-');
      expect(errors.some((e) => e.includes('lowercase letters'))).toBe(true);
    });

    it('should reject bucket name with consecutive periods', () => {
      const errors = validateS3BucketName('my..bucket');
      expect(errors.some((e) => e.includes('consecutive periods'))).toBe(true);
    });

    it('should reject bucket name formatted as IP address', () => {
      const errors = validateS3BucketName('192.168.1.1');
      expect(errors.some((e) => e.includes('IP address'))).toBe(true);
    });
  });

  describe('validateS3Region', () => {
    describe('AWS S3', () => {
      it('should accept valid AWS regions for s3 backend', () => {
        const validRegions = ['us-east-1', 'eu-west-1', 'ap-southeast-1', 'ca-central-1'];
        validRegions.forEach((region) => {
          expect(validateS3Region(region, 's3', undefined)).toEqual([]);
        });
      });

      it('should accept custom region format for S3-compatible services with endpoint', () => {
        // Backblaze B2 region format - requires endpoint to be recognized as S3-compatible
        expect(
          validateS3Region('eu-central-003', 's3', 'https://s3.eu-central-003.backblazeb2.com')
        ).toEqual([]);
        expect(
          validateS3Region('us-west-001', 's3', 'https://s3.us-west-001.backblazeb2.com')
        ).toEqual([]);
        expect(
          validateS3Region('us-east-005', 's3', 'https://s3.us-east-005.backblazeb2.com')
        ).toEqual([]);
      });

      it('should reject invalid region format for AWS S3', () => {
        const errors = validateS3Region('invalid_region', 's3', undefined);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain('valid AWS region');
      });

      it('should reject malformed regions for AWS S3', () => {
        const errors = validateS3Region('UPPERCASE-REGION', 's3', undefined);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('MinIO', () => {
      it('should accept any region for S3-compatible services with endpoint', () => {
        expect(validateS3Region('custom-region', 's3', 'http://localhost:9000')).toEqual([]);
        expect(validateS3Region('us-east-1', 's3', 'http://localhost:9000')).toEqual([]);
        expect(validateS3Region('local', 's3', 'http://localhost:9000')).toEqual([]);
        expect(validateS3Region('minio-region-1', 's3', 'http://localhost:9000')).toEqual([]);
      });
    });

    describe('Cloudflare R2', () => {
      it('should accept R2 region formats with endpoint', () => {
        const r2Endpoint = 'https://1234567890abcdef.r2.cloudflarestorage.com';
        expect(validateS3Region('auto', 's3', r2Endpoint)).toEqual([]);
        expect(validateS3Region('wnam', 's3', r2Endpoint)).toEqual([]); // Western North America
        expect(validateS3Region('enam', 's3', r2Endpoint)).toEqual([]); // Eastern North America
        expect(validateS3Region('weur', 's3', r2Endpoint)).toEqual([]); // Western Europe
        expect(validateS3Region('eeur', 's3', r2Endpoint)).toEqual([]); // Eastern Europe
        expect(validateS3Region('apac', 's3', r2Endpoint)).toEqual([]); // Asia-Pacific
      });
    });

    describe('Backblaze B2', () => {
      it('should accept Backblaze B2 region formats with endpoint', () => {
        // US regions
        expect(
          validateS3Region('us-west-001', 's3', 'https://s3.us-west-001.backblazeb2.com')
        ).toEqual([]);
        expect(
          validateS3Region('us-west-002', 's3', 'https://s3.us-west-002.backblazeb2.com')
        ).toEqual([]);
        expect(
          validateS3Region('us-west-004', 's3', 'https://s3.us-west-004.backblazeb2.com')
        ).toEqual([]);

        // EU regions
        expect(
          validateS3Region('eu-central-003', 's3', 'https://s3.eu-central-003.backblazeb2.com')
        ).toEqual([]);
        expect(
          validateS3Region('eu-central-005', 's3', 'https://s3.eu-central-005.backblazeb2.com')
        ).toEqual([]);
      });
    });
  });

  describe('validateS3Endpoint', () => {
    it('should accept valid HTTPS endpoints in production', () => {
      const validEndpoints = [
        'https://s3.example.com',
        'https://minio.example.com:9000',
        'https://storage.cloudflare.com',
      ];

      validEndpoints.forEach((endpoint) => {
        expect(validateS3Endpoint(endpoint, 's3', 'production')).toEqual([]);
      });
    });

    it('should accept HTTP endpoints in development', () => {
      const errors = validateS3Endpoint('http://localhost:9000', 'minio', 'development');
      expect(errors).toEqual([]);
    });

    it('should require endpoint for minio backend', () => {
      const errors = validateS3Endpoint(undefined, 'minio', 'production');
      expect(errors).toContain('S3_ENDPOINT is required for minio storage');
    });

    it('should require endpoint for r2 backend', () => {
      const errors = validateS3Endpoint(undefined, 'r2', 'production');
      expect(errors).toContain('S3_ENDPOINT is required for r2 storage');
    });

    it('should allow missing endpoint for s3 backend', () => {
      expect(validateS3Endpoint(undefined, 's3', 'production')).toEqual([]);
    });

    it('should reject invalid URL format', () => {
      const errors = validateS3Endpoint('not-a-url', 's3', 'production');
      expect(errors.some((e) => e.includes('must be a valid URL'))).toBe(true);
    });

    it('should reject non-HTTP protocol', () => {
      const errors = validateS3Endpoint('ftp://example.com', 's3', 'production');
      expect(errors.some((e) => e.includes('http:// or https://'))).toBe(true);
    });

    it('should reject HTTP in production', () => {
      const errors = validateS3Endpoint('http://example.com', 's3', 'production');
      expect(errors.some((e) => e.includes('must use https:// in production'))).toBe(true);
    });

    it('should reject localhost in production', () => {
      const localhostUrls = [
        'https://localhost:9000',
        'https://app.localhost',
        'https://test.local',
      ];

      localhostUrls.forEach((url) => {
        const errors = validateS3Endpoint(url, 'minio', 'production');
        expect(errors.some((e) => e.includes('localhost'))).toBe(true);
      });
    });

    it('should reject loopback addresses in production', () => {
      const loopbackUrls = ['https://127.0.0.1:9000', 'https://127.1.2.3', 'https://[::1]'];

      loopbackUrls.forEach((url) => {
        const errors = validateS3Endpoint(url, 'minio', 'production');
        expect(errors.some((e) => e.includes('loopback'))).toBe(true);
      });
    });

    it('should reject private IPv4 addresses in production', () => {
      const privateUrls = [
        'https://10.0.0.1',
        'https://172.16.0.1',
        'https://192.168.1.1',
        'https://169.254.1.1',
      ];

      privateUrls.forEach((url) => {
        const errors = validateS3Endpoint(url, 'minio', 'production');
        expect(errors.some((e) => e.includes('private IP'))).toBe(true);
      });
    });

    it('should accept public IPs in production', () => {
      const publicUrls = ['https://8.8.8.8', 'https://1.1.1.1'];

      publicUrls.forEach((url) => {
        expect(validateS3Endpoint(url, 'minio', 'production')).toEqual([]);
      });
    });

    it('should accept localhost in development', () => {
      const localhostUrls = ['http://localhost:9000', 'http://127.0.0.1:9000'];

      localhostUrls.forEach((url) => {
        expect(validateS3Endpoint(url, 'minio', 'development')).toEqual([]);
      });
    });
  });

  describe('validateS3ForcePathStyle', () => {
    describe('AWS S3', () => {
      it('should warn about deprecated forcePathStyle for AWS S3 without endpoint', () => {
        const errors = validateS3ForcePathStyle(true, 's3', undefined);
        expect(errors).toContain(
          'S3_FORCE_PATH_STYLE is deprecated for AWS S3 and should not be used'
        );
      });

      it('should allow forcePathStyle for AWS S3 with custom endpoint (S3-compatible)', () => {
        // When using S3 backend with custom endpoint (e.g., Backblaze B2)
        const errors = validateS3ForcePathStyle(
          true,
          's3',
          'https://s3.eu-central-003.backblazeb2.com'
        );
        expect(errors).toEqual([]);
      });

      it('should accept false for AWS S3', () => {
        expect(validateS3ForcePathStyle(false, 's3', undefined)).toEqual([]);
      });
    });

    describe('MinIO', () => {
      it('should accept forcePathStyle for MinIO (required)', () => {
        expect(validateS3ForcePathStyle(true, 'minio', 'http://minio:9000')).toEqual([]);
      });

      it('should accept false for MinIO', () => {
        expect(validateS3ForcePathStyle(false, 'minio', 'http://minio:9000')).toEqual([]);
      });
    });

    describe('Cloudflare R2', () => {
      it('should accept forcePathStyle for R2', () => {
        expect(validateS3ForcePathStyle(true, 'r2', 'https://r2.cloudflarestorage.com')).toEqual(
          []
        );
      });

      it('should accept false for R2', () => {
        expect(validateS3ForcePathStyle(false, 'r2', 'https://r2.cloudflarestorage.com')).toEqual(
          []
        );
      });
    });

    describe('Backblaze B2', () => {
      it('should allow forcePathStyle for Backblaze B2 (uses s3 backend)', () => {
        const errors = validateS3ForcePathStyle(
          true,
          's3',
          'https://s3.eu-central-003.backblazeb2.com'
        );
        expect(errors).toEqual([]);
      });

      it('should allow forcePathStyle=false for Backblaze B2', () => {
        const errors = validateS3ForcePathStyle(
          false,
          's3',
          'https://s3.us-west-001.backblazeb2.com'
        );
        expect(errors).toEqual([]);
      });
    });
  });

  describe('validateLocalStorageConfig', () => {
    it('should accept valid local storage configuration', () => {
      const errors = validateLocalStorageConfig('./data/uploads', 'http://localhost:3000/uploads');
      expect(errors).toEqual([]);
    });

    it('should reject missing base directory', () => {
      const errors = validateLocalStorageConfig('', 'http://localhost:3000/uploads');
      expect(errors).toContain('STORAGE_BASE_DIR is required for local storage');
    });

    it('should reject missing base URL', () => {
      const errors = validateLocalStorageConfig('./data/uploads', '');
      expect(errors).toContain('STORAGE_BASE_URL is required for local storage');
    });

    it('should reject both missing', () => {
      const errors = validateLocalStorageConfig('', '');
      expect(errors).toHaveLength(2);
      expect(errors).toContain('STORAGE_BASE_DIR is required for local storage');
      expect(errors).toContain('STORAGE_BASE_URL is required for local storage');
    });
  });

  describe('S3-Compatible Service Integration Tests', () => {
    describe('AWS S3 Production', () => {
      it('should validate complete AWS S3 production configuration', () => {
        const validKey = 'a'.repeat(MIN_S3_ACCESS_KEY_LENGTH);
        const validSecret = 'a'.repeat(MIN_S3_SECRET_KEY_LENGTH);

        const credErrors = validateS3Credentials(validKey, validSecret, 's3', undefined);
        const bucketErrors = validateS3BucketName('my-production-bucket');
        const regionErrors = validateS3Region('us-east-1', 's3', undefined);
        const endpointErrors = validateS3Endpoint(undefined, 's3', 'production');
        const styleErrors = validateS3ForcePathStyle(false, 's3', undefined);

        expect(credErrors).toEqual([]);
        expect(bucketErrors).toEqual([]);
        expect(regionErrors).toEqual([]);
        expect(endpointErrors).toEqual([]);
        expect(styleErrors).toEqual([]);
      });
    });

    describe('MinIO Development', () => {
      it('should validate complete MinIO development configuration', () => {
        const validKey = 'minioadmin123456'; // 16 chars
        const validSecret = 'minioadmin123456'; // 16 chars

        const credErrors = validateS3Credentials(
          validKey,
          validSecret,
          's3',
          'http://localhost:9000'
        );
        const bucketErrors = validateS3BucketName('minio-dev-bucket');
        const regionErrors = validateS3Region('us-east-1', 's3', 'http://localhost:9000');
        const endpointErrors = validateS3Endpoint('http://localhost:9000', 's3', 'development');
        const styleErrors = validateS3ForcePathStyle(true, 's3', 'http://localhost:9000');

        expect(credErrors).toEqual([]);
        expect(bucketErrors).toEqual([]);
        expect(regionErrors).toEqual([]);
        expect(endpointErrors).toEqual([]);
        expect(styleErrors).toEqual([]);
      });
    });

    describe('Cloudflare R2 Production', () => {
      it('should validate complete Cloudflare R2 production configuration', () => {
        const r2AccessKey = 'a'.repeat(32); // R2 access keys are 32 chars
        const r2SecretKey = 'a'.repeat(64); // R2 secret keys are 64 chars

        const credErrors = validateS3Credentials(
          r2AccessKey,
          r2SecretKey,
          's3',
          'https://1234567890abcdef.r2.cloudflarestorage.com'
        );
        const bucketErrors = validateS3BucketName('my-r2-bucket');
        const regionErrors = validateS3Region(
          'auto',
          's3',
          'https://1234567890abcdef.r2.cloudflarestorage.com'
        );
        const endpointErrors = validateS3Endpoint(
          'https://1234567890abcdef.r2.cloudflarestorage.com',
          's3',
          'production'
        );
        const styleErrors = validateS3ForcePathStyle(
          true,
          's3',
          'https://1234567890abcdef.r2.cloudflarestorage.com'
        );

        expect(credErrors).toEqual([]);
        expect(bucketErrors).toEqual([]);
        expect(regionErrors).toEqual([]);
        expect(endpointErrors).toEqual([]);
        expect(styleErrors).toEqual([]);
      });
    });

    describe('Backblaze B2 Production', () => {
      it('should validate complete Backblaze B2 production configuration', () => {
        const b2KeyId = '0'.repeat(25); // B2 key IDs are 25 chars
        const b2AppKey = 'K'.repeat(31); // B2 app keys are 31 chars

        const credErrors = validateS3Credentials(
          b2KeyId,
          b2AppKey,
          's3',
          'https://s3.eu-central-003.backblazeb2.com'
        ); // B2 is S3-compatible
        const bucketErrors = validateS3BucketName('my-b2-bucket');
        const regionErrors = validateS3Region(
          'eu-central-003',
          's3',
          'https://s3.eu-central-003.backblazeb2.com'
        ); // B2 uses custom regions
        const endpointErrors = validateS3Endpoint(
          'https://s3.eu-central-003.backblazeb2.com',
          's3',
          'production'
        );
        const styleErrors = validateS3ForcePathStyle(
          true,
          's3',
          'https://s3.eu-central-003.backblazeb2.com'
        );

        expect(credErrors).toEqual([]);
        expect(bucketErrors).toEqual([]);
        expect(regionErrors).toEqual([]);
        expect(endpointErrors).toEqual([]);
        expect(styleErrors).toEqual([]);
      });

      it('should validate Backblaze B2 US region', () => {
        const b2KeyId = '0'.repeat(25);
        const b2AppKey = 'K'.repeat(31);

        const credErrors = validateS3Credentials(
          b2KeyId,
          b2AppKey,
          's3',
          'https://s3.us-west-004.backblazeb2.com'
        ); // B2 is S3-compatible
        const bucketErrors = validateS3BucketName('my-us-bucket');
        const regionErrors = validateS3Region(
          'us-west-004',
          's3',
          'https://s3.us-west-004.backblazeb2.com'
        ); // B2 uses custom regions
        const endpointErrors = validateS3Endpoint(
          'https://s3.us-west-004.backblazeb2.com',
          's3',
          'production'
        );

        expect(credErrors).toEqual([]);
        expect(bucketErrors).toEqual([]);
        expect(regionErrors).toEqual([]);
        expect(endpointErrors).toEqual([]);
      });
    });

    describe('Error accumulation', () => {
      it('should accumulate multiple validation errors', () => {
        const credErrors = validateS3Credentials('short', 'short', 's3', undefined);
        const bucketErrors = validateS3BucketName('AB');
        const regionErrors = validateS3Region('invalid', 's3', undefined);
        const endpointErrors = validateS3Endpoint('http://localhost:9000', 's3', 'production');

        const allErrors = [...credErrors, ...bucketErrors, ...regionErrors, ...endpointErrors];
        expect(allErrors.length).toBeGreaterThan(5);
      });
    });
  });

  describe('parseBooleanEnv', () => {
    it('should return true for "true" string', () => {
      expect(parseBooleanEnv('true')).toBe(true);
    });

    it('should return false for "false" string', () => {
      expect(parseBooleanEnv('false')).toBe(false);
    });

    it('should return undefined for undefined', () => {
      expect(parseBooleanEnv(undefined)).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(parseBooleanEnv('')).toBeUndefined();
    });

    it('should return undefined for other values', () => {
      expect(parseBooleanEnv('1')).toBeUndefined();
      expect(parseBooleanEnv('0')).toBeUndefined();
      expect(parseBooleanEnv('yes')).toBeUndefined();
      expect(parseBooleanEnv('no')).toBeUndefined();
      expect(parseBooleanEnv('TRUE')).toBeUndefined();
      expect(parseBooleanEnv('FALSE')).toBeUndefined();
      expect(parseBooleanEnv('True')).toBeUndefined();
      expect(parseBooleanEnv('False')).toBeUndefined();
    });

    it('should work with nullish coalescing for defaults', () => {
      expect(parseBooleanEnv('true') ?? false).toBe(true);
      expect(parseBooleanEnv('false') ?? true).toBe(false);
      expect(parseBooleanEnv(undefined) ?? true).toBe(true);
      expect(parseBooleanEnv('invalid') ?? false).toBe(false);
      expect(parseBooleanEnv('') ?? true).toBe(true);
    });

    it('should work with three-way logic pattern', () => {
      // Simulate S3_DISABLE_CHECKSUMS behavior
      const mockDetectionFn = (endpoint?: string) => endpoint?.includes('b2') ?? false;

      // Explicit true
      expect(parseBooleanEnv('true') ?? mockDetectionFn('s3.amazonaws.com')).toBe(true);

      // Explicit false
      expect(parseBooleanEnv('false') ?? mockDetectionFn('backblazeb2.com')).toBe(false);

      // Auto-detect (undefined falls through to function)
      expect(parseBooleanEnv(undefined) ?? mockDetectionFn('backblazeb2.com')).toBe(true);
      expect(parseBooleanEnv(undefined) ?? mockDetectionFn('s3.amazonaws.com')).toBe(false);
    });
  });

  describe('Throw-based validators', () => {
    describe('assertNonNegative', () => {
      it('should accept non-negative values', () => {
        expect(() => assertNonNegative(0, 'test')).not.toThrow();
        expect(() => assertNonNegative(1, 'test')).not.toThrow();
        expect(() => assertNonNegative(100, 'test')).not.toThrow();
      });

      it('should throw for negative values', () => {
        expect(() => assertNonNegative(-1, 'test')).toThrow('test must be >= 0 (got -1)');
        expect(() => assertNonNegative(-100, 'test')).toThrow('test must be >= 0 (got -100)');
      });
    });

    describe('assertPositive', () => {
      it('should accept positive values', () => {
        expect(() => assertPositive(1, 'test')).not.toThrow();
        expect(() => assertPositive(0.1, 'test')).not.toThrow();
        expect(() => assertPositive(100, 'test')).not.toThrow();
      });

      it('should throw for zero', () => {
        expect(() => assertPositive(0, 'test')).toThrow('test must be > 0 (got 0)');
      });

      it('should throw for negative values', () => {
        expect(() => assertPositive(-1, 'test')).toThrow('test must be > 0 (got -1)');
        expect(() => assertPositive(-100, 'test')).toThrow('test must be > 0 (got -100)');
      });
    });

    describe('assertRange', () => {
      it('should accept values within range', () => {
        expect(() => assertRange(5, 'test', 1, 10)).not.toThrow();
        expect(() => assertRange(1, 'test', 1, 10)).not.toThrow();
        expect(() => assertRange(10, 'test', 1, 10)).not.toThrow();
      });

      it('should throw for values below range', () => {
        expect(() => assertRange(0, 'test', 1, 10)).toThrow(
          'test must be between 1 and 10 (got 0)'
        );
      });

      it('should throw for values above range', () => {
        expect(() => assertRange(11, 'test', 1, 10)).toThrow(
          'test must be between 1 and 10 (got 11)'
        );
      });
    });

    describe('assertMinimum', () => {
      it('should accept values meeting minimum', () => {
        expect(() => assertMinimum(5, 'test', 5)).not.toThrow();
        expect(() => assertMinimum(10, 'test', 5)).not.toThrow();
        expect(() => assertMinimum(100, 'test', 5)).not.toThrow();
      });

      it('should throw for values below minimum', () => {
        expect(() => assertMinimum(4, 'test', 5)).toThrow('test must be >= 5 (got 4)');
        expect(() => assertMinimum(0, 'test', 5)).toThrow('test must be >= 5 (got 0)');
      });
    });
  });
});
