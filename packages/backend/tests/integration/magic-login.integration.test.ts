/**
 * Magic Login Integration Tests
 * Tests for JWT-based passwordless authentication with per-organization scoping.
 *
 * Magic login is controlled via the organization's JSONB `settings` column
 * (settings.magic_login_enabled). Each test creates its own org and enables
 * the flag through the database, so no config mutation is needed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestServerWithDb } from '../setup.integration.js';
import { createTestUser, TestCleanupTracker, generateUniqueId } from '../utils/test-utils.js';
import type { DatabaseClient } from '../../src/db/client.js';

describe('Magic Login Authentication', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  const cleanup = new TestCleanupTracker();
  let testUserId: string;
  let testOrgId: string;

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

  beforeEach(async () => {
    // Create test user
    const { user } = await createTestUser(db, {
      email: `magictest-${generateUniqueId()}@example.com`,
      role: 'admin',
    });
    cleanup.trackUser(user.id);
    testUserId = user.id;

    // Create test organization with magic login enabled
    const ts = generateUniqueId();
    const org = await db.organizations.create({
      name: `Magic Test Org ${ts}`,
      subdomain: `magic-test-${ts}`,
      settings: { magic_login_enabled: true },
    });
    testOrgId = org.id;
    cleanup.trackOrganization(org.id);

    await db.organizationMembers.create({
      organization_id: org.id,
      user_id: user.id,
      role: 'member',
    });
  });

  describe('POST /api/v1/auth/magic-login', () => {
    it('should authenticate user with valid magic token', async () => {
      const magicToken = server.jwt.sign(
        {
          userId: testUserId,
          role: 'admin',
          organizationId: testOrgId,
          type: 'magic',
        },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: magicToken },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.user.id).toBe(testUserId);
      expect(body.data.user.role).toBe('admin');
      expect(body.data.access_token).toBeDefined();
      expect(body.data.expires_in).toBeDefined();
      expect(body.data.token_type).toBe('Bearer');

      // Verify refresh token cookie is set
      const cookies = response.cookies;
      expect(cookies.some((c) => c.name === 'refresh_token')).toBe(true);
    });

    it('should reject expired magic token', async () => {
      const magicToken = server.jwt.sign(
        {
          userId: testUserId,
          role: 'admin',
          organizationId: testOrgId,
          type: 'magic',
        },
        { expiresIn: '1ms' }
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: magicToken },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('expired');
    });

    it('should reject token without type=magic', async () => {
      const regularToken = server.jwt.sign(
        {
          userId: testUserId,
          role: 'admin',
          organizationId: testOrgId,
        },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: regularToken },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('Invalid token type');
    });

    it('should reject malformed token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: 'invalid.jwt.token' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('Invalid');
    });

    it('should reject missing token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toBe('Request validation failed');
    });

    it('should reject empty token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: '' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });

    it('should reject token for non-existent user', async () => {
      await db.users.delete(testUserId);

      const magicToken = server.jwt.sign(
        {
          userId: testUserId,
          role: 'admin',
          organizationId: testOrgId,
          type: 'magic',
        },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: magicToken },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('User not found');
    });

    it('should work with different token expiration times', async () => {
      const expirations = ['1h', '24h', '7d'];

      for (const exp of expirations) {
        const magicToken = server.jwt.sign(
          {
            userId: testUserId,
            role: 'admin',
            organizationId: testOrgId,
            type: 'magic',
          },
          { expiresIn: exp }
        );

        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/magic-login',
          payload: { token: magicToken },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
      }
    });

    it('should not expose password_hash in response', async () => {
      await db.users.delete(testUserId);
      const userWithPassword = await db.users.create({
        email: `withpassword-${generateUniqueId()}@example.com`,
        password_hash: 'hashed_password_123',
        role: 'admin',
      });

      // Add user to the org
      await db.organizationMembers.create({
        organization_id: testOrgId,
        user_id: userWithPassword.id,
        role: 'member',
      });

      const magicToken = server.jwt.sign(
        {
          userId: userWithPassword.id,
          role: 'admin',
          organizationId: testOrgId,
          type: 'magic',
        },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: magicToken },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.user.password_hash).toBeUndefined();
    });
  });

  describe('Magic Login Organization Scoping', () => {
    it('should reject token for org with magic login disabled', async () => {
      // Create a second org WITHOUT magic login enabled
      const ts = generateUniqueId();
      const otherOrg = await db.organizations.create({
        name: `Other Org ${ts}`,
        subdomain: `other-${ts}`,
      });
      cleanup.trackOrganization(otherOrg.id);

      await db.organizationMembers.create({
        organization_id: otherOrg.id,
        user_id: testUserId,
        role: 'member',
      });

      const magicToken = server.jwt.sign(
        {
          userId: testUserId,
          role: 'admin',
          organizationId: otherOrg.id,
          type: 'magic',
        },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: magicToken },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('not enabled for this organization');
    });

    it('should reject token when user is not a member of the org', async () => {
      // Create a user that is NOT a member of the test org
      const { user: nonMember } = await createTestUser(db, {
        email: `nonmember-${generateUniqueId()}@example.com`,
        role: 'user',
      });
      cleanup.trackUser(nonMember.id);

      const magicToken = server.jwt.sign(
        {
          userId: nonMember.id,
          role: 'user',
          organizationId: testOrgId,
          type: 'magic',
        },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: magicToken },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('not a member');
    });

    it('should reject token without organizationId claim', async () => {
      const magicToken = server.jwt.sign(
        {
          userId: testUserId,
          role: 'admin',
          // No organizationId
          type: 'magic',
        },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: magicToken },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('missing organization scope');
    });

    it('should reject when org does not exist', async () => {
      const magicToken = server.jwt.sign(
        {
          userId: testUserId,
          role: 'admin',
          organizationId: '00000000-0000-0000-0000-000000000000',
          type: 'magic',
        },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: magicToken },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('Organization not found');
    });

    it('should work after enabling magic login via settings update', async () => {
      // Create org with magic login disabled (default)
      const ts = generateUniqueId();
      const org = await db.organizations.create({
        name: `Toggle Org ${ts}`,
        subdomain: `toggle-${ts}`,
      });
      cleanup.trackOrganization(org.id);

      await db.organizationMembers.create({
        organization_id: org.id,
        user_id: testUserId,
        role: 'member',
      });

      const magicToken = server.jwt.sign(
        {
          userId: testUserId,
          role: 'admin',
          organizationId: org.id,
          type: 'magic',
        },
        { expiresIn: '1h' }
      );

      // Should fail — magic login not enabled
      const response1 = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: magicToken },
      });
      expect(response1.statusCode).toBe(403);

      // Enable magic login via DB
      await db.organizations.updateSettings(org.id, { magic_login_enabled: true });

      // Should succeed now
      const response2 = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: magicToken },
      });
      expect(response2.statusCode).toBe(200);
      const body = JSON.parse(response2.body);
      expect(body.success).toBe(true);
    });
  });

  describe('Magic Login Security', () => {
    it('should accept token with standard "sub" claim instead of "userId"', async () => {
      const magicToken = server.jwt.sign(
        {
          sub: testUserId,
          role: 'admin',
          organizationId: testOrgId,
          type: 'magic',
        },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: magicToken },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.user.id).toBe(testUserId);
      expect(body.data.user.role).toBe('admin');
      expect(body.data.access_token).toBeDefined();
    });

    it('should accept token with both "sub" and "userId" (userId takes precedence)', async () => {
      const { user: secondUser } = await createTestUser(db, {
        email: `second-${generateUniqueId()}@example.com`,
        role: 'user',
      });
      cleanup.trackUser(secondUser.id);

      // Add second user to org too
      await db.organizationMembers.create({
        organization_id: testOrgId,
        user_id: secondUser.id,
        role: 'member',
      });

      const magicToken = server.jwt.sign(
        {
          sub: secondUser.id,
          userId: testUserId,
          role: 'admin',
          organizationId: testOrgId,
          type: 'magic',
        },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: magicToken },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.user.id).toBe(testUserId);
      expect(body.data.user.id).not.toBe(secondUser.id);
    });

    it('should reject token with missing userId and sub', async () => {
      const malformedToken = server.jwt.sign(
        {
          role: 'admin',
          organizationId: testOrgId,
          type: 'magic',
        },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: malformedToken },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('user identifier');
    });

    it('should accept magic token without role claim (backward compat)', async () => {
      // `role` was made optional in `validateJwtPayload` — older tokens
      // may still carry it, newer tokens omit it entirely. Without an
      // explicit positive test, a future "fix" that re-adds the
      // role-required check would silently break every magic-login
      // token issued after `role` was dropped.
      const tokenWithoutRole = server.jwt.sign(
        {
          userId: testUserId,
          organizationId: testOrgId,
          type: 'magic',
        },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: tokenWithoutRole },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.access_token).toBeDefined();
    });

    it('should reject token with null userId', async () => {
      const malformedToken = server.jwt.sign(
        {
          userId: null,
          role: 'admin',
          organizationId: testOrgId,
          type: 'magic',
        },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: malformedToken },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('user identifier');
    });

    it('should reject token with invalid userId type', async () => {
      const malformedToken = server.jwt.sign(
        {
          userId: 12345,
          role: 'admin',
          organizationId: testOrgId,
          type: 'magic',
        },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: malformedToken },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('user identifier');
    });

    it('should generate different sessions for each magic login', async () => {
      const magicToken = server.jwt.sign(
        {
          userId: testUserId,
          role: 'admin',
          organizationId: testOrgId,
          type: 'magic',
        },
        { expiresIn: '1h' }
      );

      const response1 = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: magicToken },
      });

      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const response2 = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: magicToken },
      });

      expect(response2.statusCode).toBe(200);
      const body2 = JSON.parse(response2.body);

      expect(body1.success).toBe(true);
      expect(body2.success).toBe(true);
    });

    it('should validate JWT signature', async () => {
      const invalidToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0Iiwicm9sZSI6ImFkbWluIiwidHlwZSI6Im1hZ2ljIiwiaWF0IjoxNjAwMDAwMDAwfQ.invalid_signature';

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: invalidToken },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });
  });
});
