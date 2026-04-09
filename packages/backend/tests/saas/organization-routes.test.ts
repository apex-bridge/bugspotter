/**
 * Organization Service Tests
 * Tests for OrganizationService methods: getOrganization, updateOrganization,
 * getMembers, addMember, and removeMember. Does not test HTTP routes or middleware.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import { OrganizationService } from '../../src/saas/services/organization.service.js';
import { ORG_MEMBER_ROLE } from '../../src/db/types.js';
import type { Organization, User } from '../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('OrganizationService - route support methods', () => {
  let db: DatabaseClient;
  let service: OrganizationService;
  let ownerUser: User;
  let memberUser: User;
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    db = DatabaseClient.create({ connectionString: TEST_DATABASE_URL });
    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    service = new OrganizationService(db);

    ownerUser = await db.users.create({
      email: `org-routes-owner-${Date.now()}@test.com`,
      password_hash: 'hash123',
      role: 'admin',
    });

    memberUser = await db.users.create({
      email: `org-routes-member-${Date.now()}@test.com`,
      password_hash: 'hash456',
      role: 'user',
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
      await db.users.delete(ownerUser.id);
    } catch {
      // Ignore
    }
    try {
      await db.users.delete(memberUser.id);
    } catch {
      // Ignore
    }
    await db.close();
  });

  describe('getOrganization', () => {
    let org: Organization;

    beforeAll(async () => {
      org = await service.createOrganization(
        { name: 'Get Org Test', subdomain: `get-org-${Date.now()}` },
        ownerUser.id
      );
      createdOrgIds.push(org.id);
    });

    it('should return an organization by ID', async () => {
      const result = await service.getOrganization(org.id);
      expect(result.id).toBe(org.id);
      expect(result.name).toBe('Get Org Test');
    });

    it('should throw for non-existent org', async () => {
      await expect(service.getOrganization('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        'Organization not found'
      );
    });
  });

  describe('updateOrganization', () => {
    let org: Organization;

    beforeAll(async () => {
      org = await service.createOrganization(
        { name: 'Update Org Test', subdomain: `update-org-${Date.now()}` },
        ownerUser.id
      );
      createdOrgIds.push(org.id);
    });

    it('should update the organization name', async () => {
      const updated = await service.updateOrganization(org.id, { name: 'Updated Name' });
      expect(updated.name).toBe('Updated Name');
      expect(updated.id).toBe(org.id);
    });

    it('should throw for non-existent org', async () => {
      await expect(
        service.updateOrganization('00000000-0000-0000-0000-000000000000', { name: 'x' })
      ).rejects.toThrow('Organization not found');
    });
  });

  describe('getMembers', () => {
    let org: Organization;

    beforeAll(async () => {
      org = await service.createOrganization(
        { name: 'Members Test Org', subdomain: `members-${Date.now()}` },
        ownerUser.id
      );
      createdOrgIds.push(org.id);
    });

    it('should return the owner as the first member', async () => {
      const members = await service.getMembers(org.id);
      expect(members).toHaveLength(1);
      expect(members[0].user_id).toBe(ownerUser.id);
      expect(members[0].role).toBe(ORG_MEMBER_ROLE.OWNER);
    });
  });

  describe('addMember', () => {
    let org: Organization;

    beforeAll(async () => {
      org = await service.createOrganization(
        { name: 'Add Member Org', subdomain: `add-member-${Date.now()}` },
        ownerUser.id
      );
      createdOrgIds.push(org.id);
    });

    it('should add a new member', async () => {
      const member = await service.addMember(org.id, memberUser.id, ORG_MEMBER_ROLE.MEMBER);
      expect(member.user_id).toBe(memberUser.id);
      expect(member.role).toBe(ORG_MEMBER_ROLE.MEMBER);
      expect(member.organization_id).toBe(org.id);
    });

    it('should reject duplicate membership', async () => {
      await expect(
        service.addMember(org.id, memberUser.id, ORG_MEMBER_ROLE.MEMBER)
      ).rejects.toThrow('User is already a member of this organization');
    });

    it('should show added member in getMembers', async () => {
      const members = await service.getMembers(org.id);
      expect(members).toHaveLength(2);
    });
  });

  describe('removeMember', () => {
    let org: Organization;

    beforeAll(async () => {
      org = await service.createOrganization(
        { name: 'Remove Member Org', subdomain: `remove-member-${Date.now()}` },
        ownerUser.id
      );
      createdOrgIds.push(org.id);

      await service.addMember(org.id, memberUser.id, ORG_MEMBER_ROLE.MEMBER);
    });

    it('should remove a member', async () => {
      await service.removeMember(org.id, memberUser.id);
      const members = await service.getMembers(org.id);
      expect(members).toHaveLength(1);
      expect(members[0].user_id).toBe(ownerUser.id);
    });

    it('should throw when removing the owner', async () => {
      await expect(service.removeMember(org.id, ownerUser.id)).rejects.toThrow(
        'Cannot remove the organization owner'
      );
    });

    it('should throw when removing a non-member', async () => {
      await expect(
        service.removeMember(org.id, '00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('User is not a member of this organization');
    });
  });
});
