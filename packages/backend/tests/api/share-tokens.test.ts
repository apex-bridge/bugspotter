/**
 * Share Token Routes Integration Tests
 * Tests for public replay sharing API endpoints
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
import type { User, Project, BugReport } from '../../src/db/types.js';
import { hashPassword } from '../../src/utils/token-generator.js';

describe('Share Token Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let testUser: User;
  let testProject: Project;
  let testBugReport: BugReport;
  let authToken: string;

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();
    const queueManager = createMockQueueManager();
    server = await createServer({ db, storage, pluginRegistry, queueManager });
    await server.ready();

    // Create test user
    const timestamp = Date.now();
    testUser = await db.users.create({
      email: `testuser${timestamp}@example.com`,
      password_hash: await hashPassword('password123'),
      name: 'Test User',
    });

    // Login to get auth token
    const loginResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: testUser.email,
        password: 'password123',
      },
    });
    authToken = JSON.parse(loginResponse.body).data.access_token;

    // Create test project
    testProject = await db.projects.create({
      name: `Test Project ${timestamp}`,
      settings: {},
    });

    // Add user as project member (owner)
    await db.projectMembers.create({
      project_id: testProject.id,
      user_id: testUser.id,
      role: 'owner',
    });

    // Create test bug report with replay
    testBugReport = await db.bugReports.create({
      project_id: testProject.id,
      title: 'Test Bug with Replay',
      status: 'open',
      priority: 'medium',
      metadata: {},
      replay_key: 'replays/test-project/test-replay.json',
    });
  });

  afterAll(async () => {
    // Cleanup
    if (testBugReport?.id) await db.bugReports.delete(testBugReport.id);
    if (testProject?.id) await db.projects.delete(testProject.id);
    if (testUser?.id) await db.users.delete(testUser.id);
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    // Clean up share tokens before each test
    const tokens = await db.shareTokens.findByBugReportId(testBugReport.id);
    for (const token of tokens) {
      await db.shareTokens.deleteByToken(token.token);
    }
  });

  describe('POST /api/v1/replays/:id/share', () => {
    it('should create a share token without password', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          expires_in_hours: 1, // 1 hour
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('token');
      expect(body.data).toHaveProperty('share_url');
      expect(body.data).toHaveProperty('expires_at');
      expect(body.data.password_protected).toBe(false);
      expect(body.data.token).toMatch(/^[A-Za-z0-9_-]{43}$/); // Base64url, 32 bytes
    });

    it('should create a password-protected share token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          password: 'secure-password-123',
          expires_in_hours: 2, // 2 hours
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.password_protected).toBe(true);
    });

    it('should use default expiration if not provided', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      const expiresAt = new Date(body.data.expires_at);
      const now = new Date();
      const diff = expiresAt.getTime() - now.getTime();

      // Should be approximately 24 hours (86400 seconds)
      expect(diff).toBeGreaterThan(86300 * 1000);
      expect(diff).toBeLessThan(86500 * 1000);
    });

    it('should return 404 if bug report does not exist', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/replays/00000000-0000-0000-0000-000000000000/share',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 404 if bug report has no replay', async () => {
      const reportWithoutReplay = await db.bugReports.create({
        project_id: testProject.id,
        title: 'Bug without Replay',
        status: 'open',
        priority: 'low',
        metadata: {},
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${reportWithoutReplay.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('ReplayNotFound');

      await db.bugReports.delete(reportWithoutReplay.id);
    });

    it('should return 401 if not authenticated', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        payload: {},
      });

      expect(response.statusCode).toBe(401);
    });

    it('should validate password length', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          password: 'short', // Too short (< 8 chars)
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should validate expires_in_hours range', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          expires_in_hours: 1000, // Too long (> 720 hours = 30 days)
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/replays/shared/:token', () => {
    it('should access shared replay without password', async () => {
      // Create share token
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {},
      });

      const { token } = JSON.parse(createResponse.body).data;

      // Access shared replay
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/shared/${token}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('replay_url');
      expect(body.data).toHaveProperty('bug_report');
      expect(body.data).toHaveProperty('session');
      expect(body.data).toHaveProperty('share_info');

      // Verify bug_report structure
      expect(body.data.bug_report).toMatchObject({
        id: testBugReport.id,
        title: testBugReport.title,
        status: testBugReport.status,
        priority: testBugReport.priority,
      });
      expect(body.data.bug_report).toHaveProperty('created_at');

      // Verify share_info structure
      expect(body.data.share_info).toMatchObject({
        view_count: 1,
        password_protected: false,
      });
      expect(body.data.share_info).toHaveProperty('expires_at');
    });

    it('should access password-protected replay with correct password', async () => {
      const password = 'correct-password-123';

      // Create password-protected share token
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: { password },
      });

      const { token } = JSON.parse(createResponse.body).data;

      // Access with correct password
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/shared/${token}?password=${encodeURIComponent(password)}`,
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 404 for password-protected replay without password', async () => {
      // Create password-protected share token
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: { password: 'secret-password' },
      });

      const { token } = JSON.parse(createResponse.body).data;

      // Try to access without password
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/shared/${token}`,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('PasswordRequired');
    });

    it('should return 404 for password-protected replay with wrong password', async () => {
      const correctPassword = 'correct-password';
      const wrongPassword = 'wrong-password';

      // Create password-protected share token
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: { password: correctPassword },
      });

      const { token } = JSON.parse(createResponse.body).data;

      // Try to access with wrong password
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/shared/${token}?password=${encodeURIComponent(wrongPassword)}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should increment view count on each access', async () => {
      // Create share token
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {},
      });

      const { token } = JSON.parse(createResponse.body).data;

      // Access multiple times
      const response1 = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/shared/${token}`,
      });
      expect(JSON.parse(response1.body).data.share_info.view_count).toBe(1);

      const response2 = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/shared/${token}`,
      });
      expect(JSON.parse(response2.body).data.share_info.view_count).toBe(2);

      const response3 = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/shared/${token}`,
      });
      expect(JSON.parse(response3.body).data.share_info.view_count).toBe(3);
    });

    it('should return 404 for non-existent token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/replays/shared/invalid-token-12345678901234567890',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should not require authentication (public route)', async () => {
      // Create share token
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {},
      });

      const { token } = JSON.parse(createResponse.body).data;

      // Access without authorization header
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/shared/${token}`,
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('DELETE /api/v1/replays/share/:token', () => {
    it('should revoke a share token', async () => {
      // Create share token
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {},
      });

      const { token } = JSON.parse(createResponse.body).data;

      // Revoke token
      const deleteResponse = await server.inject({
        method: 'DELETE',
        url: `/api/v1/replays/share/${token}`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(deleteResponse.statusCode).toBe(200);
      const body = JSON.parse(deleteResponse.body);
      expect(body.success).toBe(true);

      // Verify token is no longer accessible
      const accessResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/shared/${token}`,
      });

      expect(accessResponse.statusCode).toBe(404);
    });

    it('should return 404 for non-existent token', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/replays/share/non-existent-token-1234567890123456789',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 401 if not authenticated', async () => {
      // Create share token
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {},
      });

      const { token } = JSON.parse(createResponse.body).data;

      // Try to delete without authentication
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/replays/share/${token}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 403 if user does not have access to the bug report', async () => {
      // Create another user
      const timestamp = Date.now();
      const otherUser = await db.users.create({
        email: `otheruser${timestamp}@example.com`,
        password_hash: await hashPassword('password123'),
        name: 'Other User',
      });

      // Login as other user
      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: otherUser.email,
          password: 'password123',
        },
      });
      const otherAuthToken = JSON.parse(loginResponse.body).data.access_token;

      // Create share token as original user
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {},
      });

      const { token } = JSON.parse(createResponse.body).data;

      // Try to delete as other user
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/replays/share/${token}`,
        headers: {
          authorization: `Bearer ${otherAuthToken}`,
        },
      });

      expect(response.statusCode).toBe(403);

      // Cleanup
      await db.users.delete(otherUser.id);
    });
  });

  describe('GET /api/v1/replays/:id/share', () => {
    it('should return active share token for bug report', async () => {
      // Create share token
      const createResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          expires_in_hours: 24,
        },
      });

      const createdToken = JSON.parse(createResponse.body).data.token;

      // Get active share
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.token).toBe(createdToken);
      expect(body.data.share_url).toContain('/shared/');
      expect(body.data.expires_at).toBeDefined();
      expect(body.data.password_protected).toBe(false);
      expect(body.data.view_count).toBe(0);
      expect(body.data.created_at).toBeDefined();
    });

    it('should return 404 if no active share exists', async () => {
      // Create bug report without share
      const timestamp = Date.now();
      const bugReportNoShare = await db.bugReports.create({
        project_id: testProject.id,
        title: `Test Bug ${timestamp}`,
        description: 'Bug without share',
        replay_key: `replay_${timestamp}.json`,
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/${bugReportNoShare.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    it('should return 401 if not authenticated', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/${testBugReport.id}/share`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 403 if user does not have access to bug report', async () => {
      // Create another user
      const timestamp = Date.now();
      const otherUser = await db.users.create({
        email: `otheruser_get${timestamp}@example.com`,
        password_hash: await hashPassword('password123'),
        name: 'Other User Get',
      });

      // Login as other user
      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: otherUser.email,
          password: 'password123',
        },
      });
      const otherAuthToken = JSON.parse(loginResponse.body).data.access_token;

      // Try to get share as other user
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${otherAuthToken}`,
        },
      });

      expect(response.statusCode).toBe(403);

      // Cleanup
      await db.users.delete(otherUser.id);
    });

    it('should return password_protected=true for protected shares', async () => {
      // Create password-protected share
      await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          password: 'secure-password-123',
        },
      });

      // Get active share
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.password_protected).toBe(true);
    });
  });

  describe('POST /api/v1/replays/:id/share - Auto-revoke behavior', () => {
    it('should auto-revoke existing share when creating new one', async () => {
      // Create first share
      const firstResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          expires_in_hours: 24,
        },
      });

      const firstToken = JSON.parse(firstResponse.body).data.token;

      // Create second share (should auto-revoke first)
      const secondResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          expires_in_hours: 48,
        },
      });

      const secondToken = JSON.parse(secondResponse.body).data.token;

      // Tokens should be different
      expect(firstToken).not.toBe(secondToken);

      // First token should no longer be accessible
      const firstAccessResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/shared/${firstToken}`,
      });

      expect(firstAccessResponse.statusCode).toBe(404);

      // Second token should be accessible
      const secondAccessResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/shared/${secondToken}`,
      });

      expect(secondAccessResponse.statusCode).toBe(200);
    });

    it('should only have one active share after multiple creates', async () => {
      // Create multiple shares
      await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {},
      });

      await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {},
      });

      const thirdResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {},
      });

      // Get active share - should only return the last one
      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/replays/${testBugReport.id}/share`,
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(getResponse.statusCode).toBe(200);
      const body = JSON.parse(getResponse.body);
      const lastToken = JSON.parse(thirdResponse.body).data.token;
      expect(body.data.token).toBe(lastToken);
    });
  });

  describe('Metadata Helper Functions', () => {
    // Import the helper functions for testing
    // Note: These are internal functions, so we need to test them through the API
    // However, we can create unit tests for the logic by testing different metadata structures

    describe('Viewport Extraction from Metadata', () => {
      it('should extract viewport from valid nested metadata', async () => {
        // Create bug report with valid nested metadata structure
        const bugReportWithViewport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug with viewport metadata',
          replay_url: 'https://storage.example.com/replay123.json',
          replay_key: 'replay123',
          metadata: {
            metadata: {
              viewport: { width: 1920, height: 1080 },
              userAgent: 'Mozilla/5.0...',
            },
            console: [],
            network: [],
          },
        });

        // Create share token for the bug report
        const createResponse = await server.inject({
          method: 'POST',
          url: `/api/v1/replays/${bugReportWithViewport.id}/share`,
          headers: { Authorization: `Bearer ${authToken}` },
          payload: { expires_in_hours: 24 },
        });

        expect(createResponse.statusCode).toBe(201);
        const { token } = JSON.parse(createResponse.body).data;

        // Access shared replay and verify viewport is included
        const getResponse = await server.inject({
          method: 'GET',
          url: `/api/v1/replays/shared/${token}`,
        });

        expect(getResponse.statusCode).toBe(200);
        const body = JSON.parse(getResponse.body);
        expect(body.data.session).not.toBeNull();
        expect(body.data.session?.viewport).toEqual({ width: 1920, height: 1080 });
      });

      it('should handle missing nested metadata gracefully', async () => {
        // Create bug report with metadata but no nested metadata
        const bugReportNoNested = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug without nested metadata',
          replay_url: 'https://storage.example.com/replay456.json',
          replay_key: 'replay456',
          metadata: {
            console: [],
            network: [],
            // No nested 'metadata' property
          },
        });

        const createResponse = await server.inject({
          method: 'POST',
          url: `/api/v1/replays/${bugReportNoNested.id}/share`,
          headers: { Authorization: `Bearer ${authToken}` },
          payload: { expires_in_hours: 24 },
        });

        expect(createResponse.statusCode).toBe(201);
        const { token } = JSON.parse(createResponse.body).data;

        const getResponse = await server.inject({
          method: 'GET',
          url: `/api/v1/replays/shared/${token}`,
        });

        expect(getResponse.statusCode).toBe(200);
        const body = JSON.parse(getResponse.body);
        // Session is null when no session record exists for the bug report
        expect(body.data.session).toBeNull();
      });

      it('should handle invalid viewport structure gracefully', async () => {
        // Create bug report with invalid viewport structure
        const bugReportInvalidViewport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug with invalid viewport',
          replay_url: 'https://storage.example.com/replay789.json',
          replay_key: 'replay789',
          metadata: {
            metadata: {
              viewport: { width: 'invalid', height: null }, // Invalid types
              userAgent: 'Mozilla/5.0...',
            },
            console: [],
          },
        });

        const createResponse = await server.inject({
          method: 'POST',
          url: `/api/v1/replays/${bugReportInvalidViewport.id}/share`,
          headers: { Authorization: `Bearer ${authToken}` },
          payload: { expires_in_hours: 24 },
        });

        expect(createResponse.statusCode).toBe(201);
        const { token } = JSON.parse(createResponse.body).data;

        const getResponse = await server.inject({
          method: 'GET',
          url: `/api/v1/replays/shared/${token}`,
        });

        expect(getResponse.statusCode).toBe(200);
        const body = JSON.parse(getResponse.body);
        expect(body.data.session).not.toBeNull();
        // Invalid viewport structure should result in undefined viewport
        expect(body.data.session?.viewport).toBeUndefined();
      });

      it('should handle partial viewport data gracefully', async () => {
        // Create bug report with incomplete viewport structure
        const bugReportPartialViewport = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug with partial viewport',
          replay_url: 'https://storage.example.com/replay101.json',
          replay_key: 'replay101',
          metadata: {
            metadata: {
              viewport: { width: 1920 }, // Missing height
            },
          },
        });

        const createResponse = await server.inject({
          method: 'POST',
          url: `/api/v1/replays/${bugReportPartialViewport.id}/share`,
          headers: { Authorization: `Bearer ${authToken}` },
          payload: { expires_in_hours: 24 },
        });

        expect(createResponse.statusCode).toBe(201);
        const { token } = JSON.parse(createResponse.body).data;

        const getResponse = await server.inject({
          method: 'GET',
          url: `/api/v1/replays/shared/${token}`,
        });

        expect(getResponse.statusCode).toBe(200);
        const body = JSON.parse(getResponse.body);
        expect(body.data.session).not.toBeNull();
        // Partial viewport data should result in undefined viewport
        expect(body.data.session?.viewport).toBeUndefined();
      });

      it('should handle metadata with only console logs', async () => {
        // Create bug report with console logs only (no replay, no network, no nested metadata)
        const bugReportConsoleOnly = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug with console logs only',
          metadata: {
            console: [
              { level: 'error', message: 'Network timeout', timestamp: 1700000000000 },
              { level: 'warn', message: 'Deprecated API used', timestamp: 1700000001000 },
            ],
          },
        });

        const createResponse = await server.inject({
          method: 'POST',
          url: `/api/v1/replays/${bugReportConsoleOnly.id}/share`,
          headers: { Authorization: `Bearer ${authToken}` },
          payload: { expires_in_hours: 24 },
        });

        expect(createResponse.statusCode).toBe(201);
        const { token } = JSON.parse(createResponse.body).data;

        const getResponse = await server.inject({
          method: 'GET',
          url: `/api/v1/replays/shared/${token}`,
        });

        expect(getResponse.statusCode).toBe(200);
        const body = JSON.parse(getResponse.body);

        // SessionService should create metadata session from console logs
        expect(body.data.session).not.toBeNull();
        expect(body.data.session?.events?.type).toBe('metadata');
        expect(body.data.session?.events?.console).toHaveLength(2);

        // ✅ CRITICAL: Verify actual console log content (not just array length)
        expect(body.data.session?.events?.console[0]).toMatchObject({
          level: 'error',
          message: 'Network timeout',
          timestamp: 1700000000000,
        });
        expect(body.data.session?.events?.console[1]).toMatchObject({
          level: 'warn',
          message: 'Deprecated API used',
          timestamp: 1700000001000,
        });

        expect(body.data.session?.events?.network).toEqual([]);
        expect(body.data.session?.events?.metadata).toEqual({});
      });

      it('should handle metadata with only network requests', async () => {
        // Create bug report with network requests only (no replay, no console, no nested metadata)
        const bugReportNetworkOnly = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug with network requests only',
          metadata: {
            network: [
              {
                url: 'https://api.example.com/users',
                method: 'GET',
                status: 200,
                duration: 123,
                timestamp: 1700000000000,
              },
              {
                url: 'https://api.example.com/posts',
                method: 'POST',
                status: 201,
                duration: 456,
                timestamp: 1700000001000,
              },
            ],
          },
        });

        const createResponse = await server.inject({
          method: 'POST',
          url: `/api/v1/replays/${bugReportNetworkOnly.id}/share`,
          headers: { Authorization: `Bearer ${authToken}` },
          payload: { expires_in_hours: 24 },
        });

        expect(createResponse.statusCode).toBe(201);
        const { token } = JSON.parse(createResponse.body).data;

        const getResponse = await server.inject({
          method: 'GET',
          url: `/api/v1/replays/shared/${token}`,
        });

        expect(getResponse.statusCode).toBe(200);
        const body = JSON.parse(getResponse.body);
        // SessionService should create metadata session from network requests
        expect(body.data.session).not.toBeNull();
        expect(body.data.session?.events?.type).toBe('metadata');
        expect(body.data.session?.events?.console).toEqual([]);
        expect(body.data.session?.events?.network).toHaveLength(2);

        // ✅ CRITICAL: Verify actual network request content (not just array length)
        expect(body.data.session?.events?.network[0]).toMatchObject({
          url: 'https://api.example.com/users',
          method: 'GET',
          status: 200,
          duration: 123,
        });
        expect(body.data.session?.events?.network[1]).toMatchObject({
          url: 'https://api.example.com/posts',
          method: 'POST',
          status: 201,
          duration: 456,
        });

        expect(body.data.session?.events?.metadata).toEqual({});
      });

      it('should handle null/undefined metadata gracefully', async () => {
        // Create bug report with null metadata
        const bugReportNullMetadata = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug with null metadata',
          replay_url: 'https://storage.example.com/replay202.json',
          replay_key: 'replay202',
          metadata: {}, // Empty metadata
        });

        const createResponse = await server.inject({
          method: 'POST',
          url: `/api/v1/replays/${bugReportNullMetadata.id}/share`,
          headers: { Authorization: `Bearer ${authToken}` },
          payload: { expires_in_hours: 24 },
        });

        expect(createResponse.statusCode).toBe(201);
        const { token } = JSON.parse(createResponse.body).data;

        const getResponse = await server.inject({
          method: 'GET',
          url: `/api/v1/replays/shared/${token}`,
        });

        expect(getResponse.statusCode).toBe(200);
        const body = JSON.parse(getResponse.body);
        // No session created, so session is null
        expect(body.data.session).toBeNull();
      });

      it('should handle viewport with zero dimensions', async () => {
        // Test edge case with zero dimensions
        const bugReportZeroDimensions = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug with zero viewport dimensions',
          replay_url: 'https://storage.example.com/replay303.json',
          replay_key: 'replay303',
          metadata: {
            metadata: {
              viewport: { width: 0, height: 0 }, // Zero dimensions (valid numbers)
            },
          },
        });

        const createResponse = await server.inject({
          method: 'POST',
          url: `/api/v1/replays/${bugReportZeroDimensions.id}/share`,
          headers: { Authorization: `Bearer ${authToken}` },
          payload: { expires_in_hours: 24 },
        });

        expect(createResponse.statusCode).toBe(201);
        const { token } = JSON.parse(createResponse.body).data;

        const getResponse = await server.inject({
          method: 'GET',
          url: `/api/v1/replays/shared/${token}`,
        });

        expect(getResponse.statusCode).toBe(200);
        const body = JSON.parse(getResponse.body);
        expect(body.data.session).not.toBeNull();
        // Zero dimensions are still valid numbers, so should be included
        expect(body.data.session?.viewport).toEqual({ width: 0, height: 0 });
      });

      it('should handle viewport with negative dimensions', async () => {
        // Test edge case with negative dimensions
        const bugReportNegativeDimensions = await db.bugReports.create({
          project_id: testProject.id,
          title: 'Bug with negative viewport dimensions',
          replay_url: 'https://storage.example.com/replay404.json',
          replay_key: 'replay404',
          metadata: {
            metadata: {
              viewport: { width: -100, height: -50 }, // Negative dimensions (still valid numbers)
            },
          },
        });

        const createResponse = await server.inject({
          method: 'POST',
          url: `/api/v1/replays/${bugReportNegativeDimensions.id}/share`,
          headers: { Authorization: `Bearer ${authToken}` },
          payload: { expires_in_hours: 24 },
        });

        expect(createResponse.statusCode).toBe(201);
        const { token } = JSON.parse(createResponse.body).data;

        const getResponse = await server.inject({
          method: 'GET',
          url: `/api/v1/replays/shared/${token}`,
        });

        expect(getResponse.statusCode).toBe(200);
        const body = JSON.parse(getResponse.body);
        expect(body.data.session).not.toBeNull();
        // Negative dimensions are still valid numbers, so should be included
        expect(body.data.session?.viewport).toEqual({ width: -100, height: -50 });
      });
    });
  });
});
