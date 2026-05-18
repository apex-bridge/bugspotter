/**
 * RBAC regression matrix for SaaS-tenant org owners.
 *
 * The originating bug: `POST /api/v1/api-keys`,
 * `DELETE /api/v1/api-keys/:id`, and `POST /api/v1/projects` had a
 * naïve `request.authUser.role === 'viewer'` block. That gate is
 * correct in selfhosted single-tenant mode (where customer users
 * carry system role `'user'` or `'admin'`) but actively wrong for
 * SaaS, where customer-tenant org owners ALWAYS have system role
 * `'viewer'` — platform-admin is a BugSpotter-staff role, not a
 * customer one. The fix consults `saas.organization_members.role`
 * via `userIsOrgAdminAnywhere`; this test pins the contract so the
 * regression can't return.
 *
 * Matrix axes:
 *   - actor: platform admin / system user (selfhosted) /
 *            SaaS org owner / SaaS org admin / SaaS org member /
 *            unaffiliated system viewer
 *   - route: api-keys POST, api-keys DELETE, projects POST
 *
 * Each row asserts both the success path (when allowed) and a
 * specific 403 reason on the denial path so future renames /
 * message changes surface clearly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../src/db/client.js';
import type { Organization, User } from '../../src/db/types.js';
import { createTestServerWithDb } from '../setup.integration.js';
import { TestCleanupTracker, generateUniqueId } from '../utils/test-utils.js';

interface TestActor {
  user: User;
  jwt: string;
  password: string;
}

describe('SaaS-tenant RBAC for api-keys + projects creation', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  const cleanup = new TestCleanupTracker();

  let org: Organization;
  let project: { id: string };

  // Actor permutations.
  let platformAdmin: TestActor; // system role 'admin' — passes everything.
  let systemUser: TestActor; // system role 'user', no org — selfhosted path.
  let orgOwner: TestActor; // system role 'viewer' + org_members.role = 'owner'.
  let orgAdmin: TestActor; // system role 'viewer' + org_members.role = 'admin'.
  let orgMember: TestActor; // system role 'viewer' + org_members.role = 'member'.
  let viewerNoOrg: TestActor; // system role 'viewer' + no org membership.

  async function makeActor(systemRole: 'admin' | 'user' | 'viewer'): Promise<TestActor> {
    const password = `Test${generateUniqueId()}!1`;
    const password_hash = await bcrypt.hash(password, 10);
    const user = await db.users.create({
      email: `${systemRole}-${generateUniqueId()}@example.com`,
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
    const testEnv = await createTestServerWithDb();
    server = testEnv.server;
    db = testEnv.db;

    // Shared SaaS org for the three SaaS actors.
    const subdomain = `rbac-${generateUniqueId()}`;
    const orgRow = await db.organizations.create({ name: subdomain, subdomain });
    cleanup.trackOrganization(orgRow.id);
    org = orgRow;

    platformAdmin = await makeActor('admin');
    systemUser = await makeActor('user');
    orgOwner = await makeActor('viewer');
    orgAdmin = await makeActor('viewer');
    orgMember = await makeActor('viewer');
    viewerNoOrg = await makeActor('viewer');

    await db.organizationMembers.create({
      organization_id: org.id,
      user_id: orgOwner.user.id,
      role: 'owner',
    });
    await db.organizationMembers.create({
      organization_id: org.id,
      user_id: orgAdmin.user.id,
      role: 'admin',
    });
    await db.organizationMembers.create({
      organization_id: org.id,
      user_id: orgMember.user.id,
      role: 'member',
    });

    // A project owned by the org so DELETE /api-keys/:id has something
    // to reference. Platform admin can target this project regardless;
    // SaaS owners pass `assertCanGrantProjects` via org-inherited role.
    const proj = await db.projects.create({
      name: `rbac-proj-${generateUniqueId()}`,
      organization_id: org.id,
      created_by: orgOwner.user.id,
    });
    cleanup.trackProject(proj.id);
    project = { id: proj.id };

    // Grant `orgOwner` an explicit project-admin row too. Org-inherited
    // role would also work for `assertCanGrantProjects`, but adding the
    // explicit member row makes the matrix easier to reason about:
    // the project-level gate is unambiguous regardless of how
    // resolveInheritedProjectRole evolves.
    await db.projectMembers.addMember(project.id, orgOwner.user.id, 'admin');
    await db.projectMembers.addMember(project.id, orgAdmin.user.id, 'admin');
  });

  afterAll(async () => {
    await cleanup.cleanup(db);
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

    it('system viewer with no org membership cannot create an API key', async () => {
      const { status, body } = await attempt(viewerNoOrg);
      expect(status).toBe(403);
      expect(body).toContain('Viewers cannot create API keys');
    });
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

    it('SaaS org owner (system viewer) can delete an API key', async () => {
      const keyId = await createKeyAs(platformAdmin);
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

    it('system viewer with no org membership cannot delete an API key', async () => {
      const keyId = await createKeyAs(platformAdmin);
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${viewerNoOrg.jwt}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('system user (selfhosted) can delete a key they own access to', async () => {
      // Selfhosted-style: system role 'user', no SaaS org context.
      // We grant explicit project membership so authorizeApiKeyAccess
      // passes the project-scope check on the key's allowed_projects.
      const proj = await db.projects.create({
        name: `selfhosted-proj-${generateUniqueId()}`,
        created_by: systemUser.user.id,
      });
      cleanup.trackProject(proj.id);
      await db.projectMembers.addMember(proj.id, systemUser.user.id, 'admin');

      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${systemUser.jwt}` },
        payload: {
          name: `selfhosted-key-${generateUniqueId()}`,
          type: 'production',
          permission_scope: 'read',
          allowed_projects: [proj.id],
        },
      });
      expect(createRes.statusCode).toBe(201);
      const keyId = JSON.parse(createRes.body).data.key_details.id;

      const delRes = await server.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${systemUser.jwt}` },
      });
      expect(delRes.statusCode).toBe(200);
    });
  });

  // -------------------------------------------------------------------
  // POST /api/v1/projects
  // -------------------------------------------------------------------

  describe('POST /api/v1/projects', () => {
    async function attemptCreate(
      actor: TestActor,
      organizationId?: string
    ): Promise<{ status: number; body: string }> {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: { authorization: `Bearer ${actor.jwt}` },
        payload: {
          name: `proj-${generateUniqueId()}`,
          settings: {},
          ...(organizationId ? { organization_id: organizationId } : {}),
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
        const proj = JSON.parse(body).data;
        cleanup.trackProject(proj.id);
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

    it('system viewer with no org membership cannot create a project', async () => {
      const { status, body } = await attemptCreate(viewerNoOrg);
      expect(status).toBe(403);
      expect(body).toContain('Viewers cannot create projects');
    });

    it('system user (selfhosted) can create a project', async () => {
      const { status, body } = await attemptCreate(systemUser);
      // Selfhosted: no org, so no quota path — pure 201 or a downstream
      // failure unrelated to the viewer gate.
      expect(status).toBe(201);
      cleanup.trackProject(JSON.parse(body).data.id);
    });
  });
});
