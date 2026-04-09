/**
 * E2E Tests — Org Self-Service: My Organization
 * Tests the org dashboard, members, and usage pages for org members.
 */

import { test, expect } from '../fixtures/setup-fixture';
import { loginAsAdmin } from './helpers/auth-helpers';
import { E2E_API_URL } from './config';

const TEST_ADMIN = {
  email: 'admin@bugspotter.io',
  password: 'admin123',
  name: 'Admin User',
};

test.describe('Org Self-Service: My Organization', () => {
  test.describe.configure({ mode: 'serial' });

  let authToken: string;
  let orgId: string;

  test.beforeAll(async ({ request }) => {
    // Login and create an org for the test user
    const loginResponse = await request.post(`${E2E_API_URL}/api/v1/auth/login`, {
      data: { email: TEST_ADMIN.email, password: TEST_ADMIN.password },
    });
    const loginData = await loginResponse.json();
    authToken = loginData.data.access_token;

    const createResponse = await request.post(`${E2E_API_URL}/api/v1/organizations`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: {
        name: `My Org E2E ${Date.now()}`,
        subdomain: `my-org-e2e-${Date.now()}`,
      },
    });
    const createData = await createResponse.json();
    orgId = createData.data.id;
  });

  test.afterAll(async ({ request }) => {
    if (orgId && authToken) {
      try {
        const deleteResponse = await request.delete(
          `${E2E_API_URL}/api/v1/organizations/${orgId}`,
          {
            headers: { Authorization: `Bearer ${authToken}` },
          }
        );
        if (!deleteResponse.ok()) {
          console.error(`[Cleanup] Failed to delete org ${orgId}: ${deleteResponse.status()}`);
        }
      } catch (error) {
        console.error(`[Cleanup] Error deleting org ${orgId}:`, error);
      }
    }
  });

  test.beforeEach(async ({ setupState }) => {
    await setupState.ensureInitialized(TEST_ADMIN);
  });

  test('should show my organization dashboard', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/my-organization');

    // Should show org name heading
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });

    // Should show stats cards (Plan, Team Members, Billing Status)
    const cards = page.locator('a[href*="my-organization"], div').filter({
      has: page.locator('p.text-xs'),
    });
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show trial banner for trial orgs', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/my-organization');

    // Trial banner should be visible
    const trialBanner = page.getByTestId('trial-banner');
    await expect(trialBanner).toBeVisible({ timeout: 15000 });
  });

  test('should navigate to members page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/my-organization/members');

    // Should show team heading
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });

    // Should show members table with at least the owner
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const rows = table.locator('tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(1);

    // Owner should have role badge
    const ownerBadge = page.getByTestId('role-badge-owner');
    await expect(ownerBadge).toBeVisible();
  });

  test('should show add member form', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/my-organization/members');

    // Click add member button
    const addButton = page.getByRole('button', { name: /add member/i });
    await addButton.waitFor({ state: 'visible', timeout: 10000 });
    await addButton.click();

    // Should show the add form with email input and role select
    const emailInput = page.getByLabel(/email/i);
    await expect(emailInput).toBeVisible({ timeout: 5000 });
    const roleSelect = page.getByLabel(/role/i);
    await expect(roleSelect).toBeVisible();
  });

  test('should navigate to usage page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/my-organization/usage');

    // Should show usage heading
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });

    // Should show plan badge
    const planBadge = page.getByTestId('plan-badge');
    await expect(planBadge).toBeVisible({ timeout: 10000 });

    // Should show quota progress bars
    const progressBars = page.getByTestId('quota-progress-bar');
    await expect(progressBars.first()).toBeVisible({ timeout: 10000 });
    const barCount = await progressBars.count();
    expect(barCount).toBeGreaterThan(0);
  });

  test('should show resource quota details on usage page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/my-organization/usage');

    // Should show resource labels
    const resourceNames = [
      'Projects',
      'Bug Reports',
      'Storage',
      'API Calls',
      'Screenshots',
      'Session Replays',
    ];
    for (const name of resourceNames) {
      const label = page.locator('span').filter({ hasText: name }).first();
      await expect(label).toBeVisible({ timeout: 5000 });
    }
  });

  test('should show organization section in sidebar when org exists', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/my-organization');

    // Sidebar should have organization section
    const orgSection = page.locator('nav').locator('text=/Organization/i');
    await expect(orgSection.first()).toBeVisible({ timeout: 10000 });

    // Should have My Organization, Team, Usage links
    const myOrgLink = page.locator('nav a[href="/my-organization"]');
    await expect(myOrgLink).toBeVisible();
  });
});
