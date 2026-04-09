/**
 * Load Tests
 * Tests system performance under load, concurrent operations, and resource limits
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestServerWithDb } from '../setup.integration.js';
import { createTestProject, TestCleanupTracker } from '../utils/test-utils.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { ApiKeyService } from '../../src/services/api-key/api-key-service.js';

describe('Load Tests', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  const cleanup = new TestCleanupTracker();

  beforeAll(async () => {
    const testEnv = await createTestServerWithDb();
    server = testEnv.server;
    db = testEnv.db;
  });

  beforeEach(async () => {
    await cleanup.cleanup(db);
  });

  afterAll(async () => {
    await cleanup.cleanup(db);
    await server.close();
    await db.close();
  });

  describe('Concurrent Bug Report Creation', () => {
    it('should handle 100 concurrent bug report creations', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Create managed API key
      const apiKeyService = new ApiKeyService(db);
      const apiKeyResult = await apiKeyService.createKey({
        name: 'Load Test API Key',
        permissions: ['reports:write', 'reports:read'],
        allowed_projects: [project.id],
      });
      const apiKey = apiKeyResult.plaintext;

      const startTime = Date.now();
      const concurrentRequests = 100;

      // Create 100 concurrent requests
      const promises = Array.from({ length: concurrentRequests }, (_, i) =>
        server.inject({
          method: 'POST',
          url: '/api/v1/reports',
          headers: {
            'x-api-key': apiKey,
          },
          payload: {
            title: `Load Test Bug ${i}`,
            description: `This is bug number ${i} in load test`,
            priority: 'medium',
            report: {
              console: [{ level: 'error', message: `Error ${i}` }],
              network: [],
              metadata: { browser: 'Chrome', testId: i },
            },
          },
        })
      );

      const responses = await Promise.all(promises);
      const duration = Date.now() - startTime;

      // All should succeed
      const successful = responses.filter((r) => r.statusCode === 201);
      expect(successful.length).toBe(concurrentRequests);

      // Track for cleanup
      successful.forEach((response) => {
        const body = JSON.parse(response.body);
        cleanup.trackBugReport(body.data.id);
      });

      // Performance check - should complete in reasonable time
      console.log(`Created ${concurrentRequests} bug reports in ${duration}ms`);
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
    }, 60000); // Extended timeout for load test

    it('should maintain response times under load', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Create managed API key
      const apiKeyService = new ApiKeyService(db);
      const apiKeyResult = await apiKeyService.createKey({
        name: 'Load Test API Key',
        permissions: ['reports:write'],
        allowed_projects: [project.id],
      });
      const apiKey = apiKeyResult.plaintext;

      const responseTimes: number[] = [];

      // Make 50 sequential requests and measure response times
      for (let i = 0; i < 50; i++) {
        const startTime = Date.now();

        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/reports',
          headers: {
            'x-api-key': apiKey,
          },
          payload: {
            title: `Response Time Test ${i}`,
            report: {
              console: [],
              network: [],
              metadata: {},
            },
          },
        });

        const responseTime = Date.now() - startTime;
        responseTimes.push(responseTime);

        if (response.statusCode === 201) {
          const body = JSON.parse(response.body);
          cleanup.trackBugReport(body.data.id);
        }
      }

      // Calculate statistics
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);
      const p95 = responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.95)];

      console.log(`Response time stats:`);
      console.log(`  Average: ${avgResponseTime.toFixed(2)}ms`);
      console.log(`  Max: ${maxResponseTime}ms`);
      console.log(`  P95: ${p95}ms`);

      // Performance assertions
      expect(avgResponseTime).toBeLessThan(1000); // Average < 1s
      expect(p95).toBeLessThan(2000); // P95 < 2s
    }, 60000);
  });

  describe('Connection Pool Management', () => {
    it('should not exhaust connection pool under load', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Make many concurrent database operations
      const promises = Array.from({ length: 50 }, (_, i) =>
        db.bugReports.create({
          project_id: project.id,
          title: `Pool Test ${i}`,
        })
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(50);
      results.forEach((report) => {
        expect(report.id).toBeDefined();
        cleanup.trackBugReport(report.id);
      });

      // Connection pool should still be healthy
      const isHealthy = await db.testConnection();
      expect(isHealthy).toBe(true);
    });

    it('should handle sequential operations without connection leaks', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Make many sequential operations
      for (let i = 0; i < 100; i++) {
        const report = await db.bugReports.create({
          project_id: project.id,
          title: `Sequential ${i}`,
        });
        cleanup.trackBugReport(report.id);
      }

      // Connection pool should still be healthy
      const isHealthy = await db.testConnection();
      expect(isHealthy).toBe(true);
    });
  });

  describe('Memory Usage', () => {
    it('should not grow memory unbounded with many operations', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Get initial memory usage
      const initialMemory = process.memoryUsage().heapUsed;

      // Perform many operations
      for (let i = 0; i < 100; i++) {
        const report = await db.bugReports.create({
          project_id: project.id,
          title: `Memory Test ${i}`,
          metadata: { data: 'x'.repeat(100) }, // Some data
        });
        cleanup.trackBugReport(report.id);

        // Periodically check memory doesn't grow too much
        if (i % 20 === 0) {
          const currentMemory = process.memoryUsage().heapUsed;
          const growth = (currentMemory - initialMemory) / 1024 / 1024; // MB

          // Allow some growth but not excessive
          expect(growth).toBeLessThan(100); // Less than 100MB growth
        }
      }

      // Final memory check
      const finalMemory = process.memoryUsage().heapUsed;
      const totalGrowth = (finalMemory - initialMemory) / 1024 / 1024;

      console.log(`Memory growth: ${totalGrowth.toFixed(2)}MB`);

      // Reasonable memory growth for 100 operations
      expect(totalGrowth).toBeLessThan(200); // Less than 200MB total growth
    });
  });

  describe('Batch Operations Performance', () => {
    it('should efficiently create large batches', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const batchSize = 100;
      const data = Array.from({ length: batchSize }, (_, i) => ({
        project_id: project.id,
        title: `Batch Bug ${i}`,
        priority: 'medium' as const,
      }));

      const startTime = Date.now();
      const results = await db.bugReports.createBatch(data);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(batchSize);
      results.forEach((r) => cleanup.trackBugReport(r.id));

      console.log(`Created ${batchSize} records in ${duration}ms`);
      expect(duration).toBeLessThan(5000); // Should be < 5 seconds
    });

    it('should handle auto-batching of large datasets efficiently', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const totalRecords = 500;
      const data = Array.from({ length: totalRecords }, (_, i) => ({
        project_id: project.id,
        title: `Auto Batch ${i}`,
      }));

      const startTime = Date.now();
      const results = await db.bugReports.createBatchAuto(data, 100);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(totalRecords);
      results.forEach((r) => cleanup.trackBugReport(r.id));

      console.log(`Created ${totalRecords} records (auto-batched) in ${duration}ms`);
      expect(duration).toBeLessThan(20000); // Should be < 20 seconds
    });
  });

  describe('Pagination Performance', () => {
    it('should efficiently paginate through large datasets', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Create 200 bug reports
      const data = Array.from({ length: 200 }, (_, i) => ({
        project_id: project.id,
        title: `Pagination Test ${i}`,
      }));
      const reports = await db.bugReports.createBatch(data);
      reports.forEach((r) => cleanup.trackBugReport(r.id));

      // Test pagination performance
      const pageSize = 20;
      const totalPages = 10;
      const pageTimes: number[] = [];

      for (let page = 1; page <= totalPages; page++) {
        const startTime = Date.now();

        const result = await db.bugReports.list(
          { project_id: project.id },
          { sort_by: 'created_at', order: 'desc' },
          { page, limit: pageSize }
        );

        const pageTime = Date.now() - startTime;
        pageTimes.push(pageTime);

        expect(result.data.length).toBeLessThanOrEqual(pageSize);
      }

      const avgPageTime = pageTimes.reduce((a, b) => a + b, 0) / pageTimes.length;
      console.log(`Average pagination time: ${avgPageTime.toFixed(2)}ms`);

      // Pagination should be fast even for later pages
      expect(avgPageTime).toBeLessThan(500);
      expect(Math.max(...pageTimes)).toBeLessThan(1000);
    });
  });

  describe('Concurrent Reads and Writes', () => {
    it('should handle mixed concurrent reads and writes', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Create initial bug reports
      const initialReports = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          db.bugReports.create({
            project_id: project.id,
            title: `Initial Bug ${i}`,
          })
        )
      );
      initialReports.forEach((r) => cleanup.trackBugReport(r.id));

      // Mix of reads and writes
      const operations = [
        // 20 reads
        ...Array.from({ length: 20 }, () =>
          db.bugReports.list({ project_id: project.id }, {}, { page: 1, limit: 10 })
        ),
        // 10 writes
        ...Array.from({ length: 10 }, (_, i) =>
          db.bugReports.create({
            project_id: project.id,
            title: `Concurrent Write ${i}`,
          })
        ),
        // 10 updates
        ...initialReports.map((report) => db.bugReports.update(report.id, { priority: 'high' })),
      ];

      const startTime = Date.now();
      const results = await Promise.all(operations);
      const duration = Date.now() - startTime;

      // Track new reports created
      results.forEach((result) => {
        if (result && 'id' in result && 'title' in result && result.title?.includes('Concurrent')) {
          cleanup.trackBugReport(result.id);
        }
      });

      console.log(`Mixed operations completed in ${duration}ms`);
      expect(duration).toBeLessThan(10000); // Should complete in < 10 seconds
    });
  });

  describe('Stress Tests', () => {
    it('should handle rapid authentication requests', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Create managed API key
      const apiKeyService = new ApiKeyService(db);
      const apiKeyResult = await apiKeyService.createKey({
        name: 'Stress Test API Key',
        permissions: ['reports:read'],
        allowed_projects: [project.id],
      });
      const apiKey = apiKeyResult.plaintext;

      const requests = Array.from({ length: 50 }, () =>
        server.inject({
          method: 'GET',
          url: '/api/v1/reports',
          headers: {
            'x-api-key': apiKey,
          },
        })
      );

      const responses = await Promise.all(requests);

      // All should succeed with proper authentication
      responses.forEach((response) => {
        expect([200, 429].includes(response.statusCode)).toBe(true);
      });
    });

    it('should recover from transient failures', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Simulate some failures by using invalid data
      const operations = Array.from({ length: 20 }, async (_, i) => {
        if (i % 5 === 0) {
          // Every 5th operation fails
          try {
            await db.bugReports.create({
              project_id: '00000000-0000-0000-0000-000000000000', // Invalid
              title: 'Will Fail',
            });
            return null;
          } catch {
            // Expected to fail
            return null;
          }
        } else {
          // Normal operation
          const report = await db.bugReports.create({
            project_id: project.id,
            title: `Recovery Test ${i}`,
          });
          cleanup.trackBugReport(report.id);
          return report;
        }
      });

      const results = await Promise.all(operations);

      // Some should succeed despite failures
      const successful = results.filter((r) => r !== null);
      expect(successful.length).toBeGreaterThan(10);

      // Database should still be healthy
      const isHealthy = await db.testConnection();
      expect(isHealthy).toBe(true);
    });

    it('should maintain consistency under high concurrency', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Create many reports concurrently
      const promises = Array.from({ length: 100 }, (_, i) =>
        db.bugReports.create({
          project_id: project.id,
          title: `Consistency Test ${i}`,
        })
      );

      const reports = await Promise.all(promises);
      reports.forEach((r) => cleanup.trackBugReport(r.id));

      // Count actual reports in database
      const result = await db.bugReports.list(
        { project_id: project.id },
        {},
        { page: 1, limit: 200 }
      );

      // Should have all 100 reports
      expect(result.pagination.total).toBeGreaterThanOrEqual(100);
    });
  });

  describe('Resource Cleanup', () => {
    it('should properly clean up resources after operations', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Create and delete many records
      for (let i = 0; i < 50; i++) {
        const report = await db.bugReports.create({
          project_id: project.id,
          title: `Temp Report ${i}`,
        });

        await db.bugReports.delete(report.id);
      }

      // No reports should remain
      const result = await db.bugReports.list(
        { project_id: project.id },
        {},
        { page: 1, limit: 100 }
      );

      expect(result.data.length).toBe(0);

      // Connection should be healthy
      const isHealthy = await db.testConnection();
      expect(isHealthy).toBe(true);
    });
  });
});
