/**
 * RBAC regression matrix for the api-keys + projects creation
 * surfaces, across both deployment modes.
 *
 * Origin: customer demo showed an org owner unable to create / delete
 * API keys and unable to create new projects in the admin UI. Root
 * cause was a naïve `request.authUser.role === 'viewer'` block in
 * three admin routes. The block is correct in selfhosted (where
 * customer users have system role `'user'` or `'admin'`) but
 * actively wrong in SaaS (where customer-tenant org owners carry
 * system role `'viewer'` by design — platform-admin is a BugSpotter-
 * staff concept). Fix consults `saas.organization_members` via
 * `userIsOrgAdminAnywhere` / `userIsOrgAdminOfOrg`.
 *
 * Both modes are exercised here because the gates behave differently:
 *   - SaaS: org-membership consulted, owners/admins of the TARGET org
 *     pass, cross-tenant escalation rejected.
 *   - Selfhosted: no org concept; system role 'viewer' is genuinely
 *     read-only, 'user' / 'admin' can create.
 *
 * Each 403 also asserts the response message so a future rename
 * surfaces clearly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../src/db/client.js';
import type { Organization, User } from '../../src/db/types.js';
import { BILLING_STATUS, PLAN_NAME } from '../../src/db/types.js';
import { resetDeploymentConfig } from '../../src/saas/config.js';
import { getQuotaForPlan } from '../../src/saas/plans.js';
import { createTestServerWithDb } from '../setup.integration.js';
import { TestCleanupTracker, generateUniqueId } from '../utils/test-utils.js';

interface TestActor {
  user: User;
  jwt: string;
  password: string;
}

// ---------------------------------------------------------------------
// SaaS mode
// ---------------------------------------------------------------------

describe('SaaS mode — RBAC for api-keys + projects creation', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  const cleanup = new TestCleanupTracker();
  let originalDeploymentMode: string | undefined;

  let org: Organization;
  let project: { id: string };

  // Actor permutations for the SaaS matrix. `viewerNoOrg` is
  // intentionally absent — SaaS login itself rejects users with
  // zero org membership via `assertUserHasActiveOrgAccess`, so the
  // route-level viewer gate isn't reachable for that combination.
  // The "unauthorized viewer" path is covered in the selfhosted
  // describe instead.
  let platformAdmin: TestActor; // system role 'admin' — passes everything.
  let orgOwner: TestActor; // system role 'viewer' + org_members.role = 'owner'.
  let orgAdmin: TestActor; // system role 'viewer' + org_members.role = 'admin'.
  let orgMember: TestActor; // system role 'viewer' + org_members.role = 'member'.

  /**
   * Create a user only (no login). Login must happen AFTER any
   * required `saas.organization_members` row is in place — in SaaS
   * mode the auth route's `assertUserHasActiveOrgAccess` gate
   * rejects non-platform-admin users with zero org memberships,
   * so creating + logging in inline would 403 for every viewer we
   * later wire to an org.
   */
  async function makeUser(
    systemRole: 'admin' | 'user' | 'viewer'
  ): Promise<{ user: User; password: string }> {
    const password = `Test${generateUniqueId()}!1`;
    const password_hash = await bcrypt.hash(password, 10);
    const user = await db.users.create({
      email: `${systemRole}-${generateUniqueId()}@example.com`,
      password_hash,
      role: systemRole,
    });
    cleanup.trackUser(user.id);
    return { user, password };
  }

  async function loginAs(user: User, password: string): Promise<TestActor> {
    const loginRes = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password },
    });
    const parsed = JSON.parse(loginRes.body);
    if (!parsed?.data?.access_token) {
      throw new Error(
        `Login failed for ${user.email}: status=${loginRes.statusCode} body=${loginRes.body.slice(0, 300)}`
      );
    }
    return { user, jwt: parsed.data.access_token, password };
  }

  beforeAll(async () => {
    // Force SaaS mode — the integration suite default is selfhosted,
    // in which `resolveOrganizationForProject` returns null and the
    // POST /projects gate cannot resolve the target org's role.
    originalDeploymentMode = process.env.DEPLOYMENT_MODE;
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const testEnv = await createTestServerWithDb();
    server = testEnv.server;
    db = testEnv.db;

    const subdomain = `rbac-${generateUniqueId()}`;
    const orgRow = await db.organizations.create({ name: subdomain, subdomain });
    cleanup.trackOrganization(orgRow.id);
    org = orgRow;

    // `createProjectWithQuotaCheck` consults the org's subscription
    // to read its project quota — without one, getSubscription
    // throws 404 and every POST /projects test fails before the
    // role gate even runs. Seed a trial subscription so the quota
    // path resolves.
    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await db.subscriptions.create({
      organization_id: org.id,
      plan_name: PLAN_NAME.TRIAL,
      status: BILLING_STATUS.TRIAL,
      current_period_start: new Date(),
      current_period_end: trialEnd,
      quotas: getQuotaForPlan(PLAN_NAME.TRIAL),
    });

    // Phase 1: create user rows (no login yet).
    const adminCred = await makeUser('admin');
    const ownerCred = await makeUser('viewer');
    const adminCred2 = await makeUser('viewer');
    const memberCred = await makeUser('viewer');

    // Phase 2: wire SaaS org memberships BEFORE login. The
    // /auth/login route's `assertUserHasActiveOrgAccess` rejects
    // non-platform-admin users with zero org memberships, so any
    // viewer without a row here would get 403 on login.
    await db.organizationMembers.create({
      organization_id: org.id,
      user_id: ownerCred.user.id,
      role: 'owner',
    });
    await db.organizationMembers.create({
      organization_id: org.id,
      user_id: adminCred2.user.id,
      role: 'admin',
    });
    await db.organizationMembers.create({
      organization_id: org.id,
      user_id: memberCred.user.id,
      role: 'member',
    });

    // A project owned by the org — gives api-key write paths something
    // to scope to via `allowed_projects`.
    const proj = await db.projects.create({
      name: `rbac-proj-${generateUniqueId()}`,
      organization_id: org.id,
      created_by: ownerCred.user.id,
    });
    cleanup.trackProject(proj.id);
    project = { id: proj.id };

    // Explicit project-admin row for the SaaS actors that need to
    // pass `assertCanGrantProjects` on api-key writes.
    await db.projectMembers.addMember(project.id, ownerCred.user.id, 'admin');
    await db.projectMembers.addMember(project.id, adminCred2.user.id, 'admin');

    // Phase 3: log all actors in. platformAdmin bypasses
    // assertUserHasActiveOrgAccess via isPlatformAdmin; the others
    // need their org membership row from phase 2. viewerNoOrg
    // intentionally has NO membership — it should NOT be logged in
    // for the SaaS scenarios where login would 403; instead test
    // routes that take the unscoped path.
    platformAdmin = await loginAs(adminCred.user, adminCred.password);
    orgOwner = await loginAs(ownerCred.user, ownerCred.password);
    orgAdmin = await loginAs(adminCred2.user, adminCred2.password);
    orgMember = await loginAs(memberCred.user, memberCred.password);
  });

  afterAll(async () => {
    await cleanup.cleanup(db);
    if (originalDeploymentMode === undefined) {
      delete process.env.DEPLOYMENT_MODE;
    } else {
      process.env.DEPLOYMENT_MODE = originalDeploymentMode;
    }
    resetDeploymentConfig();
  });

  // -------------------------------------------------------------------
  // POST /api/v1/api-keys
  // -------------------------------------------------------------------

  describe('POST /api/v1/api-keys', () => {
    async function attempt(actor: TestActor): Promise<{ status: number; body: string }> {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${actor.jwt}` },
        payload: {
          name: `key-${generateUniqueId()}`,
          type: 'production',
          permission_scope: 'read',
          allowed_projects: [project.id],
        },
      });
      return { status: res.statusCode, body: res.body };
    }

    it('platform admin can create an API key', async () => {
      const { status } = await attempt(platformAdmin);
      expect(status).toBe(201);
    });

    it('SaaS org owner (system viewer) can create an API key', async () => {
      // The originating regression: this was 403 before the fix.
      const { status } = await attempt(orgOwner);
      expect(status).toBe(201);
    });

    it('SaaS org admin (system viewer) can create an API key', async () => {
      const { status } = await attempt(orgAdmin);
      expect(status).toBe(201);
    });

    it('SaaS org member (system viewer) cannot create an API key', async () => {
      // `member` role is below admin, so userIsOrgAdminAnywhere returns
      // false and the viewer block stays in effect.
      const { status, body } = await attempt(orgMember);
      expect(status).toBe(403);
      expect(body).toContain('Viewers cannot create API keys');
    });

    // The "system viewer with no org membership" combination doesn't
    // exist in normal SaaS flow — `assertUserHasActiveOrgAccess`
    // (auth.ts) rejects login for such users. The selfhosted
    // describe below covers the "no SaaS org concept" axis.
  });

  // -------------------------------------------------------------------
  // DELETE /api/v1/api-keys/:id
  // -------------------------------------------------------------------

  describe('DELETE /api/v1/api-keys/:id', () => {
    async function createKeyAs(actor: TestActor): Promise<string> {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${actor.jwt}` },
        payload: {
          name: `delete-target-${generateUniqueId()}`,
          type: 'production',
          permission_scope: 'read',
          allowed_projects: [project.id],
        },
      });
      expect(res.statusCode).toBe(201);
      // POST shape is { api_key (plaintext), key_details } wrapped
      // in { success, data, ... }. The id lives on key_details.
      return JSON.parse(res.body).data.key_details.id;
    }

    it('SaaS org owner (system viewer) can delete their own API key', async () => {
      // `authorizeApiKeyAccess` gates DELETE for non-platform-admins
      // on `created_by === userId`. Cross-creator delete (org-scoped
      // delete) is out of scope for the viewer-gate fix this PR
      // shipped — it lands in a follow-up. The realistic workflow
      // tested here is: owner creates a key, owner later deletes it.
      const keyId = await createKeyAs(orgOwner);
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${orgOwner.jwt}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('SaaS org member (system viewer) cannot delete an API key', async () => {
      const keyId = await createKeyAs(platformAdmin);
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${orgMember.jwt}` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.body).toContain('Viewers cannot delete API keys');
    });

    // Skipped: no-org viewer login is blocked by
    // assertUserHasActiveOrgAccess in SaaS mode. See selfhosted
    // describe for the equivalent.
  });

  // -------------------------------------------------------------------
  // POST /api/v1/projects
  // -------------------------------------------------------------------

  describe('POST /api/v1/projects', () => {
    async function attemptCreate(
      actor: TestActor,
      organizationId: string
    ): Promise<{ status: number; body: string }> {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: { authorization: `Bearer ${actor.jwt}` },
        payload: {
          name: `proj-${generateUniqueId()}`,
          settings: {},
          organization_id: organizationId,
        },
      });
      return { status: res.statusCode, body: res.body };
    }

    it('platform admin can create a project', async () => {
      const { status, body } = await attemptCreate(platformAdmin, org.id);
      // Quota check may 429 if the org has hit its plan limit. Both
      // are post-gate outcomes, so accept either as proof the
      // role check did not block.
      expect([201, 429]).toContain(status);
      if (status === 201) {
        cleanup.trackProject(JSON.parse(body).data.id);
      }
    });

    it('SaaS org owner (system viewer) can create a project', async () => {
      const { status, body } = await attemptCreate(orgOwner, org.id);
      expect([201, 429]).toContain(status);
      expect(body).not.toContain('Viewers cannot create projects');
      if (status === 201) {
        cleanup.trackProject(JSON.parse(body).data.id);
      }
    });

    it('SaaS org member (system viewer) cannot create a project', async () => {
      const { status, body } = await attemptCreate(orgMember, org.id);
      expect(status).toBe(403);
      expect(body).toContain('Viewers cannot create projects');
    });

    it('SaaS admin of Org A cannot create a project in Org B (cross-tenant)', async () => {
      // Regression for Gemini's security-high finding on the
      // original viewer-gate fix: the first iteration used
      // `userIsOrgAdminAnywhere`, which would let an admin of Org A
      // who is only a `member` of Org B POST a project in B. The fix
      // is `userIsOrgAdminOfOrg` — gate on the RESOLVED org, not
      // "any".
      const sub = `cross-tenant-${generateUniqueId()}`;
      const orgB = await db.organizations.create({ name: sub, subdomain: sub });
      cleanup.trackOrganization(orgB.id);

      // orgAdmin is admin of `org` (set up in beforeAll) and only
      // a member of `orgB` here.
      await db.organizationMembers.create({
        organization_id: orgB.id,
        user_id: orgAdmin.user.id,
        role: 'member',
      });

      const { status, body } = await attemptCreate(orgAdmin, orgB.id);
      expect(status).toBe(403);
      expect(body).toContain('Viewers cannot create projects');
    });
  });
});

// ---------------------------------------------------------------------
// Selfhosted mode
// ---------------------------------------------------------------------

describe('Selfhosted mode — RBAC for api-keys + projects creation', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  const cleanup = new TestCleanupTracker();
  let originalDeploymentMode: string | undefined;

  let systemUser: TestActor; // system role 'user' — should pass everywhere.
  let systemViewer: TestActor; // system role 'viewer' — should be blocked.

  async function makeActor(systemRole: 'admin' | 'user' | 'viewer'): Promise<TestActor> {
    const password = `Test${generateUniqueId()}!1`;
    const password_hash = await bcrypt.hash(password, 10);
    const user = await db.users.create({
      email: `selfhosted-${systemRole}-${generateUniqueId()}@example.com`,
      password_hash,
      role: systemRole,
    });
    cleanup.trackUser(user.id);

    const loginRes = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password },
    });
    const jwt = JSON.parse(loginRes.body).data.access_token;
    return { user, jwt, password };
  }

  beforeAll(async () => {
    // Explicitly force selfhosted — the integration suite default
    // is already selfhosted, but a preceding describe in this file
    // (SaaS) may have flipped it; resetDeploymentConfig() picks up
    // whatever env says now.
    originalDeploymentMode = process.env.DEPLOYMENT_MODE;
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    resetDeploymentConfig();

    const testEnv = await createTestServerWithDb();
    server = testEnv.server;
    db = testEnv.db;

    systemUser = await makeActor('user');
    systemViewer = await makeActor('viewer');
  });

  afterAll(async () => {
    await cleanup.cleanup(db);
    if (originalDeploymentMode === undefined) {
      delete process.env.DEPLOYMENT_MODE;
    } else {
      process.env.DEPLOYMENT_MODE = originalDeploymentMode;
    }
    resetDeploymentConfig();
  });

  describe('POST /api/v1/projects', () => {
    async function attempt(actor: TestActor): Promise<{ status: number; body: string }> {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: { authorization: `Bearer ${actor.jwt}` },
        payload: { name: `proj-${generateUniqueId()}`, settings: {} },
      });
      return { status: res.statusCode, body: res.body };
    }

    it('system user (non-viewer) can create a project', async () => {
      const { status, body } = await attempt(systemUser);
      expect(status).toBe(201);
      cleanup.trackProject(JSON.parse(body).data.id);
    });

    it('system viewer cannot create a project (no SaaS escape hatch)', async () => {
      // Selfhosted has no `saas.organization_members` rows, so the
      // `userIsOrgAdminOfOrg` branch can never admit a viewer.
      // Confirms the gate doesn't accidentally open up for everyone
      // when SaaS-mode helpers fail to find a matching row.
      const { status, body } = await attempt(systemViewer);
      expect(status).toBe(403);
      expect(body).toContain('Viewers cannot create projects');
    });
  });

  describe('POST /api/v1/api-keys', () => {
    async function attempt(
      actor: TestActor,
      allowedProjects: string[] = []
    ): Promise<{ status: number; body: string }> {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${actor.jwt}` },
        payload: {
          name: `key-${generateUniqueId()}`,
          type: 'production',
          permission_scope: 'read',
          allowed_projects: allowedProjects,
        },
      });
      return { status: res.statusCode, body: res.body };
    }

    it('system user (non-viewer) can create an API key for their project', async () => {
      // System users in selfhosted must still be project-admin of any
      // scoped project — `assertCanGrantProjects` enforces this.
      const proj = await db.projects.create({
        name: `selfhosted-proj-${generateUniqueId()}`,
        created_by: systemUser.user.id,
      });
      cleanup.trackProject(proj.id);
      await db.projectMembers.addMember(proj.id, systemUser.user.id, 'admin');

      const { status } = await attempt(systemUser, [proj.id]);
      expect(status).toBe(201);
    });

    it('system viewer cannot create an API key', async () => {
      const { status, body } = await attempt(systemViewer);
      expect(status).toBe(403);
      expect(body).toContain('Viewers cannot create API keys');
    });
  });
});
