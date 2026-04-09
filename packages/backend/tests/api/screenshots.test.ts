/**
 * Screenshot Proxy Routes Tests
 * Tests for screenshot retrieval endpoint with authentication and authorization
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import {
  createMockPluginRegistry,
  createMockStorage,
  createMockQueueManager,
  createAdminUser,
} from '../test-helpers.js';
import { ApiKeyService } from '../../src/services/api-key/api-key-service.js';
import type { Project } from '../../src/db/types.js';
import { Readable } from 'stream';

describe('Screenshot Proxy Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let mockStorage: any;
  let testProject: Project;
  let otherProject: Project;
  let testApiKey: string;
  let otherProjectApiKey: string;
  let adminToken: string;

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
    const pluginRegistry = createMockPluginRegistry();
    mockStorage = createMockStorage();
    const queueManager = createMockQueueManager();

    // Mock storage.getObject to return a stream
    mockStorage.getObject = vi.fn((_key: string) => {
      const stream = Readable.from(['mock-image-data']);
      return Promise.resolve(stream);
    });

    server = await createServer({ db, storage: mockStorage, pluginRegistry, queueManager });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    const timestamp = Date.now();

    // Create test projects
    testProject = await db.projects.create({
      name: `Test Screenshot Project ${timestamp}`,
    });

    otherProject = await db.projects.create({
      name: `Other Screenshot Project ${timestamp}`,
    });

    // Create admin user for authenticated requests
    const { token: adminToken_temp } = await createAdminUser(server, db, 'admin-screenshots');
    adminToken = adminToken_temp;

    // Create API keys
    const apiKeyService = new ApiKeyService(db);

    const apiKeyResult = await apiKeyService.createKey({
      name: 'Test API Key',
      permissions: ['read', 'write'],
      allowed_projects: [testProject.id],
    });
    testApiKey = apiKeyResult.plaintext;

    const otherApiKeyResult = await apiKeyService.createKey({
      name: 'Other API Key',
      permissions: ['read', 'write'],
      allowed_projects: [otherProject.id],
    });
    otherProjectApiKey = otherApiKeyResult.plaintext;

    // Reset mock call history
    vi.clearAllMocks();
  });

  describe('GET /api/v1/screenshots/:bugReportId', () => {
    it('should retrieve screenshot with valid API key', async () => {
      // Create bug report with screenshot
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Bug with screenshot',
        description: 'Test bug',
        screenshot_key: 'screenshots/proj-123/bug-456/image.png',
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/screenshots/${bugReport.id}`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toBe('public, max-age=86400');
      expect(response.body).toBe('mock-image-data');

      // Verify storage service was called with correct key
      expect(mockStorage.getObject).toHaveBeenCalledWith('screenshots/proj-123/bug-456/image.png');
    });

    it('should retrieve screenshot with valid user session', async () => {
      // Create bug report with screenshot
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Bug with screenshot',
        description: 'Test bug',
        screenshot_key: 'screenshots/test/screenshot.jpg',
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/screenshots/${bugReport.id}`,
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/jpeg');
      expect(response.headers['cache-control']).toBe('public, max-age=86400');
    });

    it('should return 404 when bug report does not exist', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/screenshots/00000000-0000-0000-0000-000000000000',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.error).toBe('NotFound');
    });

    it('should return 404 when screenshot_key is null', async () => {
      // Create bug report without screenshot
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Bug without screenshot',
        description: 'No screenshot attached',
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/screenshots/${bugReport.id}`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.error).toBe('NotFound');
    });

    it('should return 403 when API key lacks project access', async () => {
      // Create bug report in testProject
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Bug with screenshot',
        description: 'Test bug',
        screenshot_key: 'screenshots/test/screenshot.png',
      });

      // Try to access with API key for different project
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/screenshots/${bugReport.id}`,
        headers: {
          'x-api-key': otherProjectApiKey,
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.error).toBe('Forbidden');
    });

    it('should return 401 when no authentication provided', async () => {
      // Create bug report with screenshot
      const bugReport = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Bug with screenshot',
        description: 'Test bug',
        screenshot_key: 'screenshots/test/screenshot.png',
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/screenshots/${bugReport.id}`,
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.error).toBe('Unauthorized');
    });

    describe('Content-Type Header for Different Image Formats', () => {
      it('should return image/png for .png files', async () => {
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'PNG screenshot',
          screenshot_key: 'screenshots/test/image.png',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/screenshots/${bugReport.id}`,
          headers: { 'x-api-key': testApiKey },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('image/png');
      });

      it('should return image/jpeg for .jpg files', async () => {
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'JPG screenshot',
          screenshot_key: 'screenshots/test/image.jpg',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/screenshots/${bugReport.id}`,
          headers: { 'x-api-key': testApiKey },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('image/jpeg');
      });

      it('should return image/jpeg for .jpeg files', async () => {
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'JPEG screenshot',
          screenshot_key: 'screenshots/test/image.jpeg',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/screenshots/${bugReport.id}`,
          headers: { 'x-api-key': testApiKey },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('image/jpeg');
      });

      it('should return image/gif for .gif files', async () => {
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'GIF screenshot',
          screenshot_key: 'screenshots/test/animation.gif',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/screenshots/${bugReport.id}`,
          headers: { 'x-api-key': testApiKey },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('image/gif');
      });

      it('should return image/webp for .webp files', async () => {
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'WebP screenshot',
          screenshot_key: 'screenshots/test/image.webp',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/screenshots/${bugReport.id}`,
          headers: { 'x-api-key': testApiKey },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('image/webp');
      });

      it('should default to image/png for unknown extensions', async () => {
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Unknown format',
          screenshot_key: 'screenshots/test/image.xyz',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/screenshots/${bugReport.id}`,
          headers: { 'x-api-key': testApiKey },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('image/png');
      });

      it('should default to image/png for files without extension', async () => {
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'No extension',
          screenshot_key: 'screenshots/test/image',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/screenshots/${bugReport.id}`,
          headers: { 'x-api-key': testApiKey },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('image/png');
      });
    });

    describe('Cache-Control Header', () => {
      it('should set Cache-Control header to public, max-age=86400', async () => {
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Screenshot caching test',
          screenshot_key: 'screenshots/test/cached.png',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/screenshots/${bugReport.id}`,
          headers: { 'x-api-key': testApiKey },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('public, max-age=86400');
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when storage.getObject fails', async () => {
        // Mock storage failure
        mockStorage.getObject.mockRejectedValueOnce(new Error('Storage unavailable'));

        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Storage error test',
          screenshot_key: 'screenshots/test/error.png',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/screenshots/${bugReport.id}`,
          headers: { 'x-api-key': testApiKey },
        });

        expect(response.statusCode).toBe(500);
        const json = response.json();
        expect(json.error).toBe('InternalError');
      });

      it('should return 400 for invalid bug report UUID format', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/screenshots/invalid-uuid',
          headers: { 'x-api-key': testApiKey },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe('Authorization Edge Cases', () => {
      it('should allow admin user to access any project screenshot', async () => {
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Admin access test',
          screenshot_key: 'screenshots/test/admin.png',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/screenshots/${bugReport.id}`,
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
      });

      it('should allow full-scope API key (null allowed_projects) to access any project', async () => {
        // Full-scope API keys: null/empty allowed_projects grants access to all projects
        const apiKeyService = new ApiKeyService(db);
        const wildcardKeyResult = await apiKeyService.createKey({
          name: 'Full Scope API Key',
          permissions: ['read', 'write'],
          allowed_projects: null, // null = full access to all projects
        });

        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Access test',
          screenshot_key: 'screenshots/test/access.png',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/screenshots/${bugReport.id}`,
          headers: {
            'x-api-key': wildcardKeyResult.plaintext,
          },
        });

        // Full-scope API key (null allowed_projects) gets access (200)
        expect(response.statusCode).toBe(200);
      });
    });

    describe('Stream Handling', () => {
      it('should stream screenshot data correctly', async () => {
        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Stream test',
          screenshot_key: 'screenshots/test/stream.png',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/screenshots/${bugReport.id}`,
          headers: { 'x-api-key': testApiKey },
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toBeDefined();
        expect(response.body).toBe('mock-image-data');
      });

      it('should handle large screenshot files', async () => {
        // Mock large file stream
        const largeData = 'x'.repeat(10000);
        mockStorage.getObject.mockResolvedValueOnce(Readable.from([largeData]));

        const bugReport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Large screenshot',
          screenshot_key: 'screenshots/test/large.png',
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/screenshots/${bugReport.id}`,
          headers: { 'x-api-key': testApiKey },
        });

        expect(response.statusCode).toBe(200);
        expect(response.body.length).toBeGreaterThan(5000);
      });
    });
  });
});
