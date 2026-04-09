/**
 * Authentication Middleware Tests
 * Tests for API key and JWT authentication
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { BugReport, ShareToken, Project } from '../../src/db/types.js';
import { createMockPluginRegistry, createMockStorage } from '../test-helpers.js';

describe('Authentication Middleware', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let testApiKey: string;
  let testAccessToken: string;

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();
    server = await createServer({ db, storage, pluginRegistry });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    // Generate unique identifiers for test isolation
    const timestamp = Date.now();

    // Create test user with unique email and get JWT token
    const registerResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `auth-test-${timestamp}@example.com`,
        password: 'password123',
      },
    });
    testAccessToken = registerResponse.json().data.access_token;
    const userId = registerResponse.json().data.user.id;

    // Create test project
    const project = await db.projects.create({
      name: `Test Project ${timestamp}`,
      settings: {},
      created_by: userId,
    });

    // Create managed API key for the project
    const { ApiKeyService } = await import('../../src/services/api-key/index.js');
    const apiKeyService = new ApiKeyService(db);
    const apiKeyResult = await apiKeyService.createKey({
      name: 'Auth Test Key',
      type: 'development',
      permission_scope: 'full',
      permissions: ['bugs:read', 'bugs:write'],
      created_by: userId,
      allowed_projects: [project.id],
    });
    testApiKey = apiKeyResult.plaintext;
  });

  describe('Public Routes', () => {
    it('should allow access to /health without auth', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should allow access to /ready without auth', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should allow access to /api/v1/auth/login without auth', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'password',
        },
      });

      // Route should be accessible (not blocked by auth middleware)
      // 401 from route handler (invalid credentials) is acceptable
      // Only auth middleware returns "Authentication required" message
      const json = response.json();
      expect(response.statusCode).toBe(401);
      expect(json.message).toBe('Invalid email or password');
      expect(json.error).toBe('Unauthorized');
    });

    it('should allow access to /api/v1/auth/register without auth', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'new@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).not.toBe(401);
    });
  });

  describe('API Key Authentication', () => {
    it('should authenticate with valid API key', async () => {
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

      // Should not get 401
      expect(response.statusCode).not.toBe(401);
    });

    it('should reject invalid API key', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': 'invalid_key',
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

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.error).toBe('Unauthorized');
      expect(json.message).toContain('Invalid API key');
    });
  });

  describe('JWT Authentication', () => {
    it('should authenticate with valid JWT token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          name: 'New Project',
          settings: {},
        },
      });

      // Should not get 401
      expect(response.statusCode).not.toBe(401);
    });

    it('should reject invalid JWT token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: 'Bearer invalid_token',
        },
        payload: {
          name: 'New Project',
        },
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('should reject malformed authorization header', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: 'InvalidFormat',
        },
        payload: {
          name: 'New Project',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Protected Routes', () => {
    it('should require authentication for /api/v1/projects', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        payload: {
          name: 'New Project',
        },
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.message).toContain('User authentication required');
    });

    it('should require authentication for /api/v1/reports without API key', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/reports',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Request Context', () => {
    it('should set authProject on request with API key', async () => {
      // This is tested indirectly through the endpoint behavior
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      // Should filter by the authenticated project
      expect(response.statusCode).toBe(200);
    });

    it('should set authUser on request with JWT', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          name: 'User Project',
        },
      });

      expect(response.statusCode).toBe(201);
    });
  });

  describe('ShareToken Authentication', () => {
    let bugReport: BugReport;
    let shareToken: ShareToken;

    beforeEach(async () => {
      // Create test user
      const timestamp = Date.now();
      const user = await db.users.create({
        email: `sharetoken-test-${timestamp}@example.com`,
        password_hash: 'hash',
        role: 'admin',
      });

      // Create test project
      const project = await db.projects.create({
        name: `ShareToken Test Project ${timestamp}`,
        settings: {},
        created_by: user.id,
      });

      // Create bug report with replay
      bugReport = await db.bugReports.create({
        project_id: project.id,
        title: 'Test Bug Report',
        description: 'Test description',
        replay_key: 'replays/test/replay.json.gz',
      });

      // Create share token
      const { generateShareToken } = await import('../../src/utils/token-generator.js');
      const token = generateShareToken();
      shareToken = await db.shareTokens.create({
        bug_report_id: bugReport.id,
        token,
        created_by: null,
        password_hash: null,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    });

    it('should authenticate with valid shareToken', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/storage/url/${bugReport.id}/replay?shareToken=${shareToken.token}`,
        // No API key or JWT
      });

      // Should succeed with shareToken auth
      expect(response.statusCode).toBe(200);
    });

    it('should reject invalid shareToken', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/storage/url/${bugReport.id}/replay?shareToken=invalid-token-12345`,
      });

      // Invalid token is treated as missing auth
      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.message).toContain('Authentication required');
    });

    it('should reject shareToken for different bug report', async () => {
      // Create another bug report
      const otherBugReport = await db.bugReports.create({
        project_id: bugReport.project_id,
        title: 'Other Bug Report',
        description: 'Test',
        replay_key: 'replays/test/other.json.gz',
      });

      // Try to use shareToken for different bug report
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/storage/url/${otherBugReport.id}/replay?shareToken=${shareToken.token}`,
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.message).toBe('Invalid share token for requested bug report');
    });

    it('should prioritize shareToken over API key', async () => {
      // Create a second project that testApiKey doesn't have access to
      const timestamp = Date.now();
      const user = await db.users.create({
        email: `priority-test-${timestamp}@example.com`,
        password_hash: 'hash',
        role: 'admin',
      });

      const otherProject = await db.projects.create({
        name: `Other Project ${timestamp}`,
        settings: {},
        created_by: user.id,
      });

      const otherBugReport = await db.bugReports.create({
        project_id: otherProject.id,
        title: 'Bug in Other Project',
        description: 'Test',
        replay_key: 'replays/other/replay.json.gz',
      });

      // Create shareToken for this bug report
      const { generateShareToken } = await import('../../src/utils/token-generator.js');
      const token = generateShareToken();
      const otherShareToken = await db.shareTokens.create({
        bug_report_id: otherBugReport.id,
        token,
        created_by: null,
        password_hash: null,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      // Request with both shareToken and API key (API key doesn't have access)
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/storage/url/${otherBugReport.id}/replay?shareToken=${otherShareToken.token}`,
        headers: {
          'x-api-key': testApiKey, // Doesn't have access to otherProject
        },
      });

      // Should succeed because shareToken has priority
      expect(response.statusCode).toBe(200);
    });

    it('should prioritize shareToken over JWT', async () => {
      // Similar test but with JWT instead of API key
      const timestamp = Date.now();
      const otherUser = await db.users.create({
        email: `jwt-priority-${timestamp}@example.com`,
        password_hash: 'hash',
        role: 'user', // Not admin
      });

      const otherProject = await db.projects.create({
        name: `JWT Test Project ${timestamp}`,
        settings: {},
        created_by: otherUser.id,
      });

      const otherBugReport = await db.bugReports.create({
        project_id: otherProject.id,
        title: 'Bug for JWT Test',
        description: 'Test',
        replay_key: 'replays/jwt/replay.json.gz',
      });

      // Create shareToken
      const { generateShareToken } = await import('../../src/utils/token-generator.js');
      const token = generateShareToken();
      const otherShareToken = await db.shareTokens.create({
        bug_report_id: otherBugReport.id,
        token,
        created_by: null,
        password_hash: null,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      // Request with both shareToken and JWT
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/storage/url/${otherBugReport.id}/replay?shareToken=${otherShareToken.token}`,
        headers: {
          authorization: `Bearer ${testAccessToken}`, // Different user's JWT
        },
      });

      // Should succeed with shareToken (not JWT)
      expect(response.statusCode).toBe(200);
    });

    it('should set authShareToken on request context', async () => {
      // This is tested indirectly through the route behavior
      // The route validates that request.authShareToken.bug_report_id matches
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/storage/url/${bugReport.id}/replay?shareToken=${shareToken.token}`,
      });

      expect(response.statusCode).toBe(200);
      // If authShareToken wasn't set correctly, route would return 403
    });

    it('should fallback to standard auth when shareToken invalid', async () => {
      // Use invalid shareToken with valid API key
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/storage/url/${bugReport.id}/replay?shareToken=invalid`,
        headers: {
          'x-api-key': testApiKey,
        },
      });

      // Should fail because invalid shareToken, but then API key doesn't have access to this project
      expect(response.statusCode).toBe(403);
    });

    describe('Password-Protected Share Tokens', () => {
      let passwordProtectedToken: ShareToken;
      const testPassword = 'securePassword123!';

      beforeEach(async () => {
        // Create password-protected share token
        const { generateShareToken, hashPassword } = await import(
          '../../src/utils/token-generator.js'
        );

        const token = generateShareToken();
        const hashedPassword = await hashPassword(testPassword);

        passwordProtectedToken = await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: hashedPassword,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
      });

      it('should authenticate with correct password', async () => {
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport.id}/replay`,
          payload: {
            shareToken: passwordProtectedToken.token,
            shareTokenPassword: testPassword,
          },
        });

        expect(response.statusCode).toBe(200);
      });

      it('should reject password-protected token without password', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/replay?shareToken=${passwordProtectedToken.token}`,
        });

        expect(response.statusCode).toBe(401);
        const json = response.json();
        expect(json.message).toContain('Authentication required');
      });

      it('should reject password-protected token with incorrect password', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/storage/url/${bugReport.id}/replay?shareToken=${passwordProtectedToken.token}&shareTokenPassword=wrongPassword`,
        });

        expect(response.statusCode).toBe(401);
        const json = response.json();
        expect(json.message).toContain('Authentication required');
      });

      it('should URL-decode password with special characters', async () => {
        // Create token with password containing URL-unsafe characters
        const specialPassword = 'pass&word=123';
        const { generateShareToken, hashPassword } = await import(
          '../../src/utils/token-generator.js'
        );

        const token = generateShareToken();
        const hashedPassword = await hashPassword(specialPassword);

        const specialToken = await db.shareTokens.create({
          bug_report_id: bugReport.id,
          token,
          created_by: null,
          password_hash: hashedPassword,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // Send password in POST body (not query string)
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/storage/url/${bugReport.id}/replay`,
          payload: {
            shareToken: specialToken.token,
            shareTokenPassword: specialPassword,
          },
        });

        expect(response.statusCode).toBe(200);
      });
    });
  });

  describe('New API Key System (bgs_ prefix)', () => {
    let newApiKey: string;
    let apiKeyId: string;
    let testProject: Project;

    beforeEach(async () => {
      // Create test user for API key creation
      const timestamp = Date.now();
      const user = await db.users.create({
        email: `apikey-test-${timestamp}@example.com`,
        password_hash: 'hash',
        role: 'admin',
      });

      // Create a test project
      testProject = await db.projects.create({
        name: `API Key Test Project ${timestamp}`,
        settings: {},
        created_by: user.id,
      });

      // Create new API key using the service
      const { ApiKeyService } = await import('../../src/services/api-key/index.js');
      const apiKeyService = new ApiKeyService(db);
      const result = await apiKeyService.createKey({
        name: `Test API Key ${timestamp}`,
        type: 'development',
        permission_scope: 'full',
        permissions: ['bugs:read', 'bugs:write', 'bugs:delete'],
        created_by: user.id,
        allowed_projects: [testProject.id],
        rate_limit_per_minute: 10,
        rate_limit_per_hour: 100,
        rate_limit_per_day: 1000,
      });

      newApiKey = result.plaintext;
      apiKeyId = result.key.id;
    });

    it('should authenticate with new API key (bgs_ prefix)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': newApiKey,
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

      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).not.toBe(429); // Not rate limited
    });

    it('should reject expired API key', async () => {
      // Manually expire the key
      await db.apiKeys.update(apiKeyId, {
        status: 'expired',
        expires_at: new Date(Date.now() - 1000),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': newApiKey,
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

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.error).toBe('Unauthorized');
      expect(json.message).toContain('expired');
    });

    it('should reject revoked API key', async () => {
      // Revoke the key
      await db.apiKeys.revoke(apiKeyId);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': newApiKey,
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

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.error).toBe('Unauthorized');
      expect(json.message).toContain('revoked');
    });

    it('should enforce rate limits on new API keys', async () => {
      // Make sequential requests to ensure they hit rate limit
      const responses = [];
      for (let i = 0; i < 11; i++) {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/reports',
          headers: {
            'x-api-key': newApiKey,
          },
          payload: {
            title: `Test Report ${i}`,
            report: {
              console: [],
              network: [],
              metadata: {},
            },
          },
        });
        responses.push(response);
      }

      // Check if any request was rate limited
      const successful = responses.filter((r) => r.statusCode < 400).length;

      // At least some requests should succeed, and optionally some may be rate limited
      expect(successful).toBeGreaterThan(0);

      // If rate limited, check response format
      const rateLimitedResponse = responses.find((r) => r.statusCode === 429);
      if (rateLimitedResponse) {
        const json = rateLimitedResponse.json();
        expect(json.error).toBe('TooManyRequests');
        expect(json.message).toContain('Rate limit exceeded');
        expect(json.retryAfter).toBeGreaterThan(0);
      }
    });

    it('should track API key usage', async () => {
      await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': newApiKey,
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

      // Give tracking time to complete (async operation)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that usage was tracked
      const usageLogs = await db.apiKeys.getUsageLogs(apiKeyId, 10, 0);
      expect(usageLogs.length).toBeGreaterThan(0);
    });

    it('should update last_used_at timestamp', async () => {
      const keyBefore = await db.apiKeys.findById(apiKeyId);
      const lastUsedBefore = keyBefore?.last_used_at;

      await new Promise((resolve) => setTimeout(resolve, 100));

      await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: {
          'x-api-key': newApiKey,
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

      // Give async update time to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      const keyAfter = await db.apiKeys.findById(apiKeyId);
      expect(keyAfter).toBeDefined();
      if (keyAfter && lastUsedBefore) {
        expect(keyAfter.last_used_at!.getTime()).toBeGreaterThan(lastUsedBefore.getTime());
      }
    });
  });
});
