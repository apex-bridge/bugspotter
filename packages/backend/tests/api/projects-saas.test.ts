/**
 * Project Routes Tests — SaaS Mode
 * Tests project creation with organization scoping in multi-tenant mode.
 *
 * These tests boot the server with DEPLOYMENT_MODE=saas so the tenant
 * middleware is active. They verify that:
 * - Org subdomain requests use the middleware-resolved org
 * - Hub domain requests require organization_id in the body
 * - Self-hosted behavior is unaffected (tested in projects.test.ts)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { resetDeploymentConfig } from '../../src/saas/config.js';
import { createMockPluginRegistry, createMockStorage, createAdminUser } from '../test-helpers.js';

describe('Project Routes — SaaS Mode', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let adminToken: string;
  let orgId: string;
  let orgSubdomain: string;

  const originalDeploymentMode = process.env.DEPLOYMENT_MODE;

  beforeAll(async () => {
    // Must set BEFORE createServer so tenant middleware registers
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();
    server = await createServer({ db, storage, pluginRegistry });
    await server.ready();
  });

  afterAll(async () => {
    // Restore original env
    if (originalDeploymentMode === undefined) {
      delete process.env.DEPLOYMENT_MODE;
    } else {
      process.env.DEPLOYMENT_MODE = originalDeploymentMode;
    }
    resetDeploymentConfig();
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);

    // Create admin user
    const admin = await createAdminUser(server, db, 'saas-proj');
    adminToken = admin.token;

    // Create a test organization with subscription (required for quota check)
    orgSubdomain = `testorg-${timestamp}-${randomId}`;
    const org = await db.organizations.create({
      name: `Test Org ${randomId}`,
      subdomain: orgSubdomain,
      subscription_status: 'trial',
    });
    orgId = org.id;

    // createProjectWithQuotaCheck requires a subscription record
    const now = new Date();
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db.subscriptions.create({
      organization_id: orgId,
      plan_name: 'starter',
      status: 'trial',
      current_period_start: now,
      current_period_end: thirtyDaysLater,
      quotas: { max_projects: 10, max_bug_reports: 1000, max_storage_mb: 500 },
    });

    // Tenant-match middleware (cross-tenant guard) requires the authenticated
    // user to be a member of the org whose subdomain they're acting under.
    // application-level `role: 'admin'` is not platform-admin, so it gets
    // checked too — add the test admin as a member of the test org.
    await db.organizationMembers.createWithUser(orgId, admin.user.id, 'admin');
  });

  describe('POST /api/v1/projects — org subdomain', () => {
    it('should create project with organization_id from tenant middleware', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${adminToken}`,
          // 3+ parts triggers subdomain extraction
          host: `${orgSubdomain}.example.com`,
        },
        payload: {
          name: 'Subdomain Project',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Subdomain Project');
      expect(json.data.organization_id).toBe(orgId);
    });

    it('should ignore body organization_id when on org subdomain (middleware wins)', async () => {
      const fakeOrgId = '00000000-0000-0000-0000-000000000099';

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${adminToken}`,
          host: `${orgSubdomain}.example.com`,
        },
        payload: {
          name: 'Middleware Wins Project',
          organization_id: fakeOrgId,
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      // Should use middleware org, not body org
      expect(json.data.organization_id).toBe(orgId);
    });
  });

  describe('POST /api/v1/projects — hub domain (no subdomain)', () => {
    it('should create project when organization_id provided in body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${adminToken}`,
          // 2 parts = no subdomain (hub domain)
          host: 'example.com',
        },
        payload: {
          name: 'Hub Domain Project',
          organization_id: orgId,
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Hub Domain Project');
      expect(json.data.organization_id).toBe(orgId);
    });

    it('should return 400 when organization_id is missing from body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${adminToken}`,
          host: 'example.com',
        },
        payload: {
          name: 'No Org Project',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error).toBe('ValidationError');
      expect(json.message).toContain('organization_id');
    });

    it('should return 404 when organization_id references non-existent org', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${adminToken}`,
          host: 'example.com',
        },
        payload: {
          name: 'Bad Org Project',
          organization_id: '00000000-0000-0000-0000-000000000000',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/projects — hub domain authorization', () => {
    it('should return 403 when non-admin user is not a member of the organization', async () => {
      // Create a regular (non-admin) user with no org membership
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(7);
      const passwordHash = await bcrypt.hash('password123', 10);
      const regularUser = await db.users.create({
        email: `regular-${timestamp}-${randomId}@example.com`,
        password_hash: passwordHash,
        role: 'user',
      });
      const regularToken = server.jwt.sign(
        { userId: regularUser.id, role: 'user' },
        { expiresIn: '1h' }
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${regularToken}`,
          host: 'example.com',
        },
        payload: {
          name: 'Unauthorized Project',
          organization_id: orgId,
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.message).toContain('not a member');
    });

    it('should allow non-admin user who is a member to create project', async () => {
      // Create a regular user and add them as org member
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(7);
      const passwordHash = await bcrypt.hash('password123', 10);
      const memberUser = await db.users.create({
        email: `member-${timestamp}-${randomId}@example.com`,
        password_hash: passwordHash,
        role: 'user',
      });
      const memberToken = server.jwt.sign(
        { userId: memberUser.id, role: 'user' },
        { expiresIn: '1h' }
      );

      // Add user as member of the org
      await db.organizationMembers.createWithUser(orgId, memberUser.id, 'member');

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${memberToken}`,
          host: 'example.com',
        },
        payload: {
          name: 'Member Project',
          organization_id: orgId,
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.organization_id).toBe(orgId);
    });
  });

  describe('GET /api/v1/projects — hub domain', () => {
    it('should list projects for admin on hub domain', async () => {
      // First create a project via subdomain
      await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${adminToken}`,
          host: `${orgSubdomain}.example.com`,
        },
        payload: {
          name: 'Listed Project',
        },
      });

      // Then list from hub domain
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${adminToken}`,
          host: 'example.com',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('platform admin filters by organization_id query param on hub domain', async () => {
      // Create a second org with one project so we can prove the filter narrows.
      const otherOrg = await db.organizations.create({
        name: `Other Org ${Date.now()}`,
        subdomain: `otherorg-${Date.now()}`,
        subscription_status: 'trial',
      });
      const now = new Date();
      await db.subscriptions.create({
        organization_id: otherOrg.id,
        plan_name: 'starter',
        status: 'trial',
        current_period_start: now,
        current_period_end: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        quotas: { max_projects: 10, max_bug_reports: 1000, max_storage_mb: 500 },
      });

      await db.projects.create({ name: 'In Test Org', organization_id: orgId });
      await db.projects.create({ name: 'In Other Org', organization_id: otherOrg.id });

      // Hub domain, filter to first org
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects?organization_id=${orgId}`,
        headers: { authorization: `Bearer ${adminToken}`, host: 'example.com' },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      const orgIds: string[] = json.data.map((p: { organization_id: string }) => p.organization_id);
      expect(orgIds.every((id) => id === orgId)).toBe(true);
      expect(orgIds).toContain(orgId);
      expect(orgIds).not.toContain(otherOrg.id);
    });

    it('tenant subdomain context wins over query param (admin cannot widen via ?organization_id=)', async () => {
      // Set up a second org with its own project.
      const ts = Date.now();
      const otherOrg = await db.organizations.create({
        name: `Precedence Other ${ts}`,
        subdomain: `precedence-${ts}`,
        subscription_status: 'trial',
      });
      const now = new Date();
      await db.subscriptions.create({
        organization_id: otherOrg.id,
        plan_name: 'starter',
        status: 'trial',
        current_period_start: now,
        current_period_end: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        quotas: { max_projects: 10, max_bug_reports: 1000, max_storage_mb: 500 },
      });

      await db.projects.create({ name: 'In test org', organization_id: orgId });
      await db.projects.create({ name: 'In other org', organization_id: otherOrg.id });

      // Hit the test org's subdomain BUT pass `?organization_id=` pointing at
      // the other org. The subdomain context should win, so we should see
      // ONLY test-org's projects.
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects?organization_id=${otherOrg.id}`,
        headers: {
          authorization: `Bearer ${adminToken}`,
          host: `${orgSubdomain}.example.com`,
        },
      });

      expect(response.statusCode).toBe(200);
      const orgIds: string[] = response
        .json()
        .data.map((p: { organization_id: string }) => p.organization_id);
      expect(orgIds).toContain(orgId);
      expect(orgIds).not.toContain(otherOrg.id);
    });

    it('rejects malformed organization_id query param', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects?organization_id=not-a-uuid',
        headers: { authorization: `Bearer ${adminToken}`, host: 'example.com' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('non-admin user has organization_id query param ignored (still scoped to their access)', async () => {
      // Create a regular (non-platform-admin) user, member of test org only
      const timestamp = Date.now();
      const memberEmail = `regular-${timestamp}@example.com`;
      const passwordHash = await bcrypt.hash('Password123!', 10);
      const memberUser = await db.users.create({
        email: memberEmail,
        name: 'Regular Member',
        password_hash: passwordHash,
        role: 'user', // app-level role, NOT platform admin
        email_verified_at: new Date(),
      });
      await db.organizationMembers.createWithUser(orgId, memberUser.id, 'member');

      // Project in test org (member should see it) + project in OTHER org (member must NOT)
      const otherOrg = await db.organizations.create({
        name: `Other Org ${timestamp}`,
        subdomain: `otherorg2-${timestamp}`,
        subscription_status: 'trial',
      });
      await db.projects.create({ name: 'Member-org project', organization_id: orgId });
      await db.projects.create({ name: 'Other-org project', organization_id: otherOrg.id });

      const loginRes = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: memberEmail, password: 'Password123!' },
      });
      expect(loginRes.statusCode).toBe(200);
      const token = loginRes.json().data.access_token as string;

      // Pass `?organization_id=` pointing at the OTHER org. A platform admin
      // would get the other-org's projects; a regular user should still only
      // see their own org's, because the param is consumed inside the
      // platform-admin branch only.
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects?organization_id=${otherOrg.id}`,
        headers: { authorization: `Bearer ${token}`, host: 'example.com' },
      });

      expect(response.statusCode).toBe(200);
      const orgIds: string[] = response
        .json()
        .data.map((p: { organization_id: string }) => p.organization_id);
      // Filter ignored: caller never sees the other org's data.
      expect(orgIds).not.toContain(otherOrg.id);
    });
  });
});
