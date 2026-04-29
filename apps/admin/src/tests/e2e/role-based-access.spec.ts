/**
 * E2E Tests — Role-Based Page Access
 * Verifies which pages each user role can or cannot access:
 * - Platform admin: full access to all pages
 * - Regular user with org: no admin pages, has org pages
 * - Regular user without org: no admin pages, no org pages
 */

import { test, expect } from '../fixtures/setup-fixture';
import { loginAsAdmin, loginAs } from './helpers/auth-helpers';
import { E2E_API_URL } from './config';

const TEST_ADMIN = {
  email: 'admin@bugspotter.io',
  password: 'admin123',
  name: 'Admin User',
};

const ORG_USER = {
  email: `org-user-rbac-${Date.now()}@example.com`,
  password: 'password123',
  name: 'Org User',
};

const NO_ORG_USER = {
  email: `no-org-rbac-${Date.now()}@example.com`,
  password: 'password123',
  name: 'No Org User',
};

/** Admin-only sidebar labels (from en.json nav.*).
 *
 * These items are gated by `adminOnly: true` in `NAV_ITEMS` inside
 * `dashboard-layout.tsx` and render only for platform admins.
 * Keep this list in sync with every `NAV_ITEMS` entry that carries
 * `adminOnly: true` — if they drift, the "regular user cannot see
 * admin items" assertions silently stop catching regressions.
 *
 * Note: 'Audit Logs' and 'API Keys' are intentionally NOT here — the
 * sidebar renders them for every authenticated user, with the backend
 * enforcing access control per-route (e.g. `requireAuditAccess` lets
 * org owners view their org's audit trail, and api-keys are scoped to
 * projects the user is a member of). They appear in GENERAL_LABELS
 * instead.
 */
const ADMIN_ONLY_LABELS = [
  'Dashboard',
  'User Management',
  'Organizations',
  'Requests', // organization-requests, adminOnly + saasOnly
  'Retention', // organizations/retention, adminOnly + saasOnly
  'System Health',
  'Integrations',
  'Settings',
];

/** Sidebar labels visible to all authenticated users (no gates in NAV_ITEMS) */
const GENERAL_LABELS = ['Projects', 'Bug Reports', 'Notifications', 'Audit Logs', 'API Keys'];

/** Organization section sidebar labels */
const ORG_LABELS = ['My Organization', 'Team', 'Usage & Quotas', 'Billing'];

/** Admin-only routes (protected by AdminRoute) */
const ADMIN_ROUTES = ['/dashboard', '/users', '/organizations', '/settings'];

/** Org-only routes (protected by OrgRoute) */
const ORG_ROUTES = ['/my-organization', '/my-organization/members'];

/** Base path shared by all org routes */
const ORG_BASE_PATH = '/my-organization';

/** Routes not gated by AdminRoute/OrgRoute (no frontend redirect).
 * The assertion is "URL stays", not "page rendered cleanly" —
 * `/audit-logs` and `/api-keys` may 4xx from the backend and still
 * stay put.
 */
const GENERAL_ROUTES = ['/projects', '/bug-reports', '/notifications', '/audit-logs', '/api-keys'];

