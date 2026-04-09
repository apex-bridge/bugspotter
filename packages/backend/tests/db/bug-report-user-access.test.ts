/**
 * BugReportRepository.listByUserAccess() Tests
 *
 * CRITICAL: This method caused production incident on demo.api.bugspotter.io
 * Date: November 17, 2025
 * Error: SQL syntax error "at or near [" due to pagination parameter mismatch
 * Root cause: buildPaginationClause returns {clause, values} but code only used clause
 *
 * Tests cover:
 * - Access control (user can only see reports from their projects)
 * - Pagination (regression test for production bug)
 * - Sorting (created_at, updated_at, priority)
 * - Filters (status, priority, date ranges)
 * - Soft-delete handling
 * - Edge cases (no results, empty projects, deleted reports)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import type { User, Project, BugReport } from '../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('BugReportRepository.listByUserAccess()', () => {
  let db: DatabaseClient;
  let user1: User;
  let user2: User;
  let user3: User;
  let project1: Project;
  let project2: Project;
  let project3: Project;
  let report1: BugReport;
  let report2: BugReport;
  let report3: BugReport;
  let report4: BugReport;
  let report5: BugReport;

  beforeAll(async () => {
    db = DatabaseClient.create({
      connectionString: TEST_DATABASE_URL,
    });

    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    // Create test users
    user1 = await db.users.create({
      email: `user1-access-${Date.now()}@test.com`,
      password_hash: 'hash1',
      role: 'user',
    });

    user2 = await db.users.create({
      email: `user2-access-${Date.now()}@test.com`,
      password_hash: 'hash2',
      role: 'user',
    });

    user3 = await db.users.create({
      email: `user3-access-${Date.now()}@test.com`,
      password_hash: 'hash3',
      role: 'user',
    });

    // Create test projects
    // user1 owns project1, is member of project2
    // user2 owns project2
    // user3 owns project3 (isolated)
    project1 = await db.projects.create({
      name: 'User1 Project',
      created_by: user1.id,
    });

    project2 = await db.projects.create({
      name: 'User2 Project',
      created_by: user2.id,
    });

    project3 = await db.projects.create({
      name: 'User3 Project (isolated)',
      created_by: user3.id,
    });

    // Add user1 as member of project2
    await db.projectMembers.addMember(project2.id, user1.id, 'member');

    // Create bug reports
    // Project1: 3 reports (user1 can see)
    report1 = await db.bugReports.create({
      project_id: project1.id,
      title: 'Report 1 - Open High',
      description: 'Description 1',
      status: 'open',
      priority: 'high',
    });

    report2 = await db.bugReports.create({
      project_id: project1.id,
      title: 'Report 2 - In Progress Medium',
      description: 'Description 2',
      status: 'in-progress',
      priority: 'medium',
    });

    report3 = await db.bugReports.create({
      project_id: project1.id,
      title: 'Report 3 - Resolved Low',
      description: 'Description 3',
      status: 'resolved',
      priority: 'low',
    });

    // Project2: 2 reports (user1 and user2 can see)
    report4 = await db.bugReports.create({
      project_id: project2.id,
      title: 'Report 4 - Open Medium',
      description: 'Description 4',
      status: 'open',
      priority: 'medium',
    });

    report5 = await db.bugReports.create({
      project_id: project2.id,
      title: 'Report 5 - Open High',
      description: 'Description 5',
      status: 'open',
      priority: 'high',
    });

    // Project3: 1 report (only user3 can see)
    await db.bugReports.create({
      project_id: project3.id,
      title: 'Report 6 - Isolated',
      description: 'Description 6',
      status: 'open',
      priority: 'medium',
    });
  });

  afterAll(async () => {
    // Cleanup (projects cascade delete bug_reports)
    if (project1?.id) await db.projects.delete(project1.id);
    if (project2?.id) await db.projects.delete(project2.id);
    if (project3?.id) await db.projects.delete(project3.id);
    if (user1?.id) await db.users.delete(user1.id);
    if (user2?.id) await db.users.delete(user2.id);
    if (user3?.id) await db.users.delete(user3.id);

    await db.close();
  });

  // ============================================================================
  // ACCESS CONTROL TESTS
  // ============================================================================

  describe('Access Control via JOIN', () => {
    it('should return reports from projects user owns', async () => {
      const result = await db.bugReports.list({ user_id: user1.id });

      expect(result.data).toHaveLength(5); // 3 from project1 + 2 from project2
      expect(result.pagination.total).toBe(5);

      const reportIds = result.data.map((r) => r.id);
      expect(reportIds).toContain(report1.id);
      expect(reportIds).toContain(report2.id);
      expect(reportIds).toContain(report3.id);
      expect(reportIds).toContain(report4.id);
      expect(reportIds).toContain(report5.id);
    });

    it('should return reports from projects user is member of', async () => {
      const result = await db.bugReports.list({ user_id: user2.id });

      expect(result.data).toHaveLength(2); // 2 from project2 (owner)
      expect(result.pagination.total).toBe(2);

      const reportIds = result.data.map((r) => r.id);
      expect(reportIds).toContain(report4.id);
      expect(reportIds).toContain(report5.id);
    });

    it('should NOT return reports from projects user has no access to', async () => {
      const result = await db.bugReports.list({ user_id: user3.id });

      expect(result.data).toHaveLength(1); // Only project3 report
      expect(result.pagination.total).toBe(1);

      const reportIds = result.data.map((r) => r.id);
      expect(reportIds).not.toContain(report1.id);
      expect(reportIds).not.toContain(report2.id);
      expect(reportIds).not.toContain(report3.id);
      expect(reportIds).not.toContain(report4.id);
      expect(reportIds).not.toContain(report5.id);
    });

    it('should return empty array for user with no projects', async () => {
      const orphanUser = await db.users.create({
        email: `orphan-${Date.now()}@test.com`,
        password_hash: 'hash',
        role: 'user',
      });

      const result = await db.bugReports.list({ user_id: orphanUser.id });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);

      await db.users.delete(orphanUser.id);
    });
  });

  // ============================================================================
  // PAGINATION TESTS (REGRESSION TEST FOR PRODUCTION BUG)
  // ============================================================================

  describe('Pagination (Production Bug Regression)', () => {
    it('should correctly paginate with page 1', async () => {
      const result = await db.bugReports.list({ user_id: user1.id }, undefined, {
        page: 1,
        limit: 3,
      });

      expect(result.data).toHaveLength(3);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(3);
      expect(result.pagination.total).toBe(5);
      expect(result.pagination.totalPages).toBe(2);
    });

    it('should correctly paginate with page 2', async () => {
      const result = await db.bugReports.list({ user_id: user1.id }, undefined, {
        page: 2,
        limit: 3,
      });

      expect(result.data).toHaveLength(2); // Remaining 2 reports
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(3);
      expect(result.pagination.total).toBe(5);
      expect(result.pagination.totalPages).toBe(2);
    });

    it('should handle limit of 1', async () => {
      const result = await db.bugReports.list({ user_id: user1.id }, undefined, {
        page: 1,
        limit: 1,
      });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(1);
      expect(result.pagination.total).toBe(5);
      expect(result.pagination.totalPages).toBe(5);
    });

    it('should handle limit larger than total', async () => {
      const result = await db.bugReports.list({ user_id: user1.id }, undefined, {
        page: 1,
        limit: 100,
      });

      expect(result.data).toHaveLength(5);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(100);
      expect(result.pagination.total).toBe(5);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('should return empty array for page beyond total', async () => {
      const result = await db.bugReports.list({ user_id: user1.id }, undefined, {
        page: 10,
        limit: 3,
      });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.page).toBe(10);
      expect(result.pagination.total).toBe(5);
    });

    it('should use default pagination when not specified', async () => {
      const result = await db.bugReports.list({ user_id: user1.id });

      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20); // DEFAULT_PAGE_SIZE
      expect(result.pagination.total).toBe(5);
    });
  });

  // ============================================================================
  // SORTING TESTS
  // ============================================================================

  describe('Sorting', () => {
    it('should sort by created_at desc (default)', async () => {
      const result = await db.bugReports.list({ user_id: user1.id });

      // Should be in reverse chronological order (newest first)
      for (let i = 0; i < result.data.length - 1; i++) {
        const current = new Date(result.data[i].created_at);
        const next = new Date(result.data[i + 1].created_at);
        expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
      }
    });

    it('should sort by created_at asc', async () => {
      const result = await db.bugReports.list(
        { user_id: user1.id },
        { sort_by: 'created_at', order: 'asc' }
      );

      // Should be in chronological order (oldest first)
      for (let i = 0; i < result.data.length - 1; i++) {
        const current = new Date(result.data[i].created_at);
        const next = new Date(result.data[i + 1].created_at);
        expect(current.getTime()).toBeLessThanOrEqual(next.getTime());
      }
    });

    it('should sort by priority desc', async () => {
      const result = await db.bugReports.list(
        { user_id: user1.id },
        { sort_by: 'priority', order: 'desc' }
      );

      expect(result.data).toHaveLength(5);
      // No strict ordering check since priority is text, but should not error
    });

    it('should sort by updated_at desc', async () => {
      const result = await db.bugReports.list(
        { user_id: user1.id },
        { sort_by: 'updated_at', order: 'desc' }
      );

      expect(result.data).toHaveLength(5);
      // Should be in reverse chronological order
      for (let i = 0; i < result.data.length - 1; i++) {
        const current = new Date(result.data[i].updated_at);
        const next = new Date(result.data[i + 1].updated_at);
        expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
      }
    });

    it('should reject invalid sort column', async () => {
      await expect(
        db.bugReports.list(
          { user_id: user1.id },
          { sort_by: 'invalid_column' as any, order: 'desc' }
        )
      ).rejects.toThrow('Invalid sort column');
    });
  });

  // ============================================================================
  // FILTER TESTS
  // ============================================================================

  describe('Filters', () => {
    it('should filter by status', async () => {
      const result = await db.bugReports.list({
        user_id: user1.id,
        status: 'open',
      });

      expect(result.data.length).toBeGreaterThan(0);
      result.data.forEach((report) => {
        expect(report.status).toBe('open');
      });
    });

    it('should filter by priority', async () => {
      const result = await db.bugReports.list({
        user_id: user1.id,
        priority: 'high',
      });

      expect(result.data.length).toBeGreaterThan(0);
      result.data.forEach((report) => {
        expect(report.priority).toBe('high');
      });
    });

    it('should filter by status and priority combined', async () => {
      const result = await db.bugReports.list({
        user_id: user1.id,
        status: 'open',
        priority: 'high',
      });

      // Should have report1 and report5
      expect(result.data.length).toBeGreaterThan(0);
      result.data.forEach((report) => {
        expect(report.status).toBe('open');
        expect(report.priority).toBe('high');
      });
    });

    it('should filter by created_after', async () => {
      const cutoffDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago

      const result = await db.bugReports.list({
        user_id: user1.id,
        created_after: cutoffDate,
      });

      expect(result.data).toHaveLength(5); // All created recently
      result.data.forEach((report) => {
        expect(new Date(report.created_at).getTime()).toBeGreaterThanOrEqual(cutoffDate.getTime());
      });
    });

    it('should filter by created_before', async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60); // 1 hour from now

      const result = await db.bugReports.list({
        user_id: user1.id,
        created_before: futureDate,
      });

      expect(result.data).toHaveLength(5); // All created in past
      result.data.forEach((report) => {
        expect(new Date(report.created_at).getTime()).toBeLessThanOrEqual(futureDate.getTime());
      });
    });

    it('should filter by date range', async () => {
      const start = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
      const end = new Date(Date.now() + 1000 * 60 * 60); // 1 hour from now

      const result = await db.bugReports.list({
        user_id: user1.id,
        created_after: start,
        created_before: end,
      });

      expect(result.data).toHaveLength(5);
      result.data.forEach((report) => {
        const createdAt = new Date(report.created_at).getTime();
        expect(createdAt).toBeGreaterThanOrEqual(start.getTime());
        expect(createdAt).toBeLessThanOrEqual(end.getTime());
      });
    });

    it('should return empty when date range excludes all reports', async () => {
      const start = new Date('2000-01-01');
      const end = new Date('2000-12-31');

      const result = await db.bugReports.list({
        user_id: user1.id,
        created_after: start,
        created_before: end,
      });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });
  });

  // ============================================================================
  // SOFT DELETE TESTS
  // ============================================================================

  describe('Soft Delete Handling', () => {
    let deletedReport: BugReport;

    beforeAll(async () => {
      // Create and soft-delete a report
      deletedReport = await db.bugReports.create({
        project_id: project1.id,
        title: 'Report to Delete',
        description: 'Will be soft-deleted',
        status: 'open',
        priority: 'medium',
      });

      await db.bugReports.softDelete([deletedReport.id], user1.id);
    });

    it('should exclude soft-deleted reports by default', async () => {
      const result = await db.bugReports.list({ user_id: user1.id });

      const reportIds = result.data.map((r) => r.id);
      expect(reportIds).not.toContain(deletedReport.id);
    });

    it('should include soft-deleted reports when includeDeleted=true', async () => {
      const result = await db.bugReports.list({
        user_id: user1.id,
        includeDeleted: true,
      });

      const reportIds = result.data.map((r) => r.id);
      expect(reportIds).toContain(deletedReport.id);
    });
  });

  // ============================================================================
  // COMBINED FILTER TESTS
  // ============================================================================

  describe('Combined Filters with Pagination and Sorting', () => {
    it('should handle status filter + pagination + sorting', async () => {
      const result = await db.bugReports.list(
        { user_id: user1.id, status: 'open' },
        { sort_by: 'priority', order: 'desc' },
        { page: 1, limit: 2 }
      );

      expect(result.data.length).toBeLessThanOrEqual(2);
      result.data.forEach((report) => {
        expect(report.status).toBe('open');
      });
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(2);
    });

    it('should handle all filters combined', async () => {
      const start = new Date(Date.now() - 1000 * 60 * 60);
      const end = new Date(Date.now() + 1000 * 60 * 60);

      const result = await db.bugReports.list(
        {
          user_id: user1.id,
          status: 'open',
          priority: 'high',
          created_after: start,
          created_before: end,
        },
        { sort_by: 'created_at', order: 'desc' },
        { page: 1, limit: 10 }
      );

      result.data.forEach((report) => {
        expect(report.status).toBe('open');
        expect(report.priority).toBe('high');
        const createdAt = new Date(report.created_at).getTime();
        expect(createdAt).toBeGreaterThanOrEqual(start.getTime());
        expect(createdAt).toBeLessThanOrEqual(end.getTime());
      });
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle user with single report', async () => {
      const result = await db.bugReports.list({ user_id: user3.id });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('should handle filter that returns no results', async () => {
      const result = await db.bugReports.list({
        user_id: user1.id,
        status: 'closed', // No reports with this status
      });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(1); // REST convention: minimum 1 page
    });

    it('should handle DISTINCT correctly (no duplicate reports)', async () => {
      const result = await db.bugReports.list({ user_id: user1.id });

      const reportIds = result.data.map((r) => r.id);
      const uniqueIds = new Set(reportIds);
      expect(reportIds.length).toBe(uniqueIds.size); // No duplicates
    });
  });
});
