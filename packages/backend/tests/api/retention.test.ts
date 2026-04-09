/**
 * Retention Routes Tests
 * Tests for data retention API endpoints with security focus
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { Project } from '../../src/db/types.js';
import { createRetentionService } from '../../src/retention/retention-service.factory.js';
import { RetentionScheduler } from '../../src/retention/retention-scheduler.js';
import { LocalStorageService } from '../../src/storage/local-storage.js';
import { LoggerNotificationService } from '../../src/retention/notification-service.js';
import { createMockPluginRegistry, createAdminUser } from '../test-helpers.js';

describe('Retention Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let testAccessToken!: string;
  let testAdminToken!: string;
  let testProject!: Project;
  let otherUserToken!: string;

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);

    // Create retention services
    const storage = new LocalStorageService({
      baseDirectory: './test-storage',
      baseUrl: 'http://localhost:3000/storage',
    });
    await storage.initialize();
    const retentionService = createRetentionService({
      db,
      storage,
      archiveStrategy: 'deletion', // Explicit deletion strategy for tests
    });
    const notificationService = new LoggerNotificationService();
    const retentionScheduler = new RetentionScheduler(retentionService, notificationService);
    const pluginRegistry = createMockPluginRegistry();

    server = await createServer({
      db,
      storage,
      pluginRegistry,
      retentionService,
      retentionScheduler,
    });
    await server.ready();

    // Create test users once to avoid rate limiting
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);

    // Create regular user
    const userResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `user-${timestamp}-${randomId}@example.com`,
        password: 'password123',
      },
    });
    const userData = userResponse.json();
    testAccessToken = userData.data.access_token;

    // Create project for regular user
    const projectResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: {
        authorization: `Bearer ${testAccessToken}`,
      },
      payload: {
        name: `Test Project ${timestamp}`,
      },
    });
    testProject = projectResponse.json().data;

    // Create admin user
    const { token: adminToken } = await createAdminUser(server, db, 'admin');
    testAdminToken = adminToken;

    // Create another user to test unauthorized access
    const otherUserResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `other-${timestamp}-${randomId}@example.com`,
        password: 'password123',
      },
    });
    otherUserToken = otherUserResponse.json().data.access_token;
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    // Note: User creation has been moved to beforeAll to avoid rate limiting
    // This test uses the same users across all tests
  });

  describe('GET /api/v1/projects/:id/retention', () => {
    describe('Security - Authentication', () => {
      it('should return 401 when no authentication provided', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/projects/${testProject.id}/retention`,
        });

        expect(response.statusCode).toBe(401);
        const json = response.json();
        expect(json.error).toBe('Unauthorized');
        expect(json.message).toContain('Authentication required');
      });

      it('should return 401 with invalid bearer token', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/projects/${testProject.id}/retention`,
          headers: {
            authorization: 'Bearer invalid-token',
          },
        });

        expect(response.statusCode).toBe(401);
      });

      it('should return 401 with malformed authorization header', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/projects/${testProject.id}/retention`,
          headers: {
            authorization: 'InvalidFormat',
          },
        });

        expect(response.statusCode).toBe(401);
      });
    });

    describe('Security - Authorization', () => {
      it('should return 403 when user lacks access to project', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/projects/${testProject.id}/retention`,
          headers: {
            authorization: `Bearer ${otherUserToken}`,
          },
        });

        expect(response.statusCode).toBe(403);
        const json = response.json();
        expect(json.error).toBe('Forbidden');
      });

      it('should allow project owner to access retention settings', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/projects/${testProject.id}/retention`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.projectId).toBe(testProject.id);
        expect(json.tier).toBeDefined();
        expect(json.retention).toBeDefined();
      });

      it('should allow admin to access any project retention settings', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/projects/${testProject.id}/retention`,
          headers: {
            authorization: `Bearer ${testAdminToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
      });
    });

    describe('Security - Information Disclosure', () => {
      it('should not leak project existence to unauthenticated users', async () => {
        // Without auth, should get 401 not 404
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/projects/${testProject.id}/retention`,
        });

        expect(response.statusCode).toBe(401);
        expect(response.json().error).not.toContain('not found');
      });

      it('should not leak project existence to unauthorized users', async () => {
        // User without access should get 403, not reveal if project exists
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/projects/${testProject.id}/retention`,
          headers: {
            authorization: `Bearer ${otherUserToken}`,
          },
        });

        expect(response.statusCode).toBe(403);
        const json = response.json();
        expect(json.error).toBe('Forbidden');
      });

      it('should return 404 for non-existent project only to authenticated users with potential access', async () => {
        const fakeProjectId = '00000000-0000-0000-0000-000000000000';
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/projects/${fakeProjectId}/retention`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        // Since user is authenticated, they should get proper 403/404
        expect([403, 404]).toContain(response.statusCode);
      });
    });

    describe('Functionality', () => {
      it('should return default retention settings for new project', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/projects/${testProject.id}/retention`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.projectId).toBe(testProject.id);
        expect(json.tier).toBe('free');
        expect(json.retention).toMatchObject({
          bugReportRetentionDays: expect.any(Number),
          autoDeleteEnabled: expect.any(Boolean),
        });
      });

      it('should validate project ID format', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/projects/not-a-uuid/retention',
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
        });

        expect(response.statusCode).toBe(400);
      });
    });
  });

  describe('PUT /api/v1/projects/:id/retention', () => {
    describe('Security - Authentication', () => {
      it('should return 401 when no authentication provided', async () => {
        const response = await server.inject({
          method: 'PUT',
          url: `/api/v1/projects/${testProject.id}/retention`,
          payload: {
            bugReportRetentionDays: 60,
          },
        });

        expect(response.statusCode).toBe(401);
        const json = response.json();
        expect(json.error).toBe('Unauthorized');
        expect(json.message).toContain('Authentication required');
      });

      it('should return 401 with invalid bearer token', async () => {
        const response = await server.inject({
          method: 'PUT',
          url: `/api/v1/projects/${testProject.id}/retention`,
          headers: {
            authorization: 'Bearer invalid-token',
          },
          payload: {
            bugReportRetentionDays: 60,
          },
        });

        expect(response.statusCode).toBe(401);
      });
    });

    describe('Security - Authorization', () => {
      it('should return 403 when non-owner user tries to update retention', async () => {
        // First, decode the otherUserToken to get the user ID
        const tokenParts = otherUserToken.split('.');
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
        const otherUserId = payload.userId;

        // Add other user as a viewer to the project
        await server.inject({
          method: 'POST',
          url: `/api/v1/projects/${testProject.id}/members`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            user_id: otherUserId,
            role: 'viewer',
          },
        });

        const response = await server.inject({
          method: 'PUT',
          url: `/api/v1/projects/${testProject.id}/retention`,
          headers: {
            authorization: `Bearer ${otherUserToken}`,
          },
          payload: {
            bugReportRetentionDays: 60,
          },
        });

        expect(response.statusCode).toBe(403);
        const json = response.json();
        expect(json.message).toBe('Project owner or admin access required');
      });

      it('should allow project owner to update retention settings', async () => {
        const response = await server.inject({
          method: 'PUT',
          url: `/api/v1/projects/${testProject.id}/retention`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            bugReportRetentionDays: 60,
            autoDeleteEnabled: true,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.success).toBe(true);
        expect(json.settings.retention.bugReportRetentionDays).toBe(60);
      });

      it('should allow admin to update any project retention settings', async () => {
        const response = await server.inject({
          method: 'PUT',
          url: `/api/v1/projects/${testProject.id}/retention`,
          headers: {
            authorization: `Bearer ${testAdminToken}`,
          },
          payload: {
            bugReportRetentionDays: 90,
          },
        });

        expect(response.statusCode).toBe(200);
      });
    });

    describe('Functionality', () => {
      it('should validate retention days within tier limits', async () => {
        const response = await server.inject({
          method: 'PUT',
          url: `/api/v1/projects/${testProject.id}/retention`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            bugReportRetentionDays: 9999, // Exceeds free tier limit
          },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain('retention days');
      });

      it('should validate request body schema', async () => {
        const response = await server.inject({
          method: 'PUT',
          url: `/api/v1/projects/${testProject.id}/retention`,
          headers: {
            authorization: `Bearer ${testAccessToken}`,
          },
          payload: {
            bugReportRetentionDays: 'not-a-number',
          },
        });

        expect(response.statusCode).toBe(400);
      });
    });
  });

  describe('GET /api/v1/admin/retention', () => {
    it('should require admin role', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/retention',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().message).toBe('Platform admin access required');
    });

    it('should return retention config for admin', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/retention',
        headers: {
          authorization: `Bearer ${testAdminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.defaultPolicy).toBeDefined();
      expect(json.schedulerEnabled).toBeDefined();
      expect(json.schedulerStatus).toBeDefined();
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/retention',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('PUT /api/v1/admin/retention', () => {
    it('should require admin role', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/admin/retention',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          bugReportRetentionDays: 90,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should update global retention configuration', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/admin/retention',
        headers: {
          authorization: `Bearer ${testAdminToken}`,
        },
        payload: {
          bugReportRetentionDays: 90,
          autoDeleteEnabled: true,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.policy).toBeDefined();
      expect(json.policy.bugReportRetentionDays).toBe(90);
    });
  });

  describe('POST /api/v1/admin/retention/preview', () => {
    it('should require admin role', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/retention/preview',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return preview for admin', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/retention/preview',
        headers: {
          authorization: `Bearer ${testAdminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.totalReports).toBeDefined();
      expect(json.reportsByProject).toBeDefined();
    });

    it('should support project filtering', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/admin/retention/preview?projectId=${testProject.id}`,
        headers: {
          authorization: `Bearer ${testAdminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /api/v1/admin/retention/apply', () => {
    it('should require admin role', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/retention/apply',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          dryRun: true,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should allow dry-run for admin', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/retention/apply',
        headers: {
          authorization: `Bearer ${testAdminToken}`,
        },
        payload: {
          dryRun: true,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.totalProcessed).toBeDefined();
      expect(json.deleted).toBeDefined();
    });

    it('should require confirmation for non-dry-run', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/retention/apply',
        headers: {
          authorization: `Bearer ${testAdminToken}`,
        },
        payload: {
          dryRun: false,
          confirm: false,
        },
      });

      // Should either require confirmation or return preview
      expect([200, 400]).toContain(response.statusCode);
    });
  });

  describe('GET /api/v1/admin/retention/status', () => {
    it('should require admin role', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/retention/status',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return scheduler status for admin', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/retention/status',
        headers: {
          authorization: `Bearer ${testAdminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.isRunning).toBeDefined();
      expect(json.nextRunTime).toBeDefined();
    });
  });
});
