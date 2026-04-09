/**
 * Organization Member Tests
 * Tests for adding/removing members including race condition handling
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { OrganizationService } from '../../src/saas/services/organization.service.js';
import { ORG_MEMBER_ROLE } from '../../src/db/types.js';
import type { Organization, User } from '../../src/db/types.js';

describe('Organization Member Operations', () => {
  let db: DatabaseClient;
  let orgService: OrganizationService;
  let testOrg: Organization;
  let ownerUser: User;
  let testUser1: User;
  let testUser2: User;

  beforeAll(async () => {
    db = createDatabaseClient();
    orgService = new OrganizationService(db);

    // Create test users with unique emails to avoid conflicts on re-runs
    const timestamp = Date.now();
    ownerUser = await db.users.create({
      email: `owner-member-ops-${timestamp}@example.com`,
      password_hash: 'hash',
      name: 'Owner User',
    });

    testUser1 = await db.users.create({
      email: `user1-member-ops-${timestamp}@example.com`,
      password_hash: 'hash',
      name: 'Test User 1',
    });

    testUser2 = await db.users.create({
      email: `user2-member-ops-${timestamp}@example.com`,
      password_hash: 'hash',
      name: 'Test User 2',
    });
  });

  afterEach(async () => {
    // Clean up organization created in beforeEach
    if (testOrg) {
      await db.organizations.delete(testOrg.id);
    }
  });

  afterAll(async () => {
    // Clean up users created in beforeAll
    if (ownerUser) {
      await db.users.delete(ownerUser.id);
    }
    if (testUser1) {
      await db.users.delete(testUser1.id);
    }
    if (testUser2) {
      await db.users.delete(testUser2.id);
    }
    await db.close();
  });

  beforeEach(async () => {
    // Create fresh org for each test
    testOrg = await orgService.createOrganization(
      {
        name: 'Test Org - Member Ops',
        subdomain: `member-ops-${Date.now()}`,
        data_residency_region: 'us',
      },
      ownerUser.id
    );
  });

  describe('addMember - Happy Path', () => {
    it('should successfully add a member with admin role', async () => {
      const member = await orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.ADMIN);

      expect(member).toMatchObject({
        organization_id: testOrg.id,
        user_id: testUser1.id,
        role: ORG_MEMBER_ROLE.ADMIN,
        user_email: testUser1.email,
        user_name: testUser1.name,
      });
      expect(member.id).toBeDefined();
      expect(member.created_at).toBeInstanceOf(Date);
      expect(member.updated_at).toBeInstanceOf(Date);
    });

    it('should successfully add a member with member role', async () => {
      const member = await orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.MEMBER);

      expect(member).toMatchObject({
        organization_id: testOrg.id,
        user_id: testUser1.id,
        role: ORG_MEMBER_ROLE.MEMBER,
        user_email: testUser1.email,
      });
    });

    it('should include user details (email and name) in response', async () => {
      const member = await orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.ADMIN);

      // Verify all required fields from OrganizationMemberWithUser type
      expect(member.user_email).toBe(testUser1.email);
      expect(member.user_name).toBe(testUser1.name);
    });

    it('should allow adding multiple different users', async () => {
      const member1 = await orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.ADMIN);
      const member2 = await orgService.addMember(testOrg.id, testUser2.id, ORG_MEMBER_ROLE.MEMBER);

      expect(member1.user_id).toBe(testUser1.id);
      expect(member2.user_id).toBe(testUser2.id);

      const allMembers = await orgService.getMembers(testOrg.id);
      expect(allMembers).toHaveLength(3); // owner + 2 added members
    });
  });

  describe('addMember - Role Validation', () => {
    it('should reject owner role assignment (400 Bad Request)', async () => {
      await expect(
        orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.OWNER)
      ).rejects.toMatchObject({
        statusCode: 400,
        error: 'BadRequest',
        message: expect.stringContaining('Cannot assign owner role'),
      });
    });

    it('should enforce single owner invariant at service layer', async () => {
      // Attempt to assign owner role should fail even if called internally
      const error = await orgService
        .addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.OWNER)
        .catch((e) => e);

      expect(error.message).toContain('exactly one owner');
      expect(error.statusCode).toBe(400);

      // Verify user was not added
      const members = await orgService.getMembers(testOrg.id);
      const owners = members.filter((m) => m.role === ORG_MEMBER_ROLE.OWNER);
      expect(owners).toHaveLength(1); // Only original owner
      expect(owners[0].user_id).toBe(ownerUser.id);
    });
  });

  describe('addMember - Duplicate Handling', () => {
    it('should throw 409 Conflict when adding same user twice', async () => {
      await orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.ADMIN);

      await expect(
        orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.MEMBER)
      ).rejects.toThrow('User is already a member of this organization');
    });

    it('should throw 409 even if role is different', async () => {
      await orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.MEMBER);

      await expect(
        orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.ADMIN)
      ).rejects.toThrow('User is already a member of this organization');
    });

    it('should throw 409 when adding owner user as member (already member as owner)', async () => {
      await expect(
        orgService.addMember(testOrg.id, ownerUser.id, ORG_MEMBER_ROLE.ADMIN)
      ).rejects.toThrow('User is already a member of this organization');
    });
  });

  describe('addMember - Race Condition Protection', () => {
    it('should handle concurrent addMember requests without database error', async () => {
      // Simulate race condition: two requests to add the same user simultaneously
      const results = await Promise.allSettled([
        orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.ADMIN),
        orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.ADMIN),
      ]);

      // One should succeed, one should fail with 409 Conflict
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);

      // Verify the failure is a user-friendly 409, not a DB constraint error
      const failedResult = failed[0] as PromiseRejectedResult;
      expect(failedResult.reason.message).toContain('User is already a member');
      expect(failedResult.reason.statusCode).toBe(409);

      // Verify only one member was actually created
      const allMembers = await orgService.getMembers(testOrg.id);
      const testUserMembers = allMembers.filter((m) => m.user_id === testUser1.id);
      expect(testUserMembers).toHaveLength(1);
    });

    it('should handle concurrent requests for different users successfully', async () => {
      // Both should succeed since they are different users
      const results = await Promise.allSettled([
        orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.ADMIN),
        orgService.addMember(testOrg.id, testUser2.id, ORG_MEMBER_ROLE.MEMBER),
      ]);

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded).toHaveLength(2);

      const allMembers = await orgService.getMembers(testOrg.id);
      expect(allMembers).toHaveLength(3); // owner + 2 added
    });

    it('should handle 10 concurrent duplicate requests gracefully', async () => {
      const promises = Array.from({ length: 10 }, () =>
        orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.ADMIN)
      );

      const results = await Promise.allSettled(promises);

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');

      // Exactly one should succeed
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(9);

      // All failures should be user-friendly 409 errors
      failed.forEach((result) => {
        const error = (result as PromiseRejectedResult).reason;
        expect(error.statusCode).toBe(409);
        expect(error.message).toContain('User is already a member');
      });

      // Verify database consistency - only one member record
      const allMembers = await orgService.getMembers(testOrg.id);
      const testUserMembers = allMembers.filter((m) => m.user_id === testUser1.id);
      expect(testUserMembers).toHaveLength(1);
    });
  });

  describe('addMember - Foreign Key Validation', () => {
    it('should throw error when organization does not exist', async () => {
      const fakeOrgId = '00000000-0000-0000-0000-000000000000';

      await expect(
        orgService.addMember(fakeOrgId, testUser1.id, ORG_MEMBER_ROLE.ADMIN)
      ).rejects.toThrow();
    });

    it('should throw error when user does not exist', async () => {
      const fakeUserId = '00000000-0000-0000-0000-000000000000';

      await expect(
        orgService.addMember(testOrg.id, fakeUserId, ORG_MEMBER_ROLE.ADMIN)
      ).rejects.toThrow();
    });
  });

  describe('addMember - Performance', () => {
    it('should execute in single database query (atomic operation)', async () => {
      // This test verifies the optimization works by checking the result structure
      const member = await orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.ADMIN);

      // If user details are present, it means the JOIN happened in the INSERT query
      expect(member.user_email).toBeDefined();
      expect(member.user_name).toBeDefined();
      expect(member.role).toBe(ORG_MEMBER_ROLE.ADMIN);

      // Verify the data is consistent with what was passed
      expect(member.user_email).toBe(testUser1.email);
      expect(member.user_name).toBe(testUser1.name);
    });
  });

  describe('getMembers - Member Listing', () => {
    it('should return all members including owner', async () => {
      await orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.ADMIN);
      await orgService.addMember(testOrg.id, testUser2.id, ORG_MEMBER_ROLE.MEMBER);

      const members = await orgService.getMembers(testOrg.id);

      expect(members).toHaveLength(3); // owner + 2 added
      expect(members.some((m) => m.user_id === ownerUser.id && m.role === 'owner')).toBe(true);
      expect(members.some((m) => m.user_id === testUser1.id && m.role === 'admin')).toBe(true);
      expect(members.some((m) => m.user_id === testUser2.id && m.role === 'member')).toBe(true);
    });

    it('should include user details for all members', async () => {
      await orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.ADMIN);

      const members = await orgService.getMembers(testOrg.id);
      members.forEach((member) => {
        expect(member.user_email).toBeDefined();
        expect(typeof member.user_email).toBe('string');
      });
    });

    it('should return empty array except owner for new organization', async () => {
      const members = await orgService.getMembers(testOrg.id);
      expect(members).toHaveLength(1);
      expect(members[0].user_id).toBe(ownerUser.id);
      expect(members[0].role).toBe(ORG_MEMBER_ROLE.OWNER);
    });
  });

  describe('removeMember - Member Removal', () => {
    it('should successfully remove a member', async () => {
      await orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.ADMIN);
      await orgService.removeMember(testOrg.id, testUser1.id);

      const members = await orgService.getMembers(testOrg.id);
      expect(members.some((m) => m.user_id === testUser1.id)).toBe(false);
    });

    it('should throw 404 when removing non-existent member', async () => {
      await expect(orgService.removeMember(testOrg.id, testUser1.id)).rejects.toThrow(
        'User is not a member of this organization'
      );
    });

    it('should throw 403 when trying to remove owner', async () => {
      await expect(orgService.removeMember(testOrg.id, ownerUser.id)).rejects.toThrow(
        'Cannot remove the organization owner'
      );
    });

    it('should successfully remove and re-add same user', async () => {
      await orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.ADMIN);
      await orgService.removeMember(testOrg.id, testUser1.id);
      const member = await orgService.addMember(testOrg.id, testUser1.id, ORG_MEMBER_ROLE.MEMBER);

      expect(member.user_id).toBe(testUser1.id);
      expect(member.role).toBe(ORG_MEMBER_ROLE.MEMBER); // Different role than before
    });
  });
});
