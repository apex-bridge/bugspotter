/**
 * Project Access Middleware Tests
 * Tests for requireProjectAccess middleware factory
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../../src/api/server.js';
import { createDatabaseClient } from '../../../src/db/client.js';
import type { DatabaseClient } from '../../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage } from '../../test-helpers.js';

describe('Project Access Middleware', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let testProject: { id: string };
  let ownerUser: { id: string; email: string };
  let memberUser: { id: string; email: string };
  let _outsiderUser: { id: string; email: string };
  let ownerToken: string;
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
        email: `project-owner-${timestamp}@example.com`,
        password: 'password123',
      },
    });
    ownerToken = ownerResponse.json().data.access_token;
    ownerUser = ownerResponse.json().data.user;

    const memberResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `project-member-${timestamp}@example.com`,
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
    _outsiderUser = outsiderResponse.json().data.user;

    // Create test project
    testProject = await db.projects.create({
      name: `Middleware Test Project ${timestamp}`,
      settings: {},
      created_by: ownerUser.id,
    });

    // Add member to project
    await db.projectMembers.addMember(testProject.id, memberUser.id, 'member');
  });

  describe('GET /api/v1/projects/:id (uses requireProjectAccess middleware)', () => {
    it('should allow project owner to access project', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(testProject.id);
    });

    it('should allow project member to access project', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}`,
        headers: {
          authorization: `Bearer ${memberToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(testProject.id);
    });

    it('should deny access to non-member', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}`,
        headers: {
          authorization: `Bearer ${outsiderToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
    });

    it('should return 404 for non-existent project', async () => {
      const fakeProjectId = '00000000-0000-0000-0000-000000000000';
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${fakeProjectId}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('NotFound');
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}`,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/projects/:id (uses requireProjectAccess middleware)', () => {
    it('should allow owner to update project', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${testProject.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          name: 'Updated Project Name',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Updated Project Name');
    });

    it('should deny member from updating project (requires admin role)', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${testProject.id}`,
        headers: {
          authorization: `Bearer ${memberToken}`,
        },
        payload: {
          name: 'Member Update',
        },
      });

      // PATCH requires requireProjectRole('admin') — members are blocked
      expect(response.statusCode).toBe(403);
    });

    it('should deny outsider from updating project', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${testProject.id}`,
        headers: {
          authorization: `Bearer ${outsiderToken}`,
        },
        payload: {
          name: 'Unauthorized Update',
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
    });
  });

  describe('GET /api/v1/projects/:id/members (uses requireProjectAccess middleware)', () => {
    it('should allow owner to list members', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeInstanceOf(Array);
      expect(json.data.length).toBeGreaterThanOrEqual(1); // At least member user
    });

    it('should allow member to list members', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}/members`,
        headers: {
          authorization: `Bearer ${memberToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeInstanceOf(Array);
    });

    it('should deny outsider from listing members', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}/members`,
        headers: {
          authorization: `Bearer ${outsiderToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
    });
  });

  describe('Middleware behavior', () => {
    it('should attach project to request object', async () => {
      // The fact that routes work proves the middleware attached request.project
      // This is tested implicitly by all successful route tests above
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      // Route handler uses request.project! which wouldn't work if middleware failed
    });

    it('should run before route handler', async () => {
      // Test that middleware denies access before route handler runs
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}`,
        headers: {
          authorization: `Bearer ${outsiderToken}`,
        },
      });

      // Should get 403 from middleware, not any route-specific logic
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe('Forbidden');
    });
  });

  describe('Edge cases', () => {
    it('should handle malformed project IDs gracefully', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects/invalid-uuid',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      // Should return 404 or 400, not crash
      expect([400, 404]).toContain(response.statusCode);
    });

    it('should work with projects that have no explicit members (only owner)', async () => {
      const timestamp = Date.now();
      const soloProject = await db.projects.create({
        name: `Solo Project ${timestamp}`,
        settings: {},
        created_by: ownerUser.id,
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${soloProject.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
    });
  });
});
