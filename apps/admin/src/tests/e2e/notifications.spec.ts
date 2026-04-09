/**
 * Notifications E2E Test
 * Tests notification page loads and basic UI elements are present
 *
 * Note: Full CRUD operations are not tested here as they require
 * backend implementation of notification channels/rules which is
 * tracked separately. These tests verify the UI renders correctly.
 */

import { test, expect, type Page } from '../fixtures/setup-fixture';
import { E2E_BASE_HOSTNAME } from './config';

// Shared authentication helper
async function loginAsAdmin(page: Page) {
  const currentURL = page.url();
  if (currentURL && currentURL.includes(E2E_BASE_HOSTNAME) && !currentURL.includes('/login')) {
    return;
  }

  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });

  await page.fill('input[type="email"]', 'admin@bugspotter.io');
  await page.fill('input[type="password"]', 'admin123');

  await page.getByRole('button', { name: /sign in|login/i }).click();

  await page.waitForURL('/dashboard', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
}

test.describe('Notifications E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ setupState }) => {
    await setupState.ensureInitialized();
  });

  test('should open create rule dialog', async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto('/notifications', { waitUntil: 'networkidle' });

    // Switch to Rules tab
    await page.getByRole('tab', { name: 'Rules' }).click();

    // Click New Rule button
    await page.getByRole('button', { name: /new rule/i }).click();

    // Dialog should open
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Create Notification Rule')).toBeVisible();

    // Should see form fields
    await expect(page.locator('input[id="name"]')).toBeVisible();
    await expect(page.locator('button[id="project"]')).toBeVisible();
    await expect(page.locator('button[id="trigger"]')).toBeVisible();

    // Close dialog with Escape
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });
  });
});
