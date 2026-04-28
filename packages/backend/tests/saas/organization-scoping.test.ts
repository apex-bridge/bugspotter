/**
 * Organization Scoping Tests
 * Verifies that organization_id is correctly set and filtered
 * on projects and bug reports.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import { OrganizationService } from '../../src/saas/services/organization.service.js';
import type { Organization, User, Project } from '../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('Organization scoping', () => {
  let db: DatabaseClient;
  let service: OrganizationService;
  let user: User;
  let org: Organization;
  const createdOrgIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdReportIds: string[] = [];

  beforeAll(async () => {
    db = DatabaseClient.create({ connectionString: TEST_DATABASE_URL });
    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    service = new OrganizationService(db);

    user = await db.users.create({
      email: `org-scope-test-${Date.now()}@test.com`,
      password_hash: 'hash123',
      role: 'admin',
    });

    org = await service.createOrganization(
      { name: 'Scoping Test Org', subdomain: `scope-test-${Date.now()}` },
      user.id
    );
    createdOrgIds.push(org.id);
  });

  afterAll(async () => {
    // Parallelize cleanup for better performance
    const cleanupResults = await Promise.allSettled([
      // Delete all bug reports in parallel
      ...createdReportIds.map((id) => db.bugReports.delete(id)),
      // Delete all projects in parallel
      ...createdProjectIds.map((id) => db.projects.delete(id)),
      // Delete all organizations in parallel
      ...createdOrgIds.map((id) => db.organizations.delete(id)),
      // Delete user
      db.users.delete(user.id),
    ]);

    // Log any cleanup failures for debugging
    const failures = cleanupResults.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      console.warn('Some cleanup operations failed:', failures);
    }

    await db.close();
  });

  describe('projects', () => {
    let orgProject: Project;
    let standaloneProject: Project;

    beforeAll(async () => {
      orgProject = await db.projects.create({
        name: 'Org Project',
        created_by: user.id,
        organization_id: org.id,
      });
      createdProjectIds.push(orgProject.id);

      standaloneProject = await db.projects.create({
        name: 'Standalone Project',
        created_by: user.id,
        organization_id: null,
      });
      createdProjectIds.push(standaloneProject.id);
    });

    it('should set organization_id on project creation', () => {
      expect(orgProject.organization_id).toBe(org.id);
    });

    it('should allow null organization_id for self-hosted projects', () => {
      expect(standaloneProject.organization_id).toBeNull();
    });

    it('should filter by organization with findByOrganizationId', async () => {
      const projects = await db.projects.findByOrganizationId(org.id);
      expect(projects.some((p) => p.id === orgProject.id)).toBe(true);
      expect(projects.some((p) => p.id === standaloneProject.id)).toBe(false);
    });

    it('should filter with getUserAccessibleProjects when org is provided', async () => {
      const projects = await db.projects.getUserAccessibleProjects(user.id, org.id);
      expect(projects.some((p) => p.id === orgProject.id)).toBe(true);
      expect(projects.some((p) => p.id === standaloneProject.id)).toBe(false);
    });

    it('should return all accessible projects when no org filter', async () => {
      const projects = await db.projects.getUserAccessibleProjects(user.id);
      expect(projects.some((p) => p.id === orgProject.id)).toBe(true);
      expect(projects.some((p) => p.id === standaloneProject.id)).toBe(true);
    });

    it('should filter findAll by organization', async () => {
      const projects = await db.projects.findAll(org.id);
      expect(projects.some((p) => p.id === orgProject.id)).toBe(true);
      expect(projects.some((p) => p.id === standaloneProject.id)).toBe(false);
    });

    it('should hide projects whose owning org is soft-deleted', async () => {
      // Use a fresh org so the shared `orgProject` fixture stays
      // available for the other tests in this block.
      const freshOrg = await service.createOrganization(
        { name: 'Soft-deleted Org', subdomain: `soft-deleted-${Date.now()}` },
        user.id
      );
      createdOrgIds.push(freshOrg.id);
      const freshProject = await db.projects.create({
        name: 'Project of soon-deleted org',
        created_by: user.id,
        organization_id: freshOrg.id,
      });
      createdProjectIds.push(freshProject.id);

      // Sanity: project is visible while the org is alive.
      const before = await db.projects.getUserAccessibleProjects(user.id);
      expect(before.some((p) => p.id === freshProject.id)).toBe(true);

      await db.organizations.softDelete(freshOrg.id, user.id);

      // After soft-delete: that org's project is hidden, but the
      // null-org (self-hosted-shape) project stays visible — the
      // org filter must not regress that path.
      const after = await db.projects.getUserAccessibleProjects(user.id);
      expect(after.some((p) => p.id === freshProject.id)).toBe(false);
      expect(after.some((p) => p.id === standaloneProject.id)).toBe(true);
    });
  });

  describe('bug reports', () => {
    let orgProject: Project;

    beforeAll(async () => {
      orgProject = await db.projects.create({
        name: 'Bug Report Org Project',
        created_by: user.id,
        organization_id: org.id,
      });
      createdProjectIds.push(orgProject.id);
    });

    it('should inherit organization_id from project', async () => {
      const report = await db.bugReports.create({
        project_id: orgProject.id,
        title: 'Org Bug Report',
        organization_id: orgProject.organization_id,
      });
      createdReportIds.push(report.id);

      expect(report.organization_id).toBe(org.id);
    });

    it('should allow null organization_id for self-hosted reports', async () => {
      const standaloneProject = await db.projects.create({
        name: 'Standalone Bug Project',
        created_by: user.id,
        organization_id: null,
      });
      createdProjectIds.push(standaloneProject.id);

      const report = await db.bugReports.create({
        project_id: standaloneProject.id,
        title: 'Standalone Bug Report',
        organization_id: null,
      });
      createdReportIds.push(report.id);

      expect(report.organization_id).toBeNull();
    });

    it('should filter bug reports by organization_id using list()', async () => {
      // Create a standalone project and report (use 2020 date to avoid interfering with date filter tests)
      const standaloneProject = await db.projects.create({
        name: 'Standalone List Project',
        created_by: user.id,
        organization_id: null,
      });
      createdProjectIds.push(standaloneProject.id);

      const standaloneReport = await db.bugReports.create({
        project_id: standaloneProject.id,
        title: 'Standalone Report for List',
        organization_id: null,
      });
      createdReportIds.push(standaloneReport.id);
      // Set to 2020 to avoid interfering with tests that filter by recent dates
      await db.query(`UPDATE application.bug_reports SET created_at = $1 WHERE id = $2`, [
        new Date('2020-03-01T10:00:00Z'),
        standaloneReport.id,
      ]);

      // Create an org report
      const orgReport = await db.bugReports.create({
        project_id: orgProject.id,
        title: 'Org Report for List',
        organization_id: org.id,
      });
      createdReportIds.push(orgReport.id);
      // Set to 2020 to avoid interfering with tests that filter by recent dates
      await db.query(`UPDATE application.bug_reports SET created_at = $1 WHERE id = $2`, [
        new Date('2020-03-15T10:00:00Z'),
        orgReport.id,
      ]);

      // Filter by organization_id
      const result = await db.bugReports.list({ organization_id: org.id });

      // Should include org report, exclude standalone report
      expect(result.data.some((r) => r.id === orgReport.id)).toBe(true);
      expect(result.data.some((r) => r.id === standaloneReport.id)).toBe(false);
    });
  });
});
