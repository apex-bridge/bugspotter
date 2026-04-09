/**
 * Invitation Routes Integration Tests
 * Tests for org-scoped invitation CRUD and public token acceptance.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage, createAdminUser } from '../test-helpers.js';

const TEST_DB_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';

/**
 * Helper to register a new user via the API and return token + userId.
 */
async function registerUser(
  server: FastifyInstance,
  prefix: string
): Promise<{ token: string; userId: string; email: string }> {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(7);
  const email = `${prefix}-${timestamp}-${randomId}@example.com`;
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'password123' },
  });
  const data = response.json().data;
  return { token: data.access_token, userId: data.user.id, email };
}

describe('Invitation Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let adminToken: string;
  let adminUserId: string;

  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    db = createDatabaseClient(TEST_DB_URL);
    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();
    server = await createServer({ db, storage, pluginRegistry });
    await server.ready();
  });

  afterAll(async () => {
    for (const id of createdOrgIds) {
      try {
        await db.organizations.delete(id);
      } catch {
        // Ignore
      }
    }
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    const admin = await createAdminUser(server, db, 'inv-route');
    adminToken = admin.token;
    adminUserId = admin.user.id;
  });

  /**
   * Helper to create an org via admin route and return its ID.
   * The admin user becomes the owner via the owner_user_id param.
   */
  async function createOrg(ownerUserId: string): Promise<string> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: `Inv Test Org ${Date.now()}`,
        subdomain: `inv-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        owner_user_id: ownerUserId,
      },
    });
    const orgId = response.json().data.id;
    createdOrgIds.push(orgId);
    return orgId;
  }

  // ─── POST /api/v1/organizations/:id/invitations (org admin creates invite) ───

  describe('POST /api/v1/organizations/:id/invitations', () => {
    let orgId: string;

    beforeEach(async () => {
      orgId = await createOrg(adminUserId);
    });

    it('should create an invitation as org owner', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'org-inv@example.com', role: 'member' },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.invitation.email).toBe('org-inv@example.com');
      expect(json.data.invitation.role).toBe('member');
      expect(json.data.invitation.status).toBe('pending');
      expect(json.data.invitation.token).toHaveLength(64); // 32 bytes hex
      expect(json.data.email_sent).toBe(false); // SMTP not configured in tests
    });

    it('should reject non-member user', async () => {
      const outsider = await registerUser(server, 'outsider');

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${outsider.token}` },
        payload: { email: 'blocked@example.com', role: 'member' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject regular member (requires admin role)', async () => {
      // Add a member with 'member' role
      const member = await registerUser(server, 'member');
      await db.organizationMembers.create({
        organization_id: orgId,
        user_id: member.userId,
        role: 'member',
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { email: 'from-member@example.com', role: 'member' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should allow org admin to invite', async () => {
      // Add an admin member
      const orgAdmin = await registerUser(server, 'org-admin');
      await db.organizationMembers.create({
        organization_id: orgId,
        user_id: orgAdmin.userId,
        role: 'admin',
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${orgAdmin.token}` },
        payload: { email: 'from-org-admin@example.com', role: 'member' },
      });

      expect(response.statusCode).toBe(201);
    });

    it('should reject invitation for existing member', async () => {
      // adminUser is already an owner (member) of this org
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: adminUserId, role: 'member' },
      });

      // The email is the admin's user ID (not a real email), so schema validation catches it
      expect(response.statusCode).toBe(400);
    });
  });

  // ─── GET /api/v1/organizations/:id/invitations ───

  describe('GET /api/v1/organizations/:id/invitations', () => {
    let orgId: string;

    beforeEach(async () => {
      orgId = await createOrg(adminUserId);

      // Create two invitations
      await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'list-1@example.com', role: 'member' },
      });
      await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'list-2@example.com', role: 'admin' },
      });
    });

    it('should list pending invitations', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(2);
      expect(json.data[0].status).toBe('pending');
      expect(json.data[0].organization_name).toBeDefined();
      expect(json.data[0].inviter_email).toBeDefined();
    });

    it('should reject non-admin member', async () => {
      const member = await registerUser(server, 'list-member');
      await db.organizationMembers.create({
        organization_id: orgId,
        user_id: member.userId,
        role: 'member',
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return empty array for org with no invitations', async () => {
      const emptyOrgId = await createOrg(adminUserId);

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${emptyOrgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(0);
    });
  });

  // ─── DELETE /api/v1/organizations/:id/invitations/:invitationId ───

  describe('DELETE /api/v1/organizations/:id/invitations/:invitationId', () => {
    let orgId: string;

    beforeEach(async () => {
      orgId = await createOrg(adminUserId);
    });

    it('should cancel a pending invitation', async () => {
      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'cancel-me@example.com', role: 'member' },
      });
      const invitationId = createResp.json().data.invitation.id;

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/organizations/${orgId}/invitations/${invitationId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(204);
    });

    it('should reject canceling invitation from different org', async () => {
      const otherOrgId = await createOrg(adminUserId);

      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${otherOrgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'cross-cancel@example.com', role: 'member' },
      });
      const invitationId = createResp.json().data.invitation.id;

      // Try to cancel via orgId, but invitation belongs to otherOrgId
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/organizations/${orgId}/invitations/${invitationId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject canceling non-existent invitation', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/organizations/${orgId}/invitations/00000000-0000-0000-0000-000000000000`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should not show canceled invitations in list', async () => {
      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'disappear@example.com', role: 'member' },
      });
      const invitationId = createResp.json().data.invitation.id;

      await server.inject({
        method: 'DELETE',
        url: `/api/v1/organizations/${orgId}/invitations/${invitationId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const listResp = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(listResp.json().data).toHaveLength(0);
    });
  });

  // ─── POST /api/v1/invitations/accept (public, token-based) ───

  describe('POST /api/v1/invitations/accept', () => {
    let orgId: string;

    beforeEach(async () => {
      orgId = await createOrg(adminUserId);
    });

    it('should accept invitation with valid token (authenticated user, matching email)', async () => {
      // Register user first so we know the email
      const newUser = await registerUser(server, 'accepter');

      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: newUser.email, role: 'member' },
      });
      const token = createResp.json().data.invitation.token;

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: { authorization: `Bearer ${newUser.token}` },
        payload: { token },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.joined).toBe(true);
      expect(json.data.invitation.organization_id).toBe(orgId);
    });

    it('should reject when authenticated user email does not match invitation email', async () => {
      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'specific-target@example.com', role: 'member' },
      });
      const token = createResp.json().data.invitation.token;

      // Register a user with a DIFFERENT email
      const wrongUser = await registerUser(server, 'wrong-email');

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: { authorization: `Bearer ${wrongUser.token}` },
        payload: { token },
      });

      expect(response.statusCode).toBe(403);
      const json = response.json();
      expect(json.error).toBe('EmailMismatch');
      expect(json.details.invitation_email).toBe('specific-target@example.com');
      expect(json.details.current_user_email).toBe(wrongUser.email);
    });

    it('should accept invitation when email matches case-insensitively', async () => {
      const newUser = await registerUser(server, 'case-insensitive');

      // Create invitation with UPPERCASE email
      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: newUser.email.toUpperCase(), role: 'member' },
      });
      const token = createResp.json().data.invitation.token;

      // Accept with the original (lowercase) email — should succeed
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: { authorization: `Bearer ${newUser.token}` },
        payload: { token },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.joined).toBe(true);
    });

    it('should reject unauthenticated accept (prevents token burn)', async () => {
      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'accept-anon@example.com', role: 'member' },
      });
      const token = createResp.json().data.invitation.token;

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        payload: { token },
      });

      expect(response.statusCode).toBe(401);

      // Verify the invitation is still pending (not consumed)
      const listResp = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const pending = listResp
        .json()
        .data.find((inv: { email: string }) => inv.email === 'accept-anon@example.com');
      expect(pending).toBeDefined();
      expect(pending.status).toBe('pending');
    });

    it('should add authenticated user as org member on accept', async () => {
      // Register user first so invitation targets their email
      const newUser = await registerUser(server, 'joiner');

      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: newUser.email, role: 'admin' },
      });
      const token = createResp.json().data.invitation.token;

      await server.inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: { authorization: `Bearer ${newUser.token}` },
        payload: { token },
      });

      // Verify membership was created with correct role
      const membership = await db.organizationMembers.findMembership(orgId, newUser.userId);
      expect(membership).not.toBeNull();
      expect(membership!.role).toBe('admin');
    });

    it('should reject malformed token with 400', async () => {
      const newUser = await registerUser(server, 'invalid-token');
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: { authorization: `Bearer ${newUser.token}` },
        payload: { token: 'nonexistent-token-value' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject valid-format but nonexistent token with 404', async () => {
      const newUser = await registerUser(server, 'invalid-token-fmt');
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: { authorization: `Bearer ${newUser.token}` },
        payload: { token: 'a'.repeat(64) },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject already-accepted invitation', async () => {
      // Register user first, create invitation targeting their email
      const user1 = await registerUser(server, 'accept-once');

      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: user1.email, role: 'member' },
      });
      const token = createResp.json().data.invitation.token;

      await server.inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: { authorization: `Bearer ${user1.token}` },
        payload: { token },
      });

      // Second accept by same user should fail (already accepted)
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: { authorization: `Bearer ${user1.token}` },
        payload: { token },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject expired invitation', async () => {
      // Register user first so invitation targets their email
      const newUser = await registerUser(server, 'expired');

      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: newUser.email, role: 'member' },
      });
      const invitation = createResp.json().data.invitation;

      // Manually expire the invitation
      await db.invitations.update(invitation.id, {
        expires_at: new Date('2020-01-01'),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: { authorization: `Bearer ${newUser.token}` },
        payload: { token: invitation.token },
      });

      expect(response.statusCode).toBe(410); // Gone
    });

    it('should reject missing token in body', async () => {
      const newUser = await registerUser(server, 'no-token');
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: { authorization: `Bearer ${newUser.token}` },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ─── GET /api/v1/invitations/preview (public) ───

  describe('GET /api/v1/invitations/preview', () => {
    let orgId: string;

    beforeEach(async () => {
      orgId = await createOrg(adminUserId);
    });

    it('should return invitation preview without authentication', async () => {
      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'preview-test@example.com', role: 'member' },
      });
      const token = createResp.json().data.invitation.token;

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/invitations/preview?token=${token}`,
        // No authorization header — public endpoint
      });

      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data.email).toBe('preview-test@example.com');
      expect(data.organization_name).toBeDefined();
      expect(data.role).toBe('member');
      expect(data.status).toBe('pending');
      expect(data.inviter_name).toBeDefined();
      // Should NOT contain sensitive fields
      expect(data.token).toBeUndefined();
      expect(data.id).toBeUndefined();
      expect(data.organization_id).toBeUndefined();
    });

    it('should return 400 for malformed token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/invitations/preview?token=not-a-hex-token',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 404 for valid-format but nonexistent token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/invitations/preview?token=${'a'.repeat(64)}`,
      });
      expect(response.statusCode).toBe(404);
    });

    it('should return 400 for missing token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/invitations/preview',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 410 for expired invitation', async () => {
      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'preview-expired@example.com', role: 'member' },
      });
      const invitation = createResp.json().data.invitation;

      // Manually expire
      await db.invitations.update(invitation.id, {
        expires_at: new Date('2020-01-01'),
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/invitations/preview?token=${invitation.token}`,
      });
      expect(response.statusCode).toBe(410);
    });

    it('should return 400 for already accepted invitation', async () => {
      const newUser = await registerUser(server, 'preview-accepted');
      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: newUser.email, role: 'member' },
      });
      const invitation = createResp.json().data.invitation;

      // Accept it first
      await server.inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: { authorization: `Bearer ${newUser.token}` },
        payload: { token: invitation.token },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/invitations/preview?token=${invitation.token}`,
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for canceled invitation', async () => {
      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'preview-canceled@example.com', role: 'member' },
      });
      const invitation = createResp.json().data.invitation;

      // Cancel it
      await server.inject({
        method: 'DELETE',
        url: `/api/v1/organizations/${orgId}/invitations/${invitation.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/invitations/preview?token=${invitation.token}`,
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // ─── Full invitation lifecycle ───

  describe('Full invitation lifecycle', () => {
    it('should handle create → list → cancel → re-invite flow', async () => {
      const orgId = await createOrg(adminUserId);

      // 1. Create invitation
      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'lifecycle@example.com', role: 'member' },
      });
      expect(createResp.statusCode).toBe(201);
      const invitationId = createResp.json().data.invitation.id;

      // 2. List shows 1 pending
      const listResp = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(listResp.json().data).toHaveLength(1);

      // 3. Cancel
      const cancelResp = await server.inject({
        method: 'DELETE',
        url: `/api/v1/organizations/${orgId}/invitations/${invitationId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(cancelResp.statusCode).toBe(204);

      // 4. List shows 0 pending
      const listAfterCancel = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(listAfterCancel.json().data).toHaveLength(0);

      // 5. Re-invite same email
      const reinviteResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'lifecycle@example.com', role: 'admin' },
      });
      expect(reinviteResp.statusCode).toBe(201);
      expect(reinviteResp.json().data.invitation.role).toBe('admin');
    });

    it('should handle create → accept → verify membership flow', async () => {
      const orgId = await createOrg(adminUserId);

      // 1. Register user first so invitation targets their email
      const newUser = await registerUser(server, 'full-flow');

      // 2. Create invitation targeting the user's email
      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: newUser.email, role: 'member' },
      });
      const token = createResp.json().data.invitation.token;

      // 3. User accepts
      const acceptResp = await server.inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: { authorization: `Bearer ${newUser.token}` },
        payload: { token },
      });
      expect(acceptResp.statusCode).toBe(200);
      expect(acceptResp.json().data.joined).toBe(true);

      // 4. Verify membership in DB
      const membership = await db.organizationMembers.findMembership(orgId, newUser.userId);
      expect(membership).not.toBeNull();
      expect(membership!.role).toBe('member');

      // 5. Invitation is no longer in pending list
      const listResp = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(listResp.json().data).toHaveLength(0);
    });
  });
});
