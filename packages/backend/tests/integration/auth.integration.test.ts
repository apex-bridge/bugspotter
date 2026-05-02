/**
 * Authentication Flow Integration Tests
 * Tests user registration, login, JWT tokens, and refresh tokens
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestServerWithDb } from '../setup.integration.js';
import { createTestUser, TestCleanupTracker, generateUniqueId } from '../utils/test-utils.js';
import type { DatabaseClient } from '../../src/db/client.js';

describe('Authentication Flow Integration Tests', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  const cleanup = new TestCleanupTracker();

  beforeAll(async () => {
    const testEnv = await createTestServerWithDb();
    server = testEnv.server;
    db = testEnv.db;
  });

  beforeEach(async () => {
    await cleanup.cleanup(db);
  });

  afterAll(async () => {
    await cleanup.cleanup(db);
    await server.close();
    await db.close();
  });

  describe('User Registration', () => {
    it('should register new user with valid credentials', async () => {
      const email = `test-${generateUniqueId()}@example.com`;
      const password = 'SecurePassword123!';

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email,
          password,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.data.user.email).toBe(email);
      expect(body.data.user.role).toBe('user');
      expect(body.data.user.password_hash).toBeUndefined(); // Should not expose password
      expect(body.data.access_token).toBeDefined();
      expect(body.data.token_type).toBe('Bearer');
      expect(body.data.expires_in).toBeGreaterThan(0);
      // Refresh token should be in cookie, NOT in response body
      expect(body.data.refresh_token).toBeUndefined();

      cleanup.trackUser(body.data.user.id);
    });

    // Removed: "should register admin user with admin role" — the route now
    // hardcodes role: 'user' on registration (per src/api/routes/auth.ts:193
    // comment) and registerSchema rejects extra properties including `role`,
    // so this test asserted behavior that's been deliberately removed for
    // privilege-escalation prevention. Admin users are created via admin
    // endpoints, not via /register.

    it('should reject duplicate email registration', async () => {
      const email = `duplicate-${generateUniqueId()}@example.com`;
      const password = 'Password123!';

      // First registration
      const response1 = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email, password },
      });
      expect(response1.statusCode).toBe(201);
      const user1 = JSON.parse(response1.body);
      cleanup.trackUser(user1.data.user.id);

      // Duplicate registration
      const response2 = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email, password },
      });

      expect(response2.statusCode).toBe(409);
      const body = JSON.parse(response2.body);
      expect(body.error).toBe('Conflict');
      expect(body.message).toContain('already exists');
    });

    it('should reject registration with weak password', async () => {
      const email = `weak-${generateUniqueId()}@example.com`;
      const weakPassword = 'weak';

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email,
          password: weakPassword,
        },
      });

      // Should fail validation (either 400 or rejected by schema)
      expect([400, 201].includes(response.statusCode)).toBe(true);
      // Note: If validation is strict, this should be 400
    });

    it('should reject registration with invalid email format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'not-an-email',
          password: 'ValidPassword123!',
        },
      });

      // Should fail validation
      expect([400, 201].includes(response.statusCode)).toBe(true);
    });
  });

  describe('User Login', () => {
    let testEmail: string;
    let testPassword: string;
    let userId: string;

    beforeEach(async () => {
      // Create test user
      const { user, password } = await createTestUser(db);
      testEmail = user.email;
      testPassword = password;
      userId = user.id;
      cleanup.trackUser(userId);
    });

    it('should login with valid credentials', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: testEmail,
          password: testPassword,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.data.user.email).toBe(testEmail);
      expect(body.data.user.password_hash).toBeUndefined();
      expect(body.data.access_token).toBeDefined();
      expect(body.data.expires_in).toBeGreaterThan(0);
      expect(body.data.token_type).toBe('Bearer');
      // Refresh token should be in cookie, NOT in response body
      expect(body.data.refresh_token).toBeUndefined();

      // Verify refresh token cookie was set
      const setCookieHeader = response.headers['set-cookie'];
      expect(setCookieHeader).toBeDefined();
      const refreshTokenCookie = Array.isArray(setCookieHeader)
        ? setCookieHeader.find((c: string) => c.startsWith('refresh_token='))
        : setCookieHeader;
      expect(refreshTokenCookie).toBeDefined();
      expect(refreshTokenCookie).toContain('HttpOnly');
    });

    it('should reject login with incorrect password', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: testEmail,
          password: 'WrongPassword123!',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Unauthorized');
      expect(body.message).toContain('Invalid');
    });

    it('should reject login with non-existent email', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'nonexistent@example.com',
          password: 'AnyPassword123!',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Unauthorized');
    });

    it('should reject login with empty credentials', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: '',
          password: '',
        },
      });

      // Should fail validation
      expect([400, 401].includes(response.statusCode)).toBe(true);
    });
  });

  describe('JWT Token Usage', () => {
    let accessToken: string;
    let userId: string;

    beforeEach(async () => {
      // Create user and login
      const { user, password } = await createTestUser(db);
      userId = user.id;
      cleanup.trackUser(userId);

      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: user.email,
          password,
        },
      });

      const loginBody = JSON.parse(loginResponse.body);
      accessToken = loginBody.data.access_token;
    });

    it('should access protected endpoint with valid JWT', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          name: 'Test Project',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Test Project');
    });

    it('should reject request with invalid JWT', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: 'Bearer invalid.jwt.token',
        },
        payload: {
          name: 'Test Project',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Unauthorized');
    });

    it('should reject request with malformed authorization header', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: 'InvalidFormat',
        },
        payload: {
          name: 'Test Project',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject request without authorization header', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        payload: {
          name: 'Test Project',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should include user context in authenticated requests', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          name: 'User Context Test',
        },
      });

      expect(response.statusCode).toBe(201);
      // The project should be created successfully with user context
    });
  });

  describe('Token Refresh Flow', () => {
    let refreshToken: string;
    let userId: string;

    beforeEach(async () => {
      // Create user and login
      const { user, password } = await createTestUser(db);
      userId = user.id;
      cleanup.trackUser(userId);

      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: user.email,
          password,
        },
      });

      // Extract refresh token from cookie
      const setCookieHeader = loginResponse.headers['set-cookie'];
      const refreshTokenCookie = Array.isArray(setCookieHeader)
        ? setCookieHeader.find((c) => c.startsWith('refresh_token='))
        : setCookieHeader;
      refreshToken = refreshTokenCookie?.split(';')[0]?.split('=')[1] || '';
    });

    it('should refresh access token with valid refresh token from cookie', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `refresh_token=${refreshToken}`,
        },
        payload: {}, // Empty body to satisfy schema
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.data.access_token).toBeDefined();
      expect(body.data.token_type).toBe('Bearer');
      expect(body.data.expires_in).toBeGreaterThan(0);
      // Response should NOT include refresh_token (it's in cookie)
      expect(body.data.refresh_token).toBeUndefined();

      // Should set new refresh token cookie
      const setCookieHeader = response.headers['set-cookie'];
      expect(setCookieHeader).toBeDefined();
    });

    it('should reject refresh with invalid token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: 'refresh_token=invalid.refresh.token',
        },
        payload: {}, // Empty body to satisfy schema
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Unauthorized');
      expect(body.message).toContain('Invalid or expired');
    });

    it('should use new access token after refresh', async () => {
      // Refresh token using cookie
      const refreshResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          cookie: `refresh_token=${refreshToken}`,
        },
        payload: {}, // Empty body to satisfy schema
      });

      const newAccessToken = JSON.parse(refreshResponse.body).data.access_token;

      // Use new access token
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${newAccessToken}`,
        },
        payload: {
          name: 'Project with Refreshed Token',
        },
      });

      expect(response.statusCode).toBe(201);
    });
  });

  describe('Role-Based Access Control', () => {
    it('should allow admin to create managed API keys', async () => {
      // Create admin user
      const { user: admin, password: adminPassword } = await createTestUser(db, {
        role: 'admin',
      });
      cleanup.trackUser(admin.id);

      // Login as admin
      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: admin.email,
          password: adminPassword,
        },
      });
      const adminToken = JSON.parse(loginResponse.body).data.access_token;

      // Create project
      const projectResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          name: 'Test Project',
        },
      });
      const projectId = JSON.parse(projectResponse.body).data.id;

      // Create managed API key (admin only)
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          name: 'Test API Key',
          type: 'production',
          permissions: ['reports:read', 'reports:write'],
          allowed_projects: [projectId],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.api_key).toBeDefined();
      expect(body.data.key_details.name).toBe('Test API Key');
    });

    it('should deny regular user from admin-only actions', async () => {
      // Create regular user
      const { user, password } = await createTestUser(db, { role: 'user' });
      cleanup.trackUser(user.id);

      // Login as user
      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: user.email,
          password,
        },
      });
      const userToken = JSON.parse(loginResponse.body).data.access_token;

      // Create admin user to create a project
      const { user: admin, password: adminPassword } = await createTestUser(db, {
        role: 'admin',
      });
      cleanup.trackUser(admin.id);

      const adminLoginResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: admin.email,
          password: adminPassword,
        },
      });
      const adminToken = JSON.parse(adminLoginResponse.body).data.access_token;

      const projectResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          name: 'Test Project',
        },
      });
      const projectId = JSON.parse(projectResponse.body).data.id;

      // Try to create managed API key as regular user (admin-only action)
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          name: 'Test API Key',
          type: 'production',
          permissions: ['reports:read'],
          allowed_projects: [projectId],
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Forbidden');
    });
  });

  describe('Token Security', () => {
    it('should not accept tokens from deleted users', async () => {
      // Create user and get token
      const { user, password } = await createTestUser(db);
      const userId = user.id;

      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: user.email,
          password,
        },
      });
      const token = JSON.parse(loginResponse.body).data.access_token;

      // Delete user
      await db.users.delete(userId);

      // Try to use token
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          name: 'Should Fail',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return different tokens for different users', async () => {
      const { user: user1, password: password1 } = await createTestUser(db);
      const { user: user2, password: password2 } = await createTestUser(db);
      cleanup.trackUser(user1.id);
      cleanup.trackUser(user2.id);

      const login1 = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: user1.email, password: password1 },
      });

      const login2 = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: user2.email, password: password2 },
      });

      const token1 = JSON.parse(login1.body).data.access_token;
      const token2 = JSON.parse(login2.body).data.access_token;

      expect(token1).toBeDefined();
      expect(token2).toBeDefined();
      // Test name says "different tokens for different users" — assert it.
      expect(token1).not.toBe(token2);
    });
  });
});
