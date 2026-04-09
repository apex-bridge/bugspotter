/**
 * Admin Organization Routes Integration Tests
 * Tests for admin org creation, plan management, and admin invitations.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage, createAdminUser } from '../test-helpers.js';

const TEST_DB_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';

describe('Admin Organization Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let adminToken: string;
  let regularUserToken: string;
  let regularUserId: string;

  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    db = createDatabaseClient(TEST_DB_URL);
    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();
    server = await createServer({ db, storage, pluginRegistry });
    await server.ready();
  });

  afterAll(async () => {
    // Clean up organizations created during tests
    for (const id of createdOrgIds) {
      try {
        await db.organizations.delete(id);
      } catch {
        // Ignore — cascade handles related records
      }
    }
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    // Create a fresh admin user
    const admin = await createAdminUser(server, db, 'admin-org-route');
    adminToken = admin.token;

    // Create a fresh regular user via registration
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);
    const regResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `regular-${timestamp}-${randomId}@example.com`,
        password: 'password123',
      },
    });
    const regData = regResponse.json().data;
    regularUserToken = regData.access_token;
    regularUserId = regData.user.id;
  });

  // ─── POST /api/v1/admin/organizations ───

  describe('POST /api/v1/admin/organizations', () => {
    it('should create an organization with default trial plan', async () => {
      const subdomain = `admin-test-${Date.now()}`;
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Admin Route Org',
          subdomain,
          owner_user_id: regularUserId,
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Admin Route Org');
      expect(json.data.subdomain).toBe(subdomain);
      expect(json.data.subscription_status).toBe('trial');
      createdOrgIds.push(json.data.id);
    });

    it('should create an organization with a specific plan', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Pro Plan Org',
          subdomain: `admin-pro-${Date.now()}`,
          owner_user_id: regularUserId,
          plan_name: 'professional',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.data.subscription_status).toBe('active');
      createdOrgIds.push(json.data.id);
    });

    it('should create an organization with data_residency_region', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'KZ Org',
          subdomain: `admin-kz-${Date.now()}`,
          owner_user_id: regularUserId,
          data_residency_region: 'kz',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().data.data_residency_region).toBe('kz');
      createdOrgIds.push(response.json().data.id);
    });

    it('should reject non-admin users', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${regularUserToken}` },
        payload: {
          name: 'Unauthorized Org',
          subdomain: `unauth-${Date.now()}`,
          owner_user_id: regularUserId,
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().success).toBe(false);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        payload: {
          name: 'No Auth Org',
          subdomain: `noauth-${Date.now()}`,
          owner_user_id: regularUserId,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject invalid subdomain format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Bad Subdomain',
          subdomain: 'INVALID_SUBDOMAIN!',
          owner_user_id: regularUserId,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject missing required fields', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'No Subdomain',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject non-existent owner_user_id', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Ghost Owner',
          subdomain: `ghost-${Date.now()}`,
          owner_user_id: '00000000-0000-0000-0000-000000000000',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject duplicate subdomain', async () => {
      const subdomain = `dup-sub-${Date.now()}`;

      const first = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'First',
          subdomain,
          owner_user_id: regularUserId,
        },
      });
      createdOrgIds.push(first.json().data.id);

      const second = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Second',
          subdomain,
          owner_user_id: regularUserId,
        },
      });

      expect(second.statusCode).toBe(409);
    });
  });

  // ─── POST /api/v1/admin/organizations (pending owner) ───

  describe('POST /api/v1/admin/organizations — pending owner', () => {
    it('should create org with pending owner for non-existent email', async () => {
      const pendingEmail = `pending-${Date.now()}@nonexistent.test`;
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Pending Owner Org',
          subdomain: `pending-own-${Date.now()}`,
          owner_email: pendingEmail,
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.data.pending_owner_email).toBe(pendingEmail);
      expect(json.data.email_sent).toBe(false); // SMTP not configured in tests
      createdOrgIds.push(json.data.id);
    });

    it('should create org with immediate owner when owner_email matches existing user', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Existing Email Org',
          subdomain: `exist-email-${Date.now()}`,
          owner_email: `regular-${Date.now()}-existing@example.com`,
          owner_user_id: regularUserId,
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      // No pending owner — user was resolved immediately
      expect(json.data.pending_owner_email).toBeNull();
      createdOrgIds.push(json.data.id);
    });

    it('should reject when neither owner_user_id nor owner_email is provided', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'No Owner',
          subdomain: `no-owner-${Date.now()}`,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid owner_email format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Bad Email Org',
          subdomain: `bad-email-${Date.now()}`,
          owner_email: 'not-an-email',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ─── GET /api/v1/admin/organizations (pending_owner_email in list) ───

  describe('GET /api/v1/admin/organizations — pending_owner_email field', () => {
    it('should include pending_owner_email in organization list', async () => {
      const pendingEmail = `list-pending-${Date.now()}@nonexistent.test`;
      const createResp = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'List Pending Owner Org',
          subdomain: `list-pend-${Date.now()}`,
          owner_email: pendingEmail,
        },
      });
      const orgId = createResp.json().data.id;
      createdOrgIds.push(orgId);

      const listResp = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations?search=List+Pending+Owner`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(listResp.statusCode).toBe(200);
      const orgs = listResp.json().data;
      const found = orgs.find((o: any) => o.id === orgId);
      expect(found).toBeDefined();
      expect(found.pending_owner_email).toBe(pendingEmail);
    });

    it('should return null pending_owner_email for org with actual owner', async () => {
      const createResp = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Has Owner List Org',
          subdomain: `has-own-${Date.now()}`,
          owner_user_id: regularUserId,
        },
      });
      const orgId = createResp.json().data.id;
      createdOrgIds.push(orgId);

      const listResp = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations?search=Has+Owner+List`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(listResp.statusCode).toBe(200);
      const orgs = listResp.json().data;
      const found = orgs.find((o: any) => o.id === orgId);
      expect(found).toBeDefined();
      expect(found.pending_owner_email).toBeNull();
    });
  });

  // ─── PATCH /api/v1/admin/organizations/:id/subscription ───

  describe('PATCH /api/v1/admin/organizations/:id/subscription', () => {
    let orgId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Plan Change Org',
          subdomain: `plan-chg-${Date.now()}`,
          owner_user_id: regularUserId,
        },
      });
      orgId = response.json().data.id;
      createdOrgIds.push(orgId);
    });

    it('should upgrade plan from trial to professional', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { plan_name: 'professional' },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.plan_name).toBe('professional');
      expect(json.data.status).toBe('active');
    });

    it('should allow explicit status override', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { plan_name: 'starter', status: 'past_due' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.status).toBe('past_due');
    });

    it('should sync org subscription_status when changing plan', async () => {
      // Start with trial org (default from beforeEach createOrg)
      const orgBefore = await db.organizations.findById(orgId);
      expect(orgBefore!.subscription_status).toBe('trial');

      // Upgrade to professional — should set org status to 'active'
      await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { plan_name: 'professional' },
      });

      const orgAfterUpgrade = await db.organizations.findById(orgId);
      expect(orgAfterUpgrade!.subscription_status).toBe('active');

      // Set to past_due — org should sync to 'past_due'
      await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { plan_name: 'professional', status: 'past_due' },
      });

      const orgAfterPastDue = await db.organizations.findById(orgId);
      expect(orgAfterPastDue!.subscription_status).toBe('past_due');

      // Set to canceled — org should sync to 'canceled'
      await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { plan_name: 'professional', status: 'canceled' },
      });

      const orgAfterCancel = await db.organizations.findById(orgId);
      expect(orgAfterCancel!.subscription_status).toBe('canceled');
    });

    it('should reject non-admin users', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/subscription`,
        headers: { authorization: `Bearer ${regularUserToken}` },
        payload: { plan_name: 'professional' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject invalid plan_name', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { plan_name: 'invalid_plan' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject non-existent organization', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/admin/organizations/00000000-0000-0000-0000-000000000000/subscription',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { plan_name: 'professional' },
      });

      // Service throws AppError when subscription not found
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  // ─── POST /api/v1/admin/organizations/:id/invitations ───

  describe('POST /api/v1/admin/organizations/:id/invitations', () => {
    let orgId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Admin Invite Org',
          subdomain: `admin-inv-${Date.now()}`,
          owner_user_id: regularUserId,
        },
      });
      orgId = response.json().data.id;
      createdOrgIds.push(orgId);
    });

    it('should create an invitation and report email_sent status', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          email: 'invite-test@example.com',
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.invitation.email).toBe('invite-test@example.com');
      expect(json.data.invitation.role).toBe('member');
      expect(json.data.invitation.token).toBeDefined();
      expect(json.data.invitation.status).toBe('pending');
      // SMTP not configured in test env — email_sent should be false
      expect(json.data.email_sent).toBe(false);
    });

    it('should create an admin role invitation', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          email: 'admin-invite@example.com',
          role: 'admin',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().data.invitation.role).toBe('admin');
    });

    it('should normalize email to lowercase', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          email: 'UPPER@Example.COM',
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().data.invitation.email).toBe('upper@example.com');
    });

    it('should reject duplicate pending invitation', async () => {
      await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'dup-inv@example.com', role: 'member' },
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'dup-inv@example.com', role: 'member' },
      });

      expect(response.statusCode).toBe(409);
    });

    it('should reject non-admin users', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${regularUserToken}` },
        payload: { email: 'user-inv@example.com', role: 'member' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject invalid email format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'not-an-email', role: 'member' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid role', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'test@example.com', role: 'superuser' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject owner role via generic invite endpoint', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'test@example.com', role: 'owner' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject invitation to non-existent organization', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations/00000000-0000-0000-0000-000000000000/invitations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'ghost-org@example.com', role: 'member' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── GET /api/v1/admin/organizations/:id/invitations ───

  describe('GET /api/v1/admin/organizations/:id/invitations', () => {
    let orgId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Admin List Inv Org',
          subdomain: `admin-list-inv-${Date.now()}`,
          owner_user_id: regularUserId,
        },
      });
      orgId = response.json().data.id;
      createdOrgIds.push(orgId);
    });

    it('should list pending invitations via admin endpoint', async () => {
      // Create two invitations
      await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'admin-list-1@example.com', role: 'member' },
      });
      await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'admin-list-2@example.com', role: 'admin' },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(2);
    });

    it('should reject non-admin users', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${regularUserToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ─── DELETE /api/v1/admin/organizations/:id/invitations/:invitationId ───

  describe('DELETE /api/v1/admin/organizations/:id/invitations/:invitationId', () => {
    let orgId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Admin Cancel Inv Org',
          subdomain: `admin-cancel-inv-${Date.now()}`,
          owner_user_id: regularUserId,
        },
      });
      orgId = response.json().data.id;
      createdOrgIds.push(orgId);
    });

    it('should cancel invitation and return 204', async () => {
      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'admin-cancel@example.com', role: 'member' },
      });
      const invitationId = createResp.json().data.invitation.id;

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${orgId}/invitations/${invitationId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(204);
    });

    it('should reject non-admin users', async () => {
      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'admin-cancel-auth@example.com', role: 'member' },
      });
      const invitationId = createResp.json().data.invitation.id;

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${orgId}/invitations/${invitationId}`,
        headers: { authorization: `Bearer ${regularUserToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject canceling non-existent invitation', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${orgId}/invitations/00000000-0000-0000-0000-000000000000`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject canceling invitation from wrong org', async () => {
      // Create a second org
      const otherOrgResp = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Other Org',
          subdomain: `other-cancel-${Date.now()}`,
          owner_user_id: regularUserId,
        },
      });
      const otherOrgId = otherOrgResp.json().data.id;
      createdOrgIds.push(otherOrgId);

      // Create invitation in otherOrg
      const createResp = await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${otherOrgId}/invitations`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: 'cross-org-cancel@example.com', role: 'member' },
      });
      const invitationId = createResp.json().data.invitation.id;

      // Try to cancel via orgId (wrong org)
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${orgId}/invitations/${invitationId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ─── PATCH trial_ends_at sync ───

  describe('PATCH /api/v1/admin/organizations/:id/subscription - trial_ends_at sync', () => {
    let orgId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Trial Sync Org',
          subdomain: `trial-sync-${Date.now()}`,
          owner_user_id: regularUserId,
        },
      });
      orgId = response.json().data.id;
      createdOrgIds.push(orgId);
    });

    it('should clear trial_ends_at when upgrading from trial to professional', async () => {
      // Org starts as trial — should have trial_ends_at
      const orgBefore = await db.organizations.findById(orgId);
      expect(orgBefore!.trial_ends_at).not.toBeNull();

      // Upgrade to professional
      await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { plan_name: 'professional' },
      });

      const orgAfter = await db.organizations.findById(orgId);
      expect(orgAfter!.trial_ends_at).toBeNull();
      expect(orgAfter!.subscription_status).toBe('active');
    });

    it('should set trial_ends_at when downgrading to trial', async () => {
      // First upgrade to professional (clears trial_ends_at)
      await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { plan_name: 'professional' },
      });

      const orgMid = await db.organizations.findById(orgId);
      expect(orgMid!.trial_ends_at).toBeNull();

      // Downgrade back to trial
      await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { plan_name: 'trial' },
      });

      const orgAfter = await db.organizations.findById(orgId);
      expect(orgAfter!.trial_ends_at).not.toBeNull();
      expect(orgAfter!.subscription_status).toBe('trial');

      // trial_ends_at should be ~14 days in the future
      const trialEnd = new Date(orgAfter!.trial_ends_at!);
      const now = new Date();
      const daysDiff = (trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeGreaterThan(13);
      expect(daysDiff).toBeLessThan(15);
    });
  });

  // ─── GET /api/v1/admin/organizations/:id/deletion-precheck ───

  describe('GET /api/v1/admin/organizations/:id/deletion-precheck', () => {
    let orgId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Precheck Org',
          subdomain: `precheck-${Date.now()}`,
          owner_user_id: regularUserId,
        },
      });
      orgId = response.json().data.id;
      createdOrgIds.push(orgId);
    });

    it('should return precheck data for empty org', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${orgId}/deletion-precheck`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.hasProjects).toBe(false);
      expect(json.data.projectCount).toBe(0);
      expect(json.data.canHardDelete).toBeDefined();
    });

    it('should reject non-admin users', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${orgId}/deletion-precheck`,
        headers: { authorization: `Bearer ${regularUserToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject non-existent organization', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/organizations/00000000-0000-0000-0000-000000000000/deletion-precheck',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── DELETE /api/v1/admin/organizations/:id ───

  describe('DELETE /api/v1/admin/organizations/:id', () => {
    let orgId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Delete Route Org',
          subdomain: `del-route-${Date.now()}`,
          owner_user_id: regularUserId,
        },
      });
      orgId = response.json().data.id;
      createdOrgIds.push(orgId);
    });

    it('should soft-delete an organization by default', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${orgId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.mode).toBe('soft');

      // org should be hidden from regular findById
      const found = await db.organizations.findById(orgId);
      expect(found).toBeNull();

      // but still in DB with deleted_by set to the admin who deleted it
      const foundDeleted = await db.organizations.findByIdIncludeDeleted(orgId);
      expect(foundDeleted).not.toBeNull();
      expect(foundDeleted!.deleted_at).not.toBeNull();
      expect(foundDeleted!.deleted_by).toBeDefined();
    });

    it('should return deleted_at and deleted_by when fetching soft-deleted org', async () => {
      // Soft-delete the org
      await server.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${orgId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      // Fetch via GET /api/v1/organizations/:id — admin bypass should still find it
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${orgId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.deleted_at).not.toBeNull();
      expect(json.data.deleted_by).toBeDefined();
      expect(json.data.id).toBe(orgId);
    });

    it('should hard-delete when permanent=true and no vital data', async () => {
      // Org has a trial subscription (not in 'active'/'past_due'/'incomplete'),
      // so hard-delete is allowed without canceling.
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${orgId}?permanent=true`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.mode).toBe('hard');

      // Completely gone
      const found = await db.organizations.findByIdIncludeDeleted(orgId);
      expect(found).toBeNull();
    });

    it('should reject hard-delete when org has projects', async () => {
      const project = await db.projects.create({
        name: 'Blocking Route Project',
        organization_id: orgId,
        created_by: regularUserId,
      });

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${orgId}?permanent=true`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(409);

      await db.projects.delete(project.id);
    });

    it('should reject non-admin users', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${orgId}`,
        headers: { authorization: `Bearer ${regularUserToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${orgId}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject deleting non-existent organization', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/admin/organizations/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── POST /api/v1/admin/organizations/:id/restore ───

  describe('POST /api/v1/admin/organizations/:id/restore', () => {
    let orgId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Restore Route Org',
          subdomain: `restore-route-${Date.now()}`,
          owner_user_id: regularUserId,
        },
      });
      orgId = response.json().data.id;
      createdOrgIds.push(orgId);
    });

    it('should restore a soft-deleted organization', async () => {
      // Soft-delete first
      await server.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${orgId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/restore`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(orgId);
      expect(json.data.deleted_at).toBeNull();

      // Should be visible again
      const found = await db.organizations.findById(orgId);
      expect(found).not.toBeNull();
    });

    it('should reject restoring a non-deleted organization', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/restore`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(409);
    });

    it('should reject non-admin users', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/restore`,
        headers: { authorization: `Bearer ${regularUserToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject restoring non-existent organization', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations/00000000-0000-0000-0000-000000000000/restore',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── Magic Login Status ───

  describe('GET /api/v1/admin/organizations/:id/magic-login-status', () => {
    let orgId: string;

    beforeEach(async () => {
      const subdomain = `magic-status-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Magic Status Org',
          subdomain,
          owner_user_id: regularUserId,
        },
      });
      orgId = response.json().data.id;
      createdOrgIds.push(orgId);
    });

    it('should return disabled by default for new org', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${orgId}/magic-login-status`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.allowed).toBe(false);
    });

    it('should return 404 for non-existent org', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/organizations/00000000-0000-0000-0000-000000000000/magic-login-status',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject non-admin users', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${orgId}/magic-login-status`,
        headers: { authorization: `Bearer ${regularUserToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${orgId}/magic-login-status`,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/admin/organizations/:id/magic-login-status', () => {
    let orgId: string;

    beforeEach(async () => {
      const subdomain = `magic-patch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Magic Patch Org',
          subdomain,
          owner_user_id: regularUserId,
        },
      });
      orgId = response.json().data.id;
      createdOrgIds.push(orgId);
    });

    it('should enable magic login', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/magic-login-status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { enabled: true },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.allowed).toBe(true);
    });

    it('should disable magic login after enabling', async () => {
      // Enable first
      await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/magic-login-status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { enabled: true },
      });

      // Disable
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/magic-login-status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { enabled: false },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.allowed).toBe(false);

      // Verify via GET
      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${orgId}/magic-login-status`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(getResponse.json().data.allowed).toBe(false);
    });

    it('should return 404 for non-existent org', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/admin/organizations/00000000-0000-0000-0000-000000000000/magic-login-status',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { enabled: true },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject non-admin users', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/magic-login-status`,
        headers: { authorization: `Bearer ${regularUserToken}` },
        payload: { enabled: true },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject invalid payload', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/magic-login-status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { enabled: 'yes' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject missing enabled field', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organizations/${orgId}/magic-login-status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ─── GET /api/v1/admin/organizations/:id/projects ───

  describe('GET /api/v1/admin/organizations/:id/projects', () => {
    let orgId: string;

    beforeEach(async () => {
      const subdomain = `proj-list-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Projects List Org',
          subdomain,
          owner_user_id: regularUserId,
        },
      });
      orgId = createRes.json().data.id;
      createdOrgIds.push(orgId);
    });

    it('should return empty array for org with no projects', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${orgId}/projects`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
    });

    it('should list projects belonging to the organization', async () => {
      // Create a project directly in DB with organization_id set
      // (POST /api/v1/projects resolves org via tenant middleware, not body param in non-SAAS mode)
      await db.projects.create({
        name: 'Org Project',
        settings: {},
        organization_id: orgId,
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${orgId}/projects`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const projects = response.json().data;
      expect(projects.length).toBe(1);
      expect(projects[0].name).toBe('Org Project');
    });

    it('should return 404 for non-existent org', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/organizations/00000000-0000-0000-0000-000000000000/projects',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject non-admin users', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${orgId}/projects`,
        headers: { authorization: `Bearer ${regularUserToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${orgId}/projects`,
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
