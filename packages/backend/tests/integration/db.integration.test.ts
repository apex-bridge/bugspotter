/**
 * Database Integration Tests
 * Tests connection pooling, transactions, concurrency, and performance
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDatabase } from '../setup.integration.js';
import {
  createTestProject,
  createTestBugReport,
  createTestBugReports,
  TestCleanupTracker,
  sleep,
} from '../utils/test-utils.js';
import type { DatabaseClient } from '../../src/db/client.js';

describe('Database Integration Tests', () => {
  let db: DatabaseClient;
  const cleanup = new TestCleanupTracker();

  beforeAll(() => {
    db = createTestDatabase();
  });

  beforeEach(async () => {
    await cleanup.cleanup(db);
  });

  afterAll(async () => {
    await cleanup.cleanup(db);
  });

  describe('Connection Pooling', () => {
    it('should handle multiple concurrent connections', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Create 20 concurrent requests
      const promises = Array.from({ length: 20 }, (_, i) =>
        createTestBugReport(db, project.id, { title: `Concurrent Bug ${i}` })
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(20);
      results.forEach((report) => {
        expect(report.id).toBeDefined();
        cleanup.trackBugReport(report.id);
      });
    });

    it('should reuse connections from pool', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Make sequential requests - should reuse connections
      for (let i = 0; i < 10; i++) {
        const report = await createTestBugReport(db, project.id, { title: `Bug ${i}` });
        cleanup.trackBugReport(report.id);
        expect(report.id).toBeDefined();
      }
    });

    it('should handle connection errors gracefully', async () => {
      // Test connection health
      const isHealthy = await db.testConnection();
      expect(isHealthy).toBe(true);
    });
  });

  describe('Transactions', () => {
    it('should commit transaction on success', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const result = await db.transaction(async (tx) => {
        const bug1 = await tx.bugReports.create({
          project_id: project.id,
          title: 'Transaction Bug 1',
        });

        const bug2 = await tx.bugReports.create({
          project_id: project.id,
          title: 'Transaction Bug 2',
        });

        return { bug1, bug2 };
      });

      cleanup.trackBugReport(result.bug1.id);
      cleanup.trackBugReport(result.bug2.id);

      // Verify both bugs were created
      const found1 = await db.bugReports.findById(result.bug1.id);
      const found2 = await db.bugReports.findById(result.bug2.id);

      expect(found1).toBeDefined();
      expect(found2).toBeDefined();
      expect(found1?.title).toBe('Transaction Bug 1');
      expect(found2?.title).toBe('Transaction Bug 2');
    });

    it('should rollback transaction on error', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      let createdBugId: string | undefined;

      await expect(
        db.transaction(async (tx) => {
          const bug = await tx.bugReports.create({
            project_id: project.id,
            title: 'Will be rolled back',
          });
          createdBugId = bug.id;

          // Throw error to trigger rollback
          throw new Error('Transaction failed');
        })
      ).rejects.toThrow('Transaction failed');

      // Verify bug was rolled back
      if (createdBugId) {
        const found = await db.bugReports.findById(createdBugId);
        expect(found).toBeNull();
      }
    });

    it('should handle nested operations in transaction', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const result = await db.transaction(async (tx) => {
        // Create bug report
        const bug = await tx.bugReports.create({
          project_id: project.id,
          title: 'Bug in Transaction',
        });

        return { bug };
      });

      cleanup.trackBugReport(result.bug.id);

      // Verify it was created
      const bug = await db.bugReports.findById(result.bug.id);
      expect(bug).toBeDefined();
    });
  });

  describe('Concurrent Writes', () => {
    it('should handle concurrent writes to same project', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Create 10 bug reports concurrently for same project
      const promises = Array.from({ length: 10 }, (_, i) =>
        db.bugReports.create({
          project_id: project.id,
          title: `Concurrent Write ${i}`,
          priority: 'medium',
        })
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((report) => {
        expect(report.project_id).toBe(project.id);
        cleanup.trackBugReport(report.id);
      });
    });

    it('should handle concurrent updates to different records', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Create bug reports
      const reports = await createTestBugReports(db, project.id, 5);
      reports.forEach((r) => cleanup.trackBugReport(r.id));

      // Update all concurrently
      const updatePromises = reports.map((report, i) =>
        db.bugReports.update(report.id, {
          title: `Updated ${i}`,
          priority: 'high',
        })
      );

      const results = await Promise.all(updatePromises);

      expect(results).toHaveLength(5);
      results.forEach((result, i) => {
        expect(result?.title).toBe(`Updated ${i}`);
        expect(result?.priority).toBe('high');
      });
    });

    it('should prevent lost updates with concurrent modifications', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const report = await createTestBugReport(db, project.id, {
        title: 'Original',
        priority: 'low',
      });
      cleanup.trackBugReport(report.id);

      // Two concurrent updates
      const [result1, result2] = await Promise.all([
        db.bugReports.update(report.id, { priority: 'high' }),
        db.bugReports.update(report.id, { title: 'Modified' }),
      ]);

      // Both updates should succeed
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();

      // Final state should have both changes
      const final = await db.bugReports.findById(report.id);
      expect(final?.priority).toBe('high');
      expect(final?.title).toBe('Modified');
    });
  });

  describe('JSON Field Serialization', () => {
    it('should correctly serialize and deserialize JSON metadata', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const metadata = {
        browser: 'Chrome',
        version: '120.0',
        platform: 'Windows',
        nested: {
          userAgent: 'Mozilla/5.0...',
          screenResolution: '1920x1080',
        },
        array: ['tag1', 'tag2', 'tag3'],
      };

      const report = await db.bugReports.create({
        project_id: project.id,
        title: 'JSON Test',
        metadata,
      });
      cleanup.trackBugReport(report.id);

      const found = await db.bugReports.findById(report.id);
      expect(found?.metadata).toEqual(metadata);
    });

    it('should handle empty JSON objects', async () => {
      const project = await createTestProject(db, { settings: {} });
      cleanup.trackProject(project.id);

      const found = await db.projects.findById(project.id);
      expect(found?.settings).toEqual({});
    });

    it('should handle null values in JSON fields', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const report = await db.bugReports.create({
        project_id: project.id,
        title: 'Null Metadata',
        metadata: { value: null, exists: true },
      });
      cleanup.trackBugReport(report.id);

      const found = await db.bugReports.findById(report.id);
      expect(found?.metadata).toEqual({ value: null, exists: true });
    });

    it('should handle complex nested JSON structures', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const complexMetadata = {
        level1: {
          level2: {
            level3: {
              data: 'deep',
              array: [1, 2, { nested: true }],
            },
          },
        },
      };

      const report = await db.bugReports.create({
        project_id: project.id,
        title: 'Complex JSON',
        metadata: complexMetadata,
      });
      cleanup.trackBugReport(report.id);

      const found = await db.bugReports.findById(report.id);
      expect(found?.metadata).toEqual(complexMetadata);
    });
  });

  describe('Cascade Deletes', () => {
    it('should cascade delete bug reports when project is deleted', async () => {
      const project = await createTestProject(db);
      const reports = await createTestBugReports(db, project.id, 3);

      // Delete project
      await db.projects.delete(project.id);

      // Verify bug reports are also deleted
      for (const report of reports) {
        const found = await db.bugReports.findById(report.id);
        expect(found).toBeNull();
      }
    });

    it('should cascade delete tickets when bug report is deleted', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const report = await createTestBugReport(db, project.id);
      await db.tickets.createTicket(report.id, 'JIRA-123', 'jira');

      // Delete bug report
      await db.bugReports.delete(report.id);

      // Verify ticket is deleted
      const tickets = await db.tickets.findByBugReport(report.id);
      expect(tickets).toHaveLength(0);
    });
  });

  describe('Batch Operations', () => {
    it('should efficiently create multiple records in batch', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const startTime = Date.now();
      const reports = await createTestBugReports(db, project.id, 50);
      const duration = Date.now() - startTime;

      expect(reports).toHaveLength(50);
      // Batch operation should be relatively fast
      expect(duration).toBeLessThan(5000);

      reports.forEach((r) => cleanup.trackBugReport(r.id));
    });

    it('should handle empty batch operations', async () => {
      const results = await db.bugReports.createBatch([]);
      expect(results).toHaveLength(0);
    });

    it('should automatically split large batches', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Create 150 records (should be split into batches)
      const data = Array.from({ length: 150 }, (_, i) => ({
        project_id: project.id,
        title: `Auto Batch ${i}`,
      }));

      const results = await db.bugReports.createBatchAuto(data, 50);

      expect(results).toHaveLength(150);
      results.forEach((r) => cleanup.trackBugReport(r.id));
    });
  });

  describe('Query Performance', () => {
    it('should efficiently paginate large result sets', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Create 100 bug reports
      const reports = await createTestBugReports(db, project.id, 100);
      reports.forEach((r) => cleanup.trackBugReport(r.id));

      // Test pagination performance
      const startTime = Date.now();
      const page1 = await db.bugReports.list(
        { project_id: project.id },
        { sort_by: 'created_at', order: 'desc' },
        { page: 1, limit: 20 }
      );
      const duration = Date.now() - startTime;

      expect(page1.data).toHaveLength(20);
      expect(page1.pagination.total).toBeGreaterThanOrEqual(100);
      // Should be fast even with large dataset
      expect(duration).toBeLessThan(1000);
    });

    it('should handle filtering with indexes efficiently', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Create reports with different priorities
      const reports = await Promise.all([
        ...Array.from({ length: 20 }, () =>
          createTestBugReport(db, project.id, { priority: 'high' })
        ),
        ...Array.from({ length: 30 }, () =>
          createTestBugReport(db, project.id, { priority: 'low' })
        ),
      ]);
      reports.forEach((r) => cleanup.trackBugReport(r.id));

      // Filter by priority
      const startTime = Date.now();
      const highPriority = await db.bugReports.list(
        { project_id: project.id, priority: 'high' },
        {},
        { page: 1, limit: 100 }
      );
      const duration = Date.now() - startTime;

      expect(highPriority.data.length).toBeGreaterThanOrEqual(20);
      expect(highPriority.data.every((r) => r.priority === 'high')).toBe(true);
      expect(duration).toBeLessThan(500);
    });

    it('should efficiently sort results', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Create reports with delays to ensure different timestamps
      const reports = [];
      for (let i = 0; i < 5; i++) {
        const report = await createTestBugReport(db, project.id, { title: `Bug ${i}` });
        reports.push(report);
        cleanup.trackBugReport(report.id);
        await sleep(10); // Small delay to ensure different timestamps
      }

      // Sort by created_at descending
      const result = await db.bugReports.list(
        { project_id: project.id },
        { sort_by: 'created_at', order: 'desc' },
        { page: 1, limit: 10 }
      );

      // Should be in descending order
      for (let i = 0; i < result.data.length - 1; i++) {
        const current = new Date(result.data[i].created_at).getTime();
        const next = new Date(result.data[i + 1].created_at).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle foreign key violations', async () => {
      // Try to create bug report with non-existent project
      await expect(
        db.bugReports.create({
          project_id: '00000000-0000-0000-0000-000000000000',
          title: 'Invalid Project',
        })
      ).rejects.toThrow();
    });

    it('should handle invalid UUID format', async () => {
      await expect(db.projects.findById('not-a-uuid')).rejects.toThrow();
    });

    it('should handle duplicate unique constraints', async () => {
      // Test duplicate user email constraint
      const email = `duplicate-${Date.now()}@example.com`;

      const user1 = await db.users.create({
        email,
        password_hash: 'hash1',
        role: 'user',
      });
      cleanup.trackUser(user1.id);

      // Try to create another user with same email
      await expect(
        db.users.create({
          email,
          password_hash: 'hash2',
          role: 'user',
        })
      ).rejects.toThrow();
    });
  });

  describe('Connection Health', () => {
    it('should report healthy connection', async () => {
      const isHealthy = await db.testConnection();
      expect(isHealthy).toBe(true);
    });

    it('should handle reconnection after errors', async () => {
      // Test connection before
      const before = await db.testConnection();
      expect(before).toBe(true);

      // Simulate an error by trying invalid operation
      try {
        await db.bugReports.findById('invalid-uuid');
      } catch {
        // Expected to fail
      }

      // Connection should still be healthy
      const after = await db.testConnection();
      expect(after).toBe(true);
    });
  });
});