test.describe('Role-based page access', () => {
  test.describe.configure({ mode: 'serial' });

  let adminToken: string;
  let adminOrgId: string;
  let orgUserId: string;
  let orgId: string;
  let noOrgUserId: string;

  test.beforeAll(async ({ request, setupState }) => {
    // 1. Ensure system initialized (admin user exists)
    await setupState.ensureInitialized(TEST_ADMIN);

    // 2. Login as admin to get API token
    const adminLogin = await request.post(`${E2E_API_URL}/api/v1/auth/login`, {
      data: { email: TEST_ADMIN.email, password: TEST_ADMIN.password },
    });
    expect(adminLogin.ok()).toBeTruthy();
    adminToken = (await adminLogin.json()).data.access_token;

    // 3. Create org user (platform role: user)
    const createOrgUser = await request.post(`${E2E_API_URL}/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        email: ORG_USER.email,
        password: ORG_USER.password,
        name: ORG_USER.name,
        role: 'user',
      },
    });
    expect(createOrgUser.ok()).toBeTruthy();
    orgUserId = (await createOrgUser.json()).data.id;

    // 4. Create no-org user (platform role: user)
    const createNoOrgUser = await request.post(`${E2E_API_URL}/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        email: NO_ORG_USER.email,
        password: NO_ORG_USER.password,
        name: NO_ORG_USER.name,
        role: 'user',
      },
    });
    expect(createNoOrgUser.ok()).toBeTruthy();
    noOrgUserId = (await createNoOrgUser.json()).data.id;

    // 5. Admin creates orgUser's org (with orgUser as owner) BEFORE
    //    orgUser logs in. Login was previously the first step, but
    //    SaaS-mode now rejects login for users with zero non-deleted
    //    org memberships (auth.ts `assertUserHasActiveOrgAccess`).
    //    Bootstrapping has to seed the membership first.
    //    `/api/v1/admin/organizations` accepts `owner_user_id`, so
    //    admin can establish orgUser as the owner without orgUser
    //    needing a session.
    const orgTimestamp = Date.now();
    const createOrg = await request.post(`${E2E_API_URL}/api/v1/admin/organizations`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: `RBAC Test Org ${orgTimestamp}`,
        subdomain: `rbac-org-${orgTimestamp}`,
        owner_user_id: orgUserId,
      },
    });
    expect(createOrg.ok()).toBeTruthy();
    orgId = (await createOrg.json()).data.id;

    // 6. Verify orgUser can now log in — they have an org membership.
    //    The token isn't needed downstream (admin already created the
    //    org); this is a regression-check for the SaaS-mode login
    //    gate that came in alongside this PR.
    const orgUserLogin = await request.post(`${E2E_API_URL}/api/v1/auth/login`, {
      data: { email: ORG_USER.email, password: ORG_USER.password },
    });
    expect(orgUserLogin.ok()).toBeTruthy();

    // 7. Admin creates an org too (so admin has org section visible)
    const createAdminOrg = await request.post(`${E2E_API_URL}/api/v1/organizations`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: `Admin RBAC Org ${Date.now()}`, subdomain: `admin-rbac-${Date.now()}` },
    });
    expect(createAdminOrg.ok()).toBeTruthy();
    adminOrgId = (await createAdminOrg.json()).data.id;
  });

  test.afterAll(async ({ request }) => {
    if (!adminToken) {
      return;
    }

    // Cleanup orgs (admin can delete any org)
    for (const id of [orgId, adminOrgId]) {
      if (id) {
        try {
          await request.delete(`${E2E_API_URL}/api/v1/organizations/${id}`, {
            headers: { Authorization: `Bearer ${adminToken}` },
          });
        } catch (e) {
          console.warn(`[RBAC cleanup] Failed to delete org ${id}:`, e);
        }
      }
    }

    // Cleanup users
    for (const id of [orgUserId, noOrgUserId]) {
      if (id) {
        try {
          await request.delete(`${E2E_API_URL}/api/v1/admin/users/${id}`, {
            headers: { Authorization: `Bearer ${adminToken}` },
          });
        } catch (e) {
          console.warn(`[RBAC cleanup] Failed to delete user ${id}:`, e);
        }
      }
    }
  });

  // ── Platform Admin ──────────────────────────────────────────────────

  test.describe('Platform admin', () => {
    test.beforeEach(async ({ page, setupState }) => {
      await setupState.ensureInitialized(TEST_ADMIN);
      await loginAsAdmin(page);
    });

    test('can access admin-only pages', async ({ page }) => {
      for (const route of ADMIN_ROUTES) {
        await page.goto(route);
        await expect(page).not.toHaveURL(/\/projects/, { timeout: 5000 });
        // Verify we stayed on the intended page (not redirected)
        expect(page.url()).toContain(route);
      }
    });

    test('can access org pages', async ({ page }) => {
      for (const route of ORG_ROUTES) {
        await page.goto(route);
        await expect(page).not.toHaveURL(/\/projects$/, { timeout: 5000 });
        expect(page.url()).toContain(route.split('/').slice(0, 2).join('/'));
      }
    });

    test('sidebar shows all navigation items', async ({ page }) => {
      await page.goto('/dashboard');
      const nav = page.locator('nav');

      // All admin-only items should be visible
      for (const label of ADMIN_ONLY_LABELS) {
        await expect(nav.getByText(label, { exact: true })).toBeVisible();
      }

      // All general items should be visible
      for (const label of GENERAL_LABELS) {
        await expect(nav.getByText(label, { exact: true })).toBeVisible();
      }

      // Org section should be visible (admin has an org)
      for (const label of ORG_LABELS) {
        await expect(nav.getByText(label, { exact: true })).toBeVisible();
      }
    });
  });

  // ── Regular User with Org ───────────────────────────────────────────

  test.describe('Regular user with org membership', () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, ORG_USER.email, ORG_USER.password, /\/projects/);
    });

    test('admin pages redirect to /projects', async ({ page }) => {
      for (const route of ADMIN_ROUTES) {
        await page.goto(route);
        await expect(page).toHaveURL(/\/projects/, { timeout: 5000 });
      }
    });

    test('can access org pages', async ({ page }) => {
      for (const route of ORG_ROUTES) {
        await page.goto(route);
        await expect(page).not.toHaveURL(/\/projects$/, { timeout: 5000 });
        expect(page.url()).toContain(ORG_BASE_PATH);
      }
    });

    test('can access general pages', async ({ page }) => {
      for (const route of GENERAL_ROUTES) {
        await page.goto(route);
        // Should stay on the page (not redirected elsewhere)
        await page.waitForLoadState('domcontentloaded');
        expect(page.url()).toContain(route);
      }
    });

    test('sidebar shows only general + org items (no admin items)', async ({ page }) => {
      await page.goto('/projects');
      const nav = page.locator('nav');

      // Admin-only items should NOT be visible
      for (const label of ADMIN_ONLY_LABELS) {
        await expect(nav.getByText(label, { exact: true })).not.toBeVisible();
      }

      // General items should be visible
      for (const label of GENERAL_LABELS) {
        await expect(nav.getByText(label, { exact: true })).toBeVisible();
      }

      // Org section should be visible (user has an org)
      for (const label of ORG_LABELS) {
        await expect(nav.getByText(label, { exact: true })).toBeVisible();
      }
    });
  });

  // ── Regular User without Org ────────────────────────────────────────
  //
  // These tests verified the dashboard-emptiness UX for a logged-in
  // user with zero org memberships. That state is now unreachable in
  // SaaS mode — `/api/v1/auth/login` rejects with 403 OrgAccessRevoked
  // before issuing a token (see auth.ts `assertUserHasActiveOrgAccess`).
  // The user-visible behavior is now an inline "access revoked" alert
  // on the login form, not an empty dashboard, so the assertions below
  // can never fire.
  //
  // Coverage of the new behavior lives in the backend integration
  // tests (auth.test.ts SaaS describe block). If a frontend E2E for
  // the access-revoked alert is wanted, that's a separate spec —
  // these tests are deleted in spirit, just .skipped here for the
  // git history trail.

  test.describe.skip('Regular user without org', () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, NO_ORG_USER.email, NO_ORG_USER.password, /\/projects/);
    });

    test('admin pages redirect to /projects', async ({ page }) => {
      for (const route of ADMIN_ROUTES) {
        await page.goto(route);
        await expect(page).toHaveURL(/\/projects/, { timeout: 5000 });
      }
    });

    test('org pages redirect to /projects', async ({ page }) => {
      for (const route of ORG_ROUTES) {
        await page.goto(route);
        await expect(page).toHaveURL(/\/projects/, { timeout: 5000 });
      }
    });

    test('can access general pages', async ({ page }) => {
      for (const route of GENERAL_ROUTES) {
        await page.goto(route);
        await page.waitForLoadState('domcontentloaded');
        expect(page.url()).toContain(route);
      }
    });

    test('sidebar shows only general items (no admin, no org section)', async ({ page }) => {
      await page.goto('/projects');
      const nav = page.locator('nav');

      // Admin-only items should NOT be visible
      for (const label of ADMIN_ONLY_LABELS) {
        await expect(nav.getByText(label, { exact: true })).not.toBeVisible();
      }

      // General items should be visible
      for (const label of GENERAL_LABELS) {
        await expect(nav.getByText(label, { exact: true })).toBeVisible();
      }

      // Org section should NOT be visible (user has no org)
      for (const label of ORG_LABELS) {
        await expect(nav.getByText(label, { exact: true })).not.toBeVisible();
      }
    });
  });
});
