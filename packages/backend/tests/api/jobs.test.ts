/**
 * Jobs API Route Tests
 * Tests for job queue status and monitoring endpoints
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { createServer } from '../../src/api/server.js';
import type { FastifyInstance } from 'fastify';
import type { QueueManager } from '../../src/queue/queue-manager.js';
import type { Queue } from 'bullmq';
import { createMockPluginRegistry, createMockStorage, createAdminUser } from '../test-helpers.js';
import { QueueNotFoundError } from '../../src/queue/errors.js';
import { ApiKeyService } from '../../src/services/api-key/api-key-service.js';

describe('Jobs API Routes', () => {
  let db: DatabaseClient;
  let server: FastifyInstance;
  let mockQueueManager: QueueManager;
  let testProjectId: string;
  let testApiKey: string;
  let testBugReportId: string;
  let adminToken: string;

  beforeAll(async () => {
    // Initialize database
    db = createDatabaseClient();
    await db.testConnection();

    // Create mock QueueManager with typed mocks
    const createMockQueue = (): Partial<Queue> => ({
      name: 'test-queue',
      getJobs: vi.fn().mockResolvedValue([]),
      getJob: vi.fn().mockResolvedValue(null),
      getJobCounts: vi.fn().mockResolvedValue({
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        waiting: 0,
      }),
      isPaused: vi.fn().mockResolvedValue(false),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      clean: vi.fn().mockResolvedValue([]),
      obliterate: vi.fn().mockResolvedValue(undefined),
    });

    mockQueueManager = {
      screenshotQueue: createMockQueue() as Queue,
      replayQueue: createMockQueue() as Queue,
      integrationQueue: createMockQueue() as Queue,
      notificationQueue: createMockQueue() as Queue,
      isHealthy: vi.fn().mockResolvedValue(true),
      healthCheck: vi.fn().mockResolvedValue(true),
      getJob: vi.fn().mockResolvedValue(null), // Returns null by default (job not found)
      getJobStatus: vi.fn().mockResolvedValue(null), // Returns null by default (job not found)
      getQueueMetrics: vi.fn().mockResolvedValue({
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        waiting: 0,
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as QueueManager;

    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();

    // Create server with mock queue manager
    server = await createServer({ db, storage, pluginRegistry, queueManager: mockQueueManager });
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    // Create test project
    const timestamp = Date.now();
    const project = await db.projects.create({
      name: `Test Project Jobs ${timestamp}`,
    });
    testProjectId = project.id;

    // Create platform admin for routes that require it (e.g. /queues/:queueName/jobs/:id).
    const admin = await createAdminUser(server, db, 'jobs-admin');
    adminToken = admin.token;

    // Create managed API key for the project
    const apiKeyService = new ApiKeyService(db);
    const apiKeyResult = await apiKeyService.createKey({
      name: 'Test API Key',
      permissions: ['reports:read', 'jobs:read'],
      allowed_projects: [testProjectId],
    });
    testApiKey = apiKeyResult.plaintext;

    // Create test bug report
    const bugReport = await db.bugReports.create({
      project_id: testProjectId,
      title: 'Test Bug',
      description: 'Test description',
      priority: 'medium',
      status: 'open',
      metadata: {},
      screenshot_url: null,
      replay_url: null,
    });
    testBugReportId = bugReport.id;
  });

  describe('GET /api/v1/queues/:queueName/jobs/:id', () => {
    it('should return 404 when job not found', async () => {
      // Mock returns null = job not found
      (mockQueueManager.getJob as any).mockResolvedValueOnce(null);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/queues/screenshots/jobs/test-job',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('NotFound');
      expect(body.message).toContain('Job test-job not found');
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/queues/screenshots/jobs/test-job',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject API-key auth (platform admin only)', async () => {
      // Regression: route previously had no preHandler — any authenticated
      // caller, including the public-facing SDK ingest key, could fetch any
      // job by id. Process-integration jobs carry decrypted credentials in
      // their payload, so this was a cross-tenant secret exfiltration.
      // Note: no `mockResolvedValueOnce` here — auth fails before getJob is
      // called, and queueing a mock would leak into the next test.

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/queues/screenshots/jobs/test-job',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return job status when job exists', async () => {
      // Mock returns job status
      const mockJobStatus = {
        id: 'test-job-123',
        name: 'screenshot-processing',
        state: 'completed',
        progress: 100,
        returnValue: { success: true },
      };
      (mockQueueManager.getJob as any).mockResolvedValueOnce(mockJobStatus);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/queues/screenshots/jobs/test-job-123',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual(mockJobStatus);
    });

    it('should redact credential-shaped fields from job data', async () => {
      // Regression: process-integration job payloads carry decrypted
      // credentials. Defense-in-depth — even with platform-admin auth,
      // these should never appear in the response body.
      const mockJobStatus = {
        id: 'integration-job-1',
        name: 'process-integration',
        state: 'completed',
        data: {
          bugReportId: 'bug-1',
          projectId: 'proj-1',
          platform: 'jira',
          credentials: { email: 'svc@x.com', apiToken: 'secret-token-XXX' },
          apiToken: 'top-secret',
          config: { instanceUrl: 'https://x.atlassian.net' },
        },
      };
      (mockQueueManager.getJob as any).mockResolvedValueOnce(mockJobStatus);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/queues/integrations/jobs/integration-job-1',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.data.credentials).toBe('[REDACTED]');
      expect(body.data.data.apiToken).toBe('[REDACTED]');
      // Non-sensitive fields preserved
      expect(body.data.data.bugReportId).toBe('bug-1');
      expect(body.data.data.projectId).toBe('proj-1');
      expect(body.data.data.config).toEqual({ instanceUrl: 'https://x.atlassian.net' });
    });

    it('should fail closed when nesting exceeds redaction depth', async () => {
      // Build a payload nested past MAX_REDACTION_DEPTH (10). The redactor
      // can't keep walking past the limit, and rather than leak the whole
      // subtree it replaces deep objects with a placeholder. Realistic job
      // payloads never nest this deep — hitting the limit means a buggy or
      // malicious worker shape.
      let deeplyNested: Record<string, unknown> = { apiToken: 'leak-me' };
      for (let i = 0; i < 12; i++) {
        deeplyNested = { wrapper: deeplyNested };
      }
      const mockJobStatus = {
        id: 'pathological-job',
        name: 'process-integration',
        state: 'completed',
        data: deeplyNested,
      };
      (mockQueueManager.getJob as any).mockResolvedValueOnce(mockJobStatus);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/queues/integrations/jobs/pathological-job',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Walk the response. Every level must be either a wrapper object, the
      // [DEPTH_EXCEEDED] placeholder, or [REDACTED] for matching keys —
      // never the literal 'leak-me'.
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('leak-me');
      expect(serialized).toContain('[DEPTH_EXCEEDED]');
    });

    it('should redact credential-shaped fields nested deep in job data', async () => {
      // Defense-in-depth against future job shapes that nest credentials
      // (e.g. config.apiToken, options.auth.password). The shallow walk
      // would have leaked these.
      const mockJobStatus = {
        id: 'integration-job-2',
        name: 'process-integration',
        state: 'completed',
        data: {
          bugReportId: 'bug-2',
          projectId: 'proj-2',
          config: {
            instanceUrl: 'https://x.atlassian.net',
            apiToken: 'nested-secret-1', // nested matching key
            nested: {
              password: 'nested-secret-2', // 2 levels deep
              keep: 'visible',
            },
          },
          options: [{ auth: { token: 'array-element-secret' }, label: 'first' }],
        },
      };
      (mockQueueManager.getJob as any).mockResolvedValueOnce(mockJobStatus);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/queues/integrations/jobs/integration-job-2',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.data.config.apiToken).toBe('[REDACTED]');
      expect(body.data.data.config.nested.password).toBe('[REDACTED]');
      expect(body.data.data.options[0].auth.token).toBe('[REDACTED]');
      // Surrounding non-sensitive fields preserved at every depth
      expect(body.data.data.config.instanceUrl).toBe('https://x.atlassian.net');
      expect(body.data.data.config.nested.keep).toBe('visible');
      expect(body.data.data.options[0].label).toBe('first');
    });

    it('should handle invalid queue name', async () => {
      // Mock QueueNotFoundError being thrown
      (mockQueueManager.getJob as any).mockRejectedValueOnce(
        new QueueNotFoundError('invalid-queue')
      );

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/queues/invalid-queue/jobs/test-job',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('NotFound');
      expect(body.message).toContain('Queue invalid-queue not found');
    });
  });

  describe('GET /api/v1/reports/:id/jobs', () => {
    it('should get jobs for bug report', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReportId}/jobs`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.bugReportId).toBe(testBugReportId);
    });

    it('should return 404 for non-existent bug report', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/00000000-0000-0000-0000-000000000000/jobs',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('NotFound');
    });

    it('should return 403 for bug report in different project', async () => {
      // Create another project
      const otherProject = await db.projects.create({
        name: 'Other Project',
      });

      // Create bug report in other project
      const otherBugReport = await db.bugReports.create({
        project_id: otherProject.id,
        title: 'Other Bug',
        description: 'Test',
        priority: 'medium',
        status: 'open',
        metadata: {},
        screenshot_url: null,
        replay_url: null,
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/${otherBugReport.id}/jobs`,
        headers: {
          'x-api-key': testApiKey, // Using API key restricted to different project
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Forbidden');
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/${testBugReportId}/jobs`,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/queues/metrics', () => {
    it('should return metrics for all queues', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/queues/metrics',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.queues).toBeInstanceOf(Array);
      expect(body.data.queues.length).toBeGreaterThan(0);
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/queues/metrics',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/queues/health', () => {
    it('should not require authentication (public endpoint)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/queues/health',
        // Explicitly testing without any auth headers
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should return 503 when queue system is unhealthy', async () => {
      // Mock unhealthy queue
      (mockQueueManager.healthCheck as any).mockResolvedValueOnce(false);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/queues/health',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('ServiceUnavailable');
      expect(body.message).toContain('Queue system unhealthy');
    });

    it('should return 503 when health check throws error', async () => {
      // Mock health check throwing error
      (mockQueueManager.healthCheck as any).mockRejectedValueOnce(new Error('Connection failed'));

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/queues/health',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('ServiceUnavailable');
      expect(body.message).toContain('Queue health check failed');
    });
  });
});
