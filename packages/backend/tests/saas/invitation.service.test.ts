/**
 * Invitation Service Tests
 * Integration tests for email-based invitation lifecycle:
 * create, list, cancel, accept, auto-accept on registration.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import { OrganizationService } from '../../src/saas/services/organization.service.js';
import { InvitationService } from '../../src/saas/services/invitation.service.js';
import { INVITATION_STATUS, INVITATION_ROLE, ORG_MEMBER_ROLE } from '../../src/db/types.js';
import type { Organization, User } from '../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('InvitationService', () => {
  let db: DatabaseClient;
  let orgService: OrganizationService;
  let service: InvitationService;
  let adminUser: User;
  let memberUser: User;
  const createdOrgIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    db = DatabaseClient.create({ connectionString: TEST_DATABASE_URL });
    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    orgService = new OrganizationService(db);
    service = new InvitationService(db);

    adminUser = await db.users.create({
      email: `inv-admin-${Date.now()}@test.com`,
      password_hash: 'hash123',
      role: 'admin',
    });
    createdUserIds.push(adminUser.id);

    memberUser = await db.users.create({
      email: `inv-member-${Date.now()}@test.com`,
      password_hash: 'hash456',
      role: 'user',
    });
    createdUserIds.push(memberUser.id);
  });

  afterAll(async () => {
    for (const id of createdOrgIds) {
      try {
        await db.organizations.delete(id);
      } catch {
        // Ignore — cascade handles related records
      }
    }
    for (const id of createdUserIds) {
      try {
        await db.users.delete(id);
      } catch {
        // Ignore
      }
    }
    await db.close();
  });

  function uniqueSubdomain() {
    return `inv-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  describe('createInvitation', () => {
    let org: Organization;

    beforeAll(async () => {
      org = await orgService.createOrganization(
        { name: 'Invite Create Org', subdomain: uniqueSubdomain() },
        adminUser.id
      );
      createdOrgIds.push(org.id);
    });

    it('should create an invitation with a unique token', async () => {
      const invitation = await service.createInvitation(
        org.id,
        'newuser@example.com',
        'member',
        adminUser.id
      );

      expect(invitation.id).toBeDefined();
      expect(invitation.organization_id).toBe(org.id);
      expect(invitation.email).toBe('newuser@example.com');
      expect(invitation.role).toBe('member');
      expect(invitation.invited_by).toBe(adminUser.id);
      expect(invitation.token).toHaveLength(64); // 32 bytes hex
      expect(invitation.status).toBe(INVITATION_STATUS.PENDING);
      expect(invitation.expires_at).toBeDefined();
    });

    it('should normalize email to lowercase', async () => {
      const invitation = await service.createInvitation(
        org.id,
        '  UPPER@EXAMPLE.COM  ',
        'admin',
        adminUser.id
      );

      expect(invitation.email).toBe('upper@example.com');
    });

    it('should reject duplicate pending invitation for same email + org', async () => {
      await expect(
        service.createInvitation(org.id, 'newuser@example.com', 'member', adminUser.id)
      ).rejects.toThrow('A pending invitation already exists');
    });

    it('should reject invitation for existing org member', async () => {
      // adminUser is already a member (owner) of this org
      await expect(
        service.createInvitation(org.id, adminUser.email, 'member', adminUser.id)
      ).rejects.toThrow('already a member');
    });

    it('should set expiry to 7 days in the future', async () => {
      const invitation = await service.createInvitation(
        org.id,
        'expiry-test@example.com',
        'member',
        adminUser.id
      );

      const now = new Date();
      const expiresAt = new Date(invitation.expires_at);
      const diffDays = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

      // Should be approximately 7 days (allow small margin for test execution time)
      expect(diffDays).toBeGreaterThan(6.9);
      expect(diffDays).toBeLessThanOrEqual(7.01);
    });

    it('should auto-expire stale invite and allow re-invite (lockout fix)', async () => {
      const staleOrg = await orgService.createOrganization(
        { name: 'Stale Lockout Org', subdomain: uniqueSubdomain() },
        adminUser.id
      );
      createdOrgIds.push(staleOrg.id);

      // 1. Create an invitation
      const invite = await service.createInvitation(
        staleOrg.id,
        'stale-lockout@example.com',
        'member',
        adminUser.id
      );

      // 2. Manually expire it (simulating time passing) — status stays 'pending'
      await db.invitations.update(invite.id, {
        expires_at: new Date('2020-01-01'),
      });

      // 3. Without the expire-on-write fix, this would throw
      //    "A pending invitation already exists" because the partial unique
      //    index still sees the expired-but-pending row.
      const reinvite = await service.createInvitation(
        staleOrg.id,
        'stale-lockout@example.com',
        'admin',
        adminUser.id
      );

      expect(reinvite.status).toBe(INVITATION_STATUS.PENDING);
      expect(reinvite.role).toBe('admin');
      expect(reinvite.id).not.toBe(invite.id); // New invitation

      // 4. Original invite should now be expired
      const original = await db.invitations.findById(invite.id);
      expect(original!.status).toBe(INVITATION_STATUS.EXPIRED);
    });
  });

  describe('listPendingInvitations', () => {
    let org: Organization;

    beforeAll(async () => {
      org = await orgService.createOrganization(
        { name: 'Invite List Org', subdomain: uniqueSubdomain() },
        adminUser.id
      );
      createdOrgIds.push(org.id);

      await service.createInvitation(org.id, 'list1@example.com', 'member', adminUser.id);
      await service.createInvitation(org.id, 'list2@example.com', 'admin', adminUser.id);
    });

    it('should return all pending invitations for the org', async () => {
      const invitations = await service.listPendingInvitations(org.id);

      expect(invitations).toHaveLength(2);
      expect(invitations.every((i) => i.status === INVITATION_STATUS.PENDING)).toBe(true);
    });

    it('should include org and inviter details', async () => {
      const invitations = await service.listPendingInvitations(org.id);
      const first = invitations[0];

      expect(first.organization_name).toBe('Invite List Org');
      expect(first.inviter_email).toBe(adminUser.email);
    });

    it('should return empty array for org with no invitations', async () => {
      const emptyOrg = await orgService.createOrganization(
        { name: 'Empty Invite Org', subdomain: uniqueSubdomain() },
        adminUser.id
      );
      createdOrgIds.push(emptyOrg.id);

      const invitations = await service.listPendingInvitations(emptyOrg.id);
      expect(invitations).toHaveLength(0);
    });
  });

  describe('cancelInvitation', () => {
    let org: Organization;

    beforeAll(async () => {
      org = await orgService.createOrganization(
        { name: 'Invite Cancel Org', subdomain: uniqueSubdomain() },
        adminUser.id
      );
      createdOrgIds.push(org.id);
    });

    it('should cancel a pending invitation', async () => {
      const invitation = await service.createInvitation(
        org.id,
        'cancel-me@example.com',
        'member',
        adminUser.id
      );

      const canceled = await service.cancelInvitation(invitation.id, org.id);
      expect(canceled.status).toBe(INVITATION_STATUS.CANCELED);
    });

    it('should allow re-inviting after cancellation', async () => {
      // The same email can be invited again after cancellation
      const reinvite = await service.createInvitation(
        org.id,
        'cancel-me@example.com',
        'admin',
        adminUser.id
      );
      expect(reinvite.status).toBe(INVITATION_STATUS.PENDING);
      expect(reinvite.role).toBe('admin');
    });

    it('should reject canceling a non-existent invitation', async () => {
      await expect(
        service.cancelInvitation('00000000-0000-0000-0000-000000000000', org.id)
      ).rejects.toThrow('not found');
    });

    it('should reject canceling an invitation from a different org', async () => {
      const otherOrg = await orgService.createOrganization(
        { name: 'Other Cancel Org', subdomain: uniqueSubdomain() },
        adminUser.id
      );
      createdOrgIds.push(otherOrg.id);

      const invite = await service.createInvitation(
        otherOrg.id,
        'cross-org@example.com',
        'member',
        adminUser.id
      );

      await expect(service.cancelInvitation(invite.id, org.id)).rejects.toThrow('does not belong');
    });

    it('should reject canceling an already-canceled invitation', async () => {
      const invite = await service.createInvitation(
        org.id,
        'double-cancel@example.com',
        'member',
        adminUser.id
      );

      await service.cancelInvitation(invite.id, org.id);

      await expect(service.cancelInvitation(invite.id, org.id)).rejects.toThrow(
        'Cannot cancel invitation with status'
      );
    });
  });

  describe('acceptInvitation', () => {
    let org: Organization;

    beforeAll(async () => {
      org = await orgService.createOrganization(
        { name: 'Invite Accept Org', subdomain: uniqueSubdomain() },
        adminUser.id
      );
      createdOrgIds.push(org.id);
    });

    it('should accept a valid invitation by token', async () => {
      const invitation = await service.createInvitation(
        org.id,
        'accept-token@example.com',
        'member',
        adminUser.id
      );

      const result = await service.acceptInvitation(invitation.token, memberUser.id);

      expect(result.invitation.organization_id).toBe(org.id);
      expect(result.invitation.organization_name).toBe('Invite Accept Org');
      expect(result.joined).toBe(true);
    });

    it('should add the user as a member on accept', async () => {
      const membership = await db.organizationMembers.findMembership(org.id, memberUser.id);

      expect(membership).not.toBeNull();
      expect(membership!.role).toBe('member');
    });

    it('should mark invitation as accepted in the DB', async () => {
      // Create + accept a new invitation to verify status
      const invite = await service.createInvitation(
        org.id,
        'check-status@example.com',
        'admin',
        adminUser.id
      );

      // Need a new user for this since memberUser is already a member
      const newUser = await db.users.create({
        email: `check-status-${Date.now()}@test.com`,
        password_hash: 'hash',
        role: 'user',
      });
      createdUserIds.push(newUser.id);

      await service.acceptInvitation(invite.token, newUser.id);

      // Verify status in DB
      const dbInvite = await db.invitations.findById(invite.id);
      expect(dbInvite!.status).toBe(INVITATION_STATUS.ACCEPTED);
      expect(dbInvite!.accepted_at).toBeDefined();
    });

    it('should reject an invalid token', async () => {
      await expect(service.acceptInvitation('nonexistent-token')).rejects.toThrow(
        'Invalid or expired'
      );
    });

    it('should reject an already-accepted invitation', async () => {
      const invite = await service.createInvitation(
        org.id,
        'already-accepted@example.com',
        'member',
        adminUser.id
      );

      const acceptUser = await db.users.create({
        email: `accept-once-${Date.now()}@test.com`,
        password_hash: 'hash',
        role: 'user',
      });
      createdUserIds.push(acceptUser.id);

      await service.acceptInvitation(invite.token, acceptUser.id);

      await expect(service.acceptInvitation(invite.token, acceptUser.id)).rejects.toThrow(
        'already been accepted'
      );
    });

    it('should reject an expired invitation', async () => {
      const invite = await service.createInvitation(
        org.id,
        'expired-invite@example.com',
        'member',
        adminUser.id
      );

      // Manually expire the invitation by setting expires_at to the past
      await db.invitations.update(invite.id, {
        expires_at: new Date('2020-01-01'),
      });

      await expect(service.acceptInvitation(invite.token)).rejects.toThrow('expired');
    });

    it('should not duplicate membership if user is already a member', async () => {
      // adminUser is already an owner of this org
      const invite = await service.createInvitation(
        org.id,
        'skip-dup@example.com',
        'member',
        adminUser.id
      );

      // Accept as adminUser (already owner)
      // Should not throw, just skip membership creation
      const result = await service.acceptInvitation(invite.token, adminUser.id);
      expect(result.invitation).toBeDefined();
      expect(result.joined).toBe(false);

      // Verify still only one membership for adminUser in this org
      const membership = await db.organizationMembers.findMembership(org.id, adminUser.id);
      expect(membership!.role).toBe('owner'); // Unchanged — not downgraded
    });

    it('should match emails after trimming whitespace', async () => {
      const email = `trim-test-${Date.now()}@example.com`;
      const invite = await service.createInvitation(org.id, email, 'member', adminUser.id);

      // Create user whose email has leading/trailing whitespace
      const user = await db.users.create({
        email: `  ${email}  `,
        password_hash: 'hash',
        role: 'user',
      });
      createdUserIds.push(user.id);

      // Should succeed — .trim() normalizes both sides
      const result = await service.acceptInvitation(invite.token, user.id, user.email);
      expect(result.joined).toBe(true);
    });

    it('should reject email mismatch even with whitespace', async () => {
      const invite = await service.createInvitation(
        org.id,
        'trimmed-target@example.com',
        'member',
        adminUser.id
      );

      await expect(
        service.acceptInvitation(invite.token, adminUser.id, '  wrong@example.com  ')
      ).rejects.toThrow('different email address');
    });
  });

  describe('autoAcceptPendingInvitations', () => {
    const autoAcceptEmail = `auto-accept-${Date.now()}@test.com`;
    let org1: Organization;
    let org2: Organization;

    beforeAll(async () => {
      org1 = await orgService.createOrganization(
        { name: 'Auto Accept Org 1', subdomain: uniqueSubdomain() },
        adminUser.id
      );
      createdOrgIds.push(org1.id);

      org2 = await orgService.createOrganization(
        { name: 'Auto Accept Org 2', subdomain: uniqueSubdomain() },
        adminUser.id
      );
      createdOrgIds.push(org2.id);

      // Create invitations for the same email in two different orgs
      await service.createInvitation(org1.id, autoAcceptEmail, 'member', adminUser.id);
      await service.createInvitation(org2.id, autoAcceptEmail, 'admin', adminUser.id);
    });

    it('should accept all pending invitations for a new user', async () => {
      const newUser = await db.users.create({
        email: autoAcceptEmail,
        password_hash: 'hash',
        role: 'user',
      });
      createdUserIds.push(newUser.id);

      const accepted = await service.autoAcceptPendingInvitations(autoAcceptEmail, newUser.id);

      expect(accepted).toBe(2);
    });

    it('should have joined both organizations with correct roles', async () => {
      const newUser = await db.users.findByEmail(autoAcceptEmail);
      expect(newUser).not.toBeNull();

      const membership1 = await db.organizationMembers.findMembership(org1.id, newUser!.id);
      expect(membership1).not.toBeNull();
      expect(membership1!.role).toBe('member');

      const membership2 = await db.organizationMembers.findMembership(org2.id, newUser!.id);
      expect(membership2).not.toBeNull();
      expect(membership2!.role).toBe('admin');
    });

    it('should return 0 when no pending invitations exist', async () => {
      const noInviteUser = await db.users.create({
        email: `no-invites-${Date.now()}@test.com`,
        password_hash: 'hash',
        role: 'user',
      });
      createdUserIds.push(noInviteUser.id);

      const accepted = await service.autoAcceptPendingInvitations(
        noInviteUser.email,
        noInviteUser.id
      );
      expect(accepted).toBe(0);
    });

    it('should skip expired invitations during auto-accept', async () => {
      const org3 = await orgService.createOrganization(
        { name: 'Auto Accept Expired Org', subdomain: uniqueSubdomain() },
        adminUser.id
      );
      createdOrgIds.push(org3.id);

      const expiredEmail = `auto-expired-${Date.now()}@test.com`;

      const invite = await service.createInvitation(org3.id, expiredEmail, 'member', adminUser.id);

      // Expire the invitation
      await db.invitations.update(invite.id, { expires_at: new Date('2020-01-01') });

      const user = await db.users.create({
        email: expiredEmail,
        password_hash: 'hash',
        role: 'user',
      });
      createdUserIds.push(user.id);

      // findPendingByEmail filters by expires_at > NOW(), so expired invitations are excluded
      const accepted = await service.autoAcceptPendingInvitations(expiredEmail, user.id);
      expect(accepted).toBe(0);
    });
  });

  describe('createInvitation — owner role defense-in-depth', () => {
    let ownerlessOrg: Organization;

    beforeAll(async () => {
      // Create org via adminCreateOrganization with pending owner (no actual owner member)
      const { organization } = await orgService.adminCreateOrganization(
        {
          name: 'Owner Defense Org',
          subdomain: uniqueSubdomain(),
          owner_email: `owner-defense-${Date.now()}@nonexistent.test`,
        },
        adminUser.id
      );
      ownerlessOrg = organization;
      createdOrgIds.push(ownerlessOrg.id);
    });

    it('should reject owner invitation when org already has an owner member', async () => {
      // Use a normal org (created with adminUser as owner via createOrganization)
      const orgWithOwner = await orgService.createOrganization(
        { name: 'Has Owner Org', subdomain: uniqueSubdomain() },
        adminUser.id
      );
      createdOrgIds.push(orgWithOwner.id);

      await expect(
        service.createInvitation(
          orgWithOwner.id,
          'new-owner@example.com',
          INVITATION_ROLE.OWNER,
          adminUser.id
        )
      ).rejects.toThrow('Organization already has an owner');
    });

    it('should reject duplicate pending owner invitation', async () => {
      // ownerlessOrg already has a pending owner invitation from beforeAll
      await expect(
        service.createInvitation(
          ownerlessOrg.id,
          'another-owner@example.com',
          INVITATION_ROLE.OWNER,
          adminUser.id
        )
      ).rejects.toThrow('A pending owner invitation already exists');
    });

    it('should skip existing-member check for owner role', async () => {
      // adminUser is NOT a member of ownerlessOrg, but even if they were,
      // the owner path doesn't check membership — it checks findOwner instead.
      // Create a fresh ownerless org, add adminUser as admin member, then
      // try to invite a different email as owner — should succeed.
      const { organization: freshOrg } = await orgService.adminCreateOrganization(
        {
          name: 'Skip Member Check Org',
          subdomain: uniqueSubdomain(),
          owner_email: `skip-check-${Date.now()}@nonexistent.test`,
        },
        adminUser.id
      );
      createdOrgIds.push(freshOrg.id);

      // Cancel the existing pending owner invitation so we can create a new one
      const pending = await db.invitations.findPendingOwnerByOrganizationId(freshOrg.id);
      expect(pending).not.toBeNull();
      await service.cancelInvitation(pending!.id, freshOrg.id);

      // Add adminUser as admin (non-owner) member
      await db.organizationMembers.create({
        organization_id: freshOrg.id,
        user_id: adminUser.id,
        role: ORG_MEMBER_ROLE.ADMIN,
      });

      // Creating an owner invitation for adminUser's email should NOT fail
      // with "already a member" — the owner path skips that check
      const invite = await service.createInvitation(
        freshOrg.id,
        adminUser.email,
        INVITATION_ROLE.OWNER,
        adminUser.id
      );

      expect(invite.role).toBe(INVITATION_ROLE.OWNER);
      expect(invite.email).toBe(adminUser.email);
    });
  });

  describe('acceptInvitation — owner role', () => {
    let ownerlessOrg: Organization;
    let ownerInviteToken: string;
    let newOwnerUser: User;

    beforeAll(async () => {
      const pendingEmail = `accept-owner-${Date.now()}@test.com`;

      const { organization, invitation } = await orgService.adminCreateOrganization(
        {
          name: 'Accept Owner Org',
          subdomain: uniqueSubdomain(),
          owner_email: pendingEmail,
        },
        adminUser.id
      );
      ownerlessOrg = organization;
      createdOrgIds.push(ownerlessOrg.id);
      ownerInviteToken = invitation!.token;

      // Create the user who will accept the invitation
      newOwnerUser = await db.users.create({
        email: pendingEmail,
        password_hash: 'hash',
        role: 'user',
      });
      createdUserIds.push(newOwnerUser.id);
    });

    it('should accept owner invitation and create owner membership', async () => {
      const result = await service.acceptInvitation(ownerInviteToken, newOwnerUser.id);

      expect(result.joined).toBe(true);
      expect(result.invitation.status).toBe(INVITATION_STATUS.ACCEPTED);

      // Verify membership was created with owner role
      const membership = await db.organizationMembers.findMembership(
        ownerlessOrg.id,
        newOwnerUser.id
      );
      expect(membership).not.toBeNull();
      expect(membership!.role).toBe(ORG_MEMBER_ROLE.OWNER);
    });

    it('should clear pending_owner_email after acceptance', async () => {
      // The pending owner invitation is now accepted, so the computed field should be null
      const pending = await db.invitations.findPendingOwnerByOrganizationId(ownerlessOrg.id);
      expect(pending).toBeNull();
    });
  });

  describe('autoAcceptPendingInvitations — owner role', () => {
    it('should auto-accept owner invitation on registration', async () => {
      const pendingEmail = `auto-owner-${Date.now()}@test.com`;

      const { organization: org } = await orgService.adminCreateOrganization(
        {
          name: 'Auto Owner Org',
          subdomain: uniqueSubdomain(),
          owner_email: pendingEmail,
        },
        adminUser.id
      );
      createdOrgIds.push(org.id);

      // Simulate registration: create user then auto-accept
      const newUser = await db.users.create({
        email: pendingEmail,
        password_hash: 'hash',
        role: 'user',
      });
      createdUserIds.push(newUser.id);

      const accepted = await service.autoAcceptPendingInvitations(pendingEmail, newUser.id);
      expect(accepted).toBe(1);

      // Verify owner membership
      const membership = await db.organizationMembers.findMembership(org.id, newUser.id);
      expect(membership).not.toBeNull();
      expect(membership!.role).toBe(ORG_MEMBER_ROLE.OWNER);

      // Verify findOwner now returns the user
      const owner = await db.organizationMembers.findOwner(org.id);
      expect(owner).not.toBeNull();
      expect(owner!.user_id).toBe(newUser.id);
    });
  });
});
