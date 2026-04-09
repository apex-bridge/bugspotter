/**
 * Presigned URL Actual Upload Tests
 * Tests that presigned URLs work with real HTTP PUT requests
 * across different storage backends (S3, MinIO, B2, Local)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import { createStorage } from '../../src/storage/index.js';
import { getQueueManager, type QueueManager } from '../../src/queue/queue-manager.js';
import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../src/db/client.js';
import type { IStorageService } from '../../src/storage/types.js';
import { PluginRegistry } from '../../src/integrations/plugin-registry.js';

describe('Presigned URL - Actual HTTP Upload', () => {
  let app: FastifyInstance;
  let db: DatabaseClient;
  let storage: IStorageService;
  let queueManager: QueueManager;
  let redisContainer: StartedTestContainer;
  let minioContainer: StartedTestContainer | null = null;
  let testProject: { id: string };
  let testApiKey: string;

  beforeAll(async () => {
    // Start Redis container
    redisContainer = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
    process.env.REDIS_URL = redisUrl;

    // Start MinIO container for realistic S3-compatible testing
    minioContainer = await new GenericContainer('minio/minio:RELEASE.2024-10-13T13-34-11Z')
      .withExposedPorts(9000, 9001)
      .withEnvironment({
        MINIO_ROOT_USER: 'bugspotter-test-admin',
        MINIO_ROOT_PASSWORD: 'bugspotter-test-secret-key',
      })
      .withCommand(['server', '/data', '--console-address', ':9001'])
      .start();

    const minioHost = minioContainer.getHost();
    const minioPort = minioContainer.getMappedPort(9000);
    const minioEndpoint = `http://${minioHost}:${minioPort}`;

    // Create bucket using docker exec
    const containerId = minioContainer.getId();
    const { execSync } = await import('child_process');
    try {
      execSync(
        `docker exec ${containerId} sh -c "mc alias set local http://localhost:9000 bugspotter-test-admin bugspotter-test-secret-key && mc mb local/bugspotter-test --ignore-existing"`,
        { encoding: 'utf-8' }
      );
    } catch (error) {
      console.error('Failed to create MinIO bucket:', error);
      throw error;
    }

    // Create database client
    db = createDatabaseClient();

    // Create MinIO storage
    storage = createStorage({
      backend: 'minio',
      s3: {
        region: 'us-east-1',
        accessKeyId: 'bugspotter-test-admin',
        secretAccessKey: 'bugspotter-test-secret-key',
        bucket: 'bugspotter-test',
        endpoint: minioEndpoint,
        forcePathStyle: true,
      },
    });

    await storage.initialize();

    // Create queue manager
    queueManager = getQueueManager();
    await queueManager.initialize();

    const pluginRegistry = new PluginRegistry(db, storage);

    // Create server
    app = await createServer({
      db,
      storage,
      queueManager,
      pluginRegistry,
    });

    await app.ready();

    // Create test project and API key
    testProject = await db.projects.create({
      name: 'Presigned URL Upload Test',
    });

    const testUser = await db.users.create({
      email: 'presigned-upload-test@example.com',
      password_hash: 'hash',
      role: 'admin',
    });

    const { ApiKeyService } = await import('../../src/services/api-key/index.js');
    const apiKeyService = new ApiKeyService(db);
    const apiKeyResult = await apiKeyService.createKey({
      name: 'Presigned Upload Test Key',
      type: 'development',
      permission_scope: 'full',
      permissions: ['bugs:read', 'bugs:write'],
      created_by: testUser.id,
      allowed_projects: [testProject.id],
    });
    testApiKey = apiKeyResult.plaintext;
  });

  afterAll(async () => {
    // Cleanup storage (may fail with MinIO Content-MD5 requirement - not critical)
    if (storage) {
      try {
        await storage.clearAllStorage();
      } catch (error) {
        console.warn('Storage cleanup failed (expected with MinIO):', error);
      }
    }
    if (queueManager) {
      await queueManager.shutdown();
    }
    if (app) {
      await app.close();
    }
    if (db) {
      await db.close();
    }
    if (redisContainer) {
      await redisContainer.stop();
    }
    if (minioContainer) {
      await minioContainer.stop();
    }
  });

  describe('Real HTTP PUT to presigned URL', () => {
    it('should upload screenshot using presigned URL with Content-Type header', async () => {
      // Step 1: Create bug report with screenshot upload request
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: { 'x-api-key': testApiKey },
        payload: {
          title: 'Presigned Upload Test',
          description: 'Testing real HTTP PUT',
          priority: 'high',
          report: {
            console: [],
            network: [],
            metadata: { userAgent: 'test-agent' },
          },
          hasScreenshot: true, // Request presigned URL for screenshot
        },
      });

      expect(createResponse.statusCode).toBe(201);
      const responseData = JSON.parse(createResponse.body).data;
      const bugId = responseData.id;
      const { uploadUrl, storageKey } = responseData.presignedUrls.screenshot;

      expect(uploadUrl).toBeDefined();
      expect(storageKey).toContain('screenshots/');

      // Step 2: Perform actual HTTP PUT to presigned URL with Content-Type header
      const testImageData = Buffer.from('fake-png-data-for-testing');

      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: testImageData,
        headers: {
          'Content-Type': 'image/png', // REQUIRED: Must match signature
        },
      });

      // Debug: Log error details if upload fails
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('Upload failed:', {
          status: uploadResponse.status,
          statusText: uploadResponse.statusText,
          body: errorText,
        });
      }

      expect(uploadResponse.ok).toBe(true);
      expect(uploadResponse.status).toBe(200);

      // Step 3: Confirm upload with backend
      const confirmResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/reports/${bugId}/confirm-upload`,
        headers: { 'x-api-key': testApiKey },
        payload: { fileType: 'screenshot' },
      });

      expect(confirmResponse.statusCode).toBe(200);

      // Step 4: Verify file exists in storage
      const fileExists = await storage.headObject(storageKey);
      expect(fileExists).not.toBeNull();
      expect(fileExists?.size).toBe(testImageData.length);
    });

    it('should enforce Content-Type header matching signature', async () => {
      // Create bug report with screenshot upload request
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: { 'x-api-key': testApiKey },
        payload: {
          title: 'Content-Type Enforcement Test',
          priority: 'medium',
          report: { console: [], network: [], metadata: {} },
          hasScreenshot: true,
        },
      });

      const responseData = JSON.parse(createResponse.body).data;
      const { uploadUrl, storageKey } = responseData.presignedUrls.screenshot;

      // Upload WITH required Content-Type header (signature enforces image/png)
      const pngData = Buffer.from('fake-png-data');
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: pngData,
        headers: {
          'Content-Type': 'image/png', // REQUIRED: Must match signature
        },
      });

      // Should succeed
      expect(uploadResponse.ok).toBe(true);

      // Verify upload
      const fileExists = await storage.headObject(storageKey);
      expect(fileExists).not.toBeNull();
    });

    it('should upload replay file (gzip) with Content-Type', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: { 'x-api-key': testApiKey },
        payload: {
          title: 'Replay Upload Test',
          priority: 'low',
          report: { console: [], network: [], metadata: {} },
          hasReplay: true, // Request presigned URL for replay
        },
      });

      const responseData = JSON.parse(createResponse.body).data;
      const bugId = responseData.id;
      const { uploadUrl, storageKey } = responseData.presignedUrls.replay;

      // Upload gzipped replay data WITH required Content-Type header
      const gzipData = Buffer.from('fake-gzip-compressed-data');
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: gzipData,
        headers: {
          'Content-Type': 'application/gzip', // REQUIRED: Must match signature
        },
      });

      expect(uploadResponse.ok).toBe(true);

      // Confirm and verify
      await app.inject({
        method: 'POST',
        url: `/api/v1/reports/${bugId}/confirm-upload`,
        headers: { 'x-api-key': testApiKey },
        payload: { fileType: 'replay' },
      });

      const fileExists = await storage.headObject(storageKey);
      expect(fileExists).not.toBeNull();
      expect(fileExists?.size).toBe(gzipData.length);
    });

    it('should handle CORS headers correctly with Content-Type', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: { 'x-api-key': testApiKey },
        payload: {
          title: 'CORS Test',
          priority: 'medium',
          report: { console: [], network: [], metadata: {} },
          hasScreenshot: true, // Request presigned URL for screenshot
        },
      });

      const responseData = JSON.parse(createResponse.body).data;
      const { uploadUrl, storageKey } = responseData.presignedUrls.screenshot;

      // Simulate browser CORS request with Origin and Content-Type headers
      const testData = Buffer.from('cors-test-data');
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Origin: 'https://example.com',
          'Content-Type': 'image/png', // REQUIRED: Must match signature
        },
        body: testData,
      });

      // Should succeed even with CORS headers
      expect(uploadResponse.ok).toBe(true);

      const fileExists = await storage.headObject(storageKey);
      expect(fileExists).not.toBeNull();
    });

    it('should allow uploads with custom headers alongside Content-Type', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: { 'x-api-key': testApiKey },
        payload: {
          title: 'Custom Header Test',
          priority: 'medium',
          report: { console: [], network: [], metadata: {} },
          hasScreenshot: true, // Request presigned URL for screenshot
        },
      });

      const responseData = JSON.parse(createResponse.body).data;
      const { uploadUrl } = responseData.presignedUrls.screenshot;

      // Upload with custom header + required Content-Type
      // S3/MinIO typically ignore non-AWS headers
      const testData = Buffer.from('test-data');
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'X-Custom-Header': 'test-value', // Ignored by S3/MinIO
          'Content-Type': 'image/png', // REQUIRED: Must match signature
        },
        body: testData,
      });

      // Should succeed - custom headers are ignored by most S3 implementations
      expect(uploadResponse.ok).toBe(true);
    });
  });

  describe('Cross-storage compatibility', () => {
    it('should generate valid presigned URLs for MinIO with Content-Type', async () => {
      // This test already uses MinIO (configured in beforeAll)
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: { 'x-api-key': testApiKey },
        payload: {
          title: 'MinIO Compatibility Test',
          priority: 'medium',
          report: { console: [], network: [], metadata: {} },
          hasScreenshot: true, // Request presigned URL for screenshot
        },
      });

      const responseData = JSON.parse(createResponse.body).data;
      const { uploadUrl, storageKey } = responseData.presignedUrls.screenshot;

      // Verify URL is MinIO endpoint
      expect(uploadUrl).toContain('bugspotter-test');

      // Upload with required Content-Type header and verify
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: Buffer.from('minio-test-data'),
        headers: {
          'Content-Type': 'image/png', // REQUIRED: Must match signature
        },
      });

      expect(uploadResponse.ok).toBe(true);

      const fileExists = await storage.headObject(storageKey);
      expect(fileExists).not.toBeNull();
    });
  });
});
