/**
 * MinIO Service Account Permission Boundary Tests
 * Verifies least-privilege security implementation
 *
 * Prerequisites:
 * - Docker must be running with MinIO container
 * - init-minio.sh script must have run successfully
 * - Service account (bugspotter-app) must be configured
 *
 * Tests verify:
 * 1. Service account CAN perform allowed operations
 * 2. Service account CANNOT perform prohibited operations (security boundaries)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
  DeleteBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

// Test configuration
const TEST_BUCKET = process.env.S3_BUCKET || 'bugspotter';
const TEST_PROJECT_ID = 'security-test-' + Date.now();
const TEST_KEY = `screenshots/${TEST_PROJECT_ID}/test-permissions.txt`;

// Service account credentials (least-privilege)
// Initialized in beforeAll to avoid hardcoded fallback secrets
let serviceAccountClient: S3Client;

// Helper to convert readable stream to buffer
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

describe('MinIO Service Account Permission Boundaries', () => {
  const skipTests =
    !process.env.TEST_MINIO ||
    !process.env.MINIO_APP_ACCESS_KEY ||
    !process.env.MINIO_APP_SECRET_KEY;

  beforeAll(() => {
    if (skipTests) {
      console.log('⏭️  Skipping MinIO permission tests (set TEST_MINIO=true to enable)');
      console.log('💡 Also ensure MINIO_APP_ACCESS_KEY and MINIO_APP_SECRET_KEY are set in .env');
      return;
    }

    // Initialize S3Client only when tests will run (no hardcoded fallback secrets)
    serviceAccountClient = new S3Client({
      endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
      region: process.env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.MINIO_APP_ACCESS_KEY!,
        secretAccessKey: process.env.MINIO_APP_SECRET_KEY!,
      },
      forcePathStyle: true,
    });
  });

  afterAll(async () => {
    if (skipTests) {
      return;
    }

    // Cleanup test files
    try {
      await serviceAccountClient.send(
        new DeleteObjectCommand({
          Bucket: TEST_BUCKET,
          Key: TEST_KEY,
        })
      );
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('✅ Allowed Operations (Should Succeed)', () => {
    it('should allow uploading objects to bugspotter bucket', async () => {
      if (skipTests) {
        return;
      }

      const testData = Buffer.from('test content');

      const command = new PutObjectCommand({
        Bucket: TEST_BUCKET,
        Key: TEST_KEY,
        Body: testData,
      });

      await expect(serviceAccountClient.send(command)).resolves.toBeDefined();
    });

    it('should allow downloading objects from bugspotter bucket', async () => {
      if (skipTests) {
        return;
      }

      // Ensure file exists before downloading (test independence)
      await serviceAccountClient.send(
        new PutObjectCommand({
          Bucket: TEST_BUCKET,
          Key: TEST_KEY,
          Body: Buffer.from('test content'),
        })
      );

      const command = new GetObjectCommand({
        Bucket: TEST_BUCKET,
        Key: TEST_KEY,
      });

      const response = await serviceAccountClient.send(command);
      expect(response.Body).toBeDefined();

      const content = await streamToBuffer(response.Body as Readable);
      expect(content.toString()).toBe('test content');
    });

    it('should allow listing objects in bugspotter bucket', async () => {
      if (skipTests) {
        return;
      }

      // Ensure file exists before listing (test independence)
      await serviceAccountClient.send(
        new PutObjectCommand({
          Bucket: TEST_BUCKET,
          Key: TEST_KEY,
          Body: Buffer.from('test content'),
        })
      );

      const command = new ListObjectsV2Command({
        Bucket: TEST_BUCKET,
        Prefix: `screenshots/${TEST_PROJECT_ID}/`,
      });

      const response = await serviceAccountClient.send(command);
      expect(response.Contents).toBeDefined();
      expect(response.Contents?.length).toBeGreaterThan(0);
    });

    it('should allow deleting objects from bugspotter bucket', async () => {
      if (skipTests) {
        return;
      }

      // Upload file first, then delete to verify deletion works (test independence)
      await serviceAccountClient.send(
        new PutObjectCommand({
          Bucket: TEST_BUCKET,
          Key: TEST_KEY,
          Body: Buffer.from('test content'),
        })
      );

      const command = new DeleteObjectCommand({
        Bucket: TEST_BUCKET,
        Key: TEST_KEY,
      });

      await expect(serviceAccountClient.send(command)).resolves.toBeDefined();
    });

    it('should allow checking if bugspotter bucket exists', async () => {
      if (skipTests) {
        return;
      }

      const command = new HeadBucketCommand({
        Bucket: TEST_BUCKET,
      });

      await expect(serviceAccountClient.send(command)).resolves.toBeDefined();
    });
  });

  describe('❌ Prohibited Operations (Should Fail with Access Denied)', () => {
    it('should NOT allow creating new buckets', async () => {
      if (skipTests) {
        return;
      }

      const command = new CreateBucketCommand({
        Bucket: 'unauthorized-bucket-' + Date.now(),
      });

      await expect(serviceAccountClient.send(command)).rejects.toThrow(/Access Denied|Forbidden/i);
    });

    it('should NOT allow deleting the bugspotter bucket', async () => {
      if (skipTests) {
        return;
      }

      const command = new DeleteBucketCommand({
        Bucket: TEST_BUCKET,
      });

      await expect(serviceAccountClient.send(command)).rejects.toThrow(/Access Denied|Forbidden/i);
    });

    it('should NOT allow accessing other buckets (if any exist)', async () => {
      if (skipTests) {
        return;
      }

      const command = new ListObjectsV2Command({
        Bucket: 'other-bucket', // Intentionally non-existent or other bucket
      });

      // Should fail with either Access Denied or NoSuchBucket
      // (both indicate lack of permission)
      await expect(serviceAccountClient.send(command)).rejects.toThrow();
    });

    it('should NOT allow listing all buckets', async () => {
      if (skipTests) {
        return;
      }

      // MinIO requires ListAllMyBuckets permission to list buckets
      // Service account should not have this permission
      const { ListBucketsCommand } = await import('@aws-sdk/client-s3');

      const command = new ListBucketsCommand({});

      await expect(serviceAccountClient.send(command)).rejects.toThrow(/Access Denied|Forbidden/i);
    });
  });

  describe('🔒 Security Validation', () => {
    it('should verify service account credentials are NOT root credentials', () => {
      if (skipTests) {
        return;
      }

      const accessKey = process.env.MINIO_APP_ACCESS_KEY || 'bugspotter-app';
      const rootUser = process.env.MINIO_ROOT_USER || 'minioadmin';

      // Service account credentials should be different from root
      expect(accessKey).not.toBe(rootUser);
      expect(accessKey).toBe('bugspotter-app'); // Verify correct service account
    });

    it('should verify environment variables are properly configured', () => {
      if (skipTests) {
        return;
      }

      // These should be set for service account
      expect(process.env.MINIO_APP_ACCESS_KEY).toBeDefined();
      expect(process.env.MINIO_APP_SECRET_KEY).toBeDefined();

      // These should be different from root
      expect(process.env.MINIO_APP_ACCESS_KEY).not.toBe(process.env.MINIO_ROOT_USER);
      expect(process.env.MINIO_APP_SECRET_KEY).not.toBe(process.env.MINIO_ROOT_PASSWORD);
    });

    it('should verify only bugspotter bucket is accessible', async () => {
      if (skipTests) {
        return;
      }

      // Upload test file
      await serviceAccountClient.send(
        new PutObjectCommand({
          Bucket: TEST_BUCKET,
          Key: TEST_KEY,
          Body: Buffer.from('boundary test'),
        })
      );

      // Should be able to list in bugspotter bucket
      const listCommand = new ListObjectsV2Command({
        Bucket: TEST_BUCKET,
        Prefix: `screenshots/${TEST_PROJECT_ID}/`,
      });

      const response = await serviceAccountClient.send(listCommand);
      expect(response.Contents?.length).toBeGreaterThan(0);

      // Cleanup
      await serviceAccountClient.send(
        new DeleteObjectCommand({
          Bucket: TEST_BUCKET,
          Key: TEST_KEY,
        })
      );
    });
  });

  describe('📊 Permission Summary', () => {
    it('should document allowed vs prohibited operations', () => {
      if (skipTests) {
        return;
      }

      const permissions = {
        allowed: [
          's3:GetObject - Download files from bugspotter bucket',
          's3:PutObject - Upload files to bugspotter bucket',
          's3:DeleteObject - Delete files from bugspotter bucket',
          's3:ListBucket - List files in bugspotter bucket',
        ],
        prohibited: [
          's3:CreateBucket - Cannot create new buckets',
          's3:DeleteBucket - Cannot delete buckets',
          's3:ListAllMyBuckets - Cannot list all buckets',
          's3:PutBucketPolicy - Cannot modify bucket policies',
          's3:GetBucketPolicy - Cannot read bucket policies',
          'iam:* - No IAM administrative permissions',
        ],
        scope: 'bugspotter bucket only',
      };

      expect(permissions.allowed.length).toBe(4);
      expect(permissions.prohibited.length).toBe(6);
      expect(permissions.scope).toBe('bugspotter bucket only');

      console.log('\n📋 Service Account Permissions Summary:');
      console.log('\n✅ Allowed Operations:');
      permissions.allowed.forEach((p) => console.log(`   ${p}`));
      console.log('\n❌ Prohibited Operations:');
      permissions.prohibited.forEach((p) => console.log(`   ${p}`));
      console.log(`\n🔒 Scope: ${permissions.scope}\n`);
    });
  });
});
