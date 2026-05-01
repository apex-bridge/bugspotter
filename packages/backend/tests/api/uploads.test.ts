/**
 * Uploads API Tests
 * Tests for presigned URL generation and upload confirmation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import bcrypt from 'bcrypt';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../src/db/client.js';
import type { IStorageService } from '../../src/storage/types.js';
import { PluginRegistry } from '../../src/integrations/plugin-registry.js';
import { ApiKeyService } from '../../src/services/api-key/api-key-service.js';

// Mock storage services
vi.mock('../../src/storage/storage-service.js');
vi.mock('../../src/storage/local-storage.js');
vi.mock('../../src/queue/queue-manager.js');

describe('Uploads API', () => {
  let app: FastifyInstance;
  let db: DatabaseClient;
  let mockStorage: IStorageService;
  let mockQueueManager: {
    addJob: Mock;
    getJob: Mock;
    getQueueMetrics: Mock;
    healthCheck: Mock;
    close: Mock;
  };
  let testProject: { id: string };
  let testBugReport: { id: string; project_id: string };
  let testApiKey: string;

  beforeEach(async () => {
    // Create database client
    db = createDatabaseClient();

    // Create mock storage with presigned URL support
    mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getSignedUrl: vi.fn().mockResolvedValue('https://storage.example.com/signed-get-url'),
      getPresignedUploadUrl: vi
        .fn()
        .mockResolvedValue('https://storage.example.com/signed-put-url'),
      uploadBuffer: vi.fn().mockResolvedValue({
        key: 'test-key',
        url: 'https://storage.example.com/test-key',
        size: 1024,
      }),
      deleteObject: vi.fn().mockResolvedValue(undefined),
      deleteFolder: vi.fn().mockResolvedValue(undefined),
      listObjects: vi.fn().mockResolvedValue({ objects: [], nextToken: null }),
      getObject: vi.fn(),
      headObject: vi
        .fn()
        .mockResolvedValue({ size: 1024, lastModified: new Date(), key: 'test-key' }),
      uploadStream: vi.fn(),
      uploadScreenshot: vi.fn(),
      uploadThumbnail: vi.fn(),
      uploadReplayChunk: vi.fn(),
      uploadReplayMetadata: vi.fn(),
      uploadAttachment: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(true),
      clearAllStorage: vi.fn(),
    } as IStorageService;

    // Create mock queue manager
    mockQueueManager = {
      addJob: vi.fn().mockResolvedValue({ id: 'job-123' }),
      getJob: vi.fn(),
      getQueueMetrics: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue(true),
      close: vi.fn(),
    };

    const pluginRegistry = new PluginRegistry(db, mockStorage);

    // Create Fastify app
    app = await createServer({
      db,
      storage: mockStorage,
      queueManager:
        mockQueueManager as unknown as import('../../src/queue/queue-manager.js').QueueManager,
      pluginRegistry,
    });

    await app.ready();

    // Create test project
    testProject = await db.projects.create({
      name: 'Test Project',
    });

    // Create managed API key
    const apiKeyService = new ApiKeyService(db);
    const apiKeyResult = await apiKeyService.createKey({
      name: 'Test API Key',
      permissions: ['reports:write', 'reports:read', 'uploads:write'],
      allowed_projects: [testProject.id],
    });
    testApiKey = apiKeyResult.plaintext;

    // Create test bug report
    testBugReport = await db.bugReports.create({
      project_id: testProject.id,
      title: 'Test Bug',
      description: 'Test description',
      priority: 'medium',
      status: 'open',
      metadata: {},
      screenshot_url: null,
      replay_url: null,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // NOTE: POST /api/v1/uploads/presigned-url route removed
  // Presigned URLs are now generated during bug report creation via POST /api/v1/reports
  // See upload-batch-handler.ts for the implementation used in reports.ts

  describe('POST /api/v1/reports/:id/confirm-upload', () => {
    it('should confirm screenshot upload when properly set up', async () => {
      // Setup: Set storage key and pending status
      await db.query(
        'UPDATE bug_reports SET screenshot_key = $1, upload_status = $2 WHERE id = $3',
        ['screenshots/test-project/test-bug/screenshot.png', 'pending', testBugReport.id]
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reports/${testBugReport.id}/confirm-upload`,
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          fileType: 'screenshot',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toContain('confirmed');
      expect(body.data.fileType).toBe('screenshot');
      expect(body.data.storageKey).toBe('screenshots/test-project/test-bug/screenshot.png');
      expect(body.data.fileSize).toBe(1024);

      // Verify upload_status updated
      const updated = await db.bugReports.findById(testBugReport.id);
      expect(updated?.upload_status).toBe('completed');

      // Verify worker job was queued
      expect(mockQueueManager.addJob).toHaveBeenCalledWith('screenshots', 'process-screenshot', {
        bugReportId: testBugReport.id,
        projectId: testProject.id,
        screenshotKey: 'screenshots/test-project/test-bug/screenshot.png',
      });
    });

    it('should confirm replay upload when properly set up', async () => {
      // Setup: Set storage key and pending status
      await db.query(
        'UPDATE bug_reports SET replay_key = $1, replay_upload_status = $2 WHERE id = $3',
        ['replays/test-project/test-bug/replay.gz', 'pending', testBugReport.id]
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reports/${testBugReport.id}/confirm-upload`,
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          fileType: 'replay',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.fileType).toBe('replay');

      // Verify replay_upload_status updated
      const updated = await db.bugReports.findById(testBugReport.id);
      expect(updated?.replay_upload_status).toBe('completed');

      // Verify worker job was queued
      expect(mockQueueManager.addJob).toHaveBeenCalledWith('replays', 'process-replay', {
        bugReportId: testBugReport.id,
        projectId: testProject.id,
        replayKey: 'replays/test-project/test-bug/replay.gz',
      });
    });

    it('should reject if no storage key exists (upload not initiated)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reports/${testBugReport.id}/confirm-upload`,
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          fileType: 'screenshot',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('BadRequest');
      expect(body.message).toContain('No screenshot upload initiated');
    });

    it('should reject if status is not pending', async () => {
      // Setup: Set storage key but status is 'completed'
      await db.query(
        'UPDATE bug_reports SET screenshot_key = $1, upload_status = $2 WHERE id = $3',
        ['screenshots/test/test.png', 'completed', testBugReport.id]
      );

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reports/${testBugReport.id}/confirm-upload`,
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          fileType: 'screenshot',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('BadRequest');
      expect(body.message).toContain('Upload cannot be confirmed');
      expect(body.message).toContain('current status: completed');
    });

    it('should reject if file not found in storage', async () => {
      // Setup: Set storage key and pending status
      await db.query(
        'UPDATE bug_reports SET screenshot_key = $1, upload_status = $2 WHERE id = $3',
        ['screenshots/test/missing.png', 'pending', testBugReport.id]
      );

      // Mock storage to return null (file not found)
      (mockStorage.headObject as Mock).mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reports/${testBugReport.id}/confirm-upload`,
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          fileType: 'screenshot',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Upload file not found in storage');
    });

    it('should reject invalid bug report ID', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/reports/not-a-uuid/confirm-upload',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          fileType: 'screenshot',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject non-existent bug report', async () => {
      const fakeUuid = '00000000-0000-0000-0000-000000000000';

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reports/${fakeUuid}/confirm-upload`,
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          fileType: 'screenshot',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject invalid file type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reports/${testBugReport.id}/confirm-upload`,
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          fileType: 'invalid',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reports/${testBugReport.id}/confirm-upload`,
        payload: {
          fileType: 'screenshot',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject access to bug report from different project', async () => {
      // Create another project with different API key
      const otherProject = await db.projects.create({
        name: 'Other Project',
      });

      // Create API key for other project
      const apiKeyService = new ApiKeyService(db);
      const otherApiKeyResult = await apiKeyService.createKey({
        name: 'Other API Key',
        permissions: ['uploads:write'],
        allowed_projects: [otherProject.id],
      });

      // Setup: Set storage key and pending status on original bug report
      await db.query(
        'UPDATE bug_reports SET screenshot_key = $1, upload_status = $2 WHERE id = $3',
        ['screenshots/test/test.png', 'pending', testBugReport.id]
      );

      // Try to confirm upload using different project's API key
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/reports/${testBugReport.id}/confirm-upload`,
        headers: {
          'x-api-key': otherApiKeyResult.plaintext,
        },
        payload: {
          fileType: 'screenshot',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Access denied');
    });
  });

  describe('GET /api/v1/reports/:id/screenshot-url', () => {
    it('should return presigned URL for screenshot with storage key', async () => {
      // Update bug report with screenshot_key
      await db.query('UPDATE bug_reports SET screenshot_key = $1 WHERE id = $2', [
        'screenshots/proj/bug/original.png',
        testBugReport.id,
      ]);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReport.id}/screenshot-url`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.url).toBe('https://storage.example.com/signed-get-url');
      expect(body.data.expiresIn).toBe(900);

      // CRITICAL SECURITY: Verify Content-Type and Content-Disposition are overridden
      // to prevent XSS if malicious content was uploaded
      expect(mockStorage.getSignedUrl).toHaveBeenCalledWith(
        'screenshots/proj/bug/original.png',
        expect.objectContaining({
          expiresIn: 900,
          responseContentType: 'image/png',
          responseContentDisposition: expect.stringContaining('inline'),
        })
      );
    });

    it('should fallback to legacy screenshot_url', async () => {
      // Update bug report with legacy screenshot_url
      await db.query('UPDATE bug_reports SET screenshot_url = $1 WHERE id = $2', [
        'https://legacy.com/screenshot.png',
        testBugReport.id,
      ]);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReport.id}/screenshot-url`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.url).toBe('https://legacy.com/screenshot.png');
    });

    it('should return 404 when no screenshot available', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReport.id}/screenshot-url`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Screenshot not available');
    });

    it('should reject invalid bug report ID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/reports/invalid-id/screenshot-url',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReport.id}/screenshot-url`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject access to bug report from different project', async () => {
      const otherProject = await db.projects.create({
        name: 'Other Project',
      });

      // Create API key for other project
      const apiKeyService = new ApiKeyService(db);
      const otherApiKeyResult = await apiKeyService.createKey({
        name: 'Other API Key',
        permissions: ['reports:read'],
        allowed_projects: [otherProject.id],
      });

      await db.query('UPDATE bug_reports SET screenshot_key = $1 WHERE id = $2', [
        'screenshots/proj/bug/original.png',
        testBugReport.id,
      ]);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReport.id}/screenshot-url`,
        headers: {
          'x-api-key': otherApiKeyResult.plaintext,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Access denied');
    });
  });

  describe('GET /api/v1/reports/:id/replay-url', () => {
    it('should return presigned URL for replay with storage key', async () => {
      await db.query('UPDATE bug_reports SET replay_key = $1 WHERE id = $2', [
        'replays/proj/bug/replay.gz',
        testBugReport.id,
      ]);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReport.id}/replay-url`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.url).toBe('https://storage.example.com/signed-get-url');
      expect(body.data.expiresIn).toBe(900);

      // CRITICAL SECURITY: Verify Content-Type and Content-Disposition are overridden
      // to prevent XSS if malicious content was uploaded
      expect(mockStorage.getSignedUrl).toHaveBeenCalledWith(
        'replays/proj/bug/replay.gz',
        expect.objectContaining({
          expiresIn: 900,
          responseContentType: 'application/gzip',
          responseContentDisposition: expect.stringContaining('attachment'),
        })
      );
    });

    it('should fallback to legacy replay_url', async () => {
      await db.query('UPDATE bug_reports SET replay_url = $1 WHERE id = $2', [
        'https://legacy.com/replay.json',
        testBugReport.id,
      ]);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReport.id}/replay-url`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.url).toBe('https://legacy.com/replay.json');
    });

    it('should return 404 when no replay available', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReport.id}/replay-url`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Session replay not available');
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReport.id}/replay-url`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject access to bug report from different project', async () => {
      const otherProject = await db.projects.create({
        name: 'Other Project',
      });

      // Create API key for other project
      const apiKeyService = new ApiKeyService(db);
      const otherApiKeyResult = await apiKeyService.createKey({
        name: 'Other API Key',
        permissions: ['reports:read'],
        allowed_projects: [otherProject.id],
      });

      await db.query('UPDATE bug_reports SET replay_key = $1 WHERE id = $2', [
        'replays/proj/bug/replay.gz',
        testBugReport.id,
      ]);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReport.id}/replay-url`,
        headers: {
          'x-api-key': otherApiKeyResult.plaintext,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Access denied');
    });
  });

  // Regression: ingest-only SDK keys (the kind self-service signup issues —
  // permissions: ['reports:write','sessions:write'], no read perm) must NOT be
  // able to fetch presigned URLs for screenshots or replays. The keys ship in
  // public-facing front-end SDK code; granting them read access would let any
  // page visitor pull every bug-report asset for the project.
  describe('ingest-only API key cannot read assets (regression)', () => {
    let ingestOnlyKey: string;

    beforeEach(async () => {
      const apiKeyService = new ApiKeyService(db);
      const result = await apiKeyService.createKey({
        name: 'Ingest-only SDK key',
        permissions: ['reports:write', 'sessions:write'],
        allowed_projects: [testProject.id],
      });
      ingestOnlyKey = result.plaintext;

      await db.query('UPDATE bug_reports SET screenshot_key = $1, replay_key = $2 WHERE id = $3', [
        'screenshots/proj/bug/original.png',
        'replays/proj/bug/replay.gz',
        testBugReport.id,
      ]);
    });

    it('GET screenshot-url with ingest-only key returns 403', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReport.id}/screenshot-url`,
        headers: { 'x-api-key': ingestOnlyKey },
      });

      expect(response.statusCode).toBe(403);
    });

    it('GET replay-url with ingest-only key returns 403', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReport.id}/replay-url`,
        headers: { 'x-api-key': ingestOnlyKey },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // Positive path: the admin UI hits screenshot-url / replay-url with a JWT
  // bearer token, not an API key. `requireApiKeyPermission('reports:read')`
  // explicitly bypasses for JWT users (their permissions are gated elsewhere
  // via project membership). These tests pin that bypass so a future tweak
  // to the middleware can't accidentally block dashboard users.
  describe('JWT user with project access can read assets', () => {
    let jwtToken: string;

    beforeEach(async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      const user = await db.users.create({
        email: `jwt-viewer-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
        password_hash: passwordHash,
        role: 'user',
      });
      // Project membership at viewer level — the minimum that should still
      // see screenshots/replays per ACCESS_CONTROL.md.
      await db.query(
        'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)',
        [testProject.id, user.id, 'viewer']
      );
      jwtToken = app.jwt.sign({ userId: user.id, role: 'user' }, { expiresIn: '1h' });

      await db.query('UPDATE bug_reports SET screenshot_key = $1, replay_key = $2 WHERE id = $3', [
        'screenshots/proj/bug/original.png',
        'replays/proj/bug/replay.gz',
        testBugReport.id,
      ]);
    });

    it('GET screenshot-url with project-viewer JWT returns 200', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReport.id}/screenshot-url`,
        headers: { authorization: `Bearer ${jwtToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data.url).toBeDefined();
    });

    it('GET replay-url with project-viewer JWT returns 200', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReport.id}/replay-url`,
        headers: { authorization: `Bearer ${jwtToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data.url).toBeDefined();
    });

    it('GET intelligence mitigation with project-viewer JWT passes the auth gate', async () => {
      // Mitigation is on the same `requireApiKeyPermission('reports:read')`
      // chain. JWT users must still pass through. We don't care whether the
      // mitigation row exists (it doesn't — would be 404), only that the
      // response is NOT 401/403, which is what the new gate would have
      // returned if it failed to bypass for JWT users.
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/intelligence/projects/${testProject.id}/bugs/${testBugReport.id}/mitigation`,
        headers: { authorization: `Bearer ${jwtToken}` },
      });

      expect([200, 404]).toContain(response.statusCode);
      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).not.toBe(403);
    });
  });
});
