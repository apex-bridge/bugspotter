/**
 * S3ParamsBuilder Tests
 * Unit tests for S3 command parameter building
 */

import { describe, it, expect } from 'vitest';
import { S3ParamsBuilder } from '../../src/storage/s3-params.builder.js';
import type { S3Config } from '../../src/storage/types.js';

describe('S3ParamsBuilder', () => {
  describe('buildObjectParams', () => {
    it('should return empty object for minimal config', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'test-bucket',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3ParamsBuilder(config);
      const params = builder.buildObjectParams();

      expect(params).toEqual({});
    });

    it('should include server-side encryption with AES256', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'test-bucket',
        serverSideEncryption: 'AES256',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3ParamsBuilder(config);
      const params = builder.buildObjectParams();

      expect(params.ServerSideEncryption).toBe('AES256');
      expect(params.SSEKMSKeyId).toBeUndefined();
    });

    it('should include server-side encryption with aws:kms', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'test-bucket',
        serverSideEncryption: 'aws:kms',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3ParamsBuilder(config);
      const params = builder.buildObjectParams();

      expect(params.ServerSideEncryption).toBe('aws:kms');
      expect(params.SSEKMSKeyId).toBeUndefined();
    });

    it('should include KMS key ID when provided', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'test-bucket',
        serverSideEncryption: 'aws:kms',
        sseKmsKeyId: 'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3ParamsBuilder(config);
      const params = builder.buildObjectParams();

      expect(params.ServerSideEncryption).toBe('aws:kms');
      expect(params.SSEKMSKeyId).toBe(
        'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012'
      );
    });

    it('should not include KMS key ID without KMS encryption', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'test-bucket',
        serverSideEncryption: 'AES256',
        sseKmsKeyId: 'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3ParamsBuilder(config);
      const params = builder.buildObjectParams();

      expect(params.ServerSideEncryption).toBe('AES256');
      expect(params.SSEKMSKeyId).toBeUndefined();
    });

    it('should include storage class STANDARD', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'test-bucket',
        storageClass: 'STANDARD',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3ParamsBuilder(config);
      const params = builder.buildObjectParams();

      expect(params.StorageClass).toBe('STANDARD');
    });

    it('should include storage class STANDARD_IA', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'test-bucket',
        storageClass: 'STANDARD_IA',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3ParamsBuilder(config);
      const params = builder.buildObjectParams();

      expect(params.StorageClass).toBe('STANDARD_IA');
    });

    it('should include storage class INTELLIGENT_TIERING', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'test-bucket',
        storageClass: 'INTELLIGENT_TIERING',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3ParamsBuilder(config);
      const params = builder.buildObjectParams();

      expect(params.StorageClass).toBe('INTELLIGENT_TIERING');
    });

    it('should include storage class GLACIER', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'test-bucket',
        storageClass: 'GLACIER',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3ParamsBuilder(config);
      const params = builder.buildObjectParams();

      expect(params.StorageClass).toBe('GLACIER');
    });

    it('should include both encryption and storage class', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'test-bucket',
        serverSideEncryption: 'AES256',
        storageClass: 'STANDARD_IA',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3ParamsBuilder(config);
      const params = builder.buildObjectParams();

      expect(params.ServerSideEncryption).toBe('AES256');
      expect(params.StorageClass).toBe('STANDARD_IA');
    });

    it('should include all params with KMS encryption and storage class', () => {
      const config: S3Config = {
        region: 'us-east-1',
        bucket: 'test-bucket',
        serverSideEncryption: 'aws:kms',
        sseKmsKeyId: 'arn:aws:kms:us-east-1:123456789012:key/test',
        storageClass: 'INTELLIGENT_TIERING',
        forcePathStyle: false,
        maxRetries: 3,
        timeout: 30000,
      };

      const builder = new S3ParamsBuilder(config);
      const params = builder.buildObjectParams();

      expect(params.ServerSideEncryption).toBe('aws:kms');
      expect(params.SSEKMSKeyId).toBe('arn:aws:kms:us-east-1:123456789012:key/test');
      expect(params.StorageClass).toBe('INTELLIGENT_TIERING');
    });
  });
});
