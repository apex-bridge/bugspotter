/**
 * API Key Routes Integration Tests
 * Tests for API key CRUD, rotation, revocation, and management
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage, createAdminUser } from '../test-helpers.js';

/**
 * Helper function to create a test user with unique email
 */
async function createTestUser(
  server: FastifyInstance,
  role: 'user' | 'admin' = 'user',
  prefix: string = 'user',
  db?: DatabaseClient
): Promise<{ token: string; userId: string }> {
  if (role === 'admin') {
    if (!db) {
      throw new Error('db is required when creating admin users');
    }
    const { token, user } = await createAdminUser(server, db, prefix);
    return { token, userId: user.id };
  }
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(7);
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email: `${prefix}-${timestamp}-${randomId}@example.com`,
      password: 'password123',
    },
  });
  const data = response.json().data;
  return { token: data.access_token, userId: data.user.id };
}

describe('API Key Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let userToken: string;
  let userId: string;
  let adminToken: string;
  let adminId: string;
  let projectId: string;

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
    // Clean up tables
    await db.query('DELETE FROM api_keys');
    await db.query('DELETE FROM projects');
    await db.query('DELETE FROM users');

    // Create test users
    const user = await createTestUser(server, 'user', 'user');
    userToken = user.token;
    userId = user.userId;

    const admin = await createTestUser(server, 'admin', 'admin', db);
    adminToken = admin.token;
    adminId = admin.userId;

    // Create a test project
    const projectResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { name: 'Test Project' },
    });

    // Check if project creation was successful
    if (projectResponse.statusCode !== 201) {
      console.error('Project creation failed:', projectResponse.json());
      throw new Error(`Failed to create test project: ${projectResponse.statusCode}`);
    }

    projectId = projectResponse.json().data.id;
  });

  describe('POST /api/v1/api-keys', () => {
    it('should create a new API key with minimal data', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Test API Key',
          type: 'development',
          permission_scope: 'full',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.api_key).toBeDefined();
      expect(json.data.api_key).toMatch(/^bgs_[a-zA-Z0-9_-]{43}$/);
      expect(json.data.key_details.name).toBe('Test API Key');
      expect(json.data.key_details.type).toBe('development');
      expect(json.data.key_details.permission_scope).toBe('full');
      expect(json.data.key_details.created_by).toBe(adminId);
      expect(json.timestamp).toBeDefined();
    });

    it('should create API key with custom permissions', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Custom Permissions Key',
          type: 'development',
          permission_scope: 'custom',
          permissions: ['bugs:read', 'bugs:write'],
          allowed_projects: [projectId],
          rate_limit_per_minute: 30,
          rate_limit_per_hour: 500,
          rate_limit_per_day: 5000,
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.key_details.permission_scope).toBe('custom');
      expect(json.data.key_details.permissions).toEqual(['bugs:read', 'bugs:write']);
      expect(json.data.key_details.allowed_projects).toEqual([projectId]);
      expect(json.data.key_details.rate_limit_per_minute).toBe(30);
      expect(json.data.key_details.rate_limit_per_hour).toBe(500);
      expect(json.data.key_details.rate_limit_per_day).toBe(5000);
    });

    it('should create API key with expiration', async () => {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Expiring Key',
          type: 'test',
          permission_scope: 'read',
          expires_at: expiresAt,
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.key_details.expires_at).toBeDefined();
    });

    it('should reject unauthenticated requests', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        payload: {
          name: 'Test Key',
          type: 'development',
          permission_scope: 'full',
        },
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.success).toBe(false);
    });

    it('should trim whitespace from name', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: '  Whitespace Key  ',
          type: 'development',
          permission_scope: 'full',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.data.key_details.name).toBe('Whitespace Key');
    });

    it('should allow project owner to create API key for their project', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          name: 'Project Owner Key',
          type: 'development',
          permission_scope: 'full',
          allowed_projects: [projectId],
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.api_key).toBeDefined();
      expect(json.data.key_details.allowed_projects).toEqual([projectId]);
    });

    it('should allow project admin to create API key for their project', async () => {
      // Create a second user
      const projectAdmin = await createTestUser(server, 'user', 'project-admin');
      const projectAdminToken = projectAdmin.token;
      const projectAdminId = projectAdmin.userId;

      // Add them as admin to the project
      await db.query(
        'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)',
        [projectId, projectAdminId, 'admin']
      );

      // Project admin should be able to create API key
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${projectAdminToken}` },
        payload: {
          name: 'Project Admin Key',
          type: 'development',
          permission_scope: 'full',
          allowed_projects: [projectId],
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.key_details.allowed_projects).toEqual([projectId]);
    });

    it('should reject non-admin creating key without project', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          name: 'Global Key',
          type: 'development',
          permission_scope: 'full',
          allowed_projects: [],
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
      expect(json.message).toContain('must specify at least one project');
    });

    it('should reject project member creating API key', async () => {
      // Create a second user
      const projectMember = await createTestUser(server, 'user', 'project-member');
      const projectMemberToken = projectMember.token;
      const projectMemberId = projectMember.userId;

      // Add them as member to the project
      await db.query(
        'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)',
        [projectId, projectMemberId, 'member']
      );

      // Project member should NOT be able to create API key
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${projectMemberToken}` },
        payload: {
          name: 'Project Member Key',
          type: 'development',
          permission_scope: 'full',
          allowed_projects: [projectId],
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
      expect(json.message).toContain('must be owner or admin');
    });

    it('should reject user creating key for project they do not own/admin', async () => {
      // Create a second user with their own project
      const otherUser = await createTestUser(server, 'user', 'other-user');
      const otherUserToken = otherUser.token;

      // Try to create key for the first user's project
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${otherUserToken}` },
        payload: {
          name: 'Unauthorized Key',
          type: 'development',
          permission_scope: 'full',
          allowed_projects: [projectId],
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
      expect(json.message).toContain('must be owner or admin');
    });

    it('should allow user to create key for multiple projects they own/admin', async () => {
      // Create a second project owned by the same user
      const project2Response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: { authorization: `Bearer ${userToken}` },
        payload: { name: 'Test Project 2' },
      });
      const project2Id = project2Response.json().data.id;

      // User should be able to create key for both their projects
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          name: 'Multi-Project Key',
          type: 'development',
          permission_scope: 'full',
          allowed_projects: [projectId, project2Id],
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.key_details.allowed_projects).toHaveLength(2);
      expect(json.data.key_details.allowed_projects).toContain(projectId);
      expect(json.data.key_details.allowed_projects).toContain(project2Id);
    });

    it('should reject user creating key with mixed permissions', async () => {
      // Create a second user with their own project
      const user2 = await createTestUser(server, 'user', 'user2');
      const user2Token = user2.token;
      const user2Id = user2.userId;

      const project2Response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: { authorization: `Bearer ${user2Token}` },
        payload: { name: 'User2 Project' },
      });
      const project2Id = project2Response.json().data.id;

      // Add user2 as member (not admin) to the first user's project
      await db.query(
        'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)',
        [projectId, user2Id, 'member']
      );

      // User2 tries to create key for both projects (owns one, member of another)
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${user2Token}` },
        payload: {
          name: 'Mixed Permission Key',
          type: 'development',
          permission_scope: 'full',
          allowed_projects: [projectId, project2Id],
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
      expect(json.message).toContain('must be owner or admin');
    });

    it('should reject project viewer creating API key', async () => {
      // Create a second user
      const projectViewer = await createTestUser(server, 'user', 'project-viewer');
      const projectViewerToken = projectViewer.token;
      const projectViewerId = projectViewer.userId;

      // Add them as viewer to the project
      await db.query(
        'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)',
        [projectId, projectViewerId, 'viewer']
      );

      // Project viewer should NOT be able to create API key
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${projectViewerToken}` },
        payload: {
          name: 'Project Viewer Key',
          type: 'development',
          permission_scope: 'full',
          allowed_projects: [projectId],
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
      expect(json.message).toContain('must be owner or admin');
    });

    it('should allow system admin to create key for any project', async () => {
      // Admin should be able to create key for user's project without being owner
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Admin Global Key',
          type: 'development',
          permission_scope: 'full',
          allowed_projects: [projectId],
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.key_details.allowed_projects).toEqual([projectId]);
      expect(json.data.key_details.created_by).toBe(adminId);
    });

    it('should validate custom permissions', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Invalid Custom Key',
          type: 'development',
          permission_scope: 'custom',
          permissions: [],
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
    });
  });

  describe('GET /api/v1/api-keys', () => {
    it('should list API keys with pagination', async () => {
      // Create multiple keys
      await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Key 1', type: 'development', permission_scope: 'full' },
      });
      await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Key 2', type: 'production', permission_scope: 'read' },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/api-keys?page=1&limit=10',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeInstanceOf(Array);
      expect(json.data.length).toBe(2);
      expect(json.pagination).toBeDefined();
      expect(json.pagination.page).toBe(1);
      expect(json.pagination.limit).toBe(10);
      expect(json.pagination.total).toBe(2);
      expect(json.timestamp).toBeDefined();
    });

    it('should filter by type', async () => {
      await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Dev Key', type: 'development', permission_scope: 'full' },
      });
      await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Prod Key', type: 'production', permission_scope: 'full' },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/api-keys?type=development',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.length).toBe(1);
      expect(json.data[0].type).toBe('development');
    });

    it('should filter by status', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Active Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      // Revoke one key
      await server.inject({
        method: 'POST',
        url: `/api/v1/api-keys/${keyId}/revoke`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { reason: 'Testing' },
      });

      // Create another active key
      await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Active Key 2', type: 'development', permission_scope: 'full' },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/api-keys?status=active',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.length).toBe(1);
      expect(json.data[0].status).toBe('active');
    });

    it('should only show user own keys for non-admin', async () => {
      // Admin creates keys
      await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Admin Key 1', type: 'development', permission_scope: 'full' },
      });

      await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Admin Key 2', type: 'development', permission_scope: 'full' },
      });

      // User lists keys - should see none (they didn't create any)
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.length).toBe(0); // User created no keys
    });

    it('should show all keys for admin', async () => {
      // User creates key
      await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'User Key', type: 'development', permission_scope: 'full' },
      });

      // Admin creates key
      await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Admin Key', type: 'development', permission_scope: 'full' },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.length).toBe(2);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/api-keys',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/api-keys/:id', () => {
    it('should get API key by ID', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Get Test Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(keyId);
      expect(json.data.name).toBe('Get Test Key');
      expect(json.timestamp).toBeDefined();
    });

    it('should return 404 for non-existent key', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/api-keys/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.success).toBe(false);
    });

    it('should reject access to other user keys for non-admin', async () => {
      // Admin creates key
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Admin Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      // User tries to access admin's key
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
    });

    it('should allow admin to access any key', async () => {
      // User creates key
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'User Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      // Admin accesses user's key
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.id).toBe(keyId);
    });
  });

  describe('PATCH /api/v1/api-keys/:id', () => {
    it('should update API key name', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Original Name', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Updated Name' },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Updated Name');
      expect(json.timestamp).toBeDefined();
    });

    it('should update rate limits', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Rate Limit Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          rate_limit_per_minute: 100,
          rate_limit_per_hour: 2000,
          rate_limit_per_day: 20000,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.rate_limit_per_minute).toBe(100);
      expect(json.data.rate_limit_per_hour).toBe(2000);
      expect(json.data.rate_limit_per_day).toBe(20000);
    });

    it('should update permissions', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Permissions Key',
          type: 'development',
          permission_scope: 'custom',
          permissions: ['bugs:read'],
        },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          permissions: ['bugs:read', 'bugs:write', 'projects:read'],
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.permissions).toEqual(['bugs:read', 'bugs:write', 'projects:read']);
    });

    it('should reject updates to other user keys for non-admin', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Admin Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${userToken}` },
        payload: { name: 'Hacked Name' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for non-existent key', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/api-keys/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${userToken}` },
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(404);
    });

    // Regression: PATCH used to forward `allowed_projects` / `permissions` /
    // `permission_scope` straight through after only an "are you the creator?"
    // check. CREATE has always re-validated project admin; PATCH did not, so a
    // user with admin on one project could PATCH their own key to cross
    // tenants. The gate now mirrors CREATE.
    describe('grant-field re-validation (regression)', () => {
      it('rejects non-admin widening allowed_projects to a tenant they do not admin', async () => {
        // userToken creates a key for projectId (their own project)
        const createResp = await server.inject({
          method: 'POST',
          url: '/api/v1/api-keys',
          headers: { authorization: `Bearer ${userToken}` },
          payload: {
            name: 'Single-project key',
            type: 'development',
            permission_scope: 'custom',
            permissions: ['reports:read'],
            allowed_projects: [projectId],
          },
        });
        expect(createResp.statusCode).toBe(201);
        const keyId = createResp.json().data.key_details.id;

        // Different user owns a different project — userToken has no role on it
        const otherUser = await createTestUser(server, 'user', 'cross-tenant-victim');
        const otherProjectResp = await server.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: { authorization: `Bearer ${otherUser.token}` },
          payload: { name: 'Other Tenant Project' },
        });
        const otherProjectId = otherProjectResp.json().data.id;

        // userToken tries to PATCH their own key to add the foreign project
        const patchResp = await server.inject({
          method: 'PATCH',
          url: `/api/v1/api-keys/${keyId}`,
          headers: { authorization: `Bearer ${userToken}` },
          payload: { allowed_projects: [projectId, otherProjectId] },
        });

        expect(patchResp.statusCode).toBe(403);
        expect(patchResp.json().message).toContain('owner or admin');
      });

      it('rejects non-admin widening to a project they are only a member of', async () => {
        // userToken creates a key for projectId
        const createResp = await server.inject({
          method: 'POST',
          url: '/api/v1/api-keys',
          headers: { authorization: `Bearer ${userToken}` },
          payload: {
            name: 'Member-of-other-project key',
            type: 'development',
            permission_scope: 'custom',
            permissions: ['reports:read'],
            allowed_projects: [projectId],
          },
        });
        const keyId = createResp.json().data.key_details.id;

        // Other user creates a project, then adds userToken-user as member (not admin)
        const otherUser = await createTestUser(server, 'user', 'project-owner');
        const otherProjectResp = await server.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: { authorization: `Bearer ${otherUser.token}` },
          payload: { name: 'Member-Only Project' },
        });
        const otherProjectId = otherProjectResp.json().data.id;

        await db.query(
          'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)',
          [otherProjectId, userId, 'member']
        );

        const patchResp = await server.inject({
          method: 'PATCH',
          url: `/api/v1/api-keys/${keyId}`,
          headers: { authorization: `Bearer ${userToken}` },
          payload: { allowed_projects: [projectId, otherProjectId] },
        });

        expect(patchResp.statusCode).toBe(403);
        expect(patchResp.json().message).toContain('owner or admin');
      });

      it('allows non-admin widening to a project they DO admin (positive case)', async () => {
        // userToken creates a key for projectId
        const createResp = await server.inject({
          method: 'POST',
          url: '/api/v1/api-keys',
          headers: { authorization: `Bearer ${userToken}` },
          payload: {
            name: 'About-to-be-widened key',
            type: 'development',
            permission_scope: 'custom',
            permissions: ['reports:read'],
            allowed_projects: [projectId],
          },
        });
        const keyId = createResp.json().data.key_details.id;

        // userToken creates a SECOND project they own
        const project2Resp = await server.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: { authorization: `Bearer ${userToken}` },
          payload: { name: 'Second Owned Project' },
        });
        const project2Id = project2Resp.json().data.id;

        // Widening to include their own second project should pass
        const patchResp = await server.inject({
          method: 'PATCH',
          url: `/api/v1/api-keys/${keyId}`,
          headers: { authorization: `Bearer ${userToken}` },
          payload: { allowed_projects: [projectId, project2Id] },
        });

        expect(patchResp.statusCode).toBe(200);
        expect(patchResp.json().data.allowed_projects).toContain(projectId);
        expect(patchResp.json().data.allowed_projects).toContain(project2Id);
      });

      it('allows non-admin to PATCH non-grant fields (name, rate limits) without re-validation', async () => {
        // Proves the gate isn't over-restrictive. Updating just `name` on your
        // own key shouldn't require re-running project-admin checks.
        const createResp = await server.inject({
          method: 'POST',
          url: '/api/v1/api-keys',
          headers: { authorization: `Bearer ${userToken}` },
          payload: {
            name: 'Original',
            type: 'development',
            permission_scope: 'custom',
            permissions: ['reports:read'],
            allowed_projects: [projectId],
          },
        });
        const keyId = createResp.json().data.key_details.id;

        const patchResp = await server.inject({
          method: 'PATCH',
          url: `/api/v1/api-keys/${keyId}`,
          headers: { authorization: `Bearer ${userToken}` },
          payload: { name: 'Renamed', rate_limit_per_minute: 50 },
        });

        expect(patchResp.statusCode).toBe(200);
        expect(patchResp.json().data.name).toBe('Renamed');
        expect(patchResp.json().data.rate_limit_per_minute).toBe(50);
      });

      it('platform admin can PATCH allowed_projects to any project (admin bypass)', async () => {
        // Admin creates a full-scope key for an arbitrary project
        const createResp = await server.inject({
          method: 'POST',
          url: '/api/v1/api-keys',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            name: 'Admin-managed key',
            type: 'development',
            permission_scope: 'full',
            allowed_projects: [projectId],
          },
        });
        const keyId = createResp.json().data.key_details.id;

        // A different user owns a project that admin has no membership in.
        const stranger = await createTestUser(server, 'user', 'stranger');
        const strangerProjectResp = await server.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: { authorization: `Bearer ${stranger.token}` },
          payload: { name: 'Stranger Project' },
        });
        const strangerProjectId = strangerProjectResp.json().data.id;

        // Platform admin should bypass the project-admin check entirely
        const patchResp = await server.inject({
          method: 'PATCH',
          url: `/api/v1/api-keys/${keyId}`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { allowed_projects: [projectId, strangerProjectId] },
        });

        expect(patchResp.statusCode).toBe(200);
        expect(patchResp.json().data.allowed_projects).toContain(strangerProjectId);
      });
    });
  });

  describe('DELETE /api/v1/api-keys/:id', () => {
    it('should delete API key', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Delete Test Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toBe('API key deleted successfully');
      expect(json.timestamp).toBeDefined();

      // Verify key is deleted
      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(getResponse.statusCode).toBe(404);
    });

    it('should reject deleting other user keys for non-admin', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Admin Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should allow admin to delete any key', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'User Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 404 for non-existent key', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/api-keys/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/api-keys/:id/revoke', () => {
    it('should revoke API key with reason', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Revoke Test Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/api-keys/${keyId}/revoke`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { reason: 'Security compromise' },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toBe('API key revoked successfully');
      expect(json.timestamp).toBeDefined();

      // Verify key is revoked
      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(getResponse.json().data.status).toBe('revoked');
    });

    it('should revoke without reason', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Revoke Test Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/api-keys/${keyId}/revoke`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
    });

    it('should reject revoking other user keys for non-admin', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Admin Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/api-keys/${keyId}/revoke`,
        headers: { authorization: `Bearer ${userToken}` },
        payload: { reason: 'Test' },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/api-keys/:id/rotate', () => {
    it('should rotate API key', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Rotate Test Key', type: 'development', permission_scope: 'full' },
      });
      const originalData = createResponse.json().data;
      const keyId = originalData.key_details.id;
      const originalKey = originalData.api_key;

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/api-keys/${keyId}/rotate`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.new_api_key).toBeDefined();
      expect(json.data.new_api_key).toMatch(/^bgs_[a-zA-Z0-9_-]{43}$/);
      expect(json.data.new_api_key).not.toBe(originalKey);
      expect(json.data.key_details).toBeDefined();
      expect(json.timestamp).toBeDefined();
    });

    it('should reject rotating other user keys for non-admin', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Admin Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/api-keys/${keyId}/rotate`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for non-existent key', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys/00000000-0000-0000-0000-000000000000/rotate',
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/api-keys/:id/usage', () => {
    it('should get usage logs', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Usage Test Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/api-keys/${keyId}/usage`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeInstanceOf(Array);
      expect(json.timestamp).toBeDefined();
    });

    it('should support pagination', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Usage Test Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/api-keys/${keyId}/usage?limit=50&offset=0`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should reject access to other user keys for non-admin', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Admin Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/api-keys/${keyId}/usage`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/api-keys/:id/audit', () => {
    it('should get audit logs', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Audit Test Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/api-keys/${keyId}/audit`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeInstanceOf(Array);
      expect(json.timestamp).toBeDefined();
    });

    it('should support pagination', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Audit Test Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/api-keys/${keyId}/audit?limit=50&offset=0`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should reject access to other user keys for non-admin', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Admin Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/api-keys/${keyId}/audit`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/api-keys/:id/rate-limits', () => {
    it('should get rate limit status', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Rate Limit Test Key',
          type: 'development',
          permission_scope: 'full',
          rate_limit_per_minute: 60,
          rate_limit_per_hour: 1000,
          rate_limit_per_day: 10000,
        },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/api-keys/${keyId}/rate-limits`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.minute).toBeDefined();
      expect(json.data.minute.limit).toBe(60);
      expect(json.data.minute.remaining).toBeDefined();
      expect(json.data.minute.reset_at).toBeDefined();
      expect(json.data.hour).toBeDefined();
      expect(json.data.hour.limit).toBe(1000);
      expect(json.data.day).toBeDefined();
      expect(json.data.day.limit).toBe(10000);
      expect(json.timestamp).toBeDefined();
    });

    it('should use default rate limits when not specified', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Default Rate Limit Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/api-keys/${keyId}/rate-limits`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.minute.limit).toBe(60);
      expect(json.data.hour.limit).toBe(1000);
      expect(json.data.day.limit).toBe(10000);
    });

    it('should reject access to other user keys for non-admin', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Admin Key', type: 'development', permission_scope: 'full' },
      });
      const keyId = createResponse.json().data.key_details.id;

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/api-keys/${keyId}/rate-limits`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for non-existent key', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/api-keys/00000000-0000-0000-0000-000000000000/rate-limits',
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
