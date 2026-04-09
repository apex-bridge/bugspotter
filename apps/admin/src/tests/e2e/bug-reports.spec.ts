import { test, expect, type Page } from '../fixtures/setup-fixture';
import { E2E_BASE_HOSTNAME } from './config';

// Test credentials
const TEST_ADMIN = {
  email: 'admin@bugspotter.io',
  password: 'admin123',
  name: 'Test Admin',
};

// Shared authentication helper
async function loginAsAdmin(page: Page) {
  // Check if already logged in (for serial test execution)
  const currentURL = page.url();
  if (currentURL && currentURL.includes(E2E_BASE_HOSTNAME) && !currentURL.includes('/login')) {
    // Already logged in, skip login process
    return;
  }

  await page.goto('/login', { waitUntil: 'networkidle' });

  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });

  await page.fill('input[type="email"]', TEST_ADMIN.email);
  await page.fill('input[type="password"]', TEST_ADMIN.password);

  await page.getByRole('button', { name: /sign in|login/i }).click();

  // Wait for navigation to dashboard
  await page.waitForURL('/dashboard', { timeout: 30000 });

  // Wait for page to fully load
  await page.waitForLoadState('networkidle');
}

test.describe('Bug Reports Management', () => {
  // Run tests sequentially to avoid conflicts
  test.describe.configure({ mode: 'serial' });

  let authToken: string;
  let testProject: { id: string; name: string; api_key: string };

  test.beforeEach(async ({ setupState, request }) => {
    // Ensure admin user exists
    await setupState.ensureInitialized(TEST_ADMIN);

    // Get auth token for API calls if not already cached
    if (!authToken) {
      const API_URL = process.env.API_URL || 'http://localhost:4000';
      const loginResponse = await request.post(`${API_URL}/api/v1/auth/login`, {
        data: {
          email: TEST_ADMIN.email,
          password: TEST_ADMIN.password,
        },
      });

      if (loginResponse.ok()) {
        const data = await loginResponse.json();
        authToken = data.data.access_token;
      }
    }

    // Ensure a test project exists and create sample bug reports
    if (authToken && !testProject) {
      testProject = await setupState.ensureProjectExists(authToken);
      await setupState.createSampleBugReports(testProject.api_key, testProject.id);
    }
  });

  test.afterAll(async ({ request }) => {
    // Cleanup: Delete test project and associated data
    if (authToken && testProject) {
      const API_URL = process.env.API_URL || 'http://localhost:4000';
      await request
        .delete(`${API_URL}/api/v1/projects/${testProject.id}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        })
        .catch(() => {
          // Ignore cleanup errors (project may already be deleted)
        });
    }
  });

  test('should filter bug reports by status', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/bug-reports');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Phase 1: Scoped selector with explicit wait
    const bugReportContainer = page.locator('main').locator('div.space-y-3');
    await bugReportContainer.waitFor({ state: 'visible', timeout: 20000 });

    // Select "Open" status using semantic selector
    const statusSelect = page
      .getByRole('combobox', { name: /status/i })
      .or(page.locator('#filter-status'));
    await statusSelect.waitFor({ state: 'visible' });

    // Phase 2: Start watching for API response BEFORE action
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/reports') && resp.status() === 200,
      { timeout: 15000 }
    );
    await statusSelect.selectOption('open');

    // Wait for API response and reload
    await responsePromise;
    await page.waitForLoadState('networkidle');

    // Phase 1: Scoped bug report cards
    const bugReportCards = bugReportContainer.locator('> div');
    const cardCount = await bugReportCards.count();

    if (cardCount > 0) {
      // Check each card's status badge (within the card, not in dropdowns)
      for (let i = 0; i < cardCount; i++) {
        const card = bugReportCards.nth(i);
        const statusBadge = card.locator('text=/Open/i').first();
        await expect(statusBadge).toBeVisible();
      }
    }
  });

  test('should filter bug reports by priority', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/bug-reports');

    // Phase 1: Scoped selector with explicit wait
    const bugReportContainer = page.locator('main').locator('div.space-y-3');
    await bugReportContainer.waitFor({ state: 'visible', timeout: 20000 });

    // Select "Critical" priority using semantic selector
    const prioritySelect = page
      .getByRole('combobox', { name: /priority/i })
      .or(page.locator('#filter-priority'));
    await prioritySelect.waitFor({ state: 'visible' });

    // Phase 2: Start watching for API response BEFORE action
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/reports') && resp.status() === 200,
      { timeout: 15000 }
    );
    await prioritySelect.selectOption('critical');

    // Wait for API response and reload
    await responsePromise;
    await page.waitForLoadState('networkidle');

    // Phase 1: Scoped bug report cards
    const bugReportCards = bugReportContainer.locator('> div');
    const cardCount = await bugReportCards.count();

    if (cardCount > 0) {
      // Check for critical priority badge using text content
      const firstCard = bugReportCards.first();
      const badge = firstCard.getByText('Critical', { exact: true });
      await expect(badge).toBeVisible();
    }
  });

  test('should clear all filters', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/bug-reports');

    // Phase 3: Use accessibility selector for filters heading
    await expect(page.getByRole('heading', { name: /filters/i })).toBeVisible();

    // Apply some filters
    const statusSelect = page
      .getByRole('combobox', { name: /status/i })
      .or(page.locator('#filter-status'));
    const prioritySelect = page
      .getByRole('combobox', { name: /priority/i })
      .or(page.locator('#filter-priority'));

    await statusSelect.selectOption('open');
    await prioritySelect.selectOption('high');

    // Phase 3: Use accessibility selector for Clear All button
    const clearButton = page.getByRole('button', { name: /Clear All/i });
    await expect(clearButton).toBeVisible();

    // Click Clear All
    await clearButton.click();

    // Wait for filters to reset
    await page.waitForLoadState('networkidle');

    // Verify filters are reset
    await expect(statusSelect).toHaveValue('');
    await expect(prioritySelect).toHaveValue('');
  });

  test('should open bug report detail modal', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/bug-reports');

    // Phase 1: Scoped selector with explicit wait
    const bugReportContainer = page.locator('main').locator('div.space-y-3');
    await bugReportContainer.waitFor({ state: 'visible', timeout: 20000 });

    // Phase 3: Use accessibility selector for View button
    const viewButton = page.getByRole('button', { name: /view/i }).first();
    await viewButton.waitFor({ state: 'visible' });
    await viewButton.click();

    // Verify modal is opened - use more specific selector for the dialog role
    await expect(page.getByRole('dialog')).toBeVisible();

    // Phase 3: Verify tabs are present - tabs are button elements in this UI
    await expect(page.getByRole('button', { name: /Session Replay/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Details & Metadata/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Console Logs/i })).toBeVisible();
  });

  test('should switch tabs in bug report detail modal', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/bug-reports');

    // Phase 1: Scoped selector with explicit wait
    const bugReportContainer = page.locator('main').locator('div.space-y-3');
    await bugReportContainer.waitFor({ state: 'visible', timeout: 20000 });

    // Phase 3: Use accessibility selector for View button
    const viewButton = page.getByRole('button', { name: /view/i }).first();
    await viewButton.waitFor({ state: 'visible' });
    await viewButton.click();

    // Phase 3: Wait for modal and use button role for Details tab
    const detailsTab = page.getByRole('button', { name: /Details & Metadata/i });
    await detailsTab.waitFor({ state: 'visible' });

    // Click Details tab
    await detailsTab.click();
    await page.waitForLoadState('networkidle');

    // Phase 3: Click Console Logs tab using button role
    const consoleTab = page.getByRole('button', { name: /Console Logs/i });
    await consoleTab.click();
    await page.waitForLoadState('networkidle');
  });

  test('should enable edit mode for status and priority', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/bug-reports');

    // Phase 1: Scoped selector with explicit wait
    const bugReportContainer = page.locator('main').locator('div.space-y-3');
    await bugReportContainer.waitFor({ state: 'visible', timeout: 20000 });

    // Phase 3: Use accessibility selector for View button
    const viewButton = page.getByRole('button', { name: /view/i }).first();
    await viewButton.waitFor({ state: 'visible' });
    await viewButton.click();

    // Phase 3: Wait for modal to fully render - check for tabs first (tabs are buttons in this UI)
    await expect(page.getByRole('button', { name: /Session Replay/i })).toBeVisible({
      timeout: 10000,
    });

    // Phase 3: Wait for Edit button in BugReportStatusControls
    const editButton = page.getByRole('button', { name: /Edit Status\/Priority/i });
    await editButton.waitFor({ state: 'visible', timeout: 5000 });

    // Click Edit button
    await editButton.click();

    // Phase 1: Wait for edit mode - find comboboxes within modal dialog
    const modal = page.getByRole('dialog');
    const editControls = modal.locator('[class*="bg-gray"]');
    await editControls.first().waitFor({ state: 'visible', timeout: 5000 });

    // Phase 1: Verify dropdowns appear - scope to edit controls area
    const statusSelect = editControls.locator('select').first();
    const prioritySelect = editControls.locator('select').nth(1);

    await expect(statusSelect).toBeVisible();
    await expect(prioritySelect).toBeVisible();

    // Phase 3: Verify Save and Cancel buttons appear
    await expect(page.getByRole('button', { name: /Save Changes/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Cancel/i })).toBeVisible();
  });

  test('should close modal when X button clicked', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/bug-reports');

    // Phase 1: Scoped selector with explicit wait
    const bugReportContainer = page.locator('main').locator('div.space-y-3');
    await bugReportContainer.waitFor({ state: 'visible', timeout: 20000 });

    // Phase 3: Use accessibility selector for View button
    const viewButton = page.getByRole('button', { name: /view/i }).first();
    await viewButton.waitFor({ state: 'visible' });
    await viewButton.click();

    // Wait for modal to fully render - check for dialog role
    const modal = page.getByRole('dialog');
    await modal.waitFor({ state: 'visible', timeout: 5000 });

    // Click the close button by aria-label
    const closeButton = page.getByRole('button', { name: 'Close modal' });
    await closeButton.click();

    // Wait for modal to close
    await modal.waitFor({ state: 'hidden', timeout: 2000 });

    // Verify modal is closed
    await expect(modal).not.toBeVisible();
  });

  test('should show delete confirmation on first click', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/bug-reports');

    // Phase 1: Scoped selector with explicit wait
    const bugReportContainer = page.locator('main').locator('div.space-y-3');
    await bugReportContainer.waitFor({ state: 'visible', timeout: 20000 });

    // Phase 3: Use accessibility selector for delete button (within scoped container)
    const deleteButton = bugReportContainer
      .getByRole('button', { name: /delete/i })
      .and(page.locator(':not([disabled])'))
      .first();
    await deleteButton.click();

    // Phase 3: Verify confirmation text appears
    await expect(page.getByRole('button', { name: /Confirm\?/i })).toBeVisible();
  });

  test('should disable delete for legal hold reports', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/bug-reports');

    // Phase 3: Wait for page heading using accessibility selector
    await expect(page.getByRole('heading', { level: 1, name: /bug reports/i })).toBeVisible({
      timeout: 15000,
    });

    // Phase 1: Scoped selector with explicit wait
    const bugReportContainer = page.locator('main').locator('div.space-y-3');
    await bugReportContainer.waitFor({ state: 'visible', timeout: 15000 });

    // Look for the security vulnerability report (has legal hold)
    const legalHoldBadge = page.locator('text="Legal Hold"').first();

    // If legal hold exists, check that delete button is disabled
    if (await legalHoldBadge.isVisible()) {
      // Phase 1: Find the ancestor card container (article or div with card styling)
      const card = legalHoldBadge.locator('xpath=ancestor::div[contains(@class, "space-y")][1]');
      const deleteButton = card.getByRole('button', { name: /delete/i });
      await expect(deleteButton).toBeDisabled();
    }
  });

  test('should navigate between pages', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/bug-reports');

    // Wait for page to finish loading
    await page.waitForLoadState('networkidle');

    // Phase 1: Check if we have bug reports or empty state (scoped to main)
    const bugReportContainer = page.locator('main').locator('div.space-y-3');
    const hasBugReports = await bugReportContainer.isVisible({ timeout: 5000 }).catch(() => false);
    const hasEmptyState = await page
      .locator('text=/No Bug Reports|Start capturing bugs/i')
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    // If no bug reports, test passes (empty state is valid)
    if (!hasBugReports && hasEmptyState) {
      return;
    }

    // Phase 1: Wait for bug reports to be fully rendered (scoped)
    await bugReportContainer.waitFor({ state: 'visible', timeout: 10000 });

    // Phase 3: Check if Next button exists (only if there are multiple pages)
    const nextButton = page.getByRole('button', { name: /next/i });

    if ((await nextButton.isVisible()) && !(await nextButton.isDisabled())) {
      // Click Next
      await nextButton.click();

      // Verify page number changed
      await expect(page.locator('text=/Page 2 of/i')).toBeVisible();

      // Phase 3: Click Previous button
      await page.getByRole('button', { name: /previous/i }).click();

      // Verify back to page 1
      await expect(page.locator('text=/Page 1 of/i')).toBeVisible();
    }
  });
});
