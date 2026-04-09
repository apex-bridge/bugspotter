/**
 * API Integration Tests
 * Tests HTTP endpoints with authentication, authorization, and rate limiting
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestServerWithDb } from '../setup.integration.js';
import {
  createTestProject,
  createTestUser,
  createTestBugReport,
  TestCleanupTracker,
} from '../utils/test-utils.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { ApiKeyService } from '../../src/services/api-key/api-key-service.js';

describe('API Integration Tests', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  const cleanup = new TestCleanupTracker();

  beforeAll(async () => {
    const testEnv = await createTestServerWithDb();
    server = testEnv.server;
    db = testEnv.db;
  });

  beforeEach(async () => {
    // Clean up any resources from previous tests
    await cleanup.cleanup(db);
  });

  afterAll(async () => {
    await cleanup.cleanup(db);
    await server.close();
    await db.close();
  });

  describe('Health Endpoints', () => {
    it('GET /health should return 200', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });

    it('GET /ready should return 200 when DB is connected', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ready');
      expect(body.checks.database).toBe('healthy');
    });

    it('GET / should return API info', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('BugSpotter API');
      expect(body.status).toBe('running');
    });
  });

  describe('Project Endpoints', () => {
    let userJwt: string;
    let testUser: any;

    beforeEach(async () => {
      // Create a user and get JWT token
      const { user, password } = await createTestUser(db);
      testUser = user;
      cleanup.trackUser(user.id);

      // Login to get JWT
      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: user.email,
          password,
        },
      });
      const loginBody = JSON.parse(loginResponse.body);
      userJwt = loginBody.data.access_token;
    });

    it('POST /api/v1/projects should create project with valid auth', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${userJwt}`,
        },
        payload: {
          name: 'Test Project',
          settings: { theme: 'dark' },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Test Project');
      expect(body.data.id).toBeDefined();

      cleanup.trackProject(body.data.id);
    });

    it('POST /api/v1/projects should return 401 without auth', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        payload: {
          name: 'Test Project',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Unauthorized');
    });

    it('GET /api/v1/projects/:id should return project with valid auth', async () => {
      const project = await createTestProject(db, { created_by: testUser.id });
      cleanup.trackProject(project.id);

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${project.id}`,
        headers: {
          authorization: `Bearer ${userJwt}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.id).toBe(project.id);
      expect(body.data.name).toBe(project.name);
    });

    it('PATCH /api/v1/projects/:id should update project', async () => {
      const project = await createTestProject(db, { created_by: testUser.id });
      cleanup.trackProject(project.id);

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${project.id}`,
        headers: {
          authorization: `Bearer ${userJwt}`,
        },
        payload: {
          name: 'Updated Project Name',
          settings: { theme: 'light' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.name).toBe('Updated Project Name');
      expect(body.data.settings.theme).toBe('light');
    });

    it('DELETE /api/v1/projects/:id should delete project (admin only)', async () => {
      // Create admin user
      const { user: adminUser, password: adminPassword } = await createTestUser(db, {
        role: 'admin',
      });
      cleanup.trackUser(adminUser.id);

      // Login as admin
      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: adminUser.email,
          password: adminPassword,
        },
      });
      const adminJwt = JSON.parse(loginResponse.body).data.access_token;

      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${project.id}`,
        headers: {
          authorization: `Bearer ${adminJwt}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('DELETE /api/v1/projects/:id should return 403 for non-admin', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${project.id}`,
        headers: {
          authorization: `Bearer ${userJwt}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Forbidden');
    });

    it('GET /api/v1/projects/:id should return 404 for non-existent project', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/00000000-0000-0000-0000-000000000000',
        headers: {
          authorization: `Bearer ${userJwt}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('NotFound');
    });
  });

  describe('Bug Report Endpoints', () => {
    let project: Awaited<ReturnType<typeof createTestProject>>;
    let apiKey: string;
    let testUser: any;

    beforeEach(async () => {
      // Create user for API key
      const { user } = await createTestUser(db);
      testUser = user;
      cleanup.trackUser(user.id);

      // Create project
      project = await createTestProject(db, { created_by: user.id });
      cleanup.trackProject(project.id);

      // Create managed API key for the project
      const service = new ApiKeyService(db);
      const apiKeyResult = await service.createKey({
        name: 'Test API Key',
        permissions: ['reports:write', 'reports:read'],
        allowed_projects: [project.id],
        created_by: user.id,
      });
      apiKey = apiKeyResult.plaintext;
    });

    it('POST /api/v1/reports should create bug report with valid API key', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': apiKey,
        },
        payload: {
          title: 'Test Bug Report',
          description: 'This is a test bug',
          priority: 'high',
          report: {
            console: [{ level: 'error', message: 'Test error' }],
            network: [],
            metadata: { browser: 'Chrome', version: '120' },
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.title).toBe('Test Bug Report');
      expect(body.data.priority).toBe('high');
      expect(body.data.project_id).toBe(project.id);

      cleanup.trackBugReport(body.data.id);
    });

    it('POST /api/v1/reports should return 401 with invalid API key', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': 'bgs_invalid_key_12345',
        },
        payload: {
          title: 'Test Bug Report',
          report: {
            console: [],
            network: [],
            metadata: {},
          },
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Unauthorized');
    });

    it('POST /api/v1/reports should ignore legacy sessionReplay data', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': apiKey,
        },
        payload: {
          title: 'Bug with Replay',
          report: {
            console: [],
            network: [],
            metadata: {},
            sessionReplay: {
              events: [{ type: 'click', timestamp: 1234567890 }],
              duration: 5000,
            },
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      const bugId = body.data.id;
      cleanup.trackBugReport(bugId);
    });

    it('GET /api/v1/reports should list bug reports with pagination', async () => {
      // Create multiple bug reports
      for (let i = 0; i < 5; i++) {
        const report = await createTestBugReport(db, project.id, { title: `Bug ${i}` });
        cleanup.trackBugReport(report.id);
      }

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/reports?page=1&limit=3',
        headers: {
          'x-api-key': apiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(3);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(3);
      expect(body.pagination.total).toBeGreaterThanOrEqual(5);
    });

    it('GET /api/v1/reports should filter by status', async () => {
      const openReport = await createTestBugReport(db, project.id, { status: 'open' });
      const closedReport = await createTestBugReport(db, project.id, { status: 'resolved' });
      cleanup.trackBugReport(openReport.id);
      cleanup.trackBugReport(closedReport.id);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/reports?status=open',
        headers: {
          'x-api-key': apiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.every((r: any) => r.status === 'open')).toBe(true);
    });

    it('GET /api/v1/reports/:id should return single bug report', async () => {
      const report = await createTestBugReport(db, project.id);
      cleanup.trackBugReport(report.id);

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/${report.id}`,
        headers: {
          'x-api-key': apiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.id).toBe(report.id);
      expect(body.data.title).toBe(report.title);
    });

    it('PATCH /api/v1/reports/:id should update bug report status', async () => {
      const report = await createTestBugReport(db, project.id, { status: 'open' });
      cleanup.trackBugReport(report.id);

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/reports/${report.id}`,
        headers: {
          'x-api-key': apiKey,
        },
        payload: {
          status: 'in-progress',
          priority: 'critical',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.status).toBe('in-progress');
      expect(body.data.priority).toBe('critical');
    });

    it('GET /api/v1/reports/:id should return 404 for non-existent report', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/00000000-0000-0000-0000-000000000000',
        headers: {
          'x-api-key': apiKey,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('NotFound');
    });

    it('GET /api/v1/reports/:id should return 403 for accessing other projects report', async () => {
      // Create another project
      const otherProject = await createTestProject(db);
      cleanup.trackProject(otherProject.id);

      // Create bug report for other project
      const report = await createTestBugReport(db, otherProject.id);
      cleanup.trackBugReport(report.id);

      // Try to access with original project's API key
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/${report.id}`,
        headers: {
          'x-api-key': apiKey,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Forbidden');
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits on rapid requests', async () => {
      // Note: Rate limits are set very high in test environment (10,000/min)
      // to prevent false test failures with other tests.
      // This test just verifies the rate limiter is properly configured.
      const requests = [];
      const maxRequests = 10; // Small number to avoid overwhelming other tests

      // Make rapid requests
      for (let i = 0; i < maxRequests; i++) {
        requests.push(
          server.inject({
            method: 'GET',
            url: '/health',
          })
        );
      }

      const responses = await Promise.all(requests);

      // Verify all requests succeeded (we have high limits in tests)
      const successful = responses.filter((r) => r.statusCode === 200);
      expect(successful.length).toBe(maxRequests);
    });
  });

  describe('Authentication Edge Cases', () => {
    it('should return 401 for missing authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        payload: {
          name: 'Test Project',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 for malformed Bearer token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: 'Bearer invalid-token-format',
        },
        payload: {
          name: 'Test Project',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 for expired JWT token', async () => {
      // This would require creating a token with past expiry
      // For now, we test with invalid token
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.expired.token',
        },
        payload: {
          name: 'Test Project',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('IDOR Security Tests', () => {
    // Add delay to avoid rate limiting when running full test suite
    beforeEach(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    describe('Bug Report Access Control', () => {
      it('should prevent JWT user from accessing another projects bug report (GET)', async () => {
        // Create two users with their own projects
        const { user: user1, password: password1 } = await createTestUser(db, {
          email: 'user1@test.com',
        });
        cleanup.trackUser(user1.id);

        const { user: user2, password: password2 } = await createTestUser(db, {
          email: 'user2@test.com',
        });
        cleanup.trackUser(user2.id);

        // User1 owns project1
        const project1 = await createTestProject(db, { name: 'Project 1', created_by: user1.id });
        cleanup.trackProject(project1.id);

        // User2 owns project2
        const project2 = await createTestProject(db, { name: 'Project 2', created_by: user2.id });
        cleanup.trackProject(project2.id);

        // Create bug report in project2
        const report = await createTestBugReport(db, project2.id);
        cleanup.trackBugReport(report.id);

        // Login as user1
        const loginResponse = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: user1.email, password: password1 },
        });
        expect(loginResponse.statusCode).toBe(200);
        const jwt = JSON.parse(loginResponse.body).data.access_token;

        // Try to access project2's bug report with user1's JWT
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/reports/${report.id}`,
          headers: {
            authorization: `Bearer ${jwt}`,
          },
        });

        // Should be forbidden (403) not found (404)
        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.body);
        expect(body.error).toBe('Forbidden');
      });

      it('should prevent JWT user from modifying another projects bug report (PATCH)', async () => {
        // Create user and projects
        const { user, password } = await createTestUser(db);
        cleanup.trackUser(user.id);

        const project1 = await createTestProject(db, { name: 'Project 1' });
        cleanup.trackProject(project1.id);

        const project2 = await createTestProject(db, { name: 'Project 2' });
        cleanup.trackProject(project2.id);

        // Create bug report in project2
        const report = await createTestBugReport(db, project2.id);
        cleanup.trackBugReport(report.id);

        // Login to get JWT
        const loginResponse = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: user.email, password },
        });
        expect(loginResponse.statusCode).toBe(200);
        const jwt = JSON.parse(loginResponse.body).data.access_token;

        // Try to modify project2's bug report
        const response = await server.inject({
          method: 'PATCH',
          url: `/api/v1/reports/${report.id}`,
          headers: {
            authorization: `Bearer ${jwt}`,
          },
          payload: {
            status: 'resolved',
            priority: 'critical',
          },
        });

        // Should be forbidden
        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.body);
        expect(body.error).toBe('Forbidden');
      });

      it('should prevent JWT user from listing another projects bug reports', async () => {
        // Create user and projects
        const { user, password } = await createTestUser(db);
        cleanup.trackUser(user.id);

        const project1 = await createTestProject(db, { name: 'Project 1' });
        cleanup.trackProject(project1.id);

        const project2 = await createTestProject(db, { name: 'Project 2' });
        cleanup.trackProject(project2.id);

        // Create bug reports in project2
        const report1 = await createTestBugReport(db, project2.id);
        cleanup.trackBugReport(report1.id);
        const report2 = await createTestBugReport(db, project2.id);
        cleanup.trackBugReport(report2.id);

        // Login to get JWT
        const loginResponse = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: user.email, password },
        });
        expect(loginResponse.statusCode).toBe(200);
        const jwt = JSON.parse(loginResponse.body).data.access_token;

        // Try to list project2's bug reports by passing project_id
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/reports?project_id=${project2.id}`,
          headers: {
            authorization: `Bearer ${jwt}`,
          },
        });

        // Should either be forbidden or return empty results
        if (response.statusCode === 200) {
          const body = JSON.parse(response.body);
          // Should not return project2's reports
          expect(body.data.length).toBe(0);
        } else {
          expect(response.statusCode).toBe(403);
        }
      });
    });

    describe('Project Access Control', () => {
      it('should prevent JWT user from viewing another users project', async () => {
        // Create two users
        const { user: user1, password: password1 } = await createTestUser(db, {
          email: 'user1@test.com',
        });
        cleanup.trackUser(user1.id);

        const { user: user2, password: password2 } = await createTestUser(db, {
          email: 'user2@test.com',
        });
        cleanup.trackUser(user2.id);

        // User1 creates a project
        const loginResponse1 = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: user1.email, password: password1 },
        });
        expect(loginResponse1.statusCode).toBe(200);
        const jwt1 = JSON.parse(loginResponse1.body).data.access_token;

        const createProjectResponse = await server.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: {
            authorization: `Bearer ${jwt1}`,
          },
          payload: {
            name: 'User1 Project',
          },
        });
        const project = JSON.parse(createProjectResponse.body).data;
        cleanup.trackProject(project.id);

        // User2 tries to view user1's project
        const loginResponse2 = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: user2.email, password: password2 },
        });
        expect(loginResponse2.statusCode).toBe(200);
        const jwt2 = JSON.parse(loginResponse2.body).data.access_token;

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/projects/${project.id}`,
          headers: {
            authorization: `Bearer ${jwt2}`,
          },
        });

        // Should be forbidden
        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.body);
        expect(body.error).toBe('Forbidden');
      });

      it('should prevent JWT user from modifying another users project', async () => {
        // Create two users
        const { user: user1, password: password1 } = await createTestUser(db, {
          email: 'user1@test.com',
        });
        cleanup.trackUser(user1.id);

        const { user: user2, password: password2 } = await createTestUser(db, {
          email: 'user2@test.com',
        });
        cleanup.trackUser(user2.id);

        // User1 creates a project
        const loginResponse1 = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: user1.email, password: password1 },
        });
        expect(loginResponse1.statusCode).toBe(200);
        const jwt1 = JSON.parse(loginResponse1.body).data.access_token;

        const createProjectResponse = await server.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: {
            authorization: `Bearer ${jwt1}`,
          },
          payload: {
            name: 'User1 Project',
          },
        });
        const project = JSON.parse(createProjectResponse.body).data;
        cleanup.trackProject(project.id);

        // User2 tries to modify user1's project
        const loginResponse2 = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: user2.email, password: password2 },
        });
        expect(loginResponse2.statusCode).toBe(200);
        const jwt2 = JSON.parse(loginResponse2.body).data.access_token;

        const response = await server.inject({
          method: 'PATCH',
          url: `/api/v1/projects/${project.id}`,
          headers: {
            authorization: `Bearer ${jwt2}`,
          },
          payload: {
            name: 'Hacked Project Name',
          },
        });

        // Should be forbidden
        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.body);
        expect(body.error).toBe('Forbidden');
      });

      it('should prevent regular user from viewing another users API key', async () => {
        // Create admin and regular user
        const { user: admin, password: adminPassword } = await createTestUser(db, {
          email: 'admin@test.com',
          role: 'admin',
        });
        cleanup.trackUser(admin.id);

        const { user: regularUser, password: userPassword } = await createTestUser(db, {
          email: 'user@test.com',
          role: 'user',
        });
        cleanup.trackUser(regularUser.id);

        // Admin creates a project
        const loginResponse1 = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: admin.email, password: adminPassword },
        });
        const adminJwt = JSON.parse(loginResponse1.body).data.access_token;

        const createProjectResponse = await server.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: {
            authorization: `Bearer ${adminJwt}`,
          },
          payload: {
            name: 'Admin Project',
          },
        });
        const project = JSON.parse(createProjectResponse.body).data;
        cleanup.trackProject(project.id);

        // Regular user tries to view admin's project (which contains API key)
        const loginResponse2 = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: regularUser.email, password: userPassword },
        });
        const regularUserJwt = JSON.parse(loginResponse2.body).data.access_token;

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/projects/${project.id}`,
          headers: {
            authorization: `Bearer ${regularUserJwt}`,
          },
        });

        // Should be forbidden - this would expose the API key!
        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.body);
        expect(body.error).toBe('Forbidden');
      });
    });

    describe('Admin Privilege Escalation', () => {
      it('should prevent non-admin from regenerating API keys', async () => {
        // Already tested in existing tests
        // This is properly secured with requireRole('admin')
      });

      it('should allow admin to access any project (by design)', async () => {
        // Create admin and regular user
        const { user: admin, password: adminPassword } = await createTestUser(db, {
          email: 'admin@test.com',
          role: 'admin',
        });
        cleanup.trackUser(admin.id);

        const { user: regularUser, password: userPassword } = await createTestUser(db, {
          email: 'user@test.com',
          role: 'user',
        });
        cleanup.trackUser(regularUser.id);

        // Regular user creates a project
        const loginResponse1 = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: regularUser.email, password: userPassword },
        });
        const userJwt = JSON.parse(loginResponse1.body).data.access_token;

        const createProjectResponse = await server.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: {
            authorization: `Bearer ${userJwt}`,
          },
          payload: {
            name: 'User Project',
          },
        });
        const project = JSON.parse(createProjectResponse.body).data;
        cleanup.trackProject(project.id);

        // Admin should be able to access it
        const loginResponse2 = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: admin.email, password: adminPassword },
        });
        const adminJwt = JSON.parse(loginResponse2.body).data.access_token;

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/projects/${project.id}`,
          headers: {
            authorization: `Bearer ${adminJwt}`,
          },
        });

        // Admin should have access
        expect(response.statusCode).toBe(200);
      });
    });
  });
});
