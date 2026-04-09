/**
 * Prometheus Metrics Tests
 * Tests for /metrics endpoint and HTTP request instrumentation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage } from '../test-helpers.js';

describe('Metrics', () => {
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

  describe('GET /metrics', () => {
    it('should return 200', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return Prometheus text format content type', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.headers['content-type']).toContain('text/plain');
    });

    it('should be publicly accessible when METRICS_AUTH_TOKEN is unset', async () => {
      // No Authorization header — should still succeed (no token configured)
      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should include default Node.js process metrics', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = response.body;
      expect(body).toContain('process_cpu_');
      expect(body).toContain('nodejs_heap_size_total_bytes');
    });

    it('should include http_requests_total counter', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = response.body;
      expect(body).toContain('http_requests_total');
    });

    it('should include http_request_duration_seconds histogram', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = response.body;
      expect(body).toContain('http_request_duration_seconds');
    });

    it('should include queue job metrics', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = response.body;
      expect(body).toContain('queue_jobs_processed_total');
      expect(body).toContain('queue_job_duration_seconds');
    });

    it('should include db_connection_pool_size gauge', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = response.body;
      expect(body).toContain('db_connection_pool_size');
      // Should have labeled values for pool states
      expect(body).toMatch(/db_connection_pool_size\{state="total"\}/);
      expect(body).toMatch(/db_connection_pool_size\{state="idle"\}/);
      expect(body).toMatch(/db_connection_pool_size\{state="waiting"\}/);
    });
  });

  describe('HTTP request metrics instrumentation', () => {
    it('should record metrics for requests to API routes', async () => {
      // /api/v1/setup/status is a public route that is instrumented
      await server.inject({ method: 'GET', url: '/api/v1/setup/status' });
      await server.inject({ method: 'GET', url: '/api/v1/setup/status' });

      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = response.body;
      expect(body).toMatch(/http_requests_total\{/);
      expect(body).toMatch(/http_request_duration_seconds_bucket\{/);
    });

    it('should use route pattern not actual URL for labels', async () => {
      await server.inject({ method: 'GET', url: '/api/v1/setup/status' });

      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = response.body;
      expect(body).toMatch(/route="\/api\/v1\/setup\/status"/);
    });

    it('should record correct status code labels', async () => {
      await server.inject({ method: 'GET', url: '/api/v1/setup/status' });

      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = response.body;
      expect(body).toMatch(/status_code="200"/);
    });

    it('should not instrument /metrics, /health, or /ready', async () => {
      // Hit all ignored routes
      await server.inject({ method: 'GET', url: '/metrics' });
      await server.inject({ method: 'GET', url: '/health' });
      await server.inject({ method: 'GET', url: '/ready' });

      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      const body = response.body;
      // These routes should NOT appear in http_requests_total labels
      expect(body).not.toMatch(/http_requests_total\{[^}]*route="\/metrics"/);
      expect(body).not.toMatch(/http_requests_total\{[^}]*route="\/health"/);
      expect(body).not.toMatch(/http_requests_total\{[^}]*route="\/ready"/);
    });
  });
});
