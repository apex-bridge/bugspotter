/**
 * Quota Enforcement Tests
 * Verifies that quota checks and usage tracking work correctly
 * for both SaaS and self-hosted modes.
 *
 * Each test is independent and creates its own organization to ensure
 * tests can run in parallel or in any order without conflicts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import { OrganizationService } from '../../src/saas/services/organization.service.js';
import { requireQuota } from '../../src/saas/middleware/quota.js';
import { RESOURCE_TYPE } from '../../src/db/types.js';
import type { Organization, User } from '../../src/db/types.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import * as configModule from '../../src/saas/config.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('Quota enforcement', () => {
  let db: DatabaseClient;
  let service: OrganizationService;
  let user: User;
  let org: Organization;
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    db = DatabaseClient.create({ connectionString: TEST_DATABASE_URL });
    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    service = new OrganizationService(db);

    user = await db.users.create({
      email: `quota-test-${Date.now()}@test.com`,
      password_hash: 'hash123',
      role: 'admin',
    });
  });

  afterAll(async () => {
    await db.users.delete(user.id);
    await db.close();
  });

  beforeEach(async () => {
    // Create fresh organization for each test to ensure independence
    org = await service.createOrganization(
      {
        name: `Test Org ${Date.now()}`,
        subdomain: `test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      },
      user.id
    );
  });

  afterEach(async () => {
    // Clean up projects created during test
    const cleanupResults = await Promise.allSettled(
      createdProjectIds.map((id) => db.projects.delete(id))
    );

    const failures = cleanupResults.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      console.warn('Some project cleanup operations failed:', failures);
    }
    createdProjectIds.length = 0; // Clear array

    // Clean up organization created in beforeEach
    try {
      await db.organizations.delete(org.id);
    } catch (err) {
      console.warn('Failed to delete organization:', err);
    }

    // Restore selfhosted mode so other test files aren't affected
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    configModule.resetDeploymentConfig();
  });

  describe('OrganizationService quota methods', () => {
    it('should report remaining quota for projects', async () => {
      const remaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.PROJECTS);
      // Trial plan allows 2 projects, fresh org has none created yet
      expect(remaining).toBe(2);
    });

    it('should decrease remaining quota as projects are created', async () => {
      // Verify initial quota
      const initialRemaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.PROJECTS);
      expect(initialRemaining).toBe(2);

      // Create first project
      const project = await db.projects.create({
        name: 'Quota Test Project 1',
        created_by: user.id,
        organization_id: org.id,
      });
      createdProjectIds.push(project.id);

      // Verify quota decreased
      const remaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.PROJECTS);
      expect(remaining).toBe(1);
    });

    it('should return canPerformAction=false when at project limit', async () => {
      // Create projects up to the limit (trial plan allows 2)
      const project1 = await db.projects.create({
        name: 'Quota Test Project 1',
        created_by: user.id,
        organization_id: org.id,
      });
      createdProjectIds.push(project1.id);

      const project2 = await db.projects.create({
        name: 'Quota Test Project 2',
        created_by: user.id,
        organization_id: org.id,
      });
      createdProjectIds.push(project2.id);

      // Verify we're at the limit
      const canCreate = await service.canPerformAction(org.id, RESOURCE_TYPE.PROJECTS);
      expect(canCreate).toBe(false);
    });

    it('should track and enforce bug report quota', async () => {
      // Fresh org should have full quota available
      const canCreate = await service.canPerformAction(org.id, RESOURCE_TYPE.BUG_REPORTS);
      expect(canCreate).toBe(true);

      // Track usage
      await service.trackUsage(org.id, RESOURCE_TYPE.BUG_REPORTS);

      // Verify quota decreased
      const remaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      // Trial plan allows 100, used 1
      expect(remaining).toBe(99);
    });

    it('should atomically reserve quota via reserveQuota', async () => {
      const before = await service.getRemainingQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      expect(before).toBe(100); // Fresh org

      const reserved = await service.reserveQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      expect(reserved).toBe(true);

      const after = await service.getRemainingQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      expect(after).toBe(99);
    });

    it('should reject reserveQuota when at limit', async () => {
      // Use up all bug report quota (trial plan allows 100)
      await service.trackUsage(org.id, RESOURCE_TYPE.BUG_REPORTS, 100);

      // Verify quota is exhausted
      const remaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      expect(remaining).toBe(0);

      // Attempt to reserve should fail
      const reserved = await service.reserveQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      expect(reserved).toBe(false);
    });

    it('should reject trackUsage for PROJECTS (count-based quota)', async () => {
      // trackUsage should not be called for PROJECTS since it uses count-based quota
      await expect(service.trackUsage(org.id, RESOURCE_TYPE.PROJECTS, 1)).rejects.toMatchObject({
        statusCode: 400,
        error: 'BadRequest',
      });
    });
  });

  describe('createProjectWithQuotaCheck', () => {
    it('should create project when under limit', async () => {
      const project = await service.createProjectWithQuotaCheck(org.id, {
        name: 'Atomic Project 1',
        created_by: user.id,
        organization_id: org.id,
      });
      createdProjectIds.push(project.id);

      expect(project.name).toBe('Atomic Project 1');
      expect(project.organization_id).toBe(org.id);
    });

    it('should throw 429 when at project limit', async () => {
      // Fill up to limit (trial = 2)
      const p1 = await service.createProjectWithQuotaCheck(org.id, {
        name: 'Limit Project 1',
        created_by: user.id,
        organization_id: org.id,
      });
      createdProjectIds.push(p1.id);

      const p2 = await service.createProjectWithQuotaCheck(org.id, {
        name: 'Limit Project 2',
        created_by: user.id,
        organization_id: org.id,
      });
      createdProjectIds.push(p2.id);

      // Third should fail
      await expect(
        service.createProjectWithQuotaCheck(org.id, {
          name: 'Over Limit Project',
          created_by: user.id,
          organization_id: org.id,
        })
      ).rejects.toMatchObject({
        statusCode: 429,
        error: 'QuotaExceeded',
      });
    });

    it('should reject mismatched organization_id in input', async () => {
      const otherOrgId = '12345678-1234-1234-1234-123456789abc';

      await expect(
        service.createProjectWithQuotaCheck(org.id, {
          name: 'Malicious Project',
          created_by: user.id,
          organization_id: otherOrgId, // Different from parameter!
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        error: 'BadRequest',
        message: 'Input organization_id does not match the organizationId parameter',
      });
    });
  });

  describe('requireQuota middleware', () => {
    function createMockRequest(organizationId?: string): FastifyRequest {
      return { organizationId } as unknown as FastifyRequest;
    }

    const mockReply = {} as FastifyReply;

    it('should pass when under quota (atomically reserves usage)', async () => {
      process.env.DEPLOYMENT_MODE = 'saas';
      configModule.resetDeploymentConfig();

      const middleware = requireQuota(service, RESOURCE_TYPE.BUG_REPORTS);
      const request = createMockRequest(org.id);

      // Should not throw — reserves 1 unit of BUG_REPORTS quota atomically
      await expect(middleware(request, mockReply)).resolves.toBeUndefined();

      // Verify quota was reserved
      const remaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      expect(remaining).toBe(99); // 100 - 1
    });

    it('should throw 429 when quota exceeded', async () => {
      process.env.DEPLOYMENT_MODE = 'saas';
      configModule.resetDeploymentConfig();

      // Exhaust bug report quota
      await service.trackUsage(org.id, RESOURCE_TYPE.BUG_REPORTS, 100);

      const middleware = requireQuota(service, RESOURCE_TYPE.BUG_REPORTS);
      const request = createMockRequest(org.id);

      try {
        await middleware(request, mockReply);
        expect.fail('Should have thrown QuotaExceeded error');
      } catch (error) {
        const appError = error as {
          statusCode: number;
          error: string;
          message: string;
          details: Record<string, unknown>;
        };
        expect(appError.statusCode).toBe(429);
        expect(appError.error).toBe('QuotaExceeded');
        expect(appError.message).toContain('trial plan limit of 100 bug reports');
        expect(appError.details).toMatchObject({
          resourceType: 'bug_reports', // Lowercase because RESOURCE_TYPE.BUG_REPORTS = 'bug_reports'
          limit: 100,
          planName: 'trial',
          hint: 'Consider upgrading to a higher plan tier for increased quotas.',
        });
      }
    });

    it('should skip when quotaEnforcement is disabled (self-hosted)', async () => {
      process.env.DEPLOYMENT_MODE = 'selfhosted';
      configModule.resetDeploymentConfig();

      // Exhaust bug report quota
      await service.trackUsage(org.id, RESOURCE_TYPE.BUG_REPORTS, 100);

      // Even though quota is exhausted, self-hosted should pass
      const middleware = requireQuota(service, RESOURCE_TYPE.BUG_REPORTS);
      const request = createMockRequest(org.id);

      await expect(middleware(request, mockReply)).resolves.toBeUndefined();
    });

    it('should skip when no organizationId on request', async () => {
      process.env.DEPLOYMENT_MODE = 'saas';
      configModule.resetDeploymentConfig();

      const middleware = requireQuota(service, RESOURCE_TYPE.BUG_REPORTS);
      const request = createMockRequest(undefined);

      await expect(middleware(request, mockReply)).resolves.toBeUndefined();
    });

    it('should demonstrate quota leak when operation fails after reservation', async () => {
      process.env.DEPLOYMENT_MODE = 'saas';
      configModule.resetDeploymentConfig();

      const middleware = requireQuota(service, RESOURCE_TYPE.BUG_REPORTS);
      const request = createMockRequest(org.id);

      // Reserve quota via middleware
      await middleware(request, mockReply);

      // Verify quota was reserved
      let remaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      expect(remaining).toBe(99); // 100 - 1

      // KNOWN LIMITATION: If the route handler fails after middleware runs,
      // the quota is already consumed but no resource was created.
      // This simulates a bug report creation failure after quota reservation.

      // Quota is still consumed even though we "failed" to create the resource
      remaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      expect(remaining).toBe(99); // Quota leaked - not released on error

      // TODO: Once UsageRecordRepository.decrement() is implemented,
      // add compensating transaction to release quota on error:
      // await service.releaseQuota(org.id, RESOURCE_TYPE.BUG_REPORTS, 1);
      // expect(remaining).toBe(100); // Quota restored
    });
  });

  describe('concurrent quota enforcement', () => {
    it('should not exceed bug report quota under concurrent reservations', async () => {
      // Use up 98 of 100 bug report quota, leaving 2 remaining
      await service.trackUsage(org.id, RESOURCE_TYPE.BUG_REPORTS, 98);

      // Fire 5 concurrent reserveQuota calls — only 2 should succeed
      const results = await Promise.all(
        Array.from({ length: 5 }, () => service.reserveQuota(org.id, RESOURCE_TYPE.BUG_REPORTS))
      );

      const succeeded = results.filter((r) => r === true).length;
      const failed = results.filter((r) => r === false).length;

      expect(succeeded).toBe(2);
      expect(failed).toBe(3);

      // Verify final usage is exactly at the limit
      const remaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      expect(remaining).toBe(0);
    });

    it('should not exceed project quota under concurrent creations', async () => {
      // Trial plan allows 2 projects. Fire 5 concurrent creates.
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, (_, i) =>
          service.createProjectWithQuotaCheck(org.id, {
            name: `Concurrent Project ${i}`,
            created_by: user.id,
            organization_id: org.id,
          })
        )
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');

      // Track created projects for cleanup
      for (const r of succeeded) {
        createdProjectIds.push((r as PromiseFulfilledResult<{ id: string }>).value.id);
      }

      expect(succeeded.length).toBe(2);
      expect(failed.length).toBe(3);

      // Verify exactly 2 projects exist
      const remaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.PROJECTS);
      expect(remaining).toBe(0);
    });
  });
});
