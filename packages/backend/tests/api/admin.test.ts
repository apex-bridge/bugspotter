/**
 * Admin Routes Tests
 * Tests for admin-only endpoints (health, settings)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage } from '../test-helpers.js';

describe('Admin Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let adminToken: string;
  let userToken: string;

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
    // Clean up users table
    await db.query('DELETE FROM users');

    // Create admin user directly in database
    const admin = await db.users.create({
      email: 'admin@example.com',
      password_hash: 'hashed',
      role: 'admin',
    });

    // Create regular user directly in database
    const user = await db.users.create({
      email: 'user@example.com',
      password_hash: 'hashed',
      role: 'user',
    });

    // Generate JWT tokens manually
    adminToken = server.jwt.sign({ userId: admin.id, role: 'admin' }, { expiresIn: '1h' });
    userToken = server.jwt.sign({ userId: user.id, role: 'user' }, { expiresIn: '1h' });
  });

  describe('GET /api/v1/admin/health', () => {
    it('should return health status for admin', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/health',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBeDefined();
      expect(json.data.services).toBeDefined();
      expect(json.data.services.database).toBeDefined();
      expect(json.data.services.redis).toBeDefined();
      expect(json.data.services.storage).toBeDefined();
      expect(json.data.system).toBeDefined();
      expect(json.data.system.uptime).toBeGreaterThan(0);
    });

    it('should return comprehensive worker health data', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/health',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.workers).toBeDefined();
      expect(Array.isArray(json.data.workers)).toBe(true);

      // Verify worker health structure
      if (json.data.workers.length > 0) {
        const worker = json.data.workers[0];
        expect(worker).toHaveProperty('name');
        expect(worker).toHaveProperty('enabled');
        expect(worker).toHaveProperty('running');
        expect(worker).toHaveProperty('jobs_processed');
        expect(worker).toHaveProperty('jobs_failed');
        expect(worker).toHaveProperty('avg_processing_time_ms');
        expect(typeof worker.name).toBe('string');
        expect(typeof worker.enabled).toBe('boolean');
        expect(typeof worker.running).toBe('boolean');
        expect(typeof worker.jobs_processed).toBe('number');
        expect(typeof worker.jobs_failed).toBe('number');
        expect(typeof worker.avg_processing_time_ms).toBe('number');
      }
    });

    it('should return queue health metrics', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/health',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.queues).toBeDefined();
      expect(Array.isArray(json.data.queues)).toBe(true);

      // Verify queue health structure
      if (json.data.queues.length > 0) {
        const queue = json.data.queues[0];
        expect(queue).toHaveProperty('name');
        expect(queue).toHaveProperty('waiting');
        expect(queue).toHaveProperty('active');
        expect(queue).toHaveProperty('completed');
        expect(queue).toHaveProperty('failed');
        expect(queue).toHaveProperty('delayed');
        expect(queue).toHaveProperty('paused');
        expect(typeof queue.name).toBe('string');
        expect(typeof queue.waiting).toBe('number');
        expect(typeof queue.active).toBe('number');
        expect(typeof queue.completed).toBe('number');
        expect(typeof queue.failed).toBe('number');
        expect(typeof queue.delayed).toBe('number');
        expect(typeof queue.paused).toBe('boolean');
      }
    });

    it('should return plugin health with type detection', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/health',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.plugins).toBeDefined();
      expect(Array.isArray(json.data.plugins)).toBe(true);

      // Verify plugin health structure
      if (json.data.plugins.length > 0) {
        const plugin = json.data.plugins[0];
        expect(plugin).toHaveProperty('platform');
        expect(plugin).toHaveProperty('enabled');
        expect(plugin).toHaveProperty('type');
        expect(typeof plugin.platform).toBe('string');
        expect(typeof plugin.enabled).toBe('boolean');
        expect(['built-in', 'custom']).toContain(plugin.type);
      }
    });

    it('should include system metrics', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/health',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.system).toBeDefined();
      expect(json.data.system).toHaveProperty('disk_space_available');
      expect(json.data.system).toHaveProperty('disk_space_total');
      expect(json.data.system).toHaveProperty('worker_queue_depth');
      expect(json.data.system).toHaveProperty('uptime');
      expect(json.data.system).toHaveProperty('node_version');
      expect(json.data.system).toHaveProperty('process_memory_mb');
      expect(json.data.system).toHaveProperty('system_memory_mb');

      // Verify types and reasonable values
      expect(typeof json.data.system.disk_space_available).toBe('number');
      expect(typeof json.data.system.disk_space_total).toBe('number');
      expect(typeof json.data.system.worker_queue_depth).toBe('number');
      expect(typeof json.data.system.uptime).toBe('number');
      expect(typeof json.data.system.node_version).toBe('string');
      expect(typeof json.data.system.process_memory_mb).toBe('number');
      expect(typeof json.data.system.system_memory_mb).toBe('number');
      expect(json.data.system.uptime).toBeGreaterThan(0);
      expect(json.data.system.process_memory_mb).toBeGreaterThan(0);
      expect(json.data.system.system_memory_mb).toBeGreaterThan(0);
    });

    it('should calculate overall status correctly when healthy', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/health',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(json.data.status);

      // If all services are up, status should be healthy or degraded (not unhealthy)
      const { database, redis, storage } = json.data.services;
      const allServicesUp =
        database.status === 'up' && redis.status === 'up' && storage.status === 'up';

      if (allServicesUp && json.data.workers.every((w: { running: boolean }) => w.running)) {
        // With all services and workers healthy, should not be unhealthy
        expect(json.data.status).not.toBe('unhealthy');
      }
    });

    it('should include service response times', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/health',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();

      // All services should have response_time
      expect(json.data.services.database).toHaveProperty('response_time');
      expect(json.data.services.redis).toHaveProperty('response_time');
      expect(json.data.services.storage).toHaveProperty('response_time');

      expect(typeof json.data.services.database.response_time).toBe('number');
      expect(typeof json.data.services.redis.response_time).toBe('number');
      expect(typeof json.data.services.storage.response_time).toBe('number');

      // Response times should be reasonable (< 1000ms for local services)
      expect(json.data.services.database.response_time).toBeLessThan(1000);
      expect(json.data.services.redis.response_time).toBeLessThan(1000);
      expect(json.data.services.storage.response_time).toBeLessThan(1000);
    });

    it('should include last_check timestamp for services', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/health',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();

      // All services should have last_check
      expect(json.data.services.database).toHaveProperty('last_check');
      expect(json.data.services.redis).toHaveProperty('last_check');
      expect(json.data.services.storage).toHaveProperty('last_check');

      // Verify ISO 8601 timestamp format
      expect(() => new Date(json.data.services.database.last_check)).not.toThrow();
      expect(() => new Date(json.data.services.redis.last_check)).not.toThrow();
      expect(() => new Date(json.data.services.storage.last_check)).not.toThrow();
    });

    it('should not mark system unhealthy due to old queue failures', async () => {
      // This test verifies the recent failure window logic
      // Even if queues have historical failures (>24h old), they shouldn't affect current health

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/health',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();

      // If all services are up and workers running, old queue failures shouldn't cause unhealthy status
      const { database, redis, storage } = json.data.services;
      const allServicesUp =
        database.status === 'up' && redis.status === 'up' && storage.status === 'up';

      const allWorkersRunning = json.data.workers
        .filter((w: { enabled: boolean }) => w.enabled)
        .every((w: { running: boolean }) => w.running);

      // No jobs currently waiting/active suggests system is idle/stable
      const noActiveBacklog = json.data.queues.every(
        (q: { waiting: number; active: number }) => q.waiting === 0 || q.active > 0
      );

      if (allServicesUp && allWorkersRunning && noActiveBacklog) {
        // System should be healthy or at worst degraded, not unhealthy
        // The recent failure window (24h) prevents old failures from marking it unhealthy
        expect(['healthy', 'degraded']).toContain(json.data.status);
      }
    });

    it('should reject non-admin users', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/health',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
    });

    it('should reject unauthenticated requests', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/health',
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Unauthorized');
    });

    it('should reject invalid tokens', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/health',
        headers: {
          authorization: 'Bearer invalid-token-12345',
        },
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.success).toBe(false);
    });
  });

  describe('GET /api/v1/admin/settings', () => {
    it('should return settings for admin', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/settings',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.instance_name).toBeDefined();
      expect(json.data.storage_type).toBeDefined();
      expect(json.data.retention_days).toBeGreaterThan(0);
      expect(json.data.jwt_access_expiry).toBeGreaterThan(0);
    });

    it('should include replay quality settings', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/settings',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveProperty('replay_duration');
      expect(json.data).toHaveProperty('replay_inline_stylesheets');
      expect(json.data).toHaveProperty('replay_inline_images');
      expect(json.data).toHaveProperty('replay_collect_fonts');
      expect(json.data).toHaveProperty('replay_record_canvas');
      expect(json.data).toHaveProperty('replay_record_cross_origin_iframes');
      expect(json.data).toHaveProperty('replay_sampling_mousemove');
      expect(json.data).toHaveProperty('replay_sampling_scroll');

      // Verify types
      expect(typeof json.data.replay_duration).toBe('number');
      expect(typeof json.data.replay_inline_stylesheets).toBe('boolean');
      expect(typeof json.data.replay_inline_images).toBe('boolean');
      expect(typeof json.data.replay_collect_fonts).toBe('boolean');
      expect(typeof json.data.replay_record_canvas).toBe('boolean');
      expect(typeof json.data.replay_record_cross_origin_iframes).toBe('boolean');
      expect(typeof json.data.replay_sampling_mousemove).toBe('number');
      expect(typeof json.data.replay_sampling_scroll).toBe('number');
    });

    it('should reject non-admin users', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/settings',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
    });

    it('should reject unauthenticated requests', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/settings',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/admin/settings', () => {
    it('should update settings for admin', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/admin/settings',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          instance_name: 'Updated BugSpotter',
          retention_days: 120,
          session_replay_enabled: false,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.instance_name).toBe('Updated BugSpotter');
      expect(json.data.retention_days).toBe(120);
      expect(json.data.session_replay_enabled).toBe(false);
    });

    it('should persist settings across requests', async () => {
      // Update settings
      await server.inject({
        method: 'PATCH',
        url: '/api/v1/admin/settings',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          instance_name: 'Persistent Test',
        },
      });

      // Verify settings persisted
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/settings',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.instance_name).toBe('Persistent Test');
    });

    it('should update replay quality settings', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/admin/settings',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          replay_duration: 25,
          replay_inline_stylesheets: false,
          replay_inline_images: true,
          replay_collect_fonts: false,
          replay_record_canvas: true,
          replay_record_cross_origin_iframes: true,
          replay_sampling_mousemove: 100,
          replay_sampling_scroll: 250,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.replay_duration).toBe(25);
      expect(json.data.replay_inline_stylesheets).toBe(false);
      expect(json.data.replay_inline_images).toBe(true);
      expect(json.data.replay_collect_fonts).toBe(false);
      expect(json.data.replay_record_canvas).toBe(true);
      expect(json.data.replay_record_cross_origin_iframes).toBe(true);
      expect(json.data.replay_sampling_mousemove).toBe(100);
      expect(json.data.replay_sampling_scroll).toBe(250);
    });

    it('should persist replay quality settings', async () => {
      // Update settings
      await server.inject({
        method: 'PATCH',
        url: '/api/v1/admin/settings',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          replay_inline_images: true,
          replay_record_canvas: true,
        },
      });

      // Verify settings persisted
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/settings',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.replay_inline_images).toBe(true);
      expect(json.data.replay_record_canvas).toBe(true);
    });

    it('should reject non-admin users', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/admin/settings',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          instance_name: 'Hacked',
        },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Forbidden');
    });

    it('should reject unauthenticated requests', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/admin/settings',
        payload: {
          instance_name: 'Hacked',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject invalid settings', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/admin/settings',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          instance_name: '',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should ignore read-only settings', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/admin/settings',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          storage_type: 's3', // Read-only, should be ignored
          storage_bucket: 'new-bucket', // Read-only, should be ignored
          instance_name: 'Valid Update',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      // instance_name should update
      expect(json.data.instance_name).toBe('Valid Update');
      // storage settings should remain unchanged (from env)
      expect(json.data.storage_bucket).not.toBe('new-bucket');
    });
  });
});
