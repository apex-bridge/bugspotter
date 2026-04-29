/**
 * Authentication Routes Tests
 * Tests for user registration, login, and token refresh
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage, createAdminUser } from '../test-helpers.js';

/**
 * Create a server with a different ALLOW_REGISTRATION value.
 * Uses vi.resetModules() so config.ts re-evaluates from process.env.
 * The caller's existing server/db references remain unaffected.
 */
async function createServerWithRegistration(db: DatabaseClient, allowed: boolean) {
  const original = process.env.ALLOW_REGISTRATION;
  process.env.ALLOW_REGISTRATION = String(allowed);
  vi.resetModules();

  const { createServer: freshCreateServer } = await import('../../src/api/server.js');
  const server = await freshCreateServer({
    db,
    storage: createMockStorage(),
    pluginRegistry: createMockPluginRegistry(),
  });
  await server.ready();

  // Restore env var — doesn't affect the already-created server
  process.env.ALLOW_REGISTRATION = original;
  vi.resetModules();

  return server;
}

/**
 * Create a server with REQUIRE_INVITATION_TO_REGISTER enabled.
 * Uses the same vi.resetModules() approach as createServerWithRegistration.
 */
async function createServerWithInvitationRequired(db: DatabaseClient) {
  const origAllow = process.env.ALLOW_REGISTRATION;
  const origRequire = process.env.REQUIRE_INVITATION_TO_REGISTER;
  process.env.ALLOW_REGISTRATION = 'true';
  process.env.REQUIRE_INVITATION_TO_REGISTER = 'true';
  vi.resetModules();

  const { createServer: freshCreateServer } = await import('../../src/api/server.js');
  const server = await freshCreateServer({
    db,
    storage: createMockStorage(),
    pluginRegistry: createMockPluginRegistry(),
  });
  await server.ready();

  process.env.ALLOW_REGISTRATION = origAllow;
  process.env.REQUIRE_INVITATION_TO_REGISTER = origRequire;
  vi.resetModules();

  return server;
}

