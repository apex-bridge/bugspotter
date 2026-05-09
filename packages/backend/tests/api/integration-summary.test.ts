/**
 * Tests for `GET /api/v1/integrations/summary`.
 *
 * The QuickSetup CTA in the admin UI used to read integration count
 * from `GET /api/v1/admin/integrations`, which is platform-admin-only
 * and silently 403s for org owners — leaving the "Connect Jira" CTA
 * stuck on "0 integrations" forever even after the user connected
 * Jira. This route is the org-admin-accessible replacement.
 *
 * The handler has two branches by caller role:
 *   - Platform admin → `db.projects.findAll(orgScope)`. orgScope comes
 *     from the tenant subdomain (`request.organizationId`) or, on the
 *     hub domain, from `?organization_id=`.
 *   - Regular user → `db.projects.getUserAccessibleProjects(userId, orgId)`.
 *     The query param is intentionally NOT honored for them; their
 *     visible scope is whatever the tenant subdomain resolved.
 *
 * Both branches are exercised below. Crucially, the org-owner tests
 * use a `role: 'user'` user (otherwise `isPlatformAdmin()`'s legacy
 * `role === 'admin'` fallback would silently steer them through the
 * platform-admin branch and these tests would pass for the wrong
 * reason).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { resetDeploymentConfig } from '../../src/saas/config.js';
import { createMockPluginRegistry, createMockStorage, createAdminUser } from '../test-helpers.js';

/**
 * Create a regular (non-platform-admin) user with `role: 'user'`.
 * `createAdminUser` from test-helpers.ts uses `role: 'admin'`, which
 * `isPlatformAdmin()` accepts via the legacy fallback — wrong shape
 * for tests that want to exercise the org-owner branch.
 */
async function createRegularUser(
  server: FastifyInstance,
  db: DatabaseClient,
  emailPrefix: string
): Promise<{ token: string; user: { id: string; email: string } }> {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(7);
  const passwordHash = await bcrypt.hash('password123', 10);
  const user = await db.users.create({
    email: `${emailPrefix}-${timestamp}-${randomId}@example.com`,
    password_hash: passwordHash,
    role: 'user',
  });
  const token = server.jwt.sign({ userId: user.id, role: 'user' }, { expiresIn: '1h' });
  return { token, user: { id: user.id, email: user.email } };
}

