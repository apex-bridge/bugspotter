/**
 * Project Routes Tests
 * Tests for project CRUD and API key management
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage, createAdminUser } from '../test-helpers.js';

describe('Project Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let testAccessToken: string;
  let testAdminToken: string;

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
    const randomId = Math.random().toString(36).substring(7);

    // Create regular user with unique email
    const userResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `user-${timestamp}-${randomId}@example.com`,
        password: 'password123',
      },
    });
    testAccessToken = userResponse.json().data.access_token;

    // Create admin user with unique email
    const { token: adminToken } = await createAdminUser(server, db, 'admin');
    testAdminToken = adminToken;
  });

  describe('POST /api/v1/projects', () => {
    it('should create a new project', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          name: 'My Project',
          settings: {
            notifications: true,
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('My Project');
      expect(json.data.id).toBeDefined();
      expect(json.data.settings.notifications).toBe(true);
      // API keys are now managed separately via /api/v1/api-keys
      expect(json.data.api_key).toBeUndefined();
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        payload: {
          name: 'My Project',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should validate project name', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          // Missing name
          settings: {},
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error).toBe('ValidationError');
    });

    it('should default to empty settings', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          name: 'Project Without Settings',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.data.settings).toEqual({});
    });
  });

  describe('GET /api/v1/projects/:id', () => {
    let projectId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          name: 'Test Project',
        },
      });
      projectId = response.json().data.id;
    });

    it('should get a project by ID', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(projectId);
      expect(json.data.name).toBe('Test Project');
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for non-existent project', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/00000000-0000-0000-0000-000000000000',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.error).toBe('NotFound');
    });
  });

  describe('PATCH /api/v1/projects/:id', () => {
    let projectId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          name: 'Original Name',
          settings: { feature1: true },
        },
      });
      projectId = response.json().data.id;
    });

    it('should update project name', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          name: 'Updated Name',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.name).toBe('Updated Name');
    });

    it('should update project settings', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          settings: {
            feature1: false,
            feature2: true,
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.settings.feature1).toBe(false);
      expect(json.data.settings.feature2).toBe(true);
    });

    it('should require at least one field', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 for non-existent project', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/projects/00000000-0000-0000-0000-000000000000',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          name: 'New Name',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/projects/:id', () => {
    let projectId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAdminToken}`,
        },
        payload: {
          name: 'Project to Delete',
        },
      });
      projectId = response.json().data.id;
    });

    it('should delete project with admin role', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${projectId}`,
        headers: {
          authorization: `Bearer ${testAdminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toBe('Project deleted successfully');
    });

    it('should reject non-admin users', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${projectId}`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.error).toBe('Forbidden');
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${projectId}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for non-existent project', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/projects/00000000-0000-0000-0000-000000000000',
        headers: {
          authorization: `Bearer ${testAdminToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
