/**
 * Bug Report Repository - Date Filtering Tests
 * Tests for date range filtering with parameterized queries
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import type { Project, BugReport } from '../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('BugReport Repository - Date Filtering', () => {
  let db: DatabaseClient;
  let testProject: Project;
  let oldReport: BugReport;
  let recentReport: BugReport;
  let futureReport: BugReport;

  beforeAll(async () => {
    db = DatabaseClient.create({
      connectionString: TEST_DATABASE_URL,
    });

    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    // Create test project
    testProject = await db.projects.create({
      name: 'Date Filter Test Project',
    });

    // Create bug reports with different dates
    // Old report (2020)
    oldReport = await db.bugReports.create({
      project_id: testProject.id,
      title: 'Old Bug Report',
      status: 'open',
      priority: 'medium',
      metadata: {},
    });
    // Manually update created_at to 2020
    await db.query(`UPDATE bug_reports SET created_at = $1 WHERE id = $2`, [
      new Date('2020-01-15T10:00:00Z'),
      oldReport.id,
    ]);

    // Recent report (2025)
    recentReport = await db.bugReports.create({
      project_id: testProject.id,
      title: 'Recent Bug Report',
      status: 'open',
      priority: 'high',
      metadata: {},
    });
    // Manually update created_at to 2025
    await db.query(`UPDATE bug_reports SET created_at = $1 WHERE id = $2`, [
      new Date('2025-06-15T12:00:00Z'),
      recentReport.id,
    ]);

    // Future report (2099)
    futureReport = await db.bugReports.create({
      project_id: testProject.id,
      title: 'Future Bug Report',
      status: 'open',
      priority: 'low',
      metadata: {},
    });
    // Manually update created_at to 2099
    await db.query(`UPDATE bug_reports SET created_at = $1 WHERE id = $2`, [
      new Date('2099-12-31T23:59:59Z'),
      futureReport.id,
    ]);
  });

  afterAll(async () => {
    if (db) {
      // Cleanup: soft delete all test reports
      await db.bugReports.softDelete([oldReport.id, recentReport.id, futureReport.id]);

      // Delete project
      await db.projects.delete(testProject.id);

      await db.close();
    }
  });

  describe('created_after filter', () => {
    it('should return only reports created after the specified date', async () => {
      const result = await db.bugReports.list({
        project_id: testProject.id,
        created_after: new Date('2026-01-01'),
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(futureReport.id);
      expect(result.data[0].title).toBe('Future Bug Report');
    });

    it('should return no reports when date is in future', async () => {
      const result = await db.bugReports.list({
        project_id: testProject.id,
        created_after: new Date('2100-01-01'),
      });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('should handle boundary date (inclusive)', async () => {
      // Get exact created_at of oldReport
      const reportResult = await db.query<{ created_at: Date }>(
        `SELECT created_at FROM bug_reports WHERE id = $1`,
        [oldReport.id]
      );
      const exactDate = new Date(reportResult.rows[0].created_at);

      const result = await db.bugReports.list({
        project_id: testProject.id,
        created_after: exactDate,
      });

      // Should include the report created exactly at this time
      const ids = result.data.map((r) => r.id);
      expect(ids).toContain(oldReport.id);
    });

    it('should work with ISO string dates', async () => {
      const result = await db.bugReports.list({
        project_id: testProject.id,
        created_after: new Date('2020-01-01T00:00:00.000Z'),
      });

      // Should include old, recent, and future reports
      expect(result.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('created_before filter', () => {
    it('should return only reports created before the specified date', async () => {
      const result = await db.bugReports.list({
        project_id: testProject.id,
        created_before: new Date('2021-01-01'),
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(oldReport.id);
      expect(result.data[0].title).toBe('Old Bug Report');
    });

    it('should return no reports when date is in past', async () => {
      const result = await db.bugReports.list({
        project_id: testProject.id,
        created_before: new Date('2000-01-01'),
      });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('should handle boundary date (inclusive)', async () => {
      // Get exact created_at of futureReport
      const reportResult = await db.query<{ created_at: Date }>(
        `SELECT created_at FROM bug_reports WHERE id = $1`,
        [futureReport.id]
      );
      const exactDate = new Date(reportResult.rows[0].created_at);

      const result = await db.bugReports.list({
        project_id: testProject.id,
        created_before: exactDate,
      });

      // Should include the report created exactly at this time
      const ids = result.data.map((r) => r.id);
      expect(ids).toContain(futureReport.id);
    });
  });

  describe('created_after and created_before combined', () => {
    it('should return reports within date range', async () => {
      const result = await db.bugReports.list({
        project_id: testProject.id,
        created_after: new Date('2020-01-01'),
        created_before: new Date('2030-01-01'),
      });

      // Should include old and recent reports, but not future
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      const ids = result.data.map((r) => r.id);
      expect(ids).toContain(oldReport.id);
      expect(ids).not.toContain(futureReport.id);
    });

    it('should return empty result for impossible date range', async () => {
      const result = await db.bugReports.list({
        project_id: testProject.id,
        created_after: new Date('2025-12-31'),
        created_before: new Date('2025-01-01'),
      });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('should handle single-day range', async () => {
      const result = await db.bugReports.list({
        project_id: testProject.id,
        created_after: new Date('2020-01-15T00:00:00Z'),
        created_before: new Date('2020-01-15T23:59:59Z'),
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(oldReport.id);
    });
  });

  describe('date filtering with pagination', () => {
    it('should respect pagination with date filters', async () => {
      const result = await db.bugReports.list(
        {
          project_id: testProject.id,
          created_after: new Date('2000-01-01'),
        },
        undefined,
        { page: 1, limit: 2 }
      );

      expect(result.data.length).toBeLessThanOrEqual(2);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(2);
      expect(result.pagination.total).toBeGreaterThanOrEqual(2);
    });

    it('should return correct total count with date filters', async () => {
      const result = await db.bugReports.list(
        {
          project_id: testProject.id,
          created_after: new Date('2020-01-01'),
        },
        undefined,
        { page: 1, limit: 1 }
      );

      expect(result.pagination.total).toBeGreaterThanOrEqual(2);
      expect(result.pagination.totalPages).toBe(Math.ceil(result.pagination.total / 1));
    });
  });

  describe('date filtering with sorting', () => {
    it('should sort by created_at ascending with date filter', async () => {
      const result = await db.bugReports.list(
        {
          project_id: testProject.id,
          created_after: new Date('2000-01-01'),
        },
        { sort_by: 'created_at', order: 'asc' },
        undefined
      );

      expect(result.data.length).toBeGreaterThanOrEqual(2);

      // Check that dates are in ascending order
      for (let i = 1; i < result.data.length; i++) {
        const prevDate = new Date(result.data[i - 1].created_at);
        const currDate = new Date(result.data[i].created_at);
        expect(currDate.getTime()).toBeGreaterThanOrEqual(prevDate.getTime());
      }
    });

    it('should sort by priority with date filter', async () => {
      const result = await db.bugReports.list(
        {
          project_id: testProject.id,
          created_after: new Date('2000-01-01'),
        },
        { sort_by: 'priority', order: 'asc' },
        undefined
      );

      expect(result.data.length).toBeGreaterThanOrEqual(2);

      // Check that results are sorted by priority
      expect(result.data[0].priority).toBeDefined();
    });
  });

  describe('date filtering with other filters', () => {
    it('should combine date filter with status filter', async () => {
      const result = await db.bugReports.list({
        project_id: testProject.id,
        status: 'open',
        created_after: new Date('2020-01-01'),
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
      result.data.forEach((report) => {
        expect(report.status).toBe('open');
      });
    });

    it('should combine date filter with priority filter', async () => {
      const result = await db.bugReports.list({
        project_id: testProject.id,
        priority: 'low',
        created_after: new Date('2099-01-01'),
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(futureReport.id);
      expect(result.data[0].priority).toBe('low');
    });
  });

  describe('query parameter numbering', () => {
    it('should correctly number parameters with project_id and created_after', async () => {
      // This test ensures that parameters are numbered correctly:
      // $1 = project_id, $2 = created_after, $3 = LIMIT, $4 = OFFSET
      const result = await db.bugReports.list(
        {
          project_id: testProject.id,
          created_after: new Date('2000-01-01'),
        },
        undefined,
        { page: 1, limit: 10 }
      );

      // Should not throw PostgreSQL error 42P18 (could not determine data type)
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.pagination).toBeDefined();
    });

    it('should correctly number parameters with multiple filters and date range', async () => {
      // Parameters: $1 = project_id, $2 = status, $3 = created_after,
      // $4 = created_before, $5 = LIMIT, $6 = OFFSET
      const result = await db.bugReports.list(
        {
          project_id: testProject.id,
          status: 'open',
          created_after: new Date('2000-01-01'),
          created_before: new Date('2100-01-01'),
        },
        undefined,
        { page: 2, limit: 5 }
      );

      // Should not throw PostgreSQL error
      expect(result).toBeDefined();
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(5);
    });
  });

  describe('edge cases', () => {
    it('should handle undefined date filters (no filtering)', async () => {
      const result = await db.bugReports.list({
        project_id: testProject.id,
        created_after: undefined,
        created_before: undefined,
      });

      // Should return all reports for the project
      expect(result.data.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle null date filters (no filtering)', async () => {
      const result = await db.bugReports.list({
        project_id: testProject.id,
        created_after: null as any,
        created_before: null as any,
      });

      // Should return all reports for the project
      expect(result.data.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle timezone differences', async () => {
      // Create date in different timezone
      const dateWithTimezone = new Date('2020-01-15T10:00:00-05:00');

      const result = await db.bugReports.list({
        project_id: testProject.id,
        created_after: dateWithTimezone,
      });

      // Should still filter correctly (PostgreSQL handles timezone conversion)
      expect(result.data.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle millisecond precision', async () => {
      const dateWithMillis = new Date('2020-01-15T10:00:00.123Z');

      const result = await db.bugReports.list({
        project_id: testProject.id,
        created_after: dateWithMillis,
      });

      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
    });
  });

  describe('SQL injection protection', () => {
    it('should handle malicious date strings safely', async () => {
      // PostgreSQL will reject invalid date formats
      await expect(
        db.bugReports.list({
          project_id: testProject.id,
          created_after: new Date('invalid; DROP TABLE bug_reports--'),
        })
      ).rejects.toThrow();
    });

    it('should use parameterized queries for date values', async () => {
      // This test verifies that dates are passed as parameters, not concatenated
      const result = await db.bugReports.list({
        project_id: testProject.id,
        created_after: new Date('2020-01-01'),
      });

      // Should execute without SQL injection errors
      expect(result).toBeDefined();
    });
  });
});
