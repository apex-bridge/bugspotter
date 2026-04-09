/**
 * Invitation Repository Tests
 * Integration tests for saas.organization_invitations CRUD and query operations
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import { OrganizationService } from '../../src/saas/services/organization.service.js';
import { INVITATION_STATUS } from '../../src/db/types.js';
import type { Organization, User, OrganizationInvitation } from '../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('InvitationRepository', () => {
  let db: DatabaseClient;
  let orgService: OrganizationService;
  let testUser: User;
  let org: Organization;
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    db = DatabaseClient.create({ connectionString: TEST_DATABASE_URL });
    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    orgService = new OrganizationService(db);

    testUser = await db.users.create({
      email: `inv-repo-${Date.now()}@test.com`,
      password_hash: 'hash123',
      role: 'admin',
    });

    org = await orgService.createOrganization(
      { name: 'Inv Repo Org', subdomain: `inv-repo-${Date.now()}` },
      testUser.id
    );
    createdOrgIds.push(org.id);
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

  function createTestInvitation(
    overrides: Partial<{
      email: string;
      role: 'admin' | 'member';
      expiresAt: Date;
    }> = {}
  ): Promise<OrganizationInvitation> {
    const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return db.invitations.create({
      organization_id: org.id,
      email:
        overrides.email ??
        `repo-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      role: overrides.role ?? 'member',
      invited_by: testUser.id,
      token: `token-${Date.now()}-${Math.random().toString(36).slice(2, 18)}`,
      expires_at: expiresAt,
    });
  }

  describe('CRUD basics', () => {
    it('should create an invitation', async () => {
      const invite = await createTestInvitation({ email: 'crud-create@example.com' });

      expect(invite.id).toBeDefined();
      expect(invite.status).toBe(INVITATION_STATUS.PENDING);
      expect(invite.email).toBe('crud-create@example.com');
      expect(invite.created_at).toBeDefined();
      expect(invite.updated_at).toBeDefined();
    });

    it('should find an invitation by id', async () => {
      const invite = await createTestInvitation();
      const found = await db.invitations.findById(invite.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(invite.id);
      expect(found!.email).toBe(invite.email);
    });

    it('should update an invitation', async () => {
      const invite = await createTestInvitation();
      const updated = await db.invitations.update(invite.id, { role: 'admin' });

      expect(updated).not.toBeNull();
      expect(updated!.role).toBe('admin');
    });

    it('should delete an invitation', async () => {
      const invite = await createTestInvitation();
      const deleted = await db.invitations.delete(invite.id);
      expect(deleted).toBe(true);

      const found = await db.invitations.findById(invite.id);
      expect(found).toBeNull();
    });
  });

  describe('findByToken', () => {
    it('should find invitation by token with org and inviter details', async () => {
      const invite = await createTestInvitation();
      const found = await db.invitations.findByToken(invite.token);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(invite.id);
      expect(found!.organization_name).toBe('Inv Repo Org');
      expect(found!.inviter_email).toBe(testUser.email);
    });

    it('should return null for non-existent token', async () => {
      const found = await db.invitations.findByToken('does-not-exist-token');
      expect(found).toBeNull();
    });
  });

  describe('findPendingByOrgAndEmail', () => {
    it('should find pending invitation for org + email', async () => {
      const email = `pending-org-email-${Date.now()}@example.com`;
      await createTestInvitation({ email });

      const found = await db.invitations.findPendingByOrgAndEmail(org.id, email);
      expect(found).not.toBeNull();
      expect(found!.email).toBe(email);
    });

    it('should not find canceled invitation', async () => {
      const email = `canceled-check-${Date.now()}@example.com`;
      const invite = await createTestInvitation({ email });
      await db.invitations.cancelInvitation(invite.id);

      const found = await db.invitations.findPendingByOrgAndEmail(org.id, email);
      expect(found).toBeNull();
    });

    it('should return null for non-matching org', async () => {
      const email = `wrong-org-${Date.now()}@example.com`;
      await createTestInvitation({ email });

      const found = await db.invitations.findPendingByOrgAndEmail(
        '00000000-0000-0000-0000-000000000000',
        email
      );
      expect(found).toBeNull();
    });
  });

  describe('findPendingByOrganizationId', () => {
    it('should return all pending invitations for an org', async () => {
      const newOrg = await orgService.createOrganization(
        { name: 'Pending List Org', subdomain: `pending-list-${Date.now()}` },
        testUser.id
      );
      createdOrgIds.push(newOrg.id);

      // Create 3 invitations, cancel 1
      await db.invitations.create({
        organization_id: newOrg.id,
        email: 'plist1@example.com',
        role: 'member',
        invited_by: testUser.id,
        token: `plist-tok-1-${Date.now()}`,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      await db.invitations.create({
        organization_id: newOrg.id,
        email: 'plist2@example.com',
        role: 'admin',
        invited_by: testUser.id,
        token: `plist-tok-2-${Date.now()}`,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      const inv3 = await db.invitations.create({
        organization_id: newOrg.id,
        email: 'plist3@example.com',
        role: 'member',
        invited_by: testUser.id,
        token: `plist-tok-3-${Date.now()}`,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      // Cancel one
      await db.invitations.cancelInvitation(inv3.id);

      const pending = await db.invitations.findPendingByOrganizationId(newOrg.id);
      expect(pending).toHaveLength(2);
      expect(pending.every((i) => i.status === INVITATION_STATUS.PENDING)).toBe(true);
      // Should include org details
      expect(pending[0].organization_name).toBe('Pending List Org');
    });
  });

  describe('findPendingByEmail', () => {
    it('should find all pending invitations for an email across orgs', async () => {
      const email = `multi-org-${Date.now()}@example.com`;

      const org2 = await orgService.createOrganization(
        { name: 'Multi Org 2', subdomain: `multi-org-${Date.now()}` },
        testUser.id
      );
      createdOrgIds.push(org2.id);

      await db.invitations.create({
        organization_id: org.id,
        email,
        role: 'member',
        invited_by: testUser.id,
        token: `multi-1-${Date.now()}`,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      await db.invitations.create({
        organization_id: org2.id,
        email,
        role: 'admin',
        invited_by: testUser.id,
        token: `multi-2-${Date.now()}`,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const results = await db.invitations.findPendingByEmail(email);
      expect(results).toHaveLength(2);
    });

    it('should exclude expired invitations', async () => {
      const email = `expired-email-${Date.now()}@example.com`;

      await db.invitations.create({
        organization_id: org.id,
        email,
        role: 'member',
        invited_by: testUser.id,
        token: `expired-tok-${Date.now()}`,
        expires_at: new Date('2020-01-01'), // Already expired
      });

      const results = await db.invitations.findPendingByEmail(email);
      expect(results).toHaveLength(0);
    });

    it('should normalize email to lowercase', async () => {
      const email = `case-test-${Date.now()}@example.com`;

      await db.invitations.create({
        organization_id: org.id,
        email, // lowercase
        role: 'member',
        invited_by: testUser.id,
        token: `case-tok-${Date.now()}`,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const results = await db.invitations.findPendingByEmail(email.toUpperCase());
      // findPendingByEmail lowercases its input
      expect(results).toHaveLength(1);
    });
  });

  describe('acceptInvitation', () => {
    it('should set status to accepted and accepted_at timestamp', async () => {
      const invite = await createTestInvitation();
      const accepted = await db.invitations.acceptInvitation(invite.id);

      expect(accepted).not.toBeNull();
      expect(accepted!.status).toBe(INVITATION_STATUS.ACCEPTED);
      expect(accepted!.accepted_at).toBeDefined();
    });

    it('should only accept pending invitations', async () => {
      const invite = await createTestInvitation();
      await db.invitations.cancelInvitation(invite.id);

      const result = await db.invitations.acceptInvitation(invite.id);
      expect(result).toBeNull(); // canceled, not pending
    });
  });

  describe('cancelInvitation', () => {
    it('should set status to canceled', async () => {
      const invite = await createTestInvitation();
      const canceled = await db.invitations.cancelInvitation(invite.id);

      expect(canceled).not.toBeNull();
      expect(canceled!.status).toBe(INVITATION_STATUS.CANCELED);
    });

    it('should only cancel pending invitations', async () => {
      const invite = await createTestInvitation();
      await db.invitations.acceptInvitation(invite.id);

      const result = await db.invitations.cancelInvitation(invite.id);
      expect(result).toBeNull(); // accepted, not pending
    });
  });

  describe('expireStaleInvitations', () => {
    it('should expire past-due invitations', async () => {
      const email = `stale-${Date.now()}@example.com`;
      const invite = await db.invitations.create({
        organization_id: org.id,
        email,
        role: 'member',
        invited_by: testUser.id,
        token: `stale-tok-${Date.now()}`,
        expires_at: new Date('2020-01-01'),
      });

      const count = await db.invitations.expireStaleInvitations();
      expect(count).toBeGreaterThanOrEqual(1);

      const found = await db.invitations.findById(invite.id);
      expect(found!.status).toBe(INVITATION_STATUS.EXPIRED);
    });

    it('should not expire future invitations', async () => {
      const invite = await createTestInvitation();

      await db.invitations.expireStaleInvitations();

      const found = await db.invitations.findById(invite.id);
      expect(found!.status).toBe(INVITATION_STATUS.PENDING);
    });
  });

  describe('partial unique index', () => {
    it('should enforce one pending invite per email per org', async () => {
      const email = `unique-idx-${Date.now()}@example.com`;
      await createTestInvitation({ email });

      await expect(createTestInvitation({ email })).rejects.toThrow();
    });

    it('should allow re-inviting after the previous invite is canceled', async () => {
      const email = `reinvite-cancel-${Date.now()}@example.com`;
      const invite = await createTestInvitation({ email });
      await db.invitations.cancelInvitation(invite.id);

      // Should succeed — partial unique index only applies to pending
      const reinvite = await createTestInvitation({ email });
      expect(reinvite.email).toBe(email);
      expect(reinvite.status).toBe(INVITATION_STATUS.PENDING);
    });

    it('should allow re-inviting after the previous invite is accepted', async () => {
      const email = `reinvite-accept-${Date.now()}@example.com`;
      const invite = await createTestInvitation({ email });
      await db.invitations.acceptInvitation(invite.id);

      const reinvite = await createTestInvitation({ email });
      expect(reinvite.status).toBe(INVITATION_STATUS.PENDING);
    });

    it('should allow same email in different orgs simultaneously', async () => {
      const email = `cross-org-unique-${Date.now()}@example.com`;

      const org2 = await orgService.createOrganization(
        { name: 'Cross Org Unique', subdomain: `cross-unique-${Date.now()}` },
        testUser.id
      );
      createdOrgIds.push(org2.id);

      await createTestInvitation({ email });

      // Same email, different org — should work
      const invite2 = await db.invitations.create({
        organization_id: org2.id,
        email,
        role: 'member',
        invited_by: testUser.id,
        token: `cross-unique-${Date.now()}`,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      expect(invite2.email).toBe(email);
    });
  });
});