describe('Auth Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;

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

  describe('POST /api/v1/auth/register', () => {
    beforeEach(async () => {
      // Clean up users table before each test for isolation
      await db.query('DELETE FROM users');
    });

    it('should register a new user', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.user.email).toBe('test@example.com');
      expect(json.data.user.role).toBe('user');
      expect(json.data.access_token).toBeDefined();
      // refresh_token is in httpOnly cookie, not in body
      expect(json.data.user.password_hash).toBeUndefined();
    });

    it('should reject registration with extra properties (prevent privilege escalation)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'attacker@example.com',
          password: 'password123',
          role: 'admin', // Extra property not in schema
        },
      });

      // Schema validation rejects additional properties with 400 error
      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('ValidationError');
    });

    it('should reject duplicate email', async () => {
      // Create first user
      await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'duplicate@example.com',
          password: 'password123',
        },
      });

      // Try to create duplicate
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'duplicate@example.com',
          password: 'password456',
        },
      });

      expect(response.statusCode).toBe(409);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Conflict');
    });

    it('should reject invalid email format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'invalid-email',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error).toBe('ValidationError');
    });

    it('should reject short password', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'shortpass@example.com',
          password: 'short',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error).toBe('ValidationError');
    });

    it('should default to user role', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'default-role@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.data.user.role).toBe('user');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      await db.query('DELETE FROM users');
      // Create a test user
      await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'login@example.com',
          password: 'password123',
        },
      });
    });

    it('should login with valid credentials', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'login@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.user.email).toBe('login@example.com');
      expect(json.data.access_token).toBeDefined();
      // refresh_token is in httpOnly cookie, not in body
    });

    it('should reject invalid email', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'nonexistent@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Unauthorized');
      expect(json.message).toContain('Invalid email or password');
    });

    it('should reject invalid password', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'login@example.com',
          password: 'wrongpassword',
        },
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Unauthorized');
    });
  });

  describe('POST /api/v1/auth/login — SaaS org-access revocation', () => {
    // SaaS mode rejects login when a user authenticated successfully
    // but has zero non-deleted org memberships. The point is to make
    // a leaked password against a "deleted" tenant useless and to
    // give the user a clear "access revoked" message instead of an
    // empty dashboard. Platform admins are exempt; selfhosted mode
    // is exempt (saas schema is empty there by design).
    let saasServer: FastifyInstance;

    beforeAll(async () => {
      const originalMode = process.env.DEPLOYMENT_MODE;
      process.env.DEPLOYMENT_MODE = 'saas';
      const { resetDeploymentConfig } = await import('../../src/saas/config.js');
      resetDeploymentConfig();
      vi.resetModules();

      const { createServer: freshCreateServer } = await import('../../src/api/server.js');
      saasServer = await freshCreateServer({
        db,
        storage: createMockStorage(),
        pluginRegistry: createMockPluginRegistry(),
      });
      await saasServer.ready();

      // Restore env var — the already-created server has its config baked in.
      process.env.DEPLOYMENT_MODE = originalMode;
      resetDeploymentConfig();
      vi.resetModules();
    });

    afterAll(async () => {
      await saasServer.close();
    });

    beforeEach(async () => {
      // Wipe in dependency order so FK constraints don't bite.
      await db.query('DELETE FROM saas.organization_members');
      await db.query('DELETE FROM saas.subscriptions');
      await db.query('DELETE FROM saas.organizations');
      await db.query('DELETE FROM users');
    });

    it('rejects login when user has zero active org memberships', async () => {
      // Insert a user directly so we don't depend on the register
      // route being enabled in saas mode. password_hash is bcrypt of
      // 'password123' generated on the fly.
      const bcrypt = (await import('bcrypt')).default;
      const passwordHash = await bcrypt.hash('password123', 10);
      await db.query(
        `INSERT INTO users (id, email, password_hash, role) VALUES (gen_random_uuid(), $1, $2, 'user')`,
        ['noorg@example.com', passwordHash]
      );

      const response = await saasServer.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'noorg@example.com', password: 'password123' },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('OrgAccessRevoked');
    });

    it('allows login for platform admins regardless of org memberships', async () => {
      const bcrypt = (await import('bcrypt')).default;
      const passwordHash = await bcrypt.hash('password123', 10);
      await db.query(
        `INSERT INTO users (id, email, password_hash, role) VALUES (gen_random_uuid(), $1, $2, 'admin')`,
        ['admin@example.com', passwordHash]
      );

      const response = await saasServer.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'admin@example.com', password: 'password123' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.access_token).toBeDefined();
    });

    it('rejects refresh when user has zero active org memberships', async () => {
      // Insert a user (no org) and sign a refresh JWT for them
      // directly. This bypasses the login gate so we can isolate the
      // refresh path — login already proved it's gated; this test
      // covers the scenario where a refresh cookie was issued before
      // the org was soft-deleted and the user is now trying to use
      // it.
      const userId = (
        await db.query<{ id: string }>(
          `INSERT INTO users (id, email, password_hash, role) VALUES (gen_random_uuid(), $1, 'unused', 'user') RETURNING id`,
          ['stale-refresh@example.com']
        )
      ).rows[0].id;

      const refresh_token = saasServer.jwt.sign({
        userId,
        isPlatformAdmin: false,
      });

      const response = await saasServer.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refresh_token },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('OrgAccessRevoked');
    });
  });

  describe('POST /api/v1/auth/register — name field', () => {
    beforeEach(async () => {
      await db.query('DELETE FROM users');
    });

    it('should register a user with a name', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'named@example.com',
          name: 'Jane Doe',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.data.user.name).toBe('Jane Doe');
      expect(json.data.user.email).toBe('named@example.com');
    });

    it('should register a user without a name (optional)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'noname@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.data.user.name).toBeNull();
    });
  });

  describe('Registration disabled (separate server with ALLOW_REGISTRATION=false)', () => {
    let disabledServer: FastifyInstance;

    beforeAll(async () => {
      disabledServer = await createServerWithRegistration(db, false);
    });

    afterAll(async () => {
      await disabledServer.close();
    });

    it('should return 403 when trying to register', async () => {
      const response = await disabledServer.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'blocked@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
      expect(json.message).toContain('Registration is currently disabled');
    });

    it('should return allowed: false from registration-status', async () => {
      const response = await disabledServer.inject({
        method: 'GET',
        url: '/api/v1/auth/registration-status',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.allowed).toBe(false);
    });
  });

  describe('Invitation-only registration (separate server with REQUIRE_INVITATION_TO_REGISTER=true)', () => {
    let invServer: FastifyInstance;
    let orgId: string;
    let adminUserId: string;
    let adminToken: string;

    beforeAll(async () => {
      invServer = await createServerWithInvitationRequired(db);

      // Create admin user and org for invitation tests
      const admin = await createAdminUser(invServer, db, 'inv-reg');
      adminUserId = admin.user.id;
      adminToken = admin.token;

      const orgResponse = await invServer.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: `Inv Reg Test Org`,
          subdomain: `inv-reg-${Date.now()}`,
          owner_user_id: adminUserId,
        },
      });
      expect(orgResponse.statusCode).toBe(201);
      orgId = orgResponse.json().data.id;
    });

    afterAll(async () => {
      // Clean up invitation test data (order matters due to FK constraints)
      try {
        await db.query('DELETE FROM saas.organization_invitations WHERE organization_id = $1', [
          orgId,
        ]);
      } catch {
        /* ignore */
      }
      try {
        await db.query('DELETE FROM saas.organization_members WHERE organization_id = $1', [orgId]);
      } catch {
        /* ignore */
      }
      try {
        await db.organizations.delete(orgId);
      } catch {
        /* ignore */
      }
      await invServer.close();
    });

    /**
     * Helper: create a pending invitation directly in the database.
     * Bypasses API routes to avoid JWT issues with vi.resetModules() servers.
     */
    async function createInvitationToken(email: string): Promise<string> {
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await db.invitations.create({
        organization_id: orgId,
        email,
        role: 'member',
        invited_by: adminUserId,
        token,
        expires_at: expiresAt,
      });

      return token;
    }

    it('should reject registration without invite_token', async () => {
      const response = await invServer.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'no-token@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.error).toBe('InvitationRequired');
    });

    it('should reject registration with invalid token', async () => {
      const response = await invServer.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'bad-token@example.com',
          password: 'password123',
          invite_token: 'a'.repeat(64),
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject registration with email mismatch', async () => {
      const token = await createInvitationToken('invited@example.com');
      const response = await invServer.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'different@example.com',
          password: 'password123',
          invite_token: token,
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe('EmailMismatch');
    });

    it('should register successfully with valid invite_token', async () => {
      const email = `valid-inv-${Date.now()}@example.com`;
      const token = await createInvitationToken(email);

      const response = await invServer.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email,
          password: 'password123',
          invite_token: token,
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.user.email).toBe(email);
      expect(json.data.access_token).toBeDefined();
    });

    it('should auto-accept invitation after registration', async () => {
      const email = `auto-accept-${Date.now()}@example.com`;
      const token = await createInvitationToken(email);

      const regResponse = await invServer.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email,
          password: 'password123',
          invite_token: token,
        },
      });

      // Verify the invitation was auto-accepted
      const invitation = await db.invitations.findByToken(token);
      expect(invitation?.status).toBe('accepted');

      // Verify user was added as org member
      const userId = regResponse.json().data.user.id;
      const membership = await db.organizationMembers.findMembership(orgId, userId);
      expect(membership).toBeDefined();
      expect(membership!.role).toBe('member');
    });

    it('should return requireInvitation: true from registration-status', async () => {
      const response = await invServer.inject({
        method: 'GET',
        url: '/api/v1/auth/registration-status',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.allowed).toBe(true);
      expect(json.data.requireInvitation).toBe(true);
    });
  });

  describe('GET /api/v1/auth/registration-status', () => {
    it('should return allowed: true and requireInvitation: false when open registration is enabled', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/registration-status',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.allowed).toBe(true);
      expect(json.data.requireInvitation).toBe(false);
    });

    it('should be accessible without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/registration-status',
      });

      // No Authorization header — should still work (public endpoint)
      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    beforeEach(async () => {
      await db.query('DELETE FROM users');
    });

    it('should refresh tokens with valid refresh token', async () => {
      // Register and get tokens
      const registerResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'refresh@example.com',
          password: 'password123',
        },
      });

      // Extract refresh token from cookie
      const setCookieHeader = registerResponse.headers['set-cookie'];
      const refreshTokenCookie = Array.isArray(setCookieHeader)
        ? setCookieHeader.find((c: string) => c.startsWith('refresh_token='))
        : setCookieHeader;
      const refresh_token = refreshTokenCookie?.split(';')[0]?.split('=')[1] || '';

      // Refresh tokens using body (backward compatibility)
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: {
          refresh_token,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.access_token).toBeDefined();
      // refresh_token is in httpOnly cookie, not in body
    });

    it('should reject invalid refresh token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: {
          refresh_token: 'invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Unauthorized');
    });
  });
});
