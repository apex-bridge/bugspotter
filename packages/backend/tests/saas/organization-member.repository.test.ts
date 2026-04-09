/**
 * Organization Member Repository Tests
 * Tests for saas.organization_members CRUD and query operations
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import type { Organization, User } from '../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('OrganizationMemberRepository', () => {
  let db: DatabaseClient;
  let testUser1: User;
  let testUser2: User;
  let testUser3: User;
  let testOrg: Organization;
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    db = DatabaseClient.create({ connectionString: TEST_DATABASE_URL });
    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    const ts = Date.now();
    testUser1 = await db.users.create({
      email: `orgmember-test1-${ts}@test.com`,
      password_hash: 'hash123',
      role: 'admin',
    });
    testUser2 = await db.users.create({
      email: `orgmember-test2-${ts}@test.com`,
      password_hash: 'hash123',
      role: 'user',
    });
    testUser3 = await db.users.create({
      email: `orgmember-test3-${ts}@test.com`,
      password_hash: 'hash123',
      role: 'user',
    });

    testOrg = await db.organizations.create({
      name: 'Member Test Org',
      subdomain: `member-test-${ts}`,
    });
    createdOrgIds.push(testOrg.id);
  });

  afterAll(async () => {
    for (const id of createdOrgIds) {
      try {
        await db.organizations.delete(id);
      } catch {
        // Ignore
      }
    }
    for (const user of [testUser1, testUser2, testUser3]) {
      if (user?.id) {
        try {
          await db.users.delete(user.id);
        } catch {
          // Ignore
        }
      }
    }
    await db.close();
  });

  describe('create and findMembership', () => {
    it('should add a member to an organization', async () => {
      const member = await db.organizationMembers.create({
        organization_id: testOrg.id,
        user_id: testUser1.id,
        role: 'owner',
      });

      expect(member.id).toBeDefined();
      expect(member.organization_id).toBe(testOrg.id);
      expect(member.user_id).toBe(testUser1.id);
      expect(member.role).toBe('owner');
    });

    it('should find a specific membership', async () => {
      const membership = await db.organizationMembers.findMembership(testOrg.id, testUser1.id);
      expect(membership).not.toBeNull();
      expect(membership!.role).toBe('owner');
    });

    it('should return null for non-existent membership', async () => {
      const membership = await db.organizationMembers.findMembership(
        testOrg.id,
        '00000000-0000-0000-0000-000000000000'
      );
      expect(membership).toBeNull();
    });
  });

  describe('unique constraint', () => {
    it('should enforce unique (organization_id, user_id)', async () => {
      // testUser1 is already a member from previous test
      await expect(
        db.organizationMembers.create({
          organization_id: testOrg.id,
          user_id: testUser1.id,
          role: 'member',
        })
      ).rejects.toThrow();
    });
  });

  describe('one owner per org', () => {
    it('should enforce single owner per organization', async () => {
      // testUser1 is already owner
      await expect(
        db.organizationMembers.create({
          organization_id: testOrg.id,
          user_id: testUser2.id,
          role: 'owner',
        })
      ).rejects.toThrow();
    });
  });

  describe('findByOrganizationId', () => {
    it('should list members with user details, ordered by role', async () => {
      // Add user2 as admin
      await db.organizationMembers.create({
        organization_id: testOrg.id,
        user_id: testUser2.id,
        role: 'admin',
      });

      // Add user3 as member
      await db.organizationMembers.create({
        organization_id: testOrg.id,
        user_id: testUser3.id,
        role: 'member',
      });

      const members = await db.organizationMembers.findByOrganizationId(testOrg.id);
      expect(members.length).toBe(3);

      // Should be ordered: owner, admin, member
      expect(members[0].role).toBe('owner');
      expect(members[1].role).toBe('admin');
      expect(members[2].role).toBe('member');

      // Should include user details
      expect(members[0].user_email).toBeDefined();
      expect(members[0].user_email).toContain('orgmember-test1');
    });
  });

  describe('updateRole', () => {
    it('should update a member role', async () => {
      const updated = await db.organizationMembers.updateRole(testOrg.id, testUser3.id, 'admin');
      expect(updated).not.toBeNull();
      expect(updated!.role).toBe('admin');
    });
  });

  describe('findByUserId', () => {
    it('should find all memberships for a user', async () => {
      const memberships = await db.organizationMembers.findByUserId(testUser1.id);
      expect(memberships.length).toBeGreaterThanOrEqual(1);
      expect(memberships.some((m) => m.organization_id === testOrg.id)).toBe(true);
    });
  });

  describe('findOwner', () => {
    it('should find the owner of an organization', async () => {
      const owner = await db.organizationMembers.findOwner(testOrg.id);
      expect(owner).not.toBeNull();
      expect(owner!.user_id).toBe(testUser1.id);
      expect(owner!.role).toBe('owner');
    });
  });

  describe('countByOrganizationId', () => {
    it('should count members', async () => {
      const count = await db.organizationMembers.countByOrganizationId(testOrg.id);
      expect(count).toBe(3);
    });
  });

  describe('removeMember', () => {
    it('should remove a member', async () => {
      const removed = await db.organizationMembers.removeMember(testOrg.id, testUser3.id);
      expect(removed).toBe(true);

      const membership = await db.organizationMembers.findMembership(testOrg.id, testUser3.id);
      expect(membership).toBeNull();
    });

    it('should return false for non-existent membership', async () => {
      const removed = await db.organizationMembers.removeMember(
        testOrg.id,
        '00000000-0000-0000-0000-000000000000'
      );
      expect(removed).toBe(false);
    });
  });
});
