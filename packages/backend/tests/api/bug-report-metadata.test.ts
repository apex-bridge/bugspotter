/**
 * Bug Report Metadata Tests
 *
 * Tests that verify metadata (console, network, browser info) is properly
 * saved and retrieved through the API, preventing regression of the bug
 * where Fastify schema validation was stripping nested properties.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
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

// Test metadata interfaces
interface BugReportMetadata {
  console?: Array<{
    level: string;
    message: string;
    timestamp: number;
    stack?: string;
    [key: string]: unknown;
  }>;
  network?: Array<{
    url: string;
    method: string;
    status: number;
    timestamp: number;
    duration?: number;
    headers?: Record<string, string>;
    response?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  metadata?: {
    userAgent?: string;
    viewport?: { width: number; height: number };
    browser?: string;
    browserVersion?: string;
    os?: string;
    osVersion?: string;
    url?: string;
    timestamp?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

describe('Bug Report Metadata Validation', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let testApiKey: string;
  let testProjectId: string;
  let createdProjectIds: string[] = [];
  let createdApiKeyIds: string[] = [];

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
    // Create test project with unique name
    const timestamp = Date.now();
    const project = await db.projects.create({
      name: `Metadata Test Project ${timestamp}`,
      settings: {},
    });
    testProjectId = project.id;
    createdProjectIds.push(testProjectId);

    // Create managed API key for the project
    const apiKeyService = new ApiKeyService(db);
    const apiKeyResult = await apiKeyService.createKey({
      name: 'Metadata Test API Key',
      permissions: ['reports:write', 'reports:read'],
      allowed_projects: [testProjectId],
    });
    testApiKey = apiKeyResult.plaintext;
    createdApiKeyIds.push(apiKeyResult.key.id);
  });

  afterEach(async () => {
    // Clean up in reverse dependency order
    // 1. Delete API keys first (they reference projects)
    for (const keyId of createdApiKeyIds) {
      try {
        await db.query('DELETE FROM api_keys WHERE id = $1', [keyId]);
      } catch {
        // Ignore if already deleted
      }
    }

    // 2. Delete bug reports (they reference projects)
    for (const projectId of createdProjectIds) {
      try {
        await db.query('DELETE FROM bug_reports WHERE project_id = $1', [projectId]);
      } catch {
        // Ignore errors
      }
    }

    // 3. Delete projects
    for (const projectId of createdProjectIds) {
      try {
        await db.projects.delete(projectId);
      } catch {
        // Ignore errors
      }
    }

    // Reset tracking arrays
    createdProjectIds = [];
    createdApiKeyIds = [];
  });

  describe('Schema Validation with additionalProperties', () => {
    it('should accept console logs with nested properties', async () => {
      const payload = {
        title: 'Test Bug with Console Logs',
        report: {
          console: [
            {
              level: 'error',
              message: 'Test error message',
              timestamp: Date.now(),
              stack: 'Error: Test\n  at file.js:10:15',
            },
            {
              level: 'info',
              message: 'Test info',
              timestamp: Date.now(),
              customField: 'should not be stripped',
            },
          ],
          network: [],
          metadata: {},
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'X-API-Key': testApiKey,
        },
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);

      // Verify console logs were saved with all properties
      const report = body.data;
      const metadata = report.metadata as BugReportMetadata;
      expect(metadata.console).toHaveLength(2);
      expect(metadata.console![0]).toHaveProperty('level', 'error');
      expect(metadata.console![0]).toHaveProperty('message', 'Test error message');
      expect(metadata.console![0]).toHaveProperty('stack');
      expect(metadata.console![1]).toHaveProperty('customField', 'should not be stripped');
    });

    it('should accept network requests with nested properties', async () => {
      const payload = {
        title: 'Test Bug with Network Logs',
        report: {
          console: [],
          network: [
            {
              url: '/api/test',
              method: 'GET',
              status: 200,
              duration: 123,
              timestamp: Date.now(),
              headers: {
                'content-type': 'application/json',
              },
              response: {
                data: 'test',
              },
            },
          ],
          metadata: {},
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'X-API-Key': testApiKey,
        },
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);

      // Verify network requests were saved with all properties
      const report = body.data;
      const metadata = report.metadata as BugReportMetadata;
      expect(metadata.network).toHaveLength(1);
      expect(metadata.network![0]).toHaveProperty('url', '/api/test');
      expect(metadata.network![0]).toHaveProperty('headers');
      expect(metadata.network![0].headers).toHaveProperty('content-type');
      expect(metadata.network![0]).toHaveProperty('response');
    });

    it('should accept browser metadata with nested properties', async () => {
      const payload = {
        title: 'Test Bug with Browser Metadata',
        report: {
          console: [],
          network: [],
          metadata: {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            viewport: {
              width: 1920,
              height: 1080,
            },
            browser: 'Chrome',
            browserVersion: '120.0.0',
            os: 'Windows',
            osVersion: '10',
            url: 'https://example.com/test',
            timestamp: Date.now(),
          },
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'X-API-Key': testApiKey,
        },
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);

      // Verify browser metadata was saved with all properties
      const report = body.data;
      const metadata = report.metadata as BugReportMetadata;
      expect(metadata.metadata).toHaveProperty('userAgent');
      expect(metadata.metadata).toHaveProperty('viewport');
      expect(metadata.metadata!.viewport).toHaveProperty('width', 1920);
      expect(metadata.metadata).toHaveProperty('browser', 'Chrome');
      expect(metadata.metadata).toHaveProperty('url', 'https://example.com/test');
    });

    it('should accept complete bug report with all metadata types', async () => {
      const payload = {
        title: 'Complete Bug Report',
        description: 'Test with all metadata types',
        priority: 'high',
        report: {
          console: [
            { level: 'error', message: 'Critical error', timestamp: Date.now() },
            { level: 'warn', message: 'Warning message', timestamp: Date.now() },
          ],
          network: [{ url: '/api/data', method: 'POST', status: 500, timestamp: Date.now() }],
          metadata: {
            userAgent: 'Mozilla/5.0',
            viewport: { width: 1920, height: 1080 },
            browser: 'Chrome',
            os: 'Windows',
            url: 'https://example.com',
          },
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'X-API-Key': testApiKey,
        },
        payload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      const report = body.data;
      const metadata = report.metadata as BugReportMetadata;

      // Verify all metadata was preserved
      expect(metadata.console).toHaveLength(2);
      expect(metadata.network).toHaveLength(1);
      expect(Object.keys(metadata.metadata!)).toHaveLength(5);
    });
  });

  describe('Metadata Retrieval', () => {
    it('should retrieve bug report with all metadata intact', async () => {
      // Create bug report
      const createPayload = {
        title: 'Retrieval Test',
        report: {
          console: [{ level: 'info', message: 'Test', timestamp: Date.now() }],
          network: [{ url: '/test', method: 'GET', status: 200, timestamp: Date.now() }],
          metadata: { browser: 'Chrome', os: 'Windows' },
        },
      };

      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: { 'X-API-Key': testApiKey },
        payload: createPayload,
      });

      const createBody = JSON.parse(createResponse.body);
      const bugId = createBody.data.id;

      // Retrieve bug report
      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/${bugId}`,
        headers: { 'X-API-Key': testApiKey },
      });

      expect(getResponse.statusCode).toBe(200);
      const getBody = JSON.parse(getResponse.body);
      const report = getBody.data;
      const metadata = report.metadata as BugReportMetadata;

      // Verify metadata is complete
      expect(metadata.console).toHaveLength(1);
      expect(metadata.console![0]).toHaveProperty('level', 'info');
      expect(metadata.network).toHaveLength(1);
      expect(metadata.network![0]).toHaveProperty('url', '/test');
      expect(metadata.metadata).toHaveProperty('browser', 'Chrome');
    });
  });
});
