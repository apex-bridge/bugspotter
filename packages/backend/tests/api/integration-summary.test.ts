/**
 * Tests for `GET /api/v1/integrations/summary`.
 *
 * The QuickSetup CTA in the admin UI used to read integration count
 * from `GET /api/v1/admin/integrations`, which is platform-admin-only
 * and silently 403s for org owners — leaving the "Connect Jira" CTA
 * stuck on "0 integrations" forever even after the user connected
 * Jira. This route is the org-admin-accessible replacement; tests pin:
 *
 *   1. Empty org returns zero counts (the predicate's "no integrations
 *      yet, show CTA" base case).
 *   2. After creating an enabled project_integration, total + per-type
 *      count both reflect it.
 *   3. Disabled integrations don't count (CTA should re-appear if the
 *      user disabled their only integration).
 *   4. An org owner only sees their own org's integrations — no
 *      cross-tenant leak via this endpoint (PR #115's security boundary
 *      doesn't apply here directly because this endpoint isn't
 *      `?organization_id=`-filterable; the projection through
 *      `getUserAccessibleProjects` is the guard).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { resetDeploymentConfig } from '../../src/saas/config.js';
import { createMockPluginRegistry, createMockStorage, createAdminUser } from '../test-helpers.js';

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

    const owner = await createAdminUser(server, db, 'integ-summary');
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

  function call() {
    return server.inject({
      method: 'GET',
      url: '/api/v1/integrations/summary',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        host: `${orgSubdomain}.example.com`,
      },
    });
  }

  it('returns zero counts when the org has no integrations', async () => {
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ total: 0, by_platform: {} });
  });

  it('counts an enabled project integration', async () => {
    await db.projectIntegrations.upsert(projectId, 'jira', {
      enabled: true,
      config: { projectKey: 'KAN' },
      encrypted_credentials: '',
    });

    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ total: 1, by_platform: { jira: 1 } });
  });

  it('does not count disabled integrations', async () => {
    await db.projectIntegrations.upsert(projectId, 'jira', {
      enabled: false,
      config: { projectKey: 'KAN' },
      encrypted_credentials: '',
    });

    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ total: 0, by_platform: {} });
  });

  it('does not leak integrations from other organizations', async () => {
    // Create a separate org with its own project + Jira integration.
    // Our owner is NOT a member, so the summary should ignore it.
    const otherOrg = await db.organizations.create({
      name: 'Other Org',
      subdomain: `other-${Date.now()}`,
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

    const res = await call();
    expect(res.statusCode).toBe(200);
    // Owner is not a member of `otherOrg`, so its project isn't in
    // `getUserAccessibleProjects` → its Jira integration shouldn't
    // surface in the summary.
    expect(res.json().data).toEqual({ total: 0, by_platform: {} });
  });
});
