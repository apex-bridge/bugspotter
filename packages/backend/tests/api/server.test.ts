/**
 * API Server Integration Tests
 * Tests the complete server setup with all plugins and middleware
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage } from '../test-helpers.js';

describe('API Server', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;

  beforeAll(async () => {
    // Use test database URL
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

  describe('Server Initialization', () => {
    it('should create server instance', () => {
      expect(server).toBeDefined();
      expect(server.hasRoute).toBeDefined();
    });

    it('should register CORS plugin', () => {
      expect(server.hasPlugin('@fastify/cors')).toBe(true);
    });

    it('should register Helmet plugin', () => {
      expect(server.hasPlugin('@fastify/helmet')).toBe(true);
    });

    it('should register rate limit plugin', () => {
      expect(server.hasPlugin('@fastify/rate-limit')).toBe(true);
    });
  });

  describe('Routes Registration', () => {
    it('should register health check routes', () => {
      expect(server.hasRoute.call(server, { method: 'GET', url: '/health' })).toBe(true);
      expect(server.hasRoute.call(server, { method: 'GET', url: '/ready' })).toBe(true);
    });

    it('should register auth routes', () => {
      expect(server.hasRoute({ method: 'POST', url: '/api/v1/auth/register' })).toBe(true);
      expect(server.hasRoute({ method: 'POST', url: '/api/v1/auth/login' })).toBe(true);
      expect(server.hasRoute({ method: 'POST', url: '/api/v1/auth/refresh' })).toBe(true);
    });

    it('should register project routes', () => {
      expect(server.hasRoute({ method: 'POST', url: '/api/v1/projects' })).toBe(true);
    });

    it('should register bug report routes', () => {
      expect(server.hasRoute({ method: 'POST', url: '/api/v1/reports' })).toBe(true);
      expect(server.hasRoute({ method: 'GET', url: '/api/v1/reports' })).toBe(true);
    });
  });

  describe('Root Endpoint', () => {
    it('should return API information', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.name).toBe('BugSpotter API');
      expect(json.status).toBe('running');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/unknown-route',
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('NotFound');
    });
  });

  describe('Security Headers', () => {
    it('should include security headers', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.headers['x-content-type-options']).toBeDefined();
      expect(response.headers['x-frame-options']).toBeDefined();
    });
  });
});
