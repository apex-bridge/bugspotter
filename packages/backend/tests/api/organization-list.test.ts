/**
 * Organization List API Tests
 * Tests for GET /api/v1/organizations (admin list) and GET /api/v1/organizations/me (user's orgs)
 * Covers authorization, pagination, filtering, and membership query behavior
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage } from '../test-helpers.js';
import { ORG_MEMBER_ROLE, SUBSCRIPTION_STATUS } from '../../src/db/types.js';

describe('Organization List API', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;

  // Test users
  let platformAdmin: { id: string; email: string; token: string };
  let regularUser: { id: string; email: string; token: string };
  let anotherUser: { id: string; email: string; token: string };

  // Test organizations
  let org1: { id: string; subdomain: string };
  let org2: { id: string; subdomain: string };
  let org3: { id: string; subdomain: string };

  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();
    server = await createServer({ db, storage, pluginRegistry });
    await server.ready();
  });

  afterAll(async () => {
    // Cleanup created organizations
    for (const orgId of createdOrgIds) {
      try {
        await db.organizations.delete(orgId);
      } catch {
        // Ignore cleanup errors
      }
    }

    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    const timestamp = Date.now();

    // Create platform admin user
    const adminResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `admin-list-${timestamp}@example.com`,
        password: 'password123',
      },
    });
    const adminUserId = adminResponse.json().data.user.id;

    // Promote to admin BEFORE getting token
    await db.users.update(adminUserId, { role: 'admin' });

    // Login to get token with correct role
    const loginResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: `admin-list-${timestamp}@example.com`,
        password: 'password123',
      },
    });
    platformAdmin = {
      id: adminUserId,
      email: `admin-list-${timestamp}@example.com`,
      token: loginResponse.json().data.access_token,
    };

    // Create regular user
    const userResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `user-list-${timestamp}@example.com`,
        password: 'password123',
      },
    });
    regularUser = {
      ...userResponse.json().data.user,
      token: userResponse.json().data.access_token,
    };

    // Create another user for membership testing
    const anotherResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `another-${timestamp}@example.com`,
        password: 'password123',
      },
    });
    anotherUser = {
      ...anotherResponse.json().data.user,
      token: anotherResponse.json().data.access_token,
    };

    // Create test organizations
    const createOrg1 = await server.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: {
        authorization: `Bearer ${platformAdmin.token}`,
      },
      payload: {
        name: `Test Org Alpha ${timestamp}`,
        subdomain: `alpha-${timestamp}`,
        data_residency_region: 'us',
      },
    });
    org1 = createOrg1.json().data;
    createdOrgIds.push(org1.id);

    const createOrg2 = await server.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: {
        authorization: `Bearer ${regularUser.token}`,
      },
      payload: {
        name: `Test Org Beta ${timestamp}`,
        subdomain: `beta-${timestamp}`,
        data_residency_region: 'eu',
      },
    });
    org2 = createOrg2.json().data;
    createdOrgIds.push(org2.id);

    const createOrg3 = await server.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: {
        authorization: `Bearer ${anotherUser.token}`,
      },
      payload: {
        name: `Test Org Gamma ${timestamp}`,
        subdomain: `gamma-${timestamp}`,
        data_residency_region: 'us',
      },
    });
    org3 = createOrg3.json().data;
    createdOrgIds.push(org3.id);

    // Add regularUser as member to org3
    await server.inject({
      method: 'POST',
      url: `/api/v1/organizations/${org3.id}/members`,
      headers: {
        authorization: `Bearer ${anotherUser.token}`,
      },
      payload: {
        user_id: regularUser.id,
        role: ORG_MEMBER_ROLE.MEMBER,
      },
    });
  });

  describe('GET /api/v1/organizations - Admin List', () => {
    describe('Authorization', () => {
      it('should require authentication', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations',
        });

        expect(response.statusCode).toBe(401);
      });

      it('should require admin role', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations',
          headers: {
            authorization: `Bearer ${regularUser.token}`,
          },
        });

        expect(response.statusCode).toBe(403);
        const json = response.json();
        expect(json.success).toBe(false);
        // Error structure varies - just check it exists
        expect(json.error || json.message).toBeDefined();
      });

      it('should allow admin to list organizations', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations',
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.success).toBe(true);
        expect(Array.isArray(json.data)).toBe(true);
      });
    });

    describe('Pagination', () => {
      it('should return paginated results with default pagination', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations',
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(Array.isArray(json.data)).toBe(true);
        expect(json).toHaveProperty('pagination');
        expect(json.pagination).toHaveProperty('page');
        expect(json.pagination).toHaveProperty('limit');
        expect(json.pagination).toHaveProperty('total');
        expect(json.pagination).toHaveProperty('totalPages');
      });

      it('should accept custom page parameter', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations?page=2',
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.pagination.page).toBe(2);
      });

      it('should accept custom limit parameter', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations?limit=5',
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.pagination.limit).toBe(5);
      });

      it('should enforce maximum limit (100)', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations?limit=200',
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(400); // Schema validation rejects limit > 100
      });
    });

    describe('Filtering', () => {
      it('should filter by search query (name)', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations?search=Alpha',
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.length).toBeGreaterThan(0);
        const foundOrg = json.data.find((o: any) => o.id === org1.id);
        expect(foundOrg).toBeDefined();
      });

      it('should filter by search query (subdomain)', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations?search=${org2.subdomain}`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.length).toBeGreaterThan(0);
        const foundOrg = json.data.find((o: any) => o.id === org2.id);
        expect(foundOrg).toBeDefined();
      });

      it('should filter by subscription_status', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations?subscription_status=${SUBSCRIPTION_STATUS.TRIAL}`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        // All test orgs start as trial
        expect(json.data.length).toBeGreaterThan(0);
        json.data.forEach((org: any) => {
          expect(org.subscription_status).toBe(SUBSCRIPTION_STATUS.TRIAL);
        });
      });

      it('should filter by data_residency_region', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations?data_residency_region=us',
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.length).toBeGreaterThan(0);
        json.data.forEach((org: any) => {
          expect(org.data_residency_region).toBe('us');
        });
      });

      it('should combine multiple filters', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations?data_residency_region=us&subscription_status=${SUBSCRIPTION_STATUS.TRIAL}`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        json.data.forEach((org: any) => {
          expect(org.data_residency_region).toBe('us');
          expect(org.subscription_status).toBe(SUBSCRIPTION_STATUS.TRIAL);
        });
      });

      it('should exclude soft-deleted organizations by default', async () => {
        // Soft-delete org1
        await db.organizations.softDelete(org1.id, platformAdmin.id);

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations?search=${org1.subdomain}`,
          headers: { authorization: `Bearer ${platformAdmin.token}` },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.find((o: any) => o.id === org1.id)).toBeUndefined();

        // Restore for other tests
        await db.organizations.restore(org1.id);
      });

      it('should include soft-deleted organizations when include_deleted=true', async () => {
        // Soft-delete org1
        await db.organizations.softDelete(org1.id, platformAdmin.id);

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations?search=${org1.subdomain}&include_deleted=true`,
          headers: { authorization: `Bearer ${platformAdmin.token}` },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        const found = json.data.find((o: any) => o.id === org1.id);
        expect(found).toBeDefined();
        expect(found.deleted_at).not.toBeNull();
        expect(found.deleted_by).toBe(platformAdmin.id);

        // Restore for other tests
        await db.organizations.restore(org1.id);
      });

      it('should return empty results for no matches', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations?search=nonexistent-org-xyz-12345',
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data).toEqual([]);
        expect(json.pagination.total).toBe(0);
      });
    });

    describe('Response Format', () => {
      it('should include member_count for each organization', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations',
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.length).toBeGreaterThan(0);
        json.data.forEach((org: any) => {
          expect(org).toHaveProperty('member_count');
          expect(typeof org.member_count).toBe('number');
          expect(org.member_count).toBeGreaterThanOrEqual(1); // At least owner
        });
      });

      it('should show correct member count (org with 2 members)', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations?search=${org3.subdomain}`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        const foundOrg = json.data.find((o: any) => o.id === org3.id);
        expect(foundOrg).toBeDefined();
        expect(foundOrg.member_count).toBe(2); // owner + regularUser
      });

      it('should include all organization fields', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations',
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
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
    });
  });

  describe('GET /api/v1/organizations/me - User Organizations', () => {
    describe('Authorization', () => {
      it('should require authentication', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations/me',
        });

        expect(response.statusCode).toBe(401);
      });

      it('should allow any authenticated user', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations/me',
          headers: {
            authorization: `Bearer ${regularUser.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
      });
    });

    describe('Membership Query', () => {
      it('should return only organizations where user is a member', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations/me',
          headers: {
            authorization: `Bearer ${regularUser.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(Array.isArray(json.data)).toBe(true);

        // regularUser is owner of org2 and member of org3
        expect(json.data.length).toBe(2);
        const orgIds = json.data.map((o: any) => o.id);
        expect(orgIds).toContain(org2.id);
        expect(orgIds).toContain(org3.id);
        expect(orgIds).not.toContain(org1.id);
      });

      it('should return organizations where user is owner', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations/me',
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        const orgIds = json.data.map((o: any) => o.id);
        expect(orgIds).toContain(org1.id); // platformAdmin is owner
      });

      it('should return empty array for users with no organization memberships', async () => {
        // Create new user with no org memberships
        const timestamp = Date.now();
        const newUserResponse = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: {
            email: `nomembership-${timestamp}@example.com`,
            password: 'password123',
          },
        });
        const newUserToken = newUserResponse.json().data.access_token;

        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations/me',
          headers: {
            authorization: `Bearer ${newUserToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data).toEqual([]);
      });

      it('should include all organization fields', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations/me',
          headers: {
            authorization: `Bearer ${regularUser.token}`,
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

      it('should order results by organization name (ascending)', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations/me',
          headers: {
            authorization: `Bearer ${regularUser.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.length).toBe(2);

        const names = json.data.map((o: any) => o.name);
        const sortedNames = [...names].sort();
        expect(names).toEqual(sortedNames);
      });
    });

    describe('Response Format', () => {
      it('should return array directly (not paginated)', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations/me',
          headers: {
            authorization: `Bearer ${regularUser.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(Array.isArray(json.data)).toBe(true);
        expect(json.data).not.toHaveProperty('pagination');
      });

      it('should wrap response in success envelope', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations/me',
          headers: {
            authorization: `Bearer ${regularUser.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json).toHaveProperty('success', true);
        expect(json).toHaveProperty('data');
      });
    });
  });

  describe('GET /api/v1/organizations/:id/quota - Quota Status', () => {
    describe('Authorization', () => {
      it('should require authentication', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/quota`,
        });

        expect(response.statusCode).toBe(401);
      });

      it('should require organization membership', async () => {
        // anotherUser is not a member of org1
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/quota`,
          headers: {
            authorization: `Bearer ${anotherUser.token}`,
          },
        });

        expect(response.statusCode).toBe(403);
        const json = response.json();
        expect(json.success).toBe(false);
      });

      it('should allow organization members', async () => {
        // regularUser is owner of org2
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org2.id}/quota`,
          headers: {
            authorization: `Bearer ${regularUser.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
      });

      it('should allow organization admins', async () => {
        // platformAdmin is owner of org1
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/quota`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
      });

      it('should allow regular members (not just owners)', async () => {
        // regularUser is member of org3
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org3.id}/quota`,
          headers: {
            authorization: `Bearer ${regularUser.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
      });
    });

    describe('Response Format', () => {
      it('should return quota status with plan, period, and resources', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/quota`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.success).toBe(true);
        expect(json.data).toHaveProperty('plan');
        expect(json.data).toHaveProperty('period');
        expect(json.data).toHaveProperty('resources');
      });

      it('should include current period start and end dates', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/quota`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.period).toHaveProperty('start');
        expect(json.data.period).toHaveProperty('end');
        expect(new Date(json.data.period.start)).toBeInstanceOf(Date);
        expect(new Date(json.data.period.end)).toBeInstanceOf(Date);
      });

      it('should include all resource types with current and limit', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/quota`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();

        const expectedResources = [
          'projects',
          'bug_reports',
          'storage_bytes',
          'api_calls',
          'screenshots',
          'session_replays',
        ];

        expectedResources.forEach((resource) => {
          expect(json.data.resources).toHaveProperty(resource);
          expect(json.data.resources[resource]).toHaveProperty('current');
          expect(json.data.resources[resource]).toHaveProperty('limit');
          expect(typeof json.data.resources[resource].current).toBe('number');
          expect(typeof json.data.resources[resource].limit).toBe('number');
        });
      });

      it('should show trial plan for new organizations', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/quota`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.plan).toBe('trial');
      });

      it('should return valid current usage (0 for new org)', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/quota`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();

        // New org should have 0 usage for most resources
        expect(json.data.resources.bug_reports.current).toBe(0);
        expect(json.data.resources.storage_bytes.current).toBe(0);
        expect(json.data.resources.api_calls.current).toBe(0);
        expect(json.data.resources.screenshots.current).toBe(0);
        expect(json.data.resources.session_replays.current).toBe(0);
      });
    });

    describe('Error Handling', () => {
      it('should return 404 for non-existent organization', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations/00000000-0000-0000-0000-000000000000/quota',
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(404);
      });

      it('should validate organization ID is UUID format', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations/not-a-uuid/quota',
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect([400, 404]).toContain(response.statusCode);
      });
    });
  });

  describe('GET /api/v1/organizations/:id/subscription - Subscription Details', () => {
    describe('Authorization', () => {
      it('should require authentication', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/subscription`,
        });

        expect(response.statusCode).toBe(401);
      });

      it('should require organization membership', async () => {
        // anotherUser is not a member of org1
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/subscription`,
          headers: {
            authorization: `Bearer ${anotherUser.token}`,
          },
        });

        expect(response.statusCode).toBe(403);
        const json = response.json();
        expect(json.success).toBe(false);
      });

      it('should allow organization members', async () => {
        // regularUser is owner of org2
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org2.id}/subscription`,
          headers: {
            authorization: `Bearer ${regularUser.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
      });

      it('should allow organization admins', async () => {
        // platformAdmin is owner of org1
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/subscription`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
      });

      it('should allow regular members (not just owners)', async () => {
        // regularUser is member of org3
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org3.id}/subscription`,
          headers: {
            authorization: `Bearer ${regularUser.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
      });
    });

    describe('Response Format', () => {
      it('should return subscription details with all required fields', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/subscription`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.success).toBe(true);
        expect(json.data).toHaveProperty('id');
        expect(json.data).toHaveProperty('organization_id');
        expect(json.data).toHaveProperty('plan_name');
        expect(json.data).toHaveProperty('status');
        expect(json.data).toHaveProperty('current_period_start');
        expect(json.data).toHaveProperty('current_period_end');
        expect(json.data).toHaveProperty('quotas');
        expect(json.data).toHaveProperty('created_at');
        expect(json.data).toHaveProperty('updated_at');
      });

      it('should show trial plan and status for new organizations', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/subscription`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.plan_name).toBe('trial');
        expect(json.data.status).toBe('trial');
      });

      it('should include valid period dates', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/subscription`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(new Date(json.data.current_period_start)).toBeInstanceOf(Date);
        expect(new Date(json.data.current_period_end)).toBeInstanceOf(Date);

        const periodStart = new Date(json.data.current_period_start);
        const periodEnd = new Date(json.data.current_period_end);
        expect(periodEnd.getTime()).toBeGreaterThan(periodStart.getTime());
      });

      it('should include quotas object', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/subscription`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.quotas).toBeDefined();
        expect(typeof json.data.quotas).toBe('object');
      });

      it('should match organization_id with requested org', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/subscription`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.organization_id).toBe(org1.id);
      });

      it('should have null Stripe IDs for trial subscriptions', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/subscription`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        expect(json.data.stripe_subscription_id).toBeUndefined();
        expect(json.data.stripe_customer_id).toBeUndefined();
      });

      it('should validate plan_name is valid enum value', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/subscription`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        const validPlans = ['trial', 'starter', 'professional', 'enterprise'];
        expect(validPlans).toContain(json.data.plan_name);
      });

      it('should validate status is valid enum value', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/organizations/${org1.id}/subscription`,
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const json = response.json();
        const validStatuses = [
          'trial',
          'active',
          'past_due',
          'canceled',
          'incomplete',
          'incomplete_expired',
          'paused',
        ];
        expect(validStatuses).toContain(json.data.status);
      });
    });

    describe('Error Handling', () => {
      it('should return 404 for non-existent organization', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations/00000000-0000-0000-0000-000000000000/subscription',
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect(response.statusCode).toBe(404);
      });

      it('should validate organization ID is UUID format', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/organizations/not-a-uuid/subscription',
          headers: {
            authorization: `Bearer ${platformAdmin.token}`,
          },
        });

        expect([400, 404]).toContain(response.statusCode);
      });
    });
  });
});
