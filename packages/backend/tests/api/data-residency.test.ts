/**
 * Data Residency Routes Tests
 * Tests for data residency API endpoints
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { Project } from '../../src/db/types.js';
import { LocalStorageService } from '../../src/storage/local-storage.js';
import { createMockPluginRegistry } from '../test-helpers.js';

describe('Data Residency Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let testAccessToken!: string;
  let testProject!: Project;
  let otherUserToken!: string;

  beforeAll(async () => {
    // Set up environment variables for regional storage (required for validation)
    process.env.STORAGE_EU_CENTRAL_1_ENDPOINT = 'http://localhost:9000';
    process.env.STORAGE_EU_CENTRAL_1_BUCKET = 'bugspotter-eu';
    process.env.STORAGE_US_EAST_1_ENDPOINT = 'http://localhost:9000';
    process.env.STORAGE_US_EAST_1_BUCKET = 'bugspotter-us-east';
    process.env.STORAGE_US_WEST_2_ENDPOINT = 'http://localhost:9000';
    process.env.STORAGE_US_WEST_2_BUCKET = 'bugspotter-us-west';
    // Configure strict residency regions (KZ and RF) for validation
    process.env.STORAGE_KZ_ALMATY_ENDPOINT = 'http://localhost:9000';
    process.env.STORAGE_KZ_ALMATY_BUCKET = 'bugspotter-kz';
    process.env.STORAGE_RF_MOSCOW_ENDPOINT = 'http://localhost:9000';
    process.env.STORAGE_RF_MOSCOW_BUCKET = 'bugspotter-rf';

    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);

    // Create storage service
    const storage = new LocalStorageService({
      baseDirectory: './test-storage',
      baseUrl: 'http://localhost:3000/storage',
    });
    await storage.initialize();
    const pluginRegistry = createMockPluginRegistry();

    server = await createServer({
      db,
      storage,
      pluginRegistry,
    });
    await server.ready();

    // Create test users
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);

    // Create regular user
    const userResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `user-${timestamp}-${randomId}@example.com`,
        password: 'password123',
      },
    });
    const userData = userResponse.json();
    testAccessToken = userData.data.access_token;

    // Create project for regular user
    const projectResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: {
        authorization: `Bearer ${testAccessToken}`,
      },
      payload: {
        name: `Test Project ${timestamp}`,
      },
    });
    testProject = projectResponse.json().data;

    // Create another user to test unauthorized access
    const otherUserResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `other-${timestamp}-${randomId}@example.com`,
        password: 'password123',
      },
    });
    otherUserToken = otherUserResponse.json().data.access_token;
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  describe('GET /api/v1/projects/:id/data-residency', () => {
    it('should return default global policy for new project', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}/data-residency`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.projectId).toBe(testProject.id);
      expect(body.data.policy.region).toBe('global');
      expect(body.data.policy.storageRegion).toBe('auto');
      expect(body.data.storageAvailable).toBe(true);
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}/data-residency`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should require project access', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}/data-residency`,
        headers: {
          authorization: `Bearer ${otherUserToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('PUT /api/v1/projects/:id/data-residency', () => {
    it('should update policy to EU region', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: `/api/v1/projects/${testProject.id}/data-residency`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
          'content-type': 'application/json',
        },
        payload: {
          region: 'eu',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.policy.region).toBe('eu');
      expect(body.data.policy.storageRegion).toBe('eu-central-1');
    });

    it('should update policy with custom storage region', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: `/api/v1/projects/${testProject.id}/data-residency`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
          'content-type': 'application/json',
        },
        payload: {
          region: 'us',
          storageRegion: 'us-west-2',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.policy.region).toBe('us');
      expect(body.data.policy.storageRegion).toBe('us-west-2');
    });

    it('should reject invalid storage region for data residency region', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: `/api/v1/projects/${testProject.id}/data-residency`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
          'content-type': 'application/json',
        },
        payload: {
          region: 'kz',
          storageRegion: 'us-east-1', // Not allowed for KZ
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('not allowed');
    });

    it('should reject invalid region', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: `/api/v1/projects/${testProject.id}/data-residency`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
          'content-type': 'application/json',
        },
        payload: {
          region: 'invalid-region',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require project owner or admin access', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: `/api/v1/projects/${testProject.id}/data-residency`,
        headers: {
          authorization: `Bearer ${otherUserToken}`,
          'content-type': 'application/json',
        },
        payload: {
          region: 'global',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/projects/:id/data-residency/compliance', () => {
    it('should return compliance summary', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}/data-residency/compliance`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.projectId).toBe(testProject.id);
      expect(typeof body.data.isCompliant).toBe('boolean');
      expect(body.data.violations).toBeDefined();
      expect(body.data.auditEntries).toBeDefined();
    });
  });

  describe('GET /api/v1/projects/:id/data-residency/audit', () => {
    it('should return audit log entries', async () => {
      // First, make a policy change to create an audit entry
      await server.inject({
        method: 'PUT',
        url: `/api/v1/projects/${testProject.id}/data-residency`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
          'content-type': 'application/json',
        },
        payload: { region: 'global' },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}/data-residency/audit`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.projectId).toBe(testProject.id);
      expect(Array.isArray(body.data.entries)).toBe(true);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.total).toBeGreaterThanOrEqual(1);

      // Should have a policy_changed entry
      const policyChange = body.data.entries.find(
        (e: { action: string }) => e.action === 'policy_changed'
      );
      expect(policyChange).toBeDefined();
    });

    it('should support pagination', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}/data-residency/audit?limit=10&offset=0`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.pagination.limit).toBe(10);
      expect(body.pagination.page).toBe(1);
    });
  });

  describe('GET /api/v1/projects/:id/data-residency/violations', () => {
    it('should return violations list', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${testProject.id}/data-residency/violations`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.violations)).toBe(true);
      expect(body.pagination).toBeDefined();
    });
  });

  describe('GET /api/v1/data-residency/regions', () => {
    it('should return available regions (public endpoint)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/data-residency/regions',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.regions)).toBe(true);
      expect(body.data.regions.length).toBe(5); // kz, rf, eu, us, global

      // Verify KZ region config
      const kzRegion = body.data.regions.find((r: { id: string }) => r.id === 'kz');
      expect(kzRegion).toBeDefined();
      expect(kzRegion.name).toBe('Kazakhstan');
      expect(kzRegion.allowCrossRegionBackup).toBe(false);
      expect(kzRegion.encryptionRequired).toBe(true);

      // Verify global region config
      const globalRegion = body.data.regions.find((r: { id: string }) => r.id === 'global');
      expect(globalRegion).toBeDefined();
      expect(globalRegion.allowCrossRegionBackup).toBe(true);
      expect(globalRegion.allowCrossRegionProcessing).toBe(true);
    });
  });
});
