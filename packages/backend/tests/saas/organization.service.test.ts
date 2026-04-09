/**
 * Organization Service Tests
 * Integration tests for organization lifecycle, quota enforcement, and usage tracking
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import { OrganizationService } from '../../src/saas/services/organization.service.js';
import {
  PLAN_NAME,
  RESOURCE_TYPE,
  BILLING_STATUS,
  ORG_MEMBER_ROLE,
  INVITATION_ROLE,
} from '../../src/db/types.js';
import type { Organization, User } from '../../src/db/types.js';
import { PLAN_QUOTAS } from '../../src/saas/plans.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('OrganizationService', () => {
  let db: DatabaseClient;
  let service: OrganizationService;
  let testUser: User;
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    db = DatabaseClient.create({ connectionString: TEST_DATABASE_URL });
    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    service = new OrganizationService(db);

    testUser = await db.users.create({
      email: `org-svc-test-${Date.now()}@test.com`,
      password_hash: 'hash123',
      role: 'admin',
    });
  });

  afterAll(async () => {
    for (const id of createdOrgIds) {
      try {
        await db.organizations.delete(id);
      } catch {
        // Ignore
      }
    }
    try {
      await db.users.delete(testUser.id);
    } catch {
      // Ignore
    }
    await db.close();
  });

  describe('createOrganization', () => {
    let org: Organization;

    it('should create org, subscription, and member in one transaction', async () => {
      org = await service.createOrganization(
        {
          name: 'Service Test Org',
          subdomain: `svc-test-${Date.now()}`,
        },
        testUser.id
      );
      createdOrgIds.push(org.id);

      expect(org.id).toBeDefined();
      expect(org.name).toBe('Service Test Org');
      expect(org.subscription_status).toBe('trial');
      expect(org.trial_ends_at).toBeDefined();
    });

    it('should create a trial subscription', async () => {
      const subscription = await db.subscriptions.findByOrganizationId(org.id);

      expect(subscription).not.toBeNull();
      expect(subscription!.plan_name).toBe(PLAN_NAME.TRIAL);
      expect(subscription!.status).toBe(BILLING_STATUS.TRIAL);
      expect(subscription!.current_period_start).toBeDefined();
      expect(subscription!.current_period_end).toBeDefined();
    });

    it('should add the user as owner', async () => {
      const membership = await db.organizationMembers.findMembership(org.id, testUser.id);

      expect(membership).not.toBeNull();
      expect(membership!.role).toBe(ORG_MEMBER_ROLE.OWNER);
    });
  });

  describe('quota enforcement', () => {
    let org: Organization;

    beforeAll(async () => {
      org = await service.createOrganization(
        {
          name: 'Quota Test Org',
          subdomain: `quota-test-${Date.now()}`,
        },
        testUser.id
      );
      createdOrgIds.push(org.id);
    });

    it('should allow action when under quota', async () => {
      const canCreate = await service.canPerformAction(org.id, RESOURCE_TYPE.PROJECTS);
      expect(canCreate).toBe(true);
    });

    it('should return correct remaining quota with no usage', async () => {
      const remaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.PROJECTS);
      expect(remaining).toBe(PLAN_QUOTAS[PLAN_NAME.TRIAL][RESOURCE_TYPE.PROJECTS]);
    });

    it('should deny action when at quota limit', async () => {
      const trialBugReportLimit = PLAN_QUOTAS[PLAN_NAME.TRIAL][RESOURCE_TYPE.BUG_REPORTS];

      // Fill up the quota using bug reports (period-based resource)
      await service.trackUsage(org.id, RESOURCE_TYPE.BUG_REPORTS, trialBugReportLimit);

      const canCreate = await service.canPerformAction(org.id, RESOURCE_TYPE.BUG_REPORTS);
      expect(canCreate).toBe(false);
    });

    it('should return 0 remaining when at quota limit', async () => {
      const remaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      expect(remaining).toBe(0);
    });

    it('should return 0 remaining when over quota limit', async () => {
      // Add one more to go over
      await service.trackUsage(org.id, RESOURCE_TYPE.BUG_REPORTS, 1);

      const remaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      expect(remaining).toBe(0);
    });
  });

  describe('trackUsage', () => {
    let org: Organization;

    beforeAll(async () => {
      org = await service.createOrganization(
        {
          name: 'Usage Test Org',
          subdomain: `usage-svc-test-${Date.now()}`,
        },
        testUser.id
      );
      createdOrgIds.push(org.id);
    });

    it('should create a usage record with default amount of 1', async () => {
      await service.trackUsage(org.id, RESOURCE_TYPE.BUG_REPORTS);

      const remaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      const limit = PLAN_QUOTAS[PLAN_NAME.TRIAL][RESOURCE_TYPE.BUG_REPORTS];
      expect(remaining).toBe(limit - 1);
    });

    it('should increment existing usage', async () => {
      await service.trackUsage(org.id, RESOURCE_TYPE.BUG_REPORTS, 5);

      const remaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      const limit = PLAN_QUOTAS[PLAN_NAME.TRIAL][RESOURCE_TYPE.BUG_REPORTS];
      expect(remaining).toBe(limit - 6); // 1 + 5
    });

    it('should reject zero amount', async () => {
      await expect(service.trackUsage(org.id, RESOURCE_TYPE.PROJECTS, 0)).rejects.toThrow(
        'Usage amount must be greater than zero'
      );
    });

    it('should reject negative amount', async () => {
      await expect(service.trackUsage(org.id, RESOURCE_TYPE.PROJECTS, -5)).rejects.toThrow(
        'Usage amount must be greater than zero'
      );
    });
  });

  describe('getQuotaStatus', () => {
    let org: Organization;
    const createdProjectIds: string[] = [];

    beforeAll(async () => {
      org = await service.createOrganization(
        {
          name: 'Status Test Org',
          subdomain: `status-test-${Date.now()}`,
        },
        testUser.id
      );
      createdOrgIds.push(org.id);

      // Add some usage (PROJECTS uses count-based quota, not usage records)
      await service.trackUsage(org.id, RESOURCE_TYPE.BUG_REPORTS, 10);
    });

    afterAll(async () => {
      // Clean up created projects
      for (const projectId of createdProjectIds) {
        try {
          await db.projects.delete(projectId);
        } catch {
          // Ignore
        }
      }
    });

    it('should return full quota status for all resource types', async () => {
      const status = await service.getQuotaStatus(org.id);

      expect(status.plan).toBe(PLAN_NAME.TRIAL);
      expect(status.period.start).toBeDefined();
      expect(status.period.end).toBeDefined();

      // Check projects (count-based quota: reads actual database row count)
      expect(status.resources[RESOURCE_TYPE.PROJECTS].current).toBe(0);
      expect(status.resources[RESOURCE_TYPE.PROJECTS].limit).toBe(
        PLAN_QUOTAS[PLAN_NAME.TRIAL][RESOURCE_TYPE.PROJECTS]
      );

      // Check bug_reports (usage-based quota: reads usage_records)
      expect(status.resources[RESOURCE_TYPE.BUG_REPORTS].current).toBe(10);
      expect(status.resources[RESOURCE_TYPE.BUG_REPORTS].limit).toBe(
        PLAN_QUOTAS[PLAN_NAME.TRIAL][RESOURCE_TYPE.BUG_REPORTS]
      );

      // Check unused resources have 0 current
      expect(status.resources[RESOURCE_TYPE.API_CALLS].current).toBe(0);
      expect(status.resources[RESOURCE_TYPE.API_CALLS].limit).toBe(
        PLAN_QUOTAS[PLAN_NAME.TRIAL][RESOURCE_TYPE.API_CALLS]
      );
    });

    it('should show actual project count in quota status (count-based)', async () => {
      // Create two projects via the service method
      const project1 = await service.createProjectWithQuotaCheck(org.id, {
        name: 'Status Test Project 1',
        created_by: testUser.id,
      });
      createdProjectIds.push(project1.id);

      const project2 = await service.createProjectWithQuotaCheck(org.id, {
        name: 'Status Test Project 2',
        created_by: testUser.id,
      });
      createdProjectIds.push(project2.id);

      // Verify quota status shows actual count
      const status = await service.getQuotaStatus(org.id);
      expect(status.resources[RESOURCE_TYPE.PROJECTS].current).toBe(2);
      expect(status.resources[RESOURCE_TYPE.PROJECTS].limit).toBe(
        PLAN_QUOTAS[PLAN_NAME.TRIAL][RESOURCE_TYPE.PROJECTS]
      );

      // Verify bug reports count hasn't changed (different resource type)
      expect(status.resources[RESOURCE_TYPE.BUG_REPORTS].current).toBe(10);
    });
  });

  describe('releaseQuota', () => {
    let org: Organization;

    beforeAll(async () => {
      org = await service.createOrganization(
        {
          name: 'Release Quota Test Org',
          subdomain: `release-quota-test-${Date.now()}`,
        },
        testUser.id
      );
      createdOrgIds.push(org.id);
    });

    it('should release previously reserved quota', async () => {
      // First reserve some quota
      const reserved = await service.reserveQuota(org.id, RESOURCE_TYPE.BUG_REPORTS, 5);
      expect(reserved).toBe(true);

      // Verify quota was consumed
      const beforeRelease = await service.getRemainingQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      const limit = PLAN_QUOTAS[PLAN_NAME.TRIAL][RESOURCE_TYPE.BUG_REPORTS];
      expect(beforeRelease).toBe(limit - 5);

      // Release 3 of the reserved quota
      const released = await service.releaseQuota(org.id, RESOURCE_TYPE.BUG_REPORTS, 3);
      expect(released).toBe(true);

      // Verify quota was restored
      const afterRelease = await service.getRemainingQuota(org.id, RESOURCE_TYPE.BUG_REPORTS);
      expect(afterRelease).toBe(limit - 2); // 5 reserved - 3 released = 2 consumed
    });

    it('should return false when no usage record exists', async () => {
      // Try to release quota for a resource type that has no usage
      const released = await service.releaseQuota(org.id, RESOURCE_TYPE.SCREENSHOTS, 1);
      expect(released).toBe(false);
    });

    it('should return false for PROJECTS resource type (count-based)', async () => {
      const released = await service.releaseQuota(org.id, RESOURCE_TYPE.PROJECTS, 1);
      expect(released).toBe(false);
    });

    it('should reject zero amount', async () => {
      await expect(service.releaseQuota(org.id, RESOURCE_TYPE.BUG_REPORTS, 0)).rejects.toThrow(
        'Usage amount must be greater than zero'
      );
    });

    it('should reject negative amount', async () => {
      await expect(service.releaseQuota(org.id, RESOURCE_TYPE.BUG_REPORTS, -1)).rejects.toThrow(
        'Usage amount must be greater than zero'
      );
    });

    it('should return false when trying to release more than consumed', async () => {
      // Reserve 2 more
      await service.reserveQuota(org.id, RESOURCE_TYPE.SESSION_REPLAYS, 2);

      // Try to release more than was reserved
      const released = await service.releaseQuota(org.id, RESOURCE_TYPE.SESSION_REPLAYS, 10);
      expect(released).toBe(false);

      // Verify original amount unchanged
      const remaining = await service.getRemainingQuota(org.id, RESOURCE_TYPE.SESSION_REPLAYS);
      const limit = PLAN_QUOTAS[PLAN_NAME.TRIAL][RESOURCE_TYPE.SESSION_REPLAYS];
      expect(remaining).toBe(limit - 2);
    });
  });

  describe('getSubscription', () => {
    it('should return subscription for existing org', async () => {
      const org = await service.createOrganization(
        {
          name: 'Sub Test Org',
          subdomain: `sub-test-${Date.now()}`,
        },
        testUser.id
      );
      createdOrgIds.push(org.id);

      const subscription = await service.getSubscription(org.id);
      expect(subscription.organization_id).toBe(org.id);
      expect(subscription.plan_name).toBe(PLAN_NAME.TRIAL);
    });

    it('should throw for non-existent org', async () => {
      await expect(service.getSubscription('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        'No subscription found'
      );
    });
  });

  describe('adminCreateOrganization', () => {
    it('should create org with trial plan by default', async () => {
      const { organization: org } = await service.adminCreateOrganization({
        name: 'Admin Trial Org',
        subdomain: `admin-trial-${Date.now()}`,
        owner_user_id: testUser.id,
      });
      createdOrgIds.push(org.id);

      expect(org.name).toBe('Admin Trial Org');
      expect(org.subscription_status).toBe('trial');
      expect(org.trial_ends_at).toBeDefined();

      const subscription = await db.subscriptions.findByOrganizationId(org.id);
      expect(subscription!.plan_name).toBe(PLAN_NAME.TRIAL);
      expect(subscription!.status).toBe(BILLING_STATUS.TRIAL);
    });

    it('should create org with professional plan', async () => {
      const { organization: org } = await service.adminCreateOrganization({
        name: 'Admin Pro Org',
        subdomain: `admin-pro-${Date.now()}`,
        owner_user_id: testUser.id,
        plan_name: PLAN_NAME.PROFESSIONAL,
      });
      createdOrgIds.push(org.id);

      expect(org.subscription_status).toBe('active');
      expect(org.trial_ends_at).toBeNull();

      const subscription = await db.subscriptions.findByOrganizationId(org.id);
      expect(subscription!.plan_name).toBe(PLAN_NAME.PROFESSIONAL);
      expect(subscription!.status).toBe(BILLING_STATUS.ACTIVE);
      expect(subscription!.quotas).toEqual(PLAN_QUOTAS[PLAN_NAME.PROFESSIONAL]);
    });

    it('should create org with enterprise plan and set 365-day period', async () => {
      const { organization: org } = await service.adminCreateOrganization({
        name: 'Admin Enterprise Org',
        subdomain: `admin-ent-${Date.now()}`,
        owner_user_id: testUser.id,
        plan_name: PLAN_NAME.ENTERPRISE,
      });
      createdOrgIds.push(org.id);

      const subscription = await db.subscriptions.findByOrganizationId(org.id);
      expect(subscription!.plan_name).toBe(PLAN_NAME.ENTERPRISE);

      const start = new Date(subscription!.current_period_start);
      const end = new Date(subscription!.current_period_end);
      const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(364);
      expect(diffDays).toBeLessThanOrEqual(366);
    });

    it('should add the owner as an org member with owner role', async () => {
      const { organization: org } = await service.adminCreateOrganization({
        name: 'Admin Owner Org',
        subdomain: `admin-owner-${Date.now()}`,
        owner_user_id: testUser.id,
      });
      createdOrgIds.push(org.id);

      const membership = await db.organizationMembers.findMembership(org.id, testUser.id);
      expect(membership).not.toBeNull();
      expect(membership!.role).toBe(ORG_MEMBER_ROLE.OWNER);
    });

    it('should set data_residency_region when provided', async () => {
      const { organization: org } = await service.adminCreateOrganization({
        name: 'Admin Region Org',
        subdomain: `admin-region-${Date.now()}`,
        owner_user_id: testUser.id,
        data_residency_region: 'kz',
      });
      createdOrgIds.push(org.id);

      expect(org.data_residency_region).toBe('kz');
    });

    it('should reject duplicate subdomain', async () => {
      const subdomain = `admin-dup-${Date.now()}`;

      const { organization: org } = await service.adminCreateOrganization({
        name: 'First Org',
        subdomain,
        owner_user_id: testUser.id,
      });
      createdOrgIds.push(org.id);

      await expect(
        service.adminCreateOrganization({
          name: 'Second Org',
          subdomain,
          owner_user_id: testUser.id,
        })
      ).rejects.toThrow('Subdomain is already taken');
    });

    it('should reject non-existent owner user', async () => {
      await expect(
        service.adminCreateOrganization({
          name: 'Ghost Owner Org',
          subdomain: `ghost-owner-${Date.now()}`,
          owner_user_id: '00000000-0000-0000-0000-000000000000',
        })
      ).rejects.toThrow('Owner user not found');
    });

    it('should reject when neither owner_user_id nor owner_email is provided', async () => {
      await expect(
        service.adminCreateOrganization({
          name: 'No Owner Org',
          subdomain: `no-owner-${Date.now()}`,
        } as any)
      ).rejects.toThrow('Either owner_user_id or owner_email must be provided');
    });

    it('should create org with owner_email matching existing user', async () => {
      const {
        organization: org,
        ownerMemberCreated,
        invitation,
      } = await service.adminCreateOrganization({
        name: 'Existing Email Org',
        subdomain: `exist-email-${Date.now()}`,
        owner_email: testUser.email,
      });
      createdOrgIds.push(org.id);

      expect(ownerMemberCreated).toBe(true);
      expect(invitation).toBeNull();

      const membership = await db.organizationMembers.findMembership(org.id, testUser.id);
      expect(membership).not.toBeNull();
      expect(membership!.role).toBe(ORG_MEMBER_ROLE.OWNER);
    });

    it('should create org with pending owner invitation for non-existent email', async () => {
      const pendingEmail = `pending-owner-${Date.now()}@test.com`;
      const {
        organization: org,
        ownerMemberCreated,
        invitation,
      } = await service.adminCreateOrganization(
        {
          name: 'Pending Owner Org',
          subdomain: `pending-own-${Date.now()}`,
          owner_email: pendingEmail,
        },
        testUser.id
      );
      createdOrgIds.push(org.id);

      expect(ownerMemberCreated).toBe(false);
      expect(invitation).not.toBeNull();
      expect(invitation!.email).toBe(pendingEmail);
      expect(invitation!.role).toBe(INVITATION_ROLE.OWNER);
      expect(invitation!.organization_id).toBe(org.id);
      expect(invitation!.invited_by).toBe(testUser.id);
      expect(invitation!.status).toBe('pending');

      // Verify no owner member was created
      const owner = await db.organizationMembers.findOwner(org.id);
      expect(owner).toBeNull();
    });

    it('should require invitedByUserId for pending owner flow', async () => {
      await expect(
        service.adminCreateOrganization({
          name: 'No Inviter Org',
          subdomain: `no-inviter-${Date.now()}`,
          owner_email: `no-inviter-${Date.now()}@test.com`,
        })
      ).rejects.toThrow('invitedByUserId is required');
    });
  });

  describe('deleteOrganization', () => {
    it('should soft-delete an organization', async () => {
      const { organization: org } = await service.adminCreateOrganization({
        name: 'Soft Del Svc Org',
        subdomain: `soft-del-svc-${Date.now()}`,
        owner_user_id: testUser.id,
      });
      createdOrgIds.push(org.id);

      const result = await service.deleteOrganization(org.id, testUser.id);
      expect(result.mode).toBe('soft');

      // findById should no longer return it
      const found = await db.organizations.findById(org.id);
      expect(found).toBeNull();

      // deleted_by should record who deleted it
      const deleted = await db.organizations.findByIdIncludeDeleted(org.id);
      expect(deleted!.deleted_by).toBe(testUser.id);
    });

    it('should hard-delete an empty organization', async () => {
      const { organization: org } = await service.adminCreateOrganization({
        name: 'Hard Del Svc Org',
        subdomain: `hard-del-svc-${Date.now()}`,
        owner_user_id: testUser.id,
      });
      // Don't push to createdOrgIds — hard delete removes it

      // Trial subscription doesn't block hard delete (only 'active'/'past_due'/'incomplete' do)
      const result = await service.deleteOrganization(org.id, testUser.id, true);
      expect(result.mode).toBe('hard');

      // Completely gone from DB
      const found = await db.organizations.findByIdIncludeDeleted(org.id);
      expect(found).toBeNull();
    });

    it('should reject hard-delete when org has projects', async () => {
      const { organization: org } = await service.adminCreateOrganization({
        name: 'Has Projects Org',
        subdomain: `has-proj-${Date.now()}`,
        owner_user_id: testUser.id,
      });
      createdOrgIds.push(org.id);

      const project = await db.projects.create({
        name: 'Blocking Project',
        organization_id: org.id,
        created_by: testUser.id,
      });

      await expect(service.deleteOrganization(org.id, testUser.id, true)).rejects.toThrow(
        'Cannot permanently delete'
      );

      await db.projects.delete(project.id);
    });

    it('should reject hard-delete when org has active subscription', async () => {
      const { organization: org } = await service.adminCreateOrganization({
        name: 'Active Sub Org',
        subdomain: `active-sub-del-${Date.now()}`,
        owner_user_id: testUser.id,
        plan_name: 'professional',
      });
      createdOrgIds.push(org.id);

      await expect(service.deleteOrganization(org.id, testUser.id, true)).rejects.toThrow(
        'Cannot permanently delete'
      );
    });

    it('should reject deleting an already-deleted org', async () => {
      const { organization: org } = await service.adminCreateOrganization({
        name: 'Already Deleted Org',
        subdomain: `already-del-${Date.now()}`,
        owner_user_id: testUser.id,
      });
      createdOrgIds.push(org.id);

      await service.deleteOrganization(org.id, testUser.id);

      await expect(service.deleteOrganization(org.id, testUser.id)).rejects.toThrow(
        'already deleted'
      );
    });

    it('should reject deleting a non-existent org', async () => {
      await expect(
        service.deleteOrganization('00000000-0000-0000-0000-000000000000', testUser.id)
      ).rejects.toThrow('not found');
    });
  });

  describe('restoreOrganization', () => {
    it('should restore a soft-deleted org', async () => {
      const { organization: org } = await service.adminCreateOrganization({
        name: 'Restore Svc Org',
        subdomain: `restore-svc-${Date.now()}`,
        owner_user_id: testUser.id,
      });
      createdOrgIds.push(org.id);

      await service.deleteOrganization(org.id, testUser.id);
      const restored = await service.restoreOrganization(org.id);
      expect(restored.id).toBe(org.id);
      expect(restored.deleted_at).toBeNull();

      // findById should work again
      const found = await db.organizations.findById(org.id);
      expect(found).not.toBeNull();
    });

    it('should reject restoring a non-deleted org', async () => {
      const { organization: org } = await service.adminCreateOrganization({
        name: 'Not Deleted Svc Org',
        subdomain: `not-del-svc-${Date.now()}`,
        owner_user_id: testUser.id,
      });
      createdOrgIds.push(org.id);

      await expect(service.restoreOrganization(org.id)).rejects.toThrow('not deleted');
    });

    it('should reject restoring a non-existent org', async () => {
      await expect(
        service.restoreOrganization('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('not found');
    });
  });

  describe('getOrganizationDeletionPrecheck', () => {
    it('should allow hard delete for empty org with trial subscription', async () => {
      const { organization: org } = await service.adminCreateOrganization({
        name: 'Precheck Empty Org',
        subdomain: `precheck-empty-${Date.now()}`,
        owner_user_id: testUser.id,
      });
      createdOrgIds.push(org.id);

      const precheck = await service.getOrganizationDeletionPrecheck(org.id);
      // Trial subscription is NOT in ('active', 'past_due', 'incomplete') so it doesn't block
      expect(precheck.hasProjects).toBe(false);
      expect(precheck.projectCount).toBe(0);
      expect(precheck.canHardDelete).toBe(true);
    });

    it('should disallow hard delete when org has projects', async () => {
      const { organization: org } = await service.adminCreateOrganization({
        name: 'Precheck Projects Org',
        subdomain: `precheck-proj-${Date.now()}`,
        owner_user_id: testUser.id,
      });
      createdOrgIds.push(org.id);

      const project = await db.projects.create({
        name: 'Precheck Project',
        organization_id: org.id,
        created_by: testUser.id,
      });

      const precheck = await service.getOrganizationDeletionPrecheck(org.id);
      expect(precheck.hasProjects).toBe(true);
      expect(precheck.projectCount).toBe(1);
      expect(precheck.canHardDelete).toBe(false);

      await db.projects.delete(project.id);
    });

    it('should disallow hard delete when org has active subscription', async () => {
      const { organization: org } = await service.adminCreateOrganization({
        name: 'Precheck Active Sub Org',
        subdomain: `precheck-sub-${Date.now()}`,
        owner_user_id: testUser.id,
        plan_name: 'professional',
      });
      createdOrgIds.push(org.id);

      const precheck = await service.getOrganizationDeletionPrecheck(org.id);
      expect(precheck.hasActiveSubscription).toBe(true);
      expect(precheck.canHardDelete).toBe(false);
    });
  });

  describe('adminSetPlan', () => {
    let org: Organization;

    beforeAll(async () => {
      ({ organization: org } = await service.adminCreateOrganization({
        name: 'Set Plan Org',
        subdomain: `set-plan-${Date.now()}`,
        owner_user_id: testUser.id,
      }));
      createdOrgIds.push(org.id);
    });

    it('should upgrade from trial to professional', async () => {
      const updated = await service.adminSetPlan(org.id, {
        plan_name: PLAN_NAME.PROFESSIONAL,
      });

      expect(updated.plan_name).toBe(PLAN_NAME.PROFESSIONAL);
      expect(updated.status).toBe(BILLING_STATUS.ACTIVE);
      expect(updated.quotas).toEqual(PLAN_QUOTAS[PLAN_NAME.PROFESSIONAL]);
    });

    it('should sync org subscription_status when upgrading', async () => {
      const updatedOrg = await db.organizations.findById(org.id);
      expect(updatedOrg!.subscription_status).toBe('active');
    });

    it('should switch to enterprise plan', async () => {
      const updated = await service.adminSetPlan(org.id, {
        plan_name: PLAN_NAME.ENTERPRISE,
      });

      expect(updated.plan_name).toBe(PLAN_NAME.ENTERPRISE);
      expect(updated.quotas).toEqual(PLAN_QUOTAS[PLAN_NAME.ENTERPRISE]);
    });

    it('should downgrade back to trial', async () => {
      const updated = await service.adminSetPlan(org.id, {
        plan_name: PLAN_NAME.TRIAL,
      });

      expect(updated.plan_name).toBe(PLAN_NAME.TRIAL);
      expect(updated.status).toBe(BILLING_STATUS.TRIAL);

      const updatedOrg = await db.organizations.findById(org.id);
      expect(updatedOrg!.subscription_status).toBe('trial');
    });

    it('should allow overriding status explicitly', async () => {
      const updated = await service.adminSetPlan(org.id, {
        plan_name: PLAN_NAME.STARTER,
        status: BILLING_STATUS.PAST_DUE,
      });

      expect(updated.plan_name).toBe(PLAN_NAME.STARTER);
      expect(updated.status).toBe(BILLING_STATUS.PAST_DUE);
    });

    it('should throw for non-existent organization', async () => {
      await expect(
        service.adminSetPlan('00000000-0000-0000-0000-000000000000', {
          plan_name: PLAN_NAME.PROFESSIONAL,
        })
      ).rejects.toThrow('not found');
    });
  });
});
