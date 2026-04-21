/**
 * Bug Report Routes Tests
 * Tests for CRUD operations on bug reports
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import {
  createMockPluginRegistry,
  createMockStorage,
  createMockQueueManager,
} from '../test-helpers.js';
import { ApiKeyService } from '../../src/services/api-key/api-key-service.js';

describe('Bug Report Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let testApiKey: string;
  let testProjectId: string;

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();
    const queueManager = createMockQueueManager();
    server = await createServer({ db, storage, pluginRegistry, queueManager });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    // Create test project
    const timestamp = Date.now();
    const project = await db.projects.create({
      name: `Test Project ${timestamp}`,
      settings: {},
    });
    testProjectId = project.id;

    // Create managed API key for the project. Grants explicit reports +
    // sessions access so the same fixture can drive both write-path and
    // read-path (including GET /reports/:id/sessions which enforces
    // `sessions:read` since PR #18).
    const apiKeyService = new ApiKeyService(db);
    const apiKeyResult = await apiKeyService.createKey({
      name: 'Test API Key',
      permissions: ['reports:write', 'reports:read', 'sessions:read', 'uploads:write'],
      allowed_projects: [testProjectId],
    });
    testApiKey = apiKeyResult.plaintext;
  });

  describe('POST /api/v1/reports', () => {
    it('should create a bug report with API key', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          title: 'Login button not working',
          description: 'Users cannot log in',
          priority: 'high',
          report: {
            console: [
              {
                level: 'error',
                message: 'Uncaught TypeError',
                timestamp: '2025-10-08T12:00:00Z',
              },
            ],
            network: [],
            metadata: {
              userAgent: 'Mozilla/5.0',
              url: 'https://example.com',
            },
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.title).toBe('Login button not working');
      expect(json.data.priority).toBe('high');
      expect(json.data.status).toBe('open');
      expect(json.data.project_id).toBe(testProjectId);
    });

    it('should create report with session replay', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          title: 'Test Report',
          report: {
            console: [],
            network: [],
            metadata: {},
            sessionReplay: {
              events: [{ type: 'click', target: '#button' }],
              duration: 5000,
            },
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.data.id).toBeDefined();
    });

    it('should default to medium priority', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          title: 'Test Report',
          report: {
            console: [],
            network: [],
            metadata: {},
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.data.priority).toBe('medium');
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        payload: {
          title: 'Test Report',
          report: {
            console: [],
            network: [],
            metadata: {},
          },
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should validate required fields', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          // Missing title and report
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error).toBe('ValidationError');
    });

    it('should reject console array exceeding maxItems limit', async () => {
      // Create array with 1001 items (limit is 1000)
      const tooManyConsoleLogs = Array.from({ length: 1001 }, (_, i) => ({
        level: 'info',
        message: `Log ${i}`,
        timestamp: Date.now(),
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          title: 'Test Report',
          report: {
            console: tooManyConsoleLogs,
            network: [],
            metadata: {},
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error).toBe('ValidationError');
    });

    it('should reject network array exceeding maxItems limit', async () => {
      // Create array with 501 items (limit is 500)
      const tooManyNetworkRequests = Array.from({ length: 501 }, (_, i) => ({
        url: `https://api.example.com/endpoint${i}`,
        method: 'GET',
        status: 200,
        duration: 100,
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          title: 'Test Report',
          report: {
            console: [],
            network: tooManyNetworkRequests,
            metadata: {},
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error).toBe('ValidationError');
    });

    it('should reject metadata with too many properties', async () => {
      // Create object with 51 properties (limit is 50)
      const tooManyMetadataProps: Record<string, string> = {};
      for (let i = 0; i < 51; i++) {
        tooManyMetadataProps[`key${i}`] = `value${i}`;
      }

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          title: 'Test Report',
          report: {
            console: [],
            network: [],
            metadata: tooManyMetadataProps,
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error).toBe('ValidationError');
    });

    it('should accept arrays at exactly the limit', async () => {
      // Create arrays at exactly the limits, matching TypeScript interfaces
      const baseTimestamp = Date.now();
      const consoleLogs = Array.from({ length: 1000 }, (_, i) => ({
        level: 'info' as const,
        message: `Log ${i}`,
        timestamp: baseTimestamp + i,
      }));
      const networkRequests = Array.from({ length: 500 }, (_, i) => ({
        url: `https://api.example.com/endpoint${i}`,
        method: 'GET',
        status: 200,
        timestamp: baseTimestamp + i,
      }));
      const metadataProps: Record<string, string> = {};
      for (let i = 0; i < 50; i++) {
        metadataProps[`key${i}`] = `value${i}`;
      }

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          title: 'Test Report at Limits',
          report: {
            console: consoleLogs,
            network: networkRequests,
            metadata: metadataProps,
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
    });

    describe('multi-project API keys', () => {
      let multiProjectKey: string;
      let secondProjectId: string;

      beforeEach(async () => {
        // Create a second project
        const project2 = await db.projects.create({
          name: `Second Project ${Date.now()}`,
          settings: {},
        });
        secondProjectId = project2.id;

        // Create API key with access to both projects
        const apiKeyService = new ApiKeyService(db);
        const result = await apiKeyService.createKey({
          name: 'Multi-Project Key',
          permissions: ['reports:write', 'reports:read'],
          allowed_projects: [testProjectId, secondProjectId],
        });
        multiProjectKey = result.plaintext;
      });

      it('should create report when project_id is specified', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/reports',
          headers: { 'x-api-key': multiProjectKey },
          payload: {
            project_id: testProjectId,
            title: 'Multi-project bug',
            report: { console: [], network: [], metadata: {} },
          },
        });

        expect(response.statusCode).toBe(201);
        const json = response.json();
        expect(json.data.project_id).toBe(testProjectId);
      });

      it('should return 400 when project_id is omitted', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/reports',
          headers: { 'x-api-key': multiProjectKey },
          payload: {
            title: 'Missing project',
            report: { console: [], network: [], metadata: {} },
          },
        });

        expect(response.statusCode).toBe(400);
        const json = response.json();
        expect(json.message).toContain('project_id');
      });

      it('should return 403 for disallowed project_id', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/reports',
          headers: { 'x-api-key': multiProjectKey },
          payload: {
            project_id: '00000000-0000-0000-0000-000000000000',
            title: 'Wrong project',
            report: { console: [], network: [], metadata: {} },
          },
        });

        expect(response.statusCode).toBe(403);
      });

      it('should return 404 when allowed project does not exist', async () => {
        const missingProjectId = '11111111-1111-1111-1111-111111111111';

        const apiKeyService = new ApiKeyService(db);
        const keyWithMissingProject = await apiKeyService.createKey({
          name: 'Key with missing project',
          permissions: ['reports:write', 'reports:read'],
          allowed_projects: [missingProjectId],
        });

        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/reports',
          headers: { 'x-api-key': keyWithMissingProject.plaintext },
          payload: {
            project_id: missingProjectId,
            title: 'Missing project',
            report: { console: [], network: [], metadata: {} },
          },
        });

        expect(response.statusCode).toBe(404);
        const json = response.json();
        expect(json.message).toBe('Project not found.');
      });
    });
  });

  describe('GET /api/v1/reports', () => {
    beforeEach(async () => {
      // Create some test reports
      await db.bugReports.create({
        project_id: testProjectId,
        title: 'Report 1',
        status: 'open',
        priority: 'high',
        metadata: {},
      });
      await db.bugReports.create({
        project_id: testProjectId,
        title: 'Report 2',
        status: 'resolved',
        priority: 'low',
        metadata: {},
      });
    });

    it('should list bug reports', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeInstanceOf(Array);
      expect(json.pagination).toBeDefined();
      expect(json.pagination.page).toBe(1);
      expect(json.pagination.limit).toBe(20);
    });

    it('should filter by status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/reports?status=open',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.every((r: any) => r.status === 'open')).toBe(true);
    });

    it('should filter by priority', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/reports?priority=high',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.every((r: any) => r.priority === 'high')).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/reports?page=1&limit=1',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.length).toBeLessThanOrEqual(1);
      expect(json.pagination.limit).toBe(1);
    });

    it('should support sorting', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/reports?sort_by=created_at&order=asc',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /api/v1/reports/:id', () => {
    let reportId: string;

    beforeEach(async () => {
      const report = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Single Report',
        status: 'open',
        priority: 'medium',
        metadata: {},
      });
      reportId = report.id;
    });

    it('should get a single bug report', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/${reportId}`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(reportId);
      expect(json.data.title).toBe('Single Report');
    });

    it('should return 404 for non-existent report', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/00000000-0000-0000-0000-000000000000',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.error).toBe('NotFound');
    });

    it('should enforce project access control', async () => {
      // Create another project with its own API key
      const otherProject = await db.projects.create({
        name: 'Other Project',
        settings: {},
      });

      // Create API key for the other project
      const apiKeyService = new ApiKeyService(db);
      const otherApiKeyResult = await apiKeyService.createKey({
        name: 'Other API Key',
        permissions: ['reports:read'],
        allowed_projects: [otherProject.id],
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/${reportId}`,
        headers: {
          'x-api-key': otherApiKeyResult.plaintext, // Different project's API key
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('PATCH /api/v1/reports/:id', () => {
    let reportId: string;

    beforeEach(async () => {
      const report = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Report to Update',
        status: 'open',
        priority: 'medium',
        metadata: {},
      });
      reportId = report.id;
    });

    it('should update bug report status', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/reports/${reportId}`,
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          status: 'resolved',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('resolved');
    });

    it('should update bug report priority', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/reports/${reportId}`,
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          priority: 'critical',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.priority).toBe('critical');
    });

    it('should require at least one field', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/reports/${reportId}`,
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 for non-existent report', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/reports/00000000-0000-0000-0000-000000000000',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          status: 'resolved',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/reports/:id', () => {
    let reportId: string;

    beforeEach(async () => {
      const report = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Report to Delete',
        status: 'open',
        priority: 'medium',
        metadata: {},
      });
      reportId = report.id;
    });

    it('should soft-delete a bug report', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/reports/${reportId}`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(204);

      // Verify report is no longer returned in list
      const listResponse = await server.inject({
        method: 'GET',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      const json = listResponse.json();
      const found = json.data.find((r: any) => r.id === reportId);
      expect(found).toBeUndefined();
    });

    it('should return 404 for non-existent report', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/reports/00000000-0000-0000-0000-000000000000',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 409 for report under legal hold', async () => {
      await db.bugReports.setLegalHold([reportId], true);

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/reports/${reportId}`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(409);
      const json = response.json();
      expect(json.message).toContain('legal hold');
    });

    it('should enforce project access control', async () => {
      const otherProject = await db.projects.create({
        name: 'Other Project',
        settings: {},
      });

      const apiKeyService = new ApiKeyService(db);
      const otherApiKeyResult = await apiKeyService.createKey({
        name: 'Other API Key',
        permissions: ['reports:write'],
        allowed_projects: [otherProject.id],
      });

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/reports/${reportId}`,
        headers: {
          'x-api-key': otherApiKeyResult.plaintext,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/reports/${reportId}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should be idempotent for already soft-deleted reports', async () => {
      // First delete
      const first = await server.inject({
        method: 'DELETE',
        url: `/api/v1/reports/${reportId}`,
        headers: { 'x-api-key': testApiKey },
      });
      expect(first.statusCode).toBe(204);

      // Second delete — should still return 204, not 409
      const second = await server.inject({
        method: 'DELETE',
        url: `/api/v1/reports/${reportId}`,
        headers: { 'x-api-key': testApiKey },
      });
      expect(second.statusCode).toBe(204);
    });
  });

  describe('POST /api/v1/reports/bulk-delete', () => {
    let reportIds: string[];

    beforeEach(async () => {
      reportIds = [];
      for (const title of ['Bulk Report 1', 'Bulk Report 2', 'Bulk Report 3']) {
        const report = await db.bugReports.create({
          project_id: testProjectId,
          title,
          status: 'open',
          priority: 'medium',
          metadata: {},
        });
        reportIds.push(report.id);
      }
    });

    it('should soft-delete multiple bug reports', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports/bulk-delete',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: { ids: reportIds },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.deleted).toBe(3);
    });

    it('should skip reports under legal hold', async () => {
      await db.bugReports.setLegalHold([reportIds[1]], true);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports/bulk-delete',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: { ids: reportIds },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.deleted).toBe(2);
    });

    it('should return 404 if any report does not exist', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports/bulk-delete',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: { ids: [...reportIds, '00000000-0000-0000-0000-000000000000'] },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject empty ids array', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports/bulk-delete',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: { ids: [] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports/bulk-delete',
        payload: { ids: reportIds },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Presigned URL Upload Flow', () => {
    it('should generate presigned URLs and allow confirm-upload for screenshot', async () => {
      // Step 1: Create report with hasScreenshot flag
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          title: 'Bug with Screenshot',
          description: 'Testing presigned URL flow',
          hasScreenshot: true,
          report: {
            console: [],
            network: [],
            metadata: {
              userAgent: 'Mozilla/5.0',
              url: 'https://example.com',
            },
          },
        },
      });

      expect(createResponse.statusCode).toBe(201);
      const createJson = createResponse.json();
      expect(createJson.success).toBe(true);
      expect(createJson.data.presignedUrls).toBeDefined();
      expect(createJson.data.presignedUrls.screenshot).toBeDefined();
      expect(createJson.data.screenshot_key).not.toBe(null);
      expect(createJson.data.upload_status).toBe('pending');

      const reportId = createJson.data.id;

      // Step 2: Simulate file upload to presigned URL (in real flow, client uploads to S3)
      // We skip actual S3 upload in tests

      // Step 3: Confirm upload completion
      const confirmResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/reports/${reportId}/confirm-upload`,
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          fileType: 'screenshot',
        },
      });

      expect(confirmResponse.statusCode).toBe(200);
      const confirmJson = confirmResponse.json();
      expect(confirmJson.success).toBe(true);
      expect(confirmJson.data.upload_status).toBe('completed');
    });

    it('should generate presigned URLs and allow confirm-upload for replay', async () => {
      // Step 1: Create report with hasReplay flag
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          title: 'Bug with Replay',
          description: 'Testing presigned URL flow',
          hasReplay: true,
          report: {
            console: [],
            network: [],
            metadata: {
              userAgent: 'Mozilla/5.0',
              url: 'https://example.com',
            },
          },
        },
      });

      expect(createResponse.statusCode).toBe(201);
      const createJson = createResponse.json();
      expect(createJson.success).toBe(true);
      expect(createJson.data.presignedUrls).toBeDefined();
      expect(createJson.data.presignedUrls.replay).toBeDefined();
      expect(createJson.data.replay_key).not.toBe(null);
      expect(createJson.data.replay_upload_status).toBe('pending');

      const reportId = createJson.data.id;

      // Step 2: Confirm upload completion
      const confirmResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/reports/${reportId}/confirm-upload`,
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          fileType: 'replay',
        },
      });

      expect(confirmResponse.statusCode).toBe(200);
      const confirmJson = confirmResponse.json();
      expect(confirmJson.success).toBe(true);
      expect(confirmJson.data.replay_upload_status).toBe('completed');
    });

    it('should reject confirm-upload if no presigned URL was generated', async () => {
      // Create report WITHOUT hasScreenshot flag
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          title: 'Bug without Screenshot',
          description: 'No presigned URL generated',
          report: {
            console: [],
            network: [],
            metadata: {
              userAgent: 'Mozilla/5.0',
              url: 'https://example.com',
            },
          },
        },
      });

      const reportId = createResponse.json().data.id;

      // Try to confirm upload without having initiated it
      const confirmResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/reports/${reportId}/confirm-upload`,
        headers: {
          'x-api-key': testApiKey,
        },
        payload: {
          fileType: 'screenshot',
        },
      });

      expect(confirmResponse.statusCode).toBe(400);
      const confirmJson = confirmResponse.json();
      expect(confirmJson.error).toBe('BadRequest');
      expect(confirmJson.message).toContain('No screenshot upload initiated');
    });
  });

  describe('GET /api/v1/reports/:id/sessions', () => {
    it('should return session data from metadata', async () => {
      // Create report with console logs, network requests, and browser metadata
      const report = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Report with Sessions',
        status: 'open',
        priority: 'medium',
        metadata: {
          console: [
            { level: 'error', message: 'Something went wrong', timestamp: 1700000000000 },
            { level: 'warn', message: 'Deprecated API', timestamp: 1700000001000 },
          ],
          network: [
            {
              url: 'https://api.example.com/users',
              method: 'GET',
              status: 200,
              duration: 123,
              timestamp: 1700000000000,
            },
          ],
          metadata: {
            userAgent: 'Mozilla/5.0 Chrome/120',
            viewport: { width: 1920, height: 1080 },
            url: 'https://example.com/page',
            timestamp: 1700000000000,
          },
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/${report.id}/sessions`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeInstanceOf(Array);
      expect(json.data.length).toBe(1);

      const session = json.data[0];
      expect(session.id).toBe(`${report.id}-metadata`);
      expect(session.bug_report_id).toBe(report.id);
      expect(session.events.type).toBe('metadata');
      expect(session.events.console).toHaveLength(2);
      expect(session.events.network).toHaveLength(1);
      expect(session.events.metadata).toMatchObject({
        userAgent: 'Mozilla/5.0 Chrome/120',
        viewport: { width: 1920, height: 1080 },
        timestamp: 1700000000000,
      });
    });

    it('should return empty array when no console/network data exists', async () => {
      // Create report without console/network data
      const report = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Report without Sessions',
        status: 'open',
        priority: 'medium',
        metadata: {},
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/${report.id}/sessions`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toEqual([]);
    });

    it('should handle reports with only console logs', async () => {
      const report = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Report with Console Only',
        status: 'open',
        priority: 'medium',
        metadata: {
          console: [{ level: 'info', message: 'App started', timestamp: 1700000000000 }],
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/${report.id}/sessions`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data[0].events.console).toHaveLength(1);
      expect(json.data[0].events.network).toEqual([]);
    });

    it('should handle reports with only network requests', async () => {
      const report = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Report with Network Only',
        status: 'open',
        priority: 'medium',
        metadata: {
          network: [{ url: 'https://api.example.com', method: 'POST', status: 201, duration: 456 }],
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/${report.id}/sessions`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data[0].events.console).toEqual([]);
      expect(json.data[0].events.network).toHaveLength(1);
    });

    it('should require authentication', async () => {
      const report = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Test Report',
        status: 'open',
        priority: 'medium',
        metadata: { console: [] },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/${report.id}/sessions`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should enforce project access control', async () => {
      const report = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Test Report',
        status: 'open',
        priority: 'medium',
        metadata: { console: [] },
      });

      // Create another project with its own API key
      const otherProject = await db.projects.create({
        name: 'Other Project',
        settings: {},
      });

      const apiKeyService = new ApiKeyService(db);
      const otherApiKeyResult = await apiKeyService.createKey({
        name: 'Other API Key',
        permissions: ['reports:read'],
        allowed_projects: [otherProject.id],
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/${report.id}/sessions`,
        headers: {
          'x-api-key': otherApiKeyResult.plaintext,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should handle reports with only browser metadata', async () => {
      const report = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Test Report',
        status: 'open',
        priority: 'medium',
        metadata: {
          metadata: {
            userAgent: 'Mozilla/5.0',
            viewport: { width: 1920, height: 1080 },
            url: 'https://example.com',
            timestamp: Date.now(),
          },
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/${report.id}/sessions`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].events).toEqual({
        type: 'metadata',
        console: [],
        network: [],
        metadata: {
          userAgent: 'Mozilla/5.0',
          viewport: { width: 1920, height: 1080 },
          url: 'https://example.com',
          timestamp: expect.any(Number),
        },
      });
    });
  });
});
