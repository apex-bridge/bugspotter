/**
 * Tenant Cross-Access Integration Tests
 *
 * Closes two cross-tenant gaps surfaced during PR-105 review:
 *
 *   1. Login at the wrong tenant subdomain succeeded — JWT was
 *      bearer-equivalent across all subdomains because the token
 *      carries no org binding.
 *   2. Fake subdomains served `TENANT_EXEMPT_PREFIXES` routes
 *      (admin / users-me / audit-logs) by skipping the existence
 *      check entirely.
 *
 * The fix has three pieces (see the PR description for the full
 * shape):
 *   - Login-time guard: auth routes (login, refresh, magic-login)
 *     reject when the user doesn't belong to the subdomain's org
 *   - Request-time middleware: every authenticated request on a
 *     tenant subdomain must satisfy `user ∈ org`
 *   - Tenant-resolution tightening: unknown subdomains 404 even on
 *     exempt prefixes
 *
 * Tests run in SaaS mode (`DEPLOYMENT_MODE=saas`) which is NOT the
 * default of the integration suite. The env mutation is scoped to
 * this file via beforeAll/afterAll.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { createTestServerWithDb } from '../setup.integration.js';
import { createTestProject, TestCleanupTracker, generateUniqueId } from '../utils/test-utils.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { User } from '../../src/db/types.js';
import { resetDeploymentConfig } from '../../src/saas/config.js';
import { generateMagicToken } from '../../src/api/routes/auth.js';

describe('Tenant cross-access guards (SaaS mode)', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  const cleanup = new TestCleanupTracker();
  let originalDeploymentMode: string | undefined;
  let originalAllowRegistration: string | undefined;

  // Shared fixtures: two orgs (A and B), one user per org.
  let orgA: { id: string; subdomain: string };
  let orgB: { id: string; subdomain: string };
  let userA: User;
  let userAPassword: string;
  let userB: User;

  // Hostnames mapped to the orgs above. The base domain is fixed so
  // tests can switch between hub and tenant subdomains by swapping
  // the prefix only.
  const HUB_HOST = 'app.kz.bugspotter.io';
  const orgAHost = () => `${orgA.subdomain}.kz.bugspotter.io`;
  const orgBHost = () => `${orgB.subdomain}.kz.bugspotter.io`;
  const fakeHost = `fake-org-${generateUniqueId()}.kz.bugspotter.io`;

  beforeAll(async () => {
    // Force SaaS mode — the integration suite default is selfhosted.
    originalDeploymentMode = process.env.DEPLOYMENT_MODE;
    originalAllowRegistration = process.env.ALLOW_REGISTRATION;
    process.env.DEPLOYMENT_MODE = 'saas';
    process.env.ALLOW_REGISTRATION = 'true';
    resetDeploymentConfig();

    const testEnv = await createTestServerWithDb();
    server = testEnv.server;
    db = testEnv.db;

    // Two orgs with active subscriptions.
    const tsA = generateUniqueId();
    const orgARow = await db.organizations.create({
      name: `Org A ${tsA}`,
      subdomain: `org-a-${tsA}`,
    });
    cleanup.trackOrganization(orgARow.id);
    orgA = { id: orgARow.id, subdomain: orgARow.subdomain };

    const tsB = generateUniqueId();
    const orgBRow = await db.organizations.create({
      name: `Org B ${tsB}`,
      subdomain: `org-b-${tsB}`,
    });
    cleanup.trackOrganization(orgBRow.id);
    orgB = { id: orgBRow.id, subdomain: orgBRow.subdomain };

    // One user per org. Bcrypt the password so the login route's
    // bcrypt.compare path succeeds.
    userAPassword = 'TenantCrossA!1';
    const userAHash = await bcrypt.hash(userAPassword, 10);
    userA = await db.users.create({
      email: `user-a-${generateUniqueId()}@test.com`,
      password_hash: userAHash,
      role: 'user',
    });
    cleanup.trackUser(userA.id);
    await db.organizationMembers.create({
      organization_id: orgA.id,
      user_id: userA.id,
      role: 'admin',
    });

    const userBHash = await bcrypt.hash('TenantCrossB!1', 10);
    userB = await db.users.create({
      email: `user-b-${generateUniqueId()}@test.com`,
      password_hash: userBHash,
      role: 'user',
    });
    cleanup.trackUser(userB.id);
    await db.organizationMembers.create({
      organization_id: orgB.id,
      user_id: userB.id,
      role: 'admin',
    });
  });

  afterAll(async () => {
    await cleanup.cleanup(db);
    await server.close();
    await db.close();

    if (originalDeploymentMode === undefined) {
      delete process.env.DEPLOYMENT_MODE;
    } else {
      process.env.DEPLOYMENT_MODE = originalDeploymentMode;
    }
    if (originalAllowRegistration === undefined) {
      delete process.env.ALLOW_REGISTRATION;
    } else {
      process.env.ALLOW_REGISTRATION = originalAllowRegistration;
    }
    resetDeploymentConfig();
  });

  // Helper — login userA at the given hostname, returns the response.
  async function login(host: string, email: string, password: string) {
    return server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { host },
      payload: { email, password },
    });
  }

  describe('Login-time guard (POST /auth/login)', () => {
    it('allows login at the user’s own tenant subdomain', async () => {
      const response = await login(orgAHost(), userA.email, userAPassword);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.access_token).toBeTruthy();
    });

    it('allows login at the hub domain (no subdomain) — keeps current product behaviour', async () => {
      const response = await login(HUB_HOST, userA.email, userAPassword);
      expect(response.statusCode).toBe(200);
    });

    it('rejects login at a different tenant subdomain with same shape as wrong-password', async () => {
      const response = await login(orgBHost(), userA.email, userAPassword);
      expect(response.statusCode).toBe(401);
      // Same message shape as wrong-password — no user-enumeration leak.
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Invalid email or password');
    });

    it('rejects login at an unknown subdomain', async () => {
      // Tenant resolution returns 404 OrganizationNotFound BEFORE reaching the login handler.
      const response = await login(fakeHost, userA.email, userAPassword);
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('OrganizationNotFound');
    });
  });

  describe('Login-time guard (POST /auth/refresh)', () => {
    it('rejects a refresh cookie issued at orgA when replayed at orgB', async () => {
      // Issue a refresh cookie at orgA (login)
      const loginResponse = await login(orgAHost(), userA.email, userAPassword);
      expect(loginResponse.statusCode).toBe(200);
      const refreshCookie = loginResponse.cookies.find((c) => c.name === 'refresh_token');
      expect(refreshCookie?.value).toBeTruthy();

      // Replay at orgB
      const refreshResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          host: orgBHost(),
          cookie: `refresh_token=${refreshCookie!.value}`,
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(refreshResponse.statusCode).toBe(401);
      // Same message shape as the catch's generic 401 — no tenant
      // enumeration via differing error codes.
      const body = JSON.parse(refreshResponse.body);
      expect(body.message).toContain('Invalid or expired refresh token');
    });

    it('allows refresh on the same tenant subdomain (regression)', async () => {
      const loginResponse = await login(orgAHost(), userA.email, userAPassword);
      const refreshCookie = loginResponse.cookies.find((c) => c.name === 'refresh_token');

      const refreshResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: {
          host: orgAHost(),
          cookie: `refresh_token=${refreshCookie!.value}`,
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(refreshResponse.statusCode).toBe(200);
      expect(JSON.parse(refreshResponse.body).data.access_token).toBeTruthy();
    });
  });

  describe('Login-time guard (POST /auth/magic-login)', () => {
    it('rejects a magic token minted for orgA when redeemed at orgB subdomain', async () => {
      // Enable magic login on org A so the legitimate path would otherwise succeed.
      await db.organizations.updateSettings(orgA.id, { magic_login_enabled: true });
      const magicToken = generateMagicToken(server, userA, orgA.id, '5m');

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        headers: { host: orgBHost() },
        payload: { token: magicToken },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).message).toContain('tenant mismatch');
    });

    it('accepts a magic token at the issuing tenant subdomain (regression)', async () => {
      await db.organizations.updateSettings(orgA.id, { magic_login_enabled: true });
      const magicToken = generateMagicToken(server, userA, orgA.id, '5m');

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        headers: { host: orgAHost() },
        payload: { token: magicToken },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Request-time tenant-match middleware', () => {
    let userAJwt: string;
    let userAOrgAProject: { id: string };

    beforeEach(async () => {
      // Login at hub to get a JWT that's not pre-bound to any subdomain.
      // This is the "stolen / hub-issued JWT replayed cross-tenant"
      // scenario; the middleware must still reject when the JWT is then
      // used against orgB.
      const loginResponse = await login(HUB_HOST, userA.email, userAPassword);
      userAJwt = JSON.parse(loginResponse.body).data.access_token;

      // A project under orgA so we have a real authenticated route that
      // requires project access. (Notification channels list is one such
      // route — it gates on project membership.)
      const project = await createTestProject(db, { created_by: userA.id });
      cleanup.trackProject(project.id);
      await db.query('UPDATE application.projects SET organization_id = $1 WHERE id = $2', [
        orgA.id,
        project.id,
      ]);
      userAOrgAProject = project;
    });

    it('rejects an authenticated request to a tenant subdomain that the user does not belong to', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: {
          host: orgBHost(),
          authorization: `Bearer ${userAJwt}`,
        },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error).toBe('TenantMismatch');
    });

    it('accepts the same JWT on the user’s own tenant subdomain (regression)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: {
          host: orgAHost(),
          authorization: `Bearer ${userAJwt}`,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts the same JWT on the hub domain (no tenant context)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: {
          host: HUB_HOST,
          authorization: `Bearer ${userAJwt}`,
        },
      });

      expect(response.statusCode).toBe(200);
      // Project ref consumed elsewhere (kept to avoid unused-var lint).
      void userAOrgAProject;
    });

    // The PR explicitly omits an `isPlatformAdmin` exemption from
    // both `assertUserBelongsToTenant` and `createTenantMatchMiddleware`.
    // `assertUserHasActiveOrgAccess` (in api/routes/auth.ts) DOES exempt
    // platform admins so they can hub-login without org membership —
    // that divergence is the security boundary, and these tests pin
    // it. A future developer who copies the pattern from
    // `assertUserHasActiveOrgAccess` and adds a matching exemption to
    // either guard would silently reopen the cross-tenant surface;
    // these tests turn that into a red CI signal.
    it('rejects a platform-admin JWT at a tenant subdomain the admin is not a member of', async () => {
      const adminPassword = 'PlatformAdmin!1';
      const adminHash = await bcrypt.hash(adminPassword, 10);
      const platformAdmin = await db.users.create({
        email: `platform-admin-${generateUniqueId()}@test.com`,
        password_hash: adminHash,
        role: 'admin',
      });
      cleanup.trackUser(platformAdmin.id);
      // The application-level `role: 'admin'` is NOT platform-admin —
      // platform-admin is gated by `security.is_platform_admin`. Set
      // it here so the issued JWT carries `isPlatformAdmin: true`
      // (see generateAuthTokens in api/utils/auth-tokens.ts).
      await db.query(
        `UPDATE application.users
         SET security = jsonb_set(COALESCE(security, '{}'::jsonb), '{is_platform_admin}', 'true'::jsonb)
         WHERE id = $1`,
        [platformAdmin.id]
      );

      // Hub login succeeds because assertUserHasActiveOrgAccess
      // exempts platform admins (auth.ts:55) — no membership in any
      // org needed.
      const adminLogin = await login(HUB_HOST, platformAdmin.email, adminPassword);
      expect(adminLogin.statusCode).toBe(200);
      const adminJwt = JSON.parse(adminLogin.body).data.access_token;

      // The same admin JWT used against orgA's subdomain must 403 at
      // the request-time middleware — no platform-admin exemption
      // there by design.
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: { host: orgAHost(), authorization: `Bearer ${adminJwt}` },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error).toBe('TenantMismatch');
    });

    it('rejects platform-admin login at a tenant subdomain (login-time guard, no exemption)', async () => {
      // Same divergence as above, exercised at the login-time guard
      // (assertUserBelongsToTenant). Login at a tenant subdomain the
      // platform admin doesn't belong to should fail with the same
      // wrong-password shape (401 Unauthorized) used elsewhere.
      const adminPassword = 'PlatformAdminLogin!1';
      const adminHash = await bcrypt.hash(adminPassword, 10);
      const platformAdmin = await db.users.create({
        email: `platform-admin-login-${generateUniqueId()}@test.com`,
        password_hash: adminHash,
        role: 'admin',
      });
      cleanup.trackUser(platformAdmin.id);
      await db.query(
        `UPDATE application.users
         SET security = jsonb_set(COALESCE(security, '{}'::jsonb), '{is_platform_admin}', 'true'::jsonb)
         WHERE id = $1`,
        [platformAdmin.id]
      );

      const response = await login(orgAHost(), platformAdmin.email, adminPassword);
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error).toBe('Unauthorized');
    });
  });

  describe('Bug 1: subdomain-existence check fires before exempt-prefix bypass', () => {
    it('returns 404 OrganizationNotFound for fake subdomains on exempt routes (admin / users-me / audit-logs)', async () => {
      // Before the fix this served — the tenant middleware short-
      // circuited on TENANT_EXEMPT_PREFIXES BEFORE looking the
      // subdomain up, so `evil.kz.bugspotter.io/api/v1/users/me/*`
      // reached the route handler as if it were the hub. After the
      // fix the subdomain validation runs first and rejects.
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: { host: fakeHost },
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error).toBe('OrganizationNotFound');
    });

    it('serves exempt routes on a REAL tenant subdomain (regression — keeps current UX)', async () => {
      // A logged-in user visiting `orgA.kz.bugspotter.io` and
      // clicking "preferences" hits this exact route. The fix
      // intentionally doesn't reject — it just declines to set
      // `request.organizationId` so the user-scoped handler sees
      // the same context it would on the hub.
      const loginResponse = await login(orgAHost(), userA.email, userAPassword);
      const jwt = JSON.parse(loginResponse.body).data.access_token;

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: {
          host: orgAHost(),
          authorization: `Bearer ${jwt}`,
        },
      });

      // 200 (preferences served) or 404 (no row yet) — but NOT
      // 'OrganizationNotFound' or 'TenantMismatch'. The route handler
      // ran rather than being rejected by subdomain/tenant checks.
      expect([200, 404]).toContain(response.statusCode);
      const body = JSON.parse(response.body);
      expect(['OrganizationNotFound', 'TenantMismatch']).not.toContain(body.error);
    });

    it('serves exempt routes on the hub domain (regression)', async () => {
      const loginResponse = await login(HUB_HOST, userA.email, userAPassword);
      const jwt = JSON.parse(loginResponse.body).data.access_token;

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/users/me/preferences',
        headers: {
          host: HUB_HOST,
          authorization: `Bearer ${jwt}`,
        },
      });

      expect([200, 404]).toContain(response.statusCode);
      const body = JSON.parse(response.body);
      expect(['OrganizationNotFound', 'TenantMismatch']).not.toContain(body.error);
    });
  });
});
