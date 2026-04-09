/**
 * Deployment Configuration Route Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage } from '../test-helpers.js';

describe('Deployment Routes', () => {
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

  describe('GET /api/v1/deployment', () => {
    it('should return 200 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/deployment',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return deployment config with mode and features', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/deployment',
      });

      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.mode).toMatch(/^(saas|selfhosted)$/);
      expect(typeof json.data.features.multiTenancy).toBe('boolean');
      expect(typeof json.data.features.billing).toBe('boolean');
      expect(typeof json.data.features.usageTracking).toBe('boolean');
      expect(typeof json.data.features.quotaEnforcement).toBe('boolean');
    });

    it('should have consistent feature flags for the reported mode', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/deployment',
      });

      const { mode, features } = response.json().data;
      if (mode === 'saas') {
        expect(features.billing).toBe(true);
        expect(features.multiTenancy).toBe(true);
      } else {
        expect(features.billing).toBe(false);
        expect(features.multiTenancy).toBe(false);
      }
    });
  });
});
