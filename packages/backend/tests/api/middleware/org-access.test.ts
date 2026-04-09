/**
 * Organization Access Middleware Tests
 * Tests for requireOrgAccess and requireOrgRole middleware
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../../src/api/server.js';
import { createDatabaseClient } from '../../../src/db/client.js';
import type { DatabaseClient } from '../../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage } from '../../test-helpers.js';

describe('Organization Access Middleware', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let testOrg: { id: string };
  let adminUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let ownerToken: string;
  let adminToken: string;
  let memberToken: string;
  let outsiderToken: string;

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
    const timestamp = Date.now();

    // Create test users
    const ownerResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `org-owner-${timestamp}@example.com`,
        password: 'password123',
      },
    });
    ownerToken = ownerResponse.json().data.access_token;

    const adminResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `org-admin-${timestamp}@example.com`,
        password: 'password123',
      },
    });
    adminToken = adminResponse.json().data.access_token;
    adminUser = adminResponse.json().data.user;

    const memberResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `org-member-${timestamp}@example.com`,
        password: 'password123',
      },
    });
    memberToken = memberResponse.json().data.access_token;
    memberUser = memberResponse.json().data.user;

    const outsiderResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `outsider-${timestamp}@example.com`,
        password: 'password123',
      },
    });
    outsiderToken = outsiderResponse.json().data.access_token;

    // Create test organization (owner is automatically added)
    const createOrgResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        name: `Test Org ${timestamp}`,
        subdomain: `test-org-${timestamp}`,
        data_residency_region: 'us',
      },
    });
    testOrg = createOrgResponse.json().data;

    // Add admin member
    await server.inject({
      method: 'POST',
      url: `/api/v1/organizations/${testOrg.id}/members`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        user_id: adminUser.id,
        role: 'admin',
      },
    });

    // Add regular member
    await server.inject({
      method: 'POST',
      url: `/api/v1/organizations/${testOrg.id}/members`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        user_id: memberUser.id,
        role: 'member',
      },
    });
  });

  describe('requireOrgAccess - GET /api/v1/organizations/:id', () => {
    it('should allow organization owner to access', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(testOrg.id);
    });

    it('should allow organization admin to access', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(testOrg.id);
    });

    it('should allow organization member to access', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${memberToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(testOrg.id);
    });

    it('should deny access to non-member (403)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${outsiderToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
      expect(json.message).toMatch(/not a member|membership required/i);
    });

    it('should return 404 for non-existent organization (not 403)', async () => {
      const fakeOrgId = '00000000-0000-0000-0000-000000000000';
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${fakeOrgId}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('NotFound');
      expect(json.message).toContain('Organization not found');
    });

    it('should require authentication (401)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${testOrg.id}`,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('requireOrgRole - PATCH /api/v1/organizations/:id (requires owner)', () => {
    it('should allow owner to update organization', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          name: 'Updated Org Name',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Updated Org Name');
    });

    it('should deny admin from updating organization (403 - requires owner)', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          name: 'Admin Attempted Update',
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
      expect(json.message).toMatch(/sufficient permissions|Requires organization role/i);
    });

    it('should deny member from updating organization (403 - requires owner)', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${memberToken}`,
        },
        payload: {
          name: 'Member Attempted Update',
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
    });

    it('should deny non-member (403)', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${outsiderToken}`,
        },
        payload: {
          name: 'Outsider Attempted Update',
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
      expect(json.message).toMatch(/not a member|membership required/i);
    });
  });

  describe('requireOrgRole - POST /api/v1/organizations/:id/members (requires owner)', () => {
    let newMemberUser: { id: string };

    beforeEach(async () => {
      const timestamp = Date.now();
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: `new-member-${timestamp}@example.com`,
          password: 'password123',
        },
      });
      newMemberUser = response.json().data.user;
    });

    it('should allow owner to add members', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: newMemberUser.id,
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.user_id).toBe(newMemberUser.id);
      expect(json.data.role).toBe('member');
    });

    it('should deny admin from adding members (403 - requires owner)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          user_id: newMemberUser.id,
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.message).toMatch(/sufficient permissions|Requires organization role/i);
    });

    it('should deny regular member from adding members (403)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${memberToken}`,
        },
        payload: {
          user_id: newMemberUser.id,
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/organizations/:id/members (requireOrgAccess - any role)', () => {
    it('should allow owner to list members', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(3); // owner, admin, member
    });

    it('should allow admin to list members', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('should allow regular member to list members', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${memberToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('should deny non-member from listing members (403)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${outsiderToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('404 vs 403 error ordering', () => {
    it('should return 404 for non-existent org before checking membership', async () => {
      const fakeOrgId = '00000000-0000-0000-0000-000000000000';

      // Non-member accessing non-existent org should get 404 (not 403)
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${fakeOrgId}`,
        headers: {
          authorization: `Bearer ${outsiderToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().message).toContain('Organization not found');
    });

    it('should return 404 for non-existent org even with owner role check', async () => {
      const fakeOrgId = '00000000-0000-0000-0000-000000000000';

      // PATCH requires owner role, but should still return 404 for missing org
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/${fakeOrgId}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          name: 'Updated Name',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().message).toContain('Organization not found');
    });
  });

  describe('Platform admin bypass', () => {
    let platformAdminToken: string;

    beforeEach(async () => {
      // Register a user, then promote to platform admin via direct DB update
      const timestamp = Date.now();
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: `platform-admin-${timestamp}@example.com`,
          password: 'password123',
        },
      });
      const userId = response.json().data.user.id;
      await db.users.update(userId, { role: 'admin' });

      // Re-login to get a token with the updated role
      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: `platform-admin-${timestamp}@example.com`,
          password: 'password123',
        },
      });
      platformAdminToken = loginResponse.json().data.access_token;
    });

    it('should allow platform admin to access org they are not a member of', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${platformAdminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(testOrg.id);
    });

    it('should allow platform admin to list members of any org', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${platformAdminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.length).toBeGreaterThanOrEqual(3);
    });

    it('should allow platform admin to pass owner-level role checks', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${platformAdminToken}`,
        },
        payload: {
          name: 'Admin Override Update',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.name).toBe('Admin Override Update');
    });

    it('should still return 404 for non-existent org even for platform admin', async () => {
      const fakeOrgId = '00000000-0000-0000-0000-000000000000';
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${fakeOrgId}`,
        headers: {
          authorization: `Bearer ${platformAdminToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().message).toContain('Organization not found');
    });
  });

  describe('Invalid organization ID format', () => {
    it('should handle malformed UUID gracefully', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/organizations/not-a-uuid',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      // Should return 400 or 404 (depending on validation), not crash
      expect([400, 404]).toContain(response.statusCode);
    });
  });
});
