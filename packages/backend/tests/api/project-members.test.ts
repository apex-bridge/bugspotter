/**
 * Project Member Management API Tests
 * Tests for project member CRUD operations and access control
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage, createAdminUser } from '../test-helpers.js';

describe('Project Member Management', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let projectId: string;
  let adminToken: string;
  let ownerToken: string;
  let member2Token: string;
  let member3Token: string;
  let user4Token: string;
  let ownerUserId: string;
  let userId2: string;
  let userId3: string;
  let userId4: string;

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
    const randomId = Math.random().toString(36).substring(7);

    // Create admin user
    const { token: adminToken_temp } = await createAdminUser(server, db, 'admin');
    adminToken = adminToken_temp;

    // Create owner user
    const user1Response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `owner-${timestamp}-${randomId}@example.com`,
        password: 'password123',
      },
    });
    ownerToken = user1Response.json().data.access_token;
    ownerUserId = user1Response.json().data.user.id;

    // Create user2 (will be admin member)
    const user2Response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `user2-${timestamp}-${randomId}@example.com`,
        password: 'password123',
      },
    });
    userId2 = user2Response.json().data.user.id;
    member2Token = user2Response.json().data.access_token;

    // Create user3 (will be regular member)
    const user3Response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `user3-${timestamp}-${randomId}@example.com`,
        password: 'password123',
      },
    });
    userId3 = user3Response.json().data.user.id;
    member3Token = user3Response.json().data.access_token;

    // Create user4 (not a member)
    const user4Response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `user4-${timestamp}-${randomId}@example.com`,
        password: 'password123',
      },
    });
    userId4 = user4Response.json().data.user.id;
    user4Token = user4Response.json().data.access_token;

    // Create test project with owner
    const projectResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        name: `Test Project ${timestamp}`,
        settings: {},
      },
    });
    projectId = projectResponse.json().data.id;

    // Add user2 as admin member
    await server.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        user_id: userId2,
        role: 'admin',
      },
    });

    // Add user3 as regular member
    await server.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/members`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        user_id: userId3,
        role: 'member',
      },
    });
  });

  describe('GET /api/v1/projects/:id/members', () => {
    it('should list project members', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeInstanceOf(Array);
      expect(json.data.length).toBeGreaterThanOrEqual(3); // owner + 2 members

      // Check structure includes user details
      const member = json.data.find((m: any) => m.user_id === userId2);
      expect(member).toBeDefined();
      expect(member.role).toBe('admin');
      expect(member.user_name).toBeDefined();
      expect(member.user_email).toBeDefined();
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/members`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should require project access', async () => {
      // Use user4 who is not a member
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/members`,
        headers: {
          authorization: `Bearer ${user4Token}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for non-existent project', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/00000000-0000-0000-0000-000000000000/members',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/projects/:id/members', () => {
    it('should add a member to project', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: userId4,
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.user_id).toBe(userId4);
      expect(json.data.role).toBe('member');
    });

    it('should allow adding admin role', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: userId4,
          role: 'admin',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().data.role).toBe('admin');
    });

    it('should allow adding viewer role', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: userId4,
          role: 'viewer',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().data.role).toBe('viewer');
    });

    it('should reject adding member if not owner/admin', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/members`,
        headers: {
          authorization: `Bearer ${member3Token}`, // Regular member
        },
        payload: {
          user_id: userId4,
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject duplicate member', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: userId2, // Already a member
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(409);
    });

    it('should reject invalid user_id', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: '00000000-0000-0000-0000-000000000000',
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should require user_id and role', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject owner role assignment', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: userId4,
          role: 'owner',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/v1/projects/:id/members/:userId', () => {
    it('should update member role', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}/members/${userId3}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          role: 'admin',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.role).toBe('admin');
    });

    it('should allow downgrading from admin to member', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}/members/${userId2}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.role).toBe('member');
    });

    it('should reject changing to owner role', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}/members/${userId3}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          role: 'owner',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject changing owner role', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}/members/${ownerUserId}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject changing your own role', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}/members/${userId2}`,
        headers: {
          authorization: `Bearer ${member2Token}`, // user2 is admin
        },
        payload: {
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject non-owner changing admin role', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}/members/${userId2}`,
        headers: {
          authorization: `Bearer ${member3Token}`, // Regular member
        },
        payload: {
          role: 'viewer',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject non-owner promoting to admin role', async () => {
      // member2 is admin but not owner - should not be able to promote member3 to admin
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}/members/${userId3}`,
        headers: {
          authorization: `Bearer ${member2Token}`, // Admin but not owner
        },
        payload: {
          role: 'admin',
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.message).toContain('Only project owners can promote users to admin');
    });

    it('should return 404 for non-member', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}/members/${userId4}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          role: 'admin',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should require role field', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}/members/${userId3}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/v1/projects/:id/members/:userId', () => {
    it('should remove member from project', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${projectId}/members/${userId3}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
    });

    it('should reject removing owner', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${projectId}/members/${ownerUserId}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject removing yourself', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${projectId}/members/${userId2}`,
        headers: {
          authorization: `Bearer ${member2Token}`, // user2 trying to remove themselves
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject non-owner removing admin', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${projectId}/members/${userId2}`, // user2 is admin
        headers: {
          authorization: `Bearer ${member3Token}`, // Regular member
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject non-admin/owner removing members', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${projectId}/members/${userId2}`,
        headers: {
          authorization: `Bearer ${member3Token}`, // Regular member
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for non-member', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${projectId}/members/${userId4}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/admin/users/:id/projects', () => {
    it('should get user projects with roles', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/users/${userId2}/projects`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeInstanceOf(Array);
      expect(json.data.length).toBeGreaterThanOrEqual(1);

      const project = json.data[0];
      expect(project.id).toBe(projectId);
      expect(project.name).toBeDefined();
      expect(project.role).toBe('admin');
    });

    it('should return empty array for user with no projects', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/users/${userId4}/projects`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toEqual([]);
    });

    it('should require admin role', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/users/${userId2}/projects`,
        headers: {
          authorization: `Bearer ${ownerToken}`, // Regular user
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for non-existent user', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/users/00000000-0000-0000-0000-000000000000/projects',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/users/${userId2}/projects`,
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
