/**
 * Health Routes Tests
 * Tests for liveness and readiness endpoints
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { QueueManager } from '../../src/queue/queue-manager.js';
import { createMockPluginRegistry, createMockStorage } from '../test-helpers.js';

/**
 * Create a mock QueueManager with switchable ping behavior.
 * Starts healthy (so createServer's validateServices passes),
 * then can be switched to simulate failure for /ready tests.
 */
function createMockQueueManager() {
  let pingBehavior: 'healthy' | 'down' | 'timeout' = 'healthy';

  const ping = () => {
    if (pingBehavior === 'healthy') {
      return Promise.resolve('PONG');
    }
    if (pingBehavior === 'down') {
      return Promise.reject(new Error('ECONNREFUSED'));
    }
    return new Promise(() => {}); // timeout — never resolves
  };

  const mock = {
    getConnection: () => ({ ping }) as any,
    healthCheck: () => Promise.resolve(pingBehavior === 'healthy'),
    setPingBehavior(behavior: 'healthy' | 'down' | 'timeout') {
      pingBehavior = behavior;
    },
  } as unknown as QueueManager & { setPingBehavior(b: string): void };

  return mock;
}

describe('Health Routes', () => {
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

  describe('GET /health', () => {
    it('should return 200 with ok status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.status).toBe('ok');
      expect(json.timestamp).toBeDefined();
    });

    it('should not require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /ready', () => {
    it('should return 200 when database is healthy', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.status).toBe('ready');
      expect(json.checks.database).toBe('healthy');
      expect(json.checks.redis).toBeDefined();
      expect(json.timestamp).toBeDefined();
    });

    it('should report redis as not-configured when queueManager is absent', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/ready',
      });

      const json = response.json();
      expect(json.checks.redis).toBe('not-configured');
      expect(response.statusCode).toBe(200);
    });

    it('should not require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /ready - Redis scenarios', () => {
    let redisServer: FastifyInstance;
    let mockQueueManager: ReturnType<typeof createMockQueueManager>;

    beforeAll(async () => {
      mockQueueManager = createMockQueueManager();
      const pluginRegistry = createMockPluginRegistry();
      const storage = createMockStorage();
      // Server starts with healthy Redis (passes validateServices)
      redisServer = await createServer({
        db,
        storage,
        pluginRegistry,
        queueManager: mockQueueManager as unknown as QueueManager,
      });
      await redisServer.ready();
    });

    afterAll(async () => {
      await redisServer.close();
    });

    it('should return 200 with redis healthy when ping succeeds', async () => {
      mockQueueManager.setPingBehavior('healthy');

      const response = await redisServer.inject({ method: 'GET', url: '/ready' });
      const json = response.json();

      expect(response.statusCode).toBe(200);
      expect(json.status).toBe('ready');
      expect(json.checks.redis).toBe('healthy');
      expect(json.checks.database).toBe('healthy');
    });

    it('should return 503 with redis unhealthy when ping fails', async () => {
      mockQueueManager.setPingBehavior('down');

      const response = await redisServer.inject({ method: 'GET', url: '/ready' });
      const json = response.json();

      expect(response.statusCode).toBe(503);
      expect(json.status).toBe('unavailable');
      expect(json.checks.redis).toBe('unhealthy');
      expect(json.checks.database).toBe('healthy');
    });

    it('should return 503 when redis ping times out', async () => {
      mockQueueManager.setPingBehavior('timeout');

      const response = await redisServer.inject({ method: 'GET', url: '/ready' });
      const json = response.json();

      expect(response.statusCode).toBe(503);
      expect(json.status).toBe('unavailable');
      expect(json.checks.redis).toBe('unhealthy');
    }, 10000); // Longer timeout for the 3s Promise.race
  });
});
