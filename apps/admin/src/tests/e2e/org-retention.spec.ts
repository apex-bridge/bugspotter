/**
 * E2E Tests — Platform Admin: Org Retention
 * Smoke test for the "pending permanent deletion" tab.
 *
 * Rather than seeding an expired soft-deleted org (which needs either
 * a dedicated seed fixture or direct DB writes), we rely on the default
 * empty-state branch — every clean test DB starts with zero eligible
 * orgs — and intercept the list API call to exercise the populated
 * path and the confirmation dialog's typed-subdomain guard.
 */

import { test, expect } from '../fixtures/setup-fixture';
import { loginAsAdmin } from './helpers/auth-helpers';

const TEST_ADMIN = {
  email: 'admin@bugspotter.io',
  password: 'admin123',
  name: 'Admin User',
};

test.describe('Platform Admin: Org Retention', () => {
  test.beforeEach(async ({ setupState }) => {
    await setupState.ensureInitialized(TEST_ADMIN);
  });

  test('renders the page heading and empty state on a clean DB', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/organizations/retention');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain('/organizations/retention');
    // Either the empty-state message or the table is rendered — both
    // confirm the page loaded past the loading state.
    const emptyMsg = page.getByText(/No organizations are ready/i);
    const table = page.getByRole('table');
    await expect(emptyMsg.or(table)).toBeVisible({ timeout: 10000 });
  });

  test('renders the confirmation dialog with a typed-subdomain guard', async ({ page }) => {
    // Intercept the API call so we don't need to manipulate `deleted_at`
    // on a real org to get it past the retention window.
    await page.route('**/api/v1/admin/organizations/pending-hard-delete', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            retention_days: 30,
            orgs: [
              {
                id: '00000000-0000-0000-0000-000000000001',
                name: 'Test Abandoned Tenant',
                subdomain: 'abandoned-test',
                deleted_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
                deleted_by: null,
                project_count: 2,
                bug_report_count: 17,
                days_since_deleted: 45,
              },
            ],
          },
          timestamp: new Date().toISOString(),
        }),
      })
    );

    await loginAsAdmin(page);
    await page.goto('/organizations/retention');

    // Row rendered from our mocked list.
    await expect(page.getByText('abandoned-test')).toBeVisible({ timeout: 10000 });

    // Open the confirmation dialog.
    await page
      .getByRole('button', { name: /Delete permanently/i })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const submit = dialog.getByRole('button', { name: /^Delete permanently$/i });
    // Delete is disabled until the subdomain is typed exactly.
    await expect(submit).toBeDisabled();

    await dialog.getByLabel(/Subdomain confirmation/i).fill('wrong-value');
    await expect(submit).toBeDisabled();

    await dialog.getByLabel(/Subdomain confirmation/i).fill('abandoned-test');
    await expect(submit).toBeEnabled();
  });

  test('enables delete when an uppercase subdomain is typed (case-insensitive match)', async ({
    page,
  }) => {
    // Subdomains are stored lowercase, but Caps Lock / IME quirks can insert
    // uppercase letters. The dialog normalizes user input before comparing,
    // so `ABANDONED-TEST` should unlock the delete button the same as the
    // lowercase form would.
    await page.route('**/api/v1/admin/organizations/pending-hard-delete', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            retention_days: 30,
            orgs: [
              {
                id: '00000000-0000-0000-0000-000000000001',
                name: 'Test Abandoned Tenant',
                subdomain: 'abandoned-test',
                deleted_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
                deleted_by: null,
                project_count: 2,
                bug_report_count: 17,
                days_since_deleted: 45,
              },
            ],
          },
          timestamp: new Date().toISOString(),
        }),
      })
    );

    await loginAsAdmin(page);
    await page.goto('/organizations/retention');

    await expect(page.getByText('abandoned-test')).toBeVisible({ timeout: 10000 });
    await page
      .getByRole('button', { name: /Delete permanently/i })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const submit = dialog.getByRole('button', { name: /^Delete permanently$/i });
    await dialog.getByLabel(/Subdomain confirmation/i).fill('ABANDONED-TEST');
    await expect(submit).toBeEnabled();
    // The input itself shows the lowercased value (the onChange handler
    // normalizes before updating state), so there's no "looks different
    // from what you typed" surprise for the admin.
    await expect(dialog.getByLabel(/Subdomain confirmation/i)).toHaveValue('abandoned-test');
  });
});
