/**
 * Analytics Service Integration Tests
 * Tests dual-mode SQL queries: null (self-hosted, no filter) vs string[] (SaaS, org-scoped)
 *
 * Uses the testcontainer PostgreSQL database from globalSetup.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import { AnalyticsService } from '../../src/analytics/analytics-service.js';
import { createTestUser, generateUniqueId } from '../utils/test-utils.js';

describe('AnalyticsService (integration)', () => {
  let db: DatabaseClient;
  let analytics: AnalyticsService;

  // Test data IDs for cleanup
  let org1Id: string;
  let org2Id: string;
  let user1Id: string;
  let user2Id: string;
  let projectOrg1Id: string;
  let projectOrg2Id: string;
  let projectNoOrgId: string;

  beforeAll(async () => {
    db = DatabaseClient.create({
      connectionString: process.env.DATABASE_URL!,
    });
    analytics = new AnalyticsService(db.getPool());

    const ts = generateUniqueId();

    // Create two organizations
    const org1 = await db.organizations.create({
      name: `Analytics Test Org 1 ${ts}`,
      subdomain: `analytics-org1-${ts}`,
    });
    org1Id = org1.id;

    const org2 = await db.organizations.create({
      name: `Analytics Test Org 2 ${ts}`,
      subdomain: `analytics-org2-${ts}`,
    });
    org2Id = org2.id;

    // Create users
    const { user: u1 } = await createTestUser(db, {
      email: `analytics-u1-${ts}@test.com`,
      role: 'admin',
    });
    user1Id = u1.id;

    const { user: u2 } = await createTestUser(db, {
      email: `analytics-u2-${ts}@test.com`,
      role: 'user',
    });
    user2Id = u2.id;

    // Add users as org members
    await db.organizationMembers.create({
      organization_id: org1Id,
      user_id: user1Id,
      role: 'owner',
    });
    await db.organizationMembers.create({
      organization_id: org2Id,
      user_id: user2Id,
      role: 'admin',
    });

    // Create projects: one per org + one without org (self-hosted style)
    const pOrg1 = await db.projects.create({
      name: `Proj Org1 ${ts}`,
      organization_id: org1Id,
      created_by: user1Id,
    });
    projectOrg1Id = pOrg1.id;

    const pOrg2 = await db.projects.create({
      name: `Proj Org2 ${ts}`,
      organization_id: org2Id,
      created_by: user2Id,
    });
    projectOrg2Id = pOrg2.id;

    const pNoOrg = await db.projects.create({
      name: `Proj NoOrg ${ts}`,
      created_by: user1Id,
    });
    projectNoOrgId = pNoOrg.id;

    // Create bug reports with various statuses/priorities
    // Org1 project: 3 reports
    await db.bugReports.create({
      project_id: projectOrg1Id,
      title: `Org1 Bug 1 ${ts}`,
      status: 'open',
      priority: 'high',
      organization_id: org1Id,
    });
    await db.bugReports.create({
      project_id: projectOrg1Id,
      title: `Org1 Bug 2 ${ts}`,
      status: 'resolved',
      priority: 'critical',
      organization_id: org1Id,
    });
    await db.bugReports.create({
      project_id: projectOrg1Id,
      title: `Org1 Bug 3 ${ts}`,
      status: 'closed',
      priority: 'low',
      organization_id: org1Id,
    });

    // Org2 project: 2 reports
    await db.bugReports.create({
      project_id: projectOrg2Id,
      title: `Org2 Bug 1 ${ts}`,
      status: 'open',
      priority: 'medium',
      organization_id: org2Id,
    });
    await db.bugReports.create({
      project_id: projectOrg2Id,
      title: `Org2 Bug 2 ${ts}`,
      status: 'in_progress',
      priority: 'high',
      organization_id: org2Id,
    });

    // No-org project: 1 report (self-hosted style, no org association)
    await db.bugReports.create({
      project_id: projectNoOrgId,
      title: `NoOrg Bug 1 ${ts}`,
      status: 'open',
      priority: 'critical',
    });
  });

  afterAll(async () => {
    // Cleanup in reverse dependency order
    // Bug reports cascade from projects, org members cascade from orgs
    const pool = db.getPool();
    await pool.query('DELETE FROM application.bug_reports WHERE project_id = ANY($1)', [
      [projectOrg1Id, projectOrg2Id, projectNoOrgId],
    ]);
    await pool.query('DELETE FROM application.projects WHERE id = ANY($1)', [
      [projectOrg1Id, projectOrg2Id, projectNoOrgId],
    ]);
    await pool.query('DELETE FROM saas.organization_members WHERE organization_id = ANY($1)', [
      [org1Id, org2Id],
    ]);
    await pool.query('DELETE FROM saas.organizations WHERE id = ANY($1)', [[org1Id, org2Id]]);
    await pool.query('DELETE FROM application.users WHERE id = ANY($1)', [[user1Id, user2Id]]);
    await db.close();
  });

  // ==========================================================================
  // getDashboardMetrics
  // ==========================================================================

  describe('getDashboardMetrics', () => {
    it('should return all data when organizationIds is null (self-hosted)', async () => {
      const metrics = await analytics.getDashboardMetrics(null);

      // Should include reports from ALL projects (org1 + org2 + no-org)
      // There may be other test data in the DB, so check >= our known counts
      expect(metrics.bug_reports.by_status.total).toBeGreaterThanOrEqual(6);
      expect(metrics.bug_reports.by_status.open).toBeGreaterThanOrEqual(2);
      expect(metrics.bug_reports.by_status.resolved).toBeGreaterThanOrEqual(1);
      expect(metrics.bug_reports.by_status.closed).toBeGreaterThanOrEqual(1);
      expect(metrics.bug_reports.by_status.in_progress).toBeGreaterThanOrEqual(1);

      expect(metrics.bug_reports.by_priority.high).toBeGreaterThanOrEqual(2);
      expect(metrics.bug_reports.by_priority.critical).toBeGreaterThanOrEqual(2);
      expect(metrics.bug_reports.by_priority.low).toBeGreaterThanOrEqual(1);
      expect(metrics.bug_reports.by_priority.medium).toBeGreaterThanOrEqual(1);

      // Projects: at least our 3
      expect(metrics.projects.total).toBeGreaterThanOrEqual(3);

      // Users: queries application.users when null, should include our 2
      expect(metrics.users.total).toBeGreaterThanOrEqual(2);

      // Shape check
      expect(metrics.time_series).toBeInstanceOf(Array);
      expect(metrics.top_projects).toBeInstanceOf(Array);
    });

    it('should scope to single org when organizationIds has one ID', async () => {
      const metrics = await analytics.getDashboardMetrics([org1Id]);

      // Org1 has exactly 3 bug reports
      expect(metrics.bug_reports.by_status.total).toBe(3);
      expect(metrics.bug_reports.by_status.open).toBe(1);
      expect(metrics.bug_reports.by_status.resolved).toBe(1);
      expect(metrics.bug_reports.by_status.closed).toBe(1);
      expect(metrics.bug_reports.by_status.in_progress).toBe(0);

      expect(metrics.bug_reports.by_priority.high).toBe(1);
      expect(metrics.bug_reports.by_priority.critical).toBe(1);
      expect(metrics.bug_reports.by_priority.low).toBe(1);
      expect(metrics.bug_reports.by_priority.medium).toBe(0);

      // Only org1's project
      expect(metrics.projects.total).toBe(1);
      expect(metrics.projects.total_reports).toBe(3);

      // Users: queries saas.organization_members for org1 — user1 is owner
      expect(metrics.users.total).toBe(1);
    });

    it('should scope to multiple orgs when organizationIds has multiple IDs', async () => {
      const metrics = await analytics.getDashboardMetrics([org1Id, org2Id]);

      // Org1 (3) + Org2 (2) = 5 reports
      expect(metrics.bug_reports.by_status.total).toBe(5);
      expect(metrics.bug_reports.by_status.open).toBe(2);
      expect(metrics.bug_reports.by_status.in_progress).toBe(1);

      // 2 projects (one per org)
      expect(metrics.projects.total).toBe(2);

      // 2 distinct users across both orgs
      expect(metrics.users.total).toBe(2);
    });

    it('should return zeros for a non-existent org ID', async () => {
      const fakeOrgId = '00000000-0000-0000-0000-000000000000';
      const metrics = await analytics.getDashboardMetrics([fakeOrgId]);

      expect(metrics.bug_reports.by_status.total).toBe(0);
      expect(metrics.projects.total).toBe(0);
      expect(metrics.users.total).toBe(0);
    });
  });

  // ==========================================================================
  // getReportTrend
  // ==========================================================================

  describe('getReportTrend', () => {
    it('should return trend data for all reports when null (self-hosted)', async () => {
      const trend = await analytics.getReportTrend(null, 30);

      expect(trend.days).toBe(30);
      expect(trend.trend).toBeInstanceOf(Array);
      // At least one day with our seeded reports
      expect(trend.trend.length).toBeGreaterThanOrEqual(1);

      // Each day should have the expected shape
      const day = trend.trend[0];
      expect(day).toHaveProperty('date');
      expect(day).toHaveProperty('total');
      expect(day).toHaveProperty('open');
      expect(day).toHaveProperty('in_progress');
      expect(day).toHaveProperty('resolved');
      expect(day).toHaveProperty('closed');
    });

    it('should scope trend to single org', async () => {
      const trend = await analytics.getReportTrend([org1Id], 30);

      expect(trend.days).toBe(30);
      // Org1 has 3 reports, all created today
      const totalReports = trend.trend.reduce((sum, d) => sum + d.total, 0);
      expect(totalReports).toBe(3);
    });

    it('should scope trend to multiple orgs', async () => {
      const trend = await analytics.getReportTrend([org1Id, org2Id], 30);

      const totalReports = trend.trend.reduce((sum, d) => sum + d.total, 0);
      expect(totalReports).toBe(5);
    });

    it('should clamp days to valid range', async () => {
      const trend = await analytics.getReportTrend([org1Id], 0);
      expect(trend.days).toBe(1); // Clamped from 0 to 1
    });
  });

  // ==========================================================================
  // getProjectStats
  // ==========================================================================

  describe('getProjectStats', () => {
    it('should return all project stats when null (self-hosted)', async () => {
      const stats = await analytics.getProjectStats(null);

      expect(stats).toBeInstanceOf(Array);
      // At least our 3 projects
      expect(stats.length).toBeGreaterThanOrEqual(3);

      // Each stat should have the expected shape
      const stat = stats[0];
      expect(stat).toHaveProperty('id');
      expect(stat).toHaveProperty('name');
      expect(stat).toHaveProperty('total_reports');
      expect(stat).toHaveProperty('open_reports');
      expect(stat).toHaveProperty('in_progress_reports');
      expect(stat).toHaveProperty('resolved_reports');
      expect(stat).toHaveProperty('closed_reports');
      expect(stat).toHaveProperty('critical_reports');
      expect(stat).toHaveProperty('last_report_at');
    });

    it('should scope to single org', async () => {
      const stats = await analytics.getProjectStats([org1Id]);

      // Only org1's project
      expect(stats).toHaveLength(1);
      expect(stats[0].name).toContain('Proj Org1');
      expect(stats[0].total_reports).toBe(3);
      expect(stats[0].open_reports).toBe(1);
      expect(stats[0].resolved_reports).toBe(1);
      expect(stats[0].closed_reports).toBe(1);
      expect(stats[0].critical_reports).toBe(1);
    });

    it('should scope to multiple orgs', async () => {
      const stats = await analytics.getProjectStats([org1Id, org2Id]);

      expect(stats).toHaveLength(2);
      const totalReports = stats.reduce((sum, s) => sum + s.total_reports, 0);
      expect(totalReports).toBe(5);
    });

    it('should return empty array for non-existent org', async () => {
      const fakeOrgId = '00000000-0000-0000-0000-000000000000';
      const stats = await analytics.getProjectStats([fakeOrgId]);

      expect(stats).toEqual([]);
    });
  });
});
