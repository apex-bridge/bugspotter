/**
 * Organization Request Routes Integration Tests
 * Tests for public submit/verify and admin approve/reject/delete flows.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage, createAdminUser } from '../test-helpers.js';

const TEST_DB_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';

function uniqueSubdomain(prefix = 'req') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    company_name: 'Test Corp',
    subdomain: uniqueSubdomain(),
    contact_name: 'John Doe',
    contact_email: `john-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
    message: 'We want to use BugSpotter',
    ...overrides,
  };
}

describe('Organization Request Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let adminToken: string;

  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    db = createDatabaseClient(TEST_DB_URL);
    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();
    server = await createServer({ db, storage, pluginRegistry });
    await server.ready();
  });

  afterAll(async () => {
    // Cleanup created requests
    for (const id of createdRequestIds) {
      try {
        await db.organizationRequests.delete(id);
      } catch {
        // Ignore
      }
    }
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    const admin = await createAdminUser(server, db, 'org-req');
    adminToken = admin.token;
  });

  // ─── PUBLIC: POST /api/v1/organization-requests ───

  describe('POST /api/v1/organization-requests', () => {
    it('should accept a valid submission and return 201', async () => {
      const payload = validPayload();

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/organization-requests',
        payload,
        remoteAddress: '10.0.0.1',
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.message).toContain('Verification email sent');

      // Verify it was stored
      const stored = await db.organizationRequests.findPendingByEmail(payload.contact_email);
      expect(stored).not.toBeNull();
      expect(stored!.company_name).toBe('Test Corp');
      expect(stored!.status).toBe('pending_verification');
      createdRequestIds.push(stored!.id);
    });

    it('should reject missing required fields', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/organization-requests',
        payload: { company_name: 'Test' }, // missing subdomain, contact_name, contact_email
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid subdomain format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/organization-requests',
        payload: validPayload({ subdomain: 'INVALID SUBDOMAIN!' }),
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject taken subdomain with 400', async () => {
      // Create an organization first
      const admin = await createAdminUser(server, db, 'subdomain-test');
      const subdomain = uniqueSubdomain('taken');

      const orgResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: { authorization: `Bearer ${admin.token}` },
        payload: {
          name: 'Subdomain Org',
          subdomain,
          owner_user_id: admin.user.id,
        },
      });
      const orgId = orgResponse.json().data?.id;

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/organization-requests',
        payload: validPayload({ subdomain }),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('subdomain');

      // Cleanup in FK-safe order
      if (orgId) {
        try {
          await db.query('DELETE FROM organization_invitations WHERE organization_id = $1', [
            orgId,
          ]);
          await db.query('DELETE FROM organization_members WHERE organization_id = $1', [orgId]);
          await db.query('DELETE FROM subscriptions WHERE organization_id = $1', [orgId]);
          await db.query('DELETE FROM organizations WHERE id = $1', [orgId]);
        } catch {
          // Ignore
        }
      }
    });

    it('should silently reject honeypot-filled submissions (still returns 201)', async () => {
      const payload = validPayload({ website: 'http://spam.example.com' });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/organization-requests',
        payload,
        remoteAddress: '10.0.0.2',
      });

      // Returns 201 to not reveal rejection to bots
      expect(response.statusCode).toBe(201);

      // But nothing should be stored
      const stored = await db.organizationRequests.findPendingByEmail(payload.contact_email);
      expect(stored).toBeNull();
    });

    it('should reject duplicate pending request for same email', async () => {
      const email = `dup-${Date.now()}@example.com`;
      const payload1 = validPayload({ contact_email: email });

      // First submission succeeds
      const r1 = await server.inject({
        method: 'POST',
        url: '/api/v1/organization-requests',
        payload: payload1,
        remoteAddress: '10.0.0.3',
      });
      expect(r1.statusCode).toBe(201);

      const stored = await db.organizationRequests.findPendingByEmail(email);
      if (stored) {
        createdRequestIds.push(stored.id);
      }

      // Second submission with same email — silently rejected (201 returned)
      const r2 = await server.inject({
        method: 'POST',
        url: '/api/v1/organization-requests',
        payload: validPayload({ contact_email: email }),
        remoteAddress: '10.0.0.4',
      });
      expect(r2.statusCode).toBe(201);
    });
  });

  // ─── PUBLIC: POST /api/v1/organization-requests/verify-email ───

  describe('POST /api/v1/organization-requests/verify-email', () => {
    it('should verify email with valid token', async () => {
      // Create a request directly with known token
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

      const request = await db.organizationRequests.create({
        company_name: 'Verify Corp',
        subdomain: uniqueSubdomain('verify'),
        contact_name: 'Jane',
        contact_email: `verify-${Date.now()}@example.com`,
        verification_token: hashedToken,
        ip_address: '10.0.0.5',
      });
      createdRequestIds.push(request.id);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/organization-requests/verify-email',
        payload: { token: rawToken },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.message).toContain('verified');

      // Check DB state
      const updated = await db.organizationRequests.findById(request.id);
      expect(updated!.status).toBe('verified');
      expect(updated!.email_verified_at).not.toBeNull();
    });

    it('should reject invalid token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/organization-requests/verify-email',
        payload: { token: 'invalid-token-that-does-not-exist' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject expired token', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

      const request = await db.organizationRequests.create({
        company_name: 'Expired Corp',
        subdomain: uniqueSubdomain('expird'),
        contact_name: 'Expired',
        contact_email: `expired-${Date.now()}@example.com`,
        verification_token: hashedToken,
        ip_address: '10.0.0.22',
      });
      createdRequestIds.push(request.id);

      // Backdate created_at to 25 hours ago (past 24h TTL)
      await db.query(
        `UPDATE saas.organization_requests SET created_at = NOW() - interval '25 hours' WHERE id = $1`,
        [request.id]
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/organization-requests/verify-email',
        payload: { token: rawToken },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('expired');

      // Verify status was set to expired
      const updated = await db.organizationRequests.findById(request.id);
      expect(updated!.status).toBe('expired');
    });

    it('should handle already-verified request gracefully', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

      const request = await db.organizationRequests.create({
        company_name: 'Already Verified',
        subdomain: uniqueSubdomain('alrdy'),
        contact_name: 'Already',
        contact_email: `already-${Date.now()}@example.com`,
        verification_token: hashedToken,
        ip_address: '10.0.0.6',
      });
      createdRequestIds.push(request.id);

      // Verify once
      await db.organizationRequests.updateStatus(request.id, 'verified', {
        email_verified_at: new Date(),
      });

      // Try to verify again
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/organization-requests/verify-email',
        payload: { token: rawToken },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().message).toContain('already verified');
    });
  });

  // ─── ADMIN: GET /api/v1/admin/organization-requests ───

  describe('GET /api/v1/admin/organization-requests', () => {
    it('should list requests for admin', async () => {
      // Seed a request
      const request = await db.organizationRequests.create({
        company_name: 'List Corp',
        subdomain: uniqueSubdomain('list'),
        contact_name: 'Lister',
        contact_email: `list-${Date.now()}@example.com`,
        verification_token: crypto.randomBytes(32).toString('hex'),
        ip_address: '10.0.0.7',
        status: 'verified',
      });
      createdRequestIds.push(request.id);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/organization-requests?status=verified',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeInstanceOf(Array);
      expect(json.pagination).toBeDefined();
      expect(json.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it('should reject unauthenticated request', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/organization-requests',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject non-admin user', async () => {
      // Register a regular user
      const regResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: `nonadmin-${Date.now()}@example.com`,
          password: 'password123',
        },
      });
      const userToken = regResponse.json().data.access_token;

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/organization-requests',
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ─── ADMIN: GET /api/v1/admin/organization-requests/:id ───

  describe('GET /api/v1/admin/organization-requests/:id', () => {
    it('should get a single request by ID', async () => {
      const request = await db.organizationRequests.create({
        company_name: 'Detail Corp',
        subdomain: uniqueSubdomain('detail'),
        contact_name: 'Detailer',
        contact_email: `detail-${Date.now()}@example.com`,
        verification_token: crypto.randomBytes(32).toString('hex'),
        ip_address: '10.0.0.8',
      });
      createdRequestIds.push(request.id);

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/admin/organization-requests/${request.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.company_name).toBe('Detail Corp');
    });

    it('should return 404 for non-existent request', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/admin/organization-requests/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── ADMIN: PATCH /api/v1/admin/organization-requests/:id/approve ───

  describe('PATCH /api/v1/admin/organization-requests/:id/approve', () => {
    it('should approve a verified request and create organization', async () => {
      const orgReq = await db.organizationRequests.create({
        company_name: 'Approve Corp',
        subdomain: uniqueSubdomain('approve'),
        contact_name: 'Approver',
        contact_email: `approve-${Date.now()}@example.com`,
        verification_token: crypto.randomBytes(32).toString('hex'),
        ip_address: '10.0.0.9',
        status: 'verified',
      });
      let orgId: string | undefined;

      try {
        const response = await server.inject({
          method: 'PATCH',
          url: `/api/v1/admin/organization-requests/${orgReq.id}/approve`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { admin_notes: 'Looks good' },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        orgId = json.data.organization_id;
        expect(json.data.status).toBe('approved');
        expect(orgId).toBeDefined();
        expect(json.data.admin_notes).toBe('Looks good');
        expect(json.data.reviewed_by).toBeDefined();
      } finally {
        // Cleanup in FK-safe order — must run immediately to avoid blocking
        // parallel test files that do DELETE FROM users
        try {
          await db.organizationRequests.delete(orgReq.id);
        } catch {
          /* ignore */
        }
        if (orgId) {
          try {
            await db.query('DELETE FROM organization_invitations WHERE organization_id = $1', [
              orgId,
            ]);
            await db.query('DELETE FROM organization_members WHERE organization_id = $1', [orgId]);
            await db.query('DELETE FROM subscriptions WHERE organization_id = $1', [orgId]);
            await db.query('DELETE FROM organizations WHERE id = $1', [orgId]);
          } catch {
            /* ignore */
          }
        }
      }
    });

    it('should return 404 for non-existent request', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/admin/organization-requests/00000000-0000-0000-0000-000000000000/approve',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject approval of non-verified request', async () => {
      const request = await db.organizationRequests.create({
        company_name: 'Not Verified Corp',
        subdomain: uniqueSubdomain('notver'),
        contact_name: 'NotVer',
        contact_email: `notver-${Date.now()}@example.com`,
        verification_token: crypto.randomBytes(32).toString('hex'),
        ip_address: '10.0.0.10',
        // status defaults to 'pending_verification'
      });
      createdRequestIds.push(request.id);

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organization-requests/${request.id}/approve`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });

      expect(response.statusCode).toBe(409);
    });
  });

  // ─── ADMIN: PATCH /api/v1/admin/organization-requests/:id/reject ───

  describe('PATCH /api/v1/admin/organization-requests/:id/reject', () => {
    it('should reject a request with reason', async () => {
      const request = await db.organizationRequests.create({
        company_name: 'Reject Corp',
        subdomain: uniqueSubdomain('reject'),
        contact_name: 'Rejecter',
        contact_email: `reject-${Date.now()}@example.com`,
        verification_token: crypto.randomBytes(32).toString('hex'),
        ip_address: '10.0.0.11',
        status: 'verified',
      });
      createdRequestIds.push(request.id);

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organization-requests/${request.id}/reject`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { rejection_reason: 'Insufficient information' },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.status).toBe('rejected');
      expect(json.data.rejection_reason).toBe('Insufficient information');
      expect(json.data.reviewed_by).toBeDefined();
    });

    it('should require rejection_reason', async () => {
      const request = await db.organizationRequests.create({
        company_name: 'No Reason Corp',
        subdomain: uniqueSubdomain('noreason'),
        contact_name: 'NoReason',
        contact_email: `noreason-${Date.now()}@example.com`,
        verification_token: crypto.randomBytes(32).toString('hex'),
        ip_address: '10.0.0.12',
        status: 'verified',
      });
      createdRequestIds.push(request.id);

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organization-requests/${request.id}/reject`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {}, // missing rejection_reason
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject a pending_verification request', async () => {
      const request = await db.organizationRequests.create({
        company_name: 'Pending Reject Corp',
        subdomain: uniqueSubdomain('penrej'),
        contact_name: 'PenRej',
        contact_email: `penrej-${Date.now()}@example.com`,
        verification_token: crypto.randomBytes(32).toString('hex'),
        ip_address: '10.0.0.20',
        // status defaults to 'pending_verification'
      });
      createdRequestIds.push(request.id);

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organization-requests/${request.id}/reject`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { rejection_reason: 'Spam submission' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.status).toBe('rejected');
    });

    it('should not allow rejecting a claimed (in-progress approval) request', async () => {
      const request = await db.organizationRequests.create({
        company_name: 'Claimed Corp',
        subdomain: uniqueSubdomain('claimed'),
        contact_name: 'Claimed',
        contact_email: `claimed-${Date.now()}@example.com`,
        verification_token: crypto.randomBytes(32).toString('hex'),
        ip_address: '10.0.0.21',
        status: 'verified',
      });
      createdRequestIds.push(request.id);

      // Simulate another admin claiming the request for approval
      await db.query(
        `UPDATE saas.organization_requests SET reviewed_by = $2, reviewed_at = NOW() WHERE id = $1`,
        [request.id, (await createAdminUser(server, db, 'claimer')).user.id]
      );

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organization-requests/${request.id}/reject`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { rejection_reason: 'Should not work' },
      });

      expect(response.statusCode).toBe(409);
    });

    it('should return 404 for non-existent request', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/admin/organization-requests/00000000-0000-0000-0000-000000000000/reject',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { rejection_reason: 'Does not exist' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should not allow rejecting an already-approved request', async () => {
      const request = await db.organizationRequests.create({
        company_name: 'Already Approved',
        subdomain: uniqueSubdomain('alrappr'),
        contact_name: 'AlrAppr',
        contact_email: `alrappr-${Date.now()}@example.com`,
        verification_token: crypto.randomBytes(32).toString('hex'),
        ip_address: '10.0.0.13',
        status: 'approved',
      });
      createdRequestIds.push(request.id);

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/admin/organization-requests/${request.id}/reject`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { rejection_reason: 'Too late' },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  // ─── ADMIN: DELETE /api/v1/admin/organization-requests/:id ───

  describe('DELETE /api/v1/admin/organization-requests/:id', () => {
    it('should delete a spam request', async () => {
      const request = await db.organizationRequests.create({
        company_name: 'Spam Corp',
        subdomain: uniqueSubdomain('spam'),
        contact_name: 'Spammer',
        contact_email: `spam-${Date.now()}@example.com`,
        verification_token: crypto.randomBytes(32).toString('hex'),
        ip_address: '10.0.0.14',
        spam_score: 100,
      });

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organization-requests/${request.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(204);

      // Verify it's gone
      const deleted = await db.organizationRequests.findById(request.id);
      expect(deleted).toBeNull();
    });

    it('should not delete an approved request', async () => {
      const request = await db.organizationRequests.create({
        company_name: 'Approved Corp',
        subdomain: uniqueSubdomain('appdel'),
        contact_name: 'AppDel',
        contact_email: `appdel-${Date.now()}@example.com`,
        verification_token: crypto.randomBytes(32).toString('hex'),
        ip_address: '10.0.0.15',
        status: 'approved',
      });
      createdRequestIds.push(request.id);

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organization-requests/${request.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(409);
    });

    it('should return 404 for non-existent request', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/admin/organization-requests/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