describe('GET /api/v1/integrations/summary', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let ownerToken: string;
  let ownerUserId: string;
  let orgId: string;
  let orgSubdomain: string;
  let projectId: string;

  const originalDeploymentMode = process.env.DEPLOYMENT_MODE;

  beforeAll(async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
    server = await createServer({
      db,
      storage: createMockStorage(),
      pluginRegistry: createMockPluginRegistry(),
    });
    await server.ready();
  });

  afterAll(async () => {
    if (originalDeploymentMode === undefined) {
      delete process.env.DEPLOYMENT_MODE;
    } else {
      process.env.DEPLOYMENT_MODE = originalDeploymentMode;
    }
    resetDeploymentConfig();
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);

    const owner = await createRegularUser(server, db, 'integ-summary-owner');
    ownerToken = owner.token;
    ownerUserId = owner.user.id;

    orgSubdomain = `summary-${timestamp}-${randomId}`;
    const org = await db.organizations.create({
      name: `Summary Org ${randomId}`,
      subdomain: orgSubdomain,
      subscription_status: 'trial',
    });
    orgId = org.id;

    const now = new Date();
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db.subscriptions.create({
      organization_id: orgId,
      plan_name: 'starter',
      status: 'trial',
      current_period_start: now,
      current_period_end: thirtyDaysLater,
      quotas: { max_projects: 10, max_bug_reports: 1000, max_storage_mb: 500 },
    });

    await db.organizationMembers.createWithUser(orgId, ownerUserId, 'owner');

    const project = await db.projects.create({
      name: `Summary Project ${randomId}`,
      organization_id: orgId,
      created_by: ownerUserId,
      settings: {},
    });
    projectId = project.id;
  });

  function callAsOwner() {
    return server.inject({
      method: 'GET',
      url: '/api/v1/integrations/summary',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        host: `${orgSubdomain}.example.com`,
      },
    });
  }

  describe('regular org user (the bug-fix path)', () => {
    it('returns zero counts when the org has no integrations', async () => {
      const res = await callAsOwner();
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ total: 0, by_platform: {} });
    });

    it('counts an enabled project integration', async () => {
      await db.projectIntegrations.upsert(projectId, 'jira', {
        enabled: true,
        config: { projectKey: 'KAN' },
        encrypted_credentials: '',
      });

      const res = await callAsOwner();
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ total: 1, by_platform: { jira: 1 } });
    });

    it('does not count `enabled=false` integrations', async () => {
      await db.projectIntegrations.upsert(projectId, 'jira', {
        enabled: false,
        config: { projectKey: 'KAN' },
        encrypted_credentials: '',
      });

      const res = await callAsOwner();
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ total: 0, by_platform: {} });
    });

    it('does not count soft-deleted integrations (`disabled_at` set)', async () => {
      // The repo aggregation excludes both `enabled = FALSE` AND
      // `disabled_at IS NOT NULL`. The previous test covers the former;
      // this one covers the latter. `upsert()` doesn't expose
      // `disabled_at`, so flip it directly via SQL after creating an
      // otherwise-enabled row.
      const inserted = await db.projectIntegrations.upsert(projectId, 'jira', {
        enabled: true,
        config: { projectKey: 'KAN' },
        encrypted_credentials: '',
      });
      await db.query(
        `UPDATE application.project_integrations
            SET disabled_at = CURRENT_TIMESTAMP, disabled_reason = 'test soft-delete'
          WHERE id = $1`,
        [inserted.id]
      );

      const res = await callAsOwner();
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ total: 0, by_platform: {} });
    });

    it('does not leak integrations from other organizations', async () => {
      // Create a separate org with its own project + Jira integration.
      // Our owner is NOT a member, so the summary should ignore it.
      const otherOrg = await db.organizations.create({
        name: 'Other Org',
        subdomain: `other-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        subscription_status: 'trial',
      });
      const otherProject = await db.projects.create({
        name: 'Other Project',
        organization_id: otherOrg.id,
        created_by: ownerUserId, // creator field; membership is what matters
        settings: {},
      });
      await db.projectIntegrations.upsert(otherProject.id, 'jira', {
        enabled: true,
        config: { projectKey: 'OTHER' },
        encrypted_credentials: '',
      });

      const res = await callAsOwner();
      expect(res.statusCode).toBe(200);
      // Owner is not a member of `otherOrg`, so its project isn't in
      // `getUserAccessibleProjects` → its Jira integration shouldn't
      // surface in the summary.
      expect(res.json().data).toEqual({ total: 0, by_platform: {} });
    });

    it('ignores `?organization_id=` from regular users (no scope-widening)', async () => {
      // Create a sibling org with an integration. The regular user's
      // attempt to widen scope to it via the query param must be a
      // no-op — they keep their tenant-subdomain scope (their own org,
      // which is empty).
      const sibling = await db.organizations.create({
        name: 'Sibling Org',
        subdomain: `sibling-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        subscription_status: 'trial',
      });
      const siblingProject = await db.projects.create({
        name: 'Sibling Project',
        organization_id: sibling.id,
        created_by: ownerUserId,
        settings: {},
      });
      await db.projectIntegrations.upsert(siblingProject.id, 'jira', {
        enabled: true,
        config: { projectKey: 'SIB' },
        encrypted_credentials: '',
      });

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/summary?organization_id=${sibling.id}`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
          host: `${orgSubdomain}.example.com`,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ total: 0, by_platform: {} });
    });
  });

  describe('platform admin', () => {
    it("on a tenant subdomain: sees that org's integrations", async () => {
      // Create platform admin (createAdminUser sets role:'admin' which
      // satisfies isPlatformAdmin via the legacy fallback). They're
      // hitting the test-org subdomain; tenant middleware sets
      // request.organizationId so the route's platform-admin branch
      // calls findAll(orgScope = test-org-id).
      const platformAdmin = await createAdminUser(server, db, 'integ-summary-platadmin');
      // Membership is required by the cross-tenant guard middleware
      // (admins of other orgs can't act on a foreign tenant subdomain).
      await db.organizationMembers.createWithUser(orgId, platformAdmin.user.id, 'admin');

      await db.projectIntegrations.upsert(projectId, 'jira', {
        enabled: true,
        config: { projectKey: 'KAN' },
        encrypted_credentials: '',
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/integrations/summary',
        headers: {
          authorization: `Bearer ${platformAdmin.token}`,
          host: `${orgSubdomain}.example.com`,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ total: 1, by_platform: { jira: 1 } });
    });

    it('on the hub domain: honors `?organization_id=` to query arbitrary orgs', async () => {
      const platformAdmin = await createAdminUser(server, db, 'integ-summary-hubadmin');

      await db.projectIntegrations.upsert(projectId, 'jira', {
        enabled: true,
        config: { projectKey: 'KAN' },
        encrypted_credentials: '',
      });

      // Hub domain: 2-part host so `extractSubdomain` returns null
      // and tenant middleware leaves `request.organizationId` unset.
      // (Anything with 3+ parts is treated as a tenant subdomain and
      // will 404 if no matching org exists — `hub.example.com` looks
      // like the subdomain `hub`, not the hub itself.) Platform admin
      // then uses `?organization_id=` to scope the lookup.
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/summary?organization_id=${orgId}`,
        headers: {
          authorization: `Bearer ${platformAdmin.token}`,
          host: 'example.com',
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ total: 1, by_platform: { jira: 1 } });
    });
  });
});
