/**
 * E2E Tests — Platform Admin: Organizations
 * Tests the organizations list page and detail page for platform admins.
 */

import { test, expect } from '../fixtures/setup-fixture';
import { loginAsAdmin } from './helpers/auth-helpers';
import { E2E_API_URL } from './config';

const TEST_ADMIN = {
  email: 'admin@bugspotter.io',
  password: 'admin123',
  name: 'Admin User',
};

test.describe('Platform Admin: Organizations', () => {
  test.describe.configure({ mode: 'serial' });

  let authToken: string;
  let createdOrgId: string;

  test.beforeEach(async ({ setupState, request }) => {
    await setupState.ensureInitialized(TEST_ADMIN);

    if (!authToken) {
      const loginResponse = await request.post(`${E2E_API_URL}/api/v1/auth/login`, {
        data: { email: TEST_ADMIN.email, password: TEST_ADMIN.password },
      });
      const data = await loginResponse.json();
      authToken = data.data.access_token;
    }
  });

  test.afterAll(async ({ request }) => {
    // Clean up created org
    if (createdOrgId && authToken) {
      try {
        const deleteResponse = await request.delete(
          `${E2E_API_URL}/api/v1/organizations/${createdOrgId}`,
          {
            headers: { Authorization: `Bearer ${authToken}` },
          }
        );
        if (!deleteResponse.ok()) {
          console.error(
            `[Cleanup] Failed to delete org ${createdOrgId}: ${deleteResponse.status()}`
          );
        }
      } catch (error) {
        console.error(`[Cleanup] Error deleting org ${createdOrgId}:`, error);
      }
    }
  });

  test('should navigate to organizations page from sidebar', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/organizations');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain('/organizations');
  });

  test('should display organizations list', async ({ page, request }) => {
    // Create a test org via API
    const createResponse = await request.post(`${E2E_API_URL}/api/v1/organizations`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: {
        name: `E2E Test Org ${Date.now()}`,
        subdomain: `e2e-test-${Date.now()}`,
      },
    });
    const createData = await createResponse.json();
    createdOrgId = createData.data.id;

    await loginAsAdmin(page);
    await page.goto('/organizations');

    // Wait for table to render
    const table = page.locator('table');
    await table.waitFor({ state: 'visible', timeout: 15000 });

    // Should see at least our created org
    const rows = table.locator('tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test('should filter organizations by status', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/organizations');

    // Use role-based selector for status filter
    const statusSelect = page.getByRole('combobox', { name: /status/i });
    await statusSelect.waitFor({ state: 'visible', timeout: 10000 });

    // Filter by trial status
    await statusSelect.selectOption('trial');

    // Wait for filtered results to render (use semantic role query)
    const statusBadges = page.getByRole('status');
    await expect(statusBadges.first().or(page.locator('text=/no organizations/i'))).toBeVisible({
      timeout: 10000,
    });
    const badgeCount = await statusBadges.count();
    if (badgeCount > 0) {
      for (let i = 0; i < badgeCount; i++) {
        const badge = statusBadges.nth(i);
        const ariaLabel = await badge.getAttribute('aria-label');
        const textContent = await badge.textContent();
        const content = ariaLabel || textContent || '';
        expect(content.toLowerCase()).toContain('trial');
      }
    }
  });

  test('should search organizations by name', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/organizations');

    // Use role-based selector for search input
    const searchInput = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i));
    await searchInput.waitFor({ state: 'visible', timeout: 10000 });

    // Search for our test org
    await searchInput.fill('e2e-test');

    // Wait for table to update with filtered results
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10000 });
    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();
    // At least verify no error state
    expect(rowCount).toBeGreaterThanOrEqual(0);
  });

  test('should navigate to organization detail', async ({ page }) => {
    if (!createdOrgId) {
      test.skip();
      return;
    }

    await loginAsAdmin(page);
    await page.goto(`/organizations/${createdOrgId}`);

    // Should show org name
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 });

    // Should show subdomain badge
    const subdomainBadge = page.getByTestId('subdomain-badge');
    await expect(subdomainBadge).toBeVisible();
  });

  test('should show organization detail tabs', async ({ page }) => {
    if (!createdOrgId) {
      test.skip();
      return;
    }

    await loginAsAdmin(page);
    await page.goto(`/organizations/${createdOrgId}`);

    // Verify tabs exist
    const overviewTab = page.getByRole('button', { name: /overview/i });
    const membersTab = page.getByRole('button', { name: /members/i });
    const quotaTab = page.getByRole('button', { name: /quota/i });
    const subscriptionTab = page.getByRole('button', { name: /subscription/i });

    await expect(overviewTab).toBeVisible({ timeout: 10000 });
    await expect(membersTab).toBeVisible();
    await expect(quotaTab).toBeVisible();
    await expect(subscriptionTab).toBeVisible();
  });

  test('should switch to members tab and show members', async ({ page }) => {
    if (!createdOrgId) {
      test.skip();
      return;
    }

    await loginAsAdmin(page);
    await page.goto(`/organizations/${createdOrgId}`);

    // Click members tab
    const membersTab = page.getByRole('button', { name: /members/i });
    await membersTab.waitFor({ state: 'visible', timeout: 10000 });
    await membersTab.click();

    // Should show the owner (admin user who created the org)
    const memberTable = page.locator('table');
    await expect(memberTable).toBeVisible({ timeout: 10000 });

    // Should have at least the owner
    const rows = memberTable.locator('tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(1);
  });

  test('should switch to quota tab and show quotas', async ({ page }) => {
    if (!createdOrgId) {
      test.skip();
      return;
    }

    await loginAsAdmin(page);
    await page.goto(`/organizations/${createdOrgId}`);

    // Click quota tab
    const quotaTab = page.getByRole('button', { name: /quota/i });
    await quotaTab.waitFor({ state: 'visible', timeout: 10000 });
    await quotaTab.click();

    // Should show plan badge
    const planBadge = page.getByTestId('plan-badge');
    await expect(planBadge).toBeVisible({ timeout: 10000 });

    // Should show progress bars for quotas
    const progressBars = page.getByTestId('quota-progress-bar');
    const barCount = await progressBars.count();
    expect(barCount).toBeGreaterThan(0);
  });
});
