/**
 * Organization Schema Validation Tests
 * Tests Fastify request/response schema validation for organization endpoints
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage } from '../test-helpers.js';

describe('Organization Schema Validation', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let memberUser: { id: string; email: string };
  let ownerToken: string;
  let ownerEmail: string;
  let testOrg: { id: string };

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();
    server = await createServer({ db, storage, pluginRegistry });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    const timestamp = Date.now();

    // Create owner user
    ownerEmail = `schema-owner-${timestamp}@example.com`;
    const ownerResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: ownerEmail,
        password: 'password123',
      },
    });
    ownerToken = ownerResponse.json().data.access_token;

    // Create member user
    const memberResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `schema-member-${timestamp}@example.com`,
        password: 'password123',
      },
    });
    memberUser = memberResponse.json().data.user;

    // Create test organization
    const createOrgResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        name: `Schema Test Org ${timestamp}`,
        subdomain: `schema-org-${timestamp}`,
        data_residency_region: 'us',
      },
    });
    testOrg = createOrgResponse.json().data;
  });

  describe('POST /api/v1/organizations - createOrganization schema', () => {
    it('should reject invalid data_residency_region enum value', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/organizations',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          name: 'Invalid Region Org',
          subdomain: `invalid-region-${Date.now()}`,
          data_residency_region: 'invalid-region', // Not in enum
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
    });

    it('should accept all valid data_residency_region values', async () => {
      const validRegions = ['kz', 'rf', 'eu', 'us', 'global'];

      for (const region of validRegions) {
        const timestamp = Date.now();
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/organizations',
          headers: {
            authorization: `Bearer ${ownerToken}`,
          },
          payload: {
            name: `Test Org ${region}`,
            subdomain: `test-${region}-${timestamp}`,
            data_residency_region: region,
          },
        });

        expect(response.statusCode).toBe(201);
        const json = response.json();
        expect(json.data.data_residency_region).toBe(region);
      }
    });

    it('should reject subdomain that does not match pattern', async () => {
      const invalidSubdomains = [
        'ABC', // uppercase
        'a', // too short (min 3)
        'a-', // ends with dash
        '-a', // starts with dash
        // Note: 'a--b' is valid - consecutive hyphens are allowed in DNS
        'a b', // contains space
        'a_b', // contains underscore
      ];

      for (const subdomain of invalidSubdomains) {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/organizations',
          headers: {
            authorization: `Bearer ${ownerToken}`,
          },
          payload: {
            name: 'Test Org',
            subdomain: subdomain,
          },
        });

        expect(response.statusCode).toBe(400);
      }
    });

    it('should accept valid subdomain patterns', async () => {
      const validSubdomains = [
        `abc-${Date.now()}`,
        `test-org-123-${Date.now()}`,
        `a1b2c3-${Date.now()}`,
      ];

      for (const subdomain of validSubdomains) {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/organizations',
          headers: {
            authorization: `Bearer ${ownerToken}`,
          },
          payload: {
            name: 'Test Org',
            subdomain: subdomain,
          },
        });

        expect(response.statusCode).toBe(201);
      }
    });

    it('should require name and subdomain fields', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/organizations',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          // Missing required fields
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should enforce name length constraints', async () => {
      // Empty name (minLength: 1)
      const emptyResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/organizations',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          name: '',
          subdomain: `test-${Date.now()}`,
        },
      });
      expect(emptyResponse.statusCode).toBe(400);

      // Name too long (maxLength: 255)
      const longResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/organizations',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          name: 'a'.repeat(256),
          subdomain: `test-long-${Date.now()}`,
        },
      });
      expect(longResponse.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/organizations/:id/members - addMember schema', () => {
    it('should reject role=owner (only admin/member allowed)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: memberUser.id,
          role: 'owner', // Not allowed via API
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
    });

    it('should accept role=admin', async () => {
      const newUserResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: `admin-test-${Date.now()}@example.com`,
          password: 'password123',
        },
      });
      const newUserId = newUserResponse.json().data.user.id;

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: newUserId,
          role: 'admin',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.data.role).toBe('admin');
    });

    it('should accept role=member', async () => {
      const newUserResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: `member-test-${Date.now()}@example.com`,
          password: 'password123',
        },
      });
      const newUserId = newUserResponse.json().data.user.id;

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: newUserId,
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.data.role).toBe('member');
    });

    it('should reject invalid role enum value', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: memberUser.id,
          role: 'superadmin', // Not in enum
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require user_id and role fields', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          // Missing required fields
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should validate user_id is a UUID', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: 'not-a-uuid',
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Response schema validation', () => {
    it('should validate organizationSchema response includes required fields', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty('id');
      expect(json.data).toHaveProperty('name');
      expect(json.data).toHaveProperty('subdomain');
      expect(json.data).toHaveProperty('data_residency_region');
      expect(json.data).toHaveProperty('storage_region');
      expect(json.data).toHaveProperty('subscription_status');
      expect(json.data).toHaveProperty('created_at');
      expect(json.data).toHaveProperty('updated_at');
    });

    it('should validate memberSchema response includes all required fields', async () => {
      // Add a member first
      await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: memberUser.id,
          role: 'member',
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThan(0);

      const member = json.data[0];
      expect(member).toHaveProperty('id');
      expect(member).toHaveProperty('organization_id');
      expect(member).toHaveProperty('user_id');
      expect(member).toHaveProperty('role');
      expect(member).toHaveProperty('user_email'); // Required
      expect(member).toHaveProperty('created_at'); // Required
      expect(member).toHaveProperty('updated_at'); // Required

      // Validate role is one of the allowed enum values
      expect(['owner', 'admin', 'member']).toContain(member.role);

      // Validate user_email format
      expect(member.user_email).toMatch(/@/);
    });

    it('should validate subscription_status is a valid enum value', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      const validStatuses = ['trial', 'active', 'past_due', 'canceled', 'trial_expired'];
      expect(validStatuses).toContain(json.data.subscription_status);
    });

    it('should validate data_residency_region is a valid enum value or null', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      const validRegions = ['kz', 'rf', 'eu', 'us', 'global'];
      expect(validRegions).toContain(json.data.data_residency_region);
    });
  });

  describe('PATCH /api/v1/organizations/:id - updateOrganization schema', () => {
    it('should validate name length constraints', async () => {
      // Empty name
      const emptyResponse = await server.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          name: '',
        },
      });
      expect(emptyResponse.statusCode).toBe(400);

      // Too long name
      const longResponse = await server.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          name: 'a'.repeat(256),
        },
      });
      expect(longResponse.statusCode).toBe(400);
    });

    it('should require at least one property to update', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          // Empty payload
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should accept valid name update', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/${testOrg.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          name: 'Updated Organization Name',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.name).toBe('Updated Organization Name');
    });
  });

  describe('DELETE /api/v1/organizations/:id/members/:userId - removeMember schema', () => {
    it('should validate organization ID is UUID format', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/organizations/not-a-uuid/members/00000000-0000-0000-0000-000000000000',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect([400, 404]).toContain(response.statusCode);
    });

    it('should validate user ID is UUID format', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/organizations/${testOrg.id}/members/not-a-uuid`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect([400, 404]).toContain(response.statusCode);
    });

    it('should return success message on successful removal', async () => {
      // Add a member first
      const newUserResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: `member-to-remove-${Date.now()}@example.com`,
          password: 'password123',
        },
      });
      const newUserId = newUserResponse.json().data.user.id;

      await server.inject({
        method: 'POST',
        url: `/api/v1/organizations/${testOrg.id}/members`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        payload: {
          user_id: newUserId,
          role: 'member',
        },
      });

      // Remove the member
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/organizations/${testOrg.id}/members/${newUserId}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(204);
    });
  });

  describe('GET /api/v1/organizations - listOrganizationsSchema', () => {
    let adminToken: string;

    beforeEach(async () => {
      // Promote owner to platform admin for list access
      await db.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [ownerEmail]);

      // Re-login to get token with admin role
      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: ownerEmail,
          password: 'password123',
        },
      });

      expect(loginResponse.statusCode).toBe(200);
      adminToken = loginResponse.json().data.access_token;
    });

    describe('Query parameter defaults', () => {
      it('should apply default page=1 and limit=20 when not specified', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations',
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.pagination.page).toBe(1);
        expect(json.pagination.limit).toBe(20);
      });

      it('should accept custom page and limit values', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations?page=2&limit=10',
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.pagination.page).toBe(2);
        expect(json.pagination.limit).toBe(10);
      });
    });

    describe('Query parameter constraints', () => {
      it('should reject page < 1', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations?page=0',
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        });

        expect(response.statusCode).toBe(400);
      });

      it('should reject limit < 1', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations?limit=0',
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        });

        expect(response.statusCode).toBe(400);
      });

      it('should reject limit > 100', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations?limit=101',
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        });

        expect(response.statusCode).toBe(400);
      });

      it('should accept limit=100 (maximum allowed)', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations?limit=100',
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.pagination.limit).toBe(100);
      });
    });

    describe('Query parameter enums', () => {
      it('should reject invalid subscription_status value', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations?subscription_status=invalid',
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        });

        expect(response.statusCode).toBe(400);
      });

      it('should accept all valid subscription_status values', async () => {
        const validStatuses = ['trial', 'active', 'past_due', 'canceled', 'trial_expired'];

        for (const status of validStatuses) {
          const response = await server.inject({
            method: 'GET',
            url: `/api/v1/organizations?subscription_status=${status}`,
            headers: {
              authorization: `Bearer ${adminToken}`,
            },
          });

          expect(response.statusCode).toBe(200);
        }
      });

      it('should reject invalid data_residency_region value', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations?data_residency_region=invalid',
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        });

        expect(response.statusCode).toBe(400);
      });

      it('should accept all valid data_residency_region values', async () => {
        const validRegions = ['kz', 'rf', 'eu', 'us', 'global'];

        for (const region of validRegions) {
          const response = await server.inject({
            method: 'GET',
            url: `/api/v1/organizations?data_residency_region=${region}`,
            headers: {
              authorization: `Bearer ${adminToken}`,
            },
          });

          expect(response.statusCode).toBe(200);
        }
      });

      it('should accept search parameter', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations?search=test',
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
      });
    });

    describe('Response shape validation', () => {
      it('should include pagination object with all required fields', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations',
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();

        expect(json).toHaveProperty('pagination');
        expect(json.pagination).toHaveProperty('page');
        expect(json.pagination).toHaveProperty('limit');
        expect(json.pagination).toHaveProperty('total');
        expect(json.pagination).toHaveProperty('totalPages');

        expect(typeof json.pagination.page).toBe('number');
        expect(typeof json.pagination.limit).toBe('number');
        expect(typeof json.pagination.total).toBe('number');
        expect(typeof json.pagination.totalPages).toBe('number');
      });

      it('should include member_count in each organization', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations',
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(Array.isArray(json.data)).toBe(true);

        if (json.data.length > 0) {
          const org = json.data[0];
          expect(org).toHaveProperty('member_count');
          expect(typeof org.member_count).toBe('number');
          expect(org.member_count).toBeGreaterThanOrEqual(0);
        }
      });

      it('should include all organization fields plus member_count', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations',
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();

        if (json.data.length > 0) {
          const org = json.data[0];

          // Standard organizationSchema fields
          expect(org).toHaveProperty('id');
          expect(org).toHaveProperty('name');
          expect(org).toHaveProperty('subdomain');
          expect(org).toHaveProperty('data_residency_region');
          expect(org).toHaveProperty('storage_region');
          expect(org).toHaveProperty('subscription_status');
          expect(org).toHaveProperty('created_at');
          expect(org).toHaveProperty('updated_at');

          // Additional field from organizationWithMemberCountSchema
          expect(org).toHaveProperty('member_count');
        }
      });

      it('should validate pagination calculations are correct', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations?limit=5',
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();

        const expectedTotalPages = Math.ceil(json.pagination.total / json.pagination.limit);
        expect(json.pagination.totalPages).toBe(expectedTotalPages);
      });

      it('should return data as array', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations',
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(Array.isArray(json.data)).toBe(true);
      });
    });
  });

  describe('GET /api/v1/organizations/me - myOrganizationsSchema', () => {
    it('should return array of organizations without pagination', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/organizations/me',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();

      // Should have data array but NO pagination object
      expect(json).toHaveProperty('data');
      expect(Array.isArray(json.data)).toBe(true);
      expect(json).not.toHaveProperty('pagination');
    });

    it('should include all standard organization fields', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/organizations/me',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.length).toBeGreaterThan(0);

      const org = json.data[0];
      expect(org).toHaveProperty('id');
      expect(org).toHaveProperty('name');
      expect(org).toHaveProperty('subdomain');
      expect(org).toHaveProperty('data_residency_region');
      expect(org).toHaveProperty('storage_region');
      expect(org).toHaveProperty('subscription_status');
      expect(org).toHaveProperty('created_at');
      expect(org).toHaveProperty('updated_at');
    });

    it('should NOT include member_count in response', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/organizations/me',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();

      if (json.data.length > 0) {
        const org = json.data[0];
        // myOrganizationsSchema uses organizationSchema, NOT organizationWithMemberCountSchema
        expect(org).not.toHaveProperty('member_count');
      }
    });

    it('should include success and timestamp fields', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/organizations/me',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();

      expect(json).toHaveProperty('success');
      expect(json.success).toBe(true);
      expect(json).toHaveProperty('timestamp');
      expect(typeof json.timestamp).toBe('string');
    });

    it('should validate organization enum fields', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/organizations/me',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();

      if (json.data.length > 0) {
        const org = json.data[0];

        const validStatuses = ['trial', 'active', 'past_due', 'canceled', 'trial_expired'];
        expect(validStatuses).toContain(org.subscription_status);

        const validRegions = ['kz', 'rf', 'eu', 'us', 'global'];
        expect(validRegions).toContain(org.data_residency_region);
      }
    });
  });
});
