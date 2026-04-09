/**
 * Settings Routes Tests
 * Tests for replay quality settings endpoint (requires API key)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage } from '../test-helpers.js';

// Mock cache service to always call fallback (no caching in tests)
vi.mock('../../src/cache/index.js', () => ({
  getCacheService: () => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    getApiKey: vi.fn().mockImplementation(async (_keyHash, fallback) => {
      return await fallback();
    }),
    getSystemConfig: vi.fn().mockImplementation(async (_key, fallback) => {
      return await fallback();
    }),
  }),
}));

describe('Settings Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let testApiKey: string;
  let testProjectId: string;

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();
    server = await createServer({ db, storage, pluginRegistry });
    await server.ready();

    // Create test project and managed API key
    const timestamp = Date.now();
    const project = await db.projects.create({
      name: `Settings Test Project ${timestamp}`,
      settings: {},
      created_by: null,
    });
    testProjectId = project.id;

    // Create managed API key
    const { ApiKeyService } = await import('../../src/services/api-key/index.js');
    const apiKeyService = new ApiKeyService(db);
    const apiKeyResult = await apiKeyService.createKey({
      name: 'Settings Test Key',
      type: 'development',
      permission_scope: 'full',
      permissions: ['bugs:read', 'bugs:write'],
      created_by: null,
      allowed_projects: [project.id],
    });
    testApiKey = apiKeyResult.plaintext;
  });

  afterAll(async () => {
    // Clean up test project (cascades to API key)
    if (testProjectId) {
      await db.query('DELETE FROM projects WHERE id = $1', [testProjectId]);
    }
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    // Reset instance_settings to defaults
    await db.systemConfig.set(
      'instance_settings',
      {
        instance_name: 'BugSpotter',
        instance_url: 'http://localhost:3000',
        support_email: 'support@bugspotter.dev',
        retention_days: 90,
        max_reports_per_project: 10000,
        session_replay_enabled: true,
        replay_duration: 15,
        replay_inline_stylesheets: true,
        replay_inline_images: false,
        replay_collect_fonts: true,
        replay_record_canvas: false,
        replay_record_cross_origin_iframes: false,
      },
      'Test setup',
      undefined
    );
  });

  describe('GET /api/v1/settings/replay', () => {
    it('should return default replay settings with valid API key', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/settings/replay',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toEqual({
        duration: 15,
        inline_stylesheets: true,
        inline_images: false,
        collect_fonts: true,
        record_canvas: false,
        record_cross_origin_iframes: false,
        sampling_mousemove: 50,
        sampling_scroll: 100,
      });
    });

    it('should return 401 without API key', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/settings/replay',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 with invalid API key', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/settings/replay',
        headers: {
          'x-api-key': 'bgs_invalid_key_12345',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return updated settings after admin changes', async () => {
      // Update settings in database
      await db.systemConfig.set(
        'instance_settings',
        {
          instance_name: 'BugSpotter',
          instance_url: 'http://localhost:3000',
          support_email: 'support@bugspotter.dev',
          retention_days: 90,
          max_reports_per_project: 10000,
          session_replay_enabled: true,
          replay_duration: 30, // Changed to 30
          replay_inline_stylesheets: true,
          replay_inline_images: true, // Changed to true
          replay_collect_fonts: true,
          replay_record_canvas: true, // Changed to true
          replay_record_cross_origin_iframes: false,
          replay_sampling_mousemove: 25, // Changed to 25ms
          replay_sampling_scroll: 200, // Changed to 200ms
        },
        'Test update',
        undefined
      );

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/settings/replay',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toEqual({
        duration: 30,
        inline_stylesheets: true,
        inline_images: true,
        collect_fonts: true,
        record_canvas: true,
        record_cross_origin_iframes: false,
        sampling_mousemove: 25,
        sampling_scroll: 200,
      });
    });

    it('should return defaults when settings are missing', async () => {
      // Delete instance_settings from database
      await db.query('DELETE FROM system_config WHERE key = $1', ['instance_settings']);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/settings/replay',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toEqual({
        duration: 15,
        inline_stylesheets: true,
        inline_images: false,
        collect_fonts: true,
        record_canvas: false,
        record_cross_origin_iframes: false,
        sampling_mousemove: 50,
        sampling_scroll: 100,
      });
    });

    it('should handle partial settings gracefully', async () => {
      // Set incomplete settings
      await db.systemConfig.set(
        'instance_settings',
        {
          instance_name: 'BugSpotter',
          replay_inline_stylesheets: false, // Only this setting present
        },
        'Partial settings test',
        undefined
      );

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/settings/replay',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.inline_stylesheets).toBe(false); // Uses provided value
      expect(json.data.inline_images).toBe(false); // Uses default
      expect(json.data.collect_fonts).toBe(true); // Uses default
      expect(json.data.duration).toBe(15); // Uses default
      expect(json.data.sampling_mousemove).toBe(50); // Uses default
      expect(json.data.sampling_scroll).toBe(100); // Uses default
    });

    it('should respect custom replay duration values', async () => {
      // Test minimum value
      await db.systemConfig.set(
        'instance_settings',
        {
          instance_name: 'BugSpotter',
          replay_duration: 5,
          replay_inline_stylesheets: true,
          replay_inline_images: false,
          replay_collect_fonts: true,
          replay_record_canvas: false,
          replay_record_cross_origin_iframes: false,
        },
        'Custom duration test',
        undefined
      );

      let response = await server.inject({
        method: 'GET',
        url: '/api/v1/settings/replay',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      let json = response.json();
      expect(json.data.duration).toBe(5);

      // Test maximum value
      await db.systemConfig.set(
        'instance_settings',
        {
          instance_name: 'BugSpotter',
          replay_duration: 60,
          replay_inline_stylesheets: true,
          replay_inline_images: false,
          replay_collect_fonts: true,
          replay_record_canvas: false,
          replay_record_cross_origin_iframes: false,
        },
        'Custom duration test',
        undefined
      );

      response = await server.inject({
        method: 'GET',
        url: '/api/v1/settings/replay',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      json = response.json();
      expect(json.data.duration).toBe(60);
    });

    it('should handle all settings set to false', async () => {
      await db.systemConfig.set(
        'instance_settings',
        {
          instance_name: 'BugSpotter',
          replay_inline_stylesheets: false,
          replay_inline_images: false,
          replay_collect_fonts: false,
          replay_record_canvas: false,
          replay_record_cross_origin_iframes: false,
        },
        'All false test',
        undefined
      );

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/settings/replay',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toEqual({
        duration: 15,
        inline_stylesheets: false,
        inline_images: false,
        collect_fonts: false,
        record_canvas: false,
        record_cross_origin_iframes: false,
        sampling_mousemove: 50,
        sampling_scroll: 100,
      });
    });

    it('should handle all settings set to true', async () => {
      await db.systemConfig.set(
        'instance_settings',
        {
          instance_name: 'BugSpotter',
          replay_inline_stylesheets: true,
          replay_inline_images: true,
          replay_collect_fonts: true,
          replay_record_canvas: true,
          replay_record_cross_origin_iframes: true,
        },
        'All true test',
        undefined
      );

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/settings/replay',
        headers: {
          'x-api-key': testApiKey,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toEqual({
        duration: 15,
        inline_stylesheets: true,
        inline_images: true,
        collect_fonts: true,
        record_canvas: true,
        record_cross_origin_iframes: true,
        sampling_mousemove: 50,
        sampling_scroll: 100,
      });
    });
  });
});
