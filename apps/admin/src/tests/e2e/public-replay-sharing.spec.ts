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

// ============================================================================
// NAVIGATION HELPERS (DRY Principle)
// ============================================================================

/**
 * Navigate to bug reports list and wait for it to load
 */
async function navigateToBugReportsList(page: Page) {
  await page.goto('/bug-reports');
  await page.waitForSelector('.space-y-3', { state: 'visible', timeout: 20000 });
}

/**
 * Open the first bug report modal (most recently created)
 */
async function openFirstBugReportModal(page: Page) {
  const viewButtons = page.getByRole('button', { name: 'View' });
  await viewButtons.first().click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
}

/**
 * Navigate to bug reports list and open first bug report modal
 * Common pattern used in most tests
 */
async function navigateToFirstBugReport(page: Page) {
  await navigateToBugReportsList(page);
  await openFirstBugReportModal(page);
}

// Helper for tests that specifically test revocation (Tests #13 and #16)
async function revokeShareToken(page: Page) {
  await page.getByRole('button', { name: 'Revoke share link' }).click();
  const confirmDialog = page.locator('[role="dialog"]').last();
  await expect(confirmDialog).toBeVisible();
  await page.getByRole('button', { name: /^Revoke$/i }).click();
  await expect(page.locator('text="Share link revoked successfully"')).toBeVisible({
    timeout: 5000,
  });
  await expect(page.locator('text="Active Share Link"')).not.toBeVisible();
  // Verify form appears after revocation
  await expect(page.locator('label:has-text("Expires In (hours)")')).toBeVisible();
}

test.describe('Public Replay Sharing', () => {
  // Serial mode disabled - each test creates its own bug report with replay
  // Tests are independent and can run in parallel for faster execution
  // test.describe.configure({ mode: 'serial' });

  let authToken: string;
  let testProject: { id: string; name: string; api_key: string };

  test.beforeEach(async ({ setupState, request }) => {
    await setupState.ensureInitialized({
      email: 'admin@bugspotter.io',
      password: 'admin123',
      name: 'Test Admin',
    });

    if (!authToken) {
      const API_URL = process.env.API_URL || 'http://localhost:4000';
      const loginResponse = await request.post(`${API_URL}/api/v1/auth/login`, {
        data: {
          email: 'admin@bugspotter.io',
          password: 'admin123',
        },
      });

      if (loginResponse.ok()) {
        const data = await loginResponse.json();
        authToken = data.data.access_token;
      }
    }

    if (authToken && !testProject) {
      testProject = await setupState.ensureProjectExists(authToken);
      await setupState.createSampleBugReports(testProject.api_key, testProject.id);
    }
  });

  test('should create share link with default settings', async ({ page, setupState }) => {
    await loginAsAdmin(page);
    await setupState.createBugReportWithReplay(testProject.api_key, testProject.id);
    await navigateToFirstBugReport(page);

    // Session Replay tab is active by default, wait for ShareTokenManager
    await expect(page.locator('text="Public Replay Sharing"')).toBeVisible({ timeout: 10000 });

    // Wait for form to load
    await expect(page.locator('#expires-in')).toBeVisible();

    // Default expiration should be 24 hours
    await expect(page.locator('#expires-in')).toHaveValue('24');

    // Click Create Share Link button
    await page.getByRole('button', { name: /Create Share Link/i }).click();

    // Wait for success toast
    await expect(page.locator('text="Share link created successfully"')).toBeVisible({
      timeout: 5000,
    });

    // Verify active share token display appears
    await expect(page.locator('text="Active Share Link"')).toBeVisible();
  });

  test('should validate expiration hours range', async ({ page, setupState }) => {
    await loginAsAdmin(page);
    await setupState.createBugReportWithReplay(testProject.api_key, testProject.id);
    await navigateToFirstBugReport(page);
    // Session Replay tab is active - ShareTokenManager visible by default
    await expect(page.locator('#expires-in')).toBeVisible();

    // Try to create with invalid expiration (0 hours)
    await page.fill('#expires-in', '0');
    await page.getByRole('button', { name: /Create Share Link/i }).click();

    // Verify error message (target form error specifically, not toast)
    await expect(
      page.locator('p.text-sm:has-text("Expiration must be between 1 and 720 hours")')
    ).toBeVisible();

    // Try to create with too large expiration (721 hours)
    await page.fill('#expires-in', '721');
    await page.getByRole('button', { name: /Create Share Link/i }).click();

    // Verify error message (target form error specifically, not toast)
    await expect(
      page.locator('p.text-sm:has-text("Expiration must be between 1 and 720 hours")')
    ).toBeVisible();
  });

  test('should toggle password protection checkbox', async ({ page, setupState }) => {
    await loginAsAdmin(page);
    await setupState.createBugReportWithReplay(testProject.api_key, testProject.id);
    await navigateToFirstBugReport(page);
    // Session Replay tab is active - ShareTokenManager visible by default

    // Verify checkbox is present and unchecked
    const checkbox = page.locator('#password-toggle');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();

    // Click the label to toggle
    await page.click('label[for="password-toggle"]');

    // Verify checkbox is now checked
    await expect(checkbox).toBeChecked();

    // Verify password field appears
    await expect(page.locator('#password')).toBeVisible();

    // Click again to uncheck
    await page.click('label[for="password-toggle"]');
    await expect(checkbox).not.toBeChecked();

    // Verify password field is hidden
    await expect(page.locator('#password')).not.toBeVisible();
  });

  test('should create password-protected share link', async ({ page, setupState }) => {
    await loginAsAdmin(page);
    await setupState.createBugReportWithReplay(testProject.api_key, testProject.id);
    await navigateToFirstBugReport(page);
    // Session Replay tab is active - ShareTokenManager visible by default

    // Enable password protection
    await page.click('label[for="password-toggle"]');
    await expect(page.locator('#password')).toBeVisible();

    // Enter password
    await page.fill('#password', 'SecurePass123');

    // Create share link
    await page.getByRole('button', { name: /Create Share Link/i }).click();

    // Wait for success
    await expect(page.locator('text="Share link created successfully"')).toBeVisible({
      timeout: 5000,
    });

    // Verify Protected badge appears
    await expect(page.locator('text="Protected"')).toBeVisible();
  });

  test('should validate password length', async ({ page, setupState }) => {
    await loginAsAdmin(page);
    await setupState.createBugReportWithReplay(testProject.api_key, testProject.id);
    await navigateToFirstBugReport(page);
    // Session Replay tab is active - ShareTokenManager visible by default

    // Enable password protection
    await page.click('label[for="password-toggle"]');
    await expect(page.locator('#password')).toBeVisible();

    // Enter short password (less than 8 characters)
    await page.fill('#password', 'short');

    // Try to create
    await page.getByRole('button', { name: /Create Share Link/i }).click();

    // Verify error message (target form error specifically, not toast)
    await expect(
      page.locator('p.text-sm:has-text("Password must be at least 8 characters")')
    ).toBeVisible();
  });

  test('should display active share token with copy button', async ({ page, setupState }) => {
    await loginAsAdmin(page);
    await setupState.createBugReportWithReplay(testProject.api_key, testProject.id);
    await navigateToFirstBugReport(page);
    // Session Replay tab is active - ShareTokenManager visible by default
    await expect(page.locator('text="Public Replay Sharing"')).toBeVisible();

    // Create a share link first
    await page.getByRole('button', { name: /Create Share Link/i }).click();
    await expect(page.locator('text="Active Share Link"')).toBeVisible({ timeout: 5000 });

    // Verify copy button has accessible label
    const copyButton = page.getByRole('button', { name: 'Copy share link' });
    await expect(copyButton).toBeVisible();

    // Verify share URL input is readonly
    const urlInput = page.locator('input[readonly]').first();
    await expect(urlInput).toBeVisible();
  });

  test('should open confirmation dialog when revoking share link', async ({ page, setupState }) => {
    await loginAsAdmin(page);
    await setupState.createBugReportWithReplay(testProject.api_key, testProject.id);
    await navigateToFirstBugReport(page);
    // Session Replay tab is active - ShareTokenManager visible by default
    await expect(page.locator('text="Public Replay Sharing"')).toBeVisible();

    // Create a share link
    await page.getByRole('button', { name: /Create Share Link/i }).click();
    await expect(page.locator('text="Active Share Link"')).toBeVisible({ timeout: 5000 });

    // Click revoke button
    await page.getByRole('button', { name: 'Revoke share link' }).click();

    // Wait for confirmation dialog
    const confirmDialog = page.locator('[role="dialog"]').last();
    await expect(confirmDialog).toBeVisible({ timeout: 10000 });

    // Verify dialog title and message with more flexible selectors
    await expect(page.locator('text="Revoke Share Link"')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=/Are you sure.*revoke.*share link/i')).toBeVisible({
      timeout: 5000,
    });

    // Verify Revoke and Cancel buttons
    await expect(page.getByRole('button', { name: /^Revoke$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Cancel/i })).toBeVisible();
  });

  test('should cancel revoke when clicking Cancel in dialog', async ({ page, setupState }) => {
    await loginAsAdmin(page);
    await setupState.createBugReportWithReplay(testProject.api_key, testProject.id);
    await navigateToFirstBugReport(page);
    // Session Replay tab is active - ShareTokenManager visible by default
    await expect(page.locator('text="Public Replay Sharing"')).toBeVisible();

    // Create a share link
    await page.getByRole('button', { name: /Create Share Link/i }).click();
    await expect(page.locator('text="Active Share Link"')).toBeVisible({ timeout: 5000 });

    // Click revoke button
    await page.getByRole('button', { name: 'Revoke share link' }).click();

    // Click Cancel in dialog
    await page.getByRole('button', { name: /Cancel/i }).click();

    // Verify confirmation dialog closes (check for dialog title instead of last dialog)
    await expect(page.locator('text="Revoke Share Link"')).not.toBeVisible({ timeout: 5000 });

    // Verify share link is still active
    await expect(page.locator('text="Active Share Link"')).toBeVisible({ timeout: 5000 });
  });

  test('should revoke share link when confirming', async ({ page, setupState }) => {
    await loginAsAdmin(page);
    await setupState.createBugReportWithReplay(testProject.api_key, testProject.id);
    await navigateToFirstBugReport(page);
    // Session Replay tab is active - ShareTokenManager visible by default
    await expect(page.locator('text="Public Replay Sharing"')).toBeVisible();

    // Create a share link
    await page.getByRole('button', { name: /Create Share Link/i }).click();
    await expect(page.locator('text="Active Share Link"')).toBeVisible({ timeout: 5000 });

    // Revoke share link and wait for complete lifecycle
    await revokeShareToken(page);

    // Verify create form is shown again
    await expect(page.locator('label:has-text("Expires In (hours)")')).toBeVisible();
  });

  test('should show message when no replay available', async ({ page }) => {
    await loginAsAdmin(page);

    // Create a bug report WITHOUT replay (hasReplay: false means no presigned URLs generated)
    const reportData = {
      title: 'Bug Report WITHOUT Replay',
      description: 'This report has no session replay data',
      priority: 'medium',
      hasReplay: false, // Critical: no replay upload URLs will be generated
      report: {
        console: [{ level: 'info', message: 'Test log', timestamp: Date.now() }],
        network: [{ url: 'https://api.test.com', method: 'GET', status: 200 }],
        metadata: {
          userAgent: 'Mozilla/5.0 (Test Browser)',
          viewport: { width: 1920, height: 1080 },
          url: 'https://test.app.com',
        },
      },
    };

    const createResponse = await page.request.post('http://localhost:4000/api/v1/reports', {
      headers: { 'X-API-Key': testProject.api_key },
      data: reportData,
    });

    expect(createResponse.ok()).toBeTruthy();
    await createResponse.json();

    await navigateToFirstBugReport(page);

    // For bug reports without replay, the Session Replay tab might not exist or show a message directly
    // Check if the "no replay available" message is already visible without clicking any tabs
    const noReplayMessage = page.locator('text=/no.*replay.*available/i').first();
    const isMessageVisible = await noReplayMessage.isVisible().catch(() => false);

    if (!isMessageVisible) {
      // If message not immediately visible, try clicking Session Replay tab if it exists
      const sessionReplayTab = page.getByRole('tab', { name: /session replay/i });
      const tabExists = await sessionReplayTab.isVisible().catch(() => false);

      if (tabExists) {
        await sessionReplayTab.click();
      }
    }

    // Look for the "no replay available" message (use .first() to handle multiple matches)
    await expect(noReplayMessage).toBeVisible({ timeout: 5000 });
  });

  test('should allow creating new share link after revocation', async ({ page, setupState }) => {
    await loginAsAdmin(page);
    await setupState.createBugReportWithReplay(testProject.api_key, testProject.id);
    await navigateToFirstBugReport(page);
    // Session Replay tab is active - ShareTokenManager visible by default

    // Create first share link
    await page.getByRole('button', { name: /Create Share Link/i }).click();
    await expect(page.locator('text="Active Share Link"')).toBeVisible({ timeout: 5000 });

    // Revoke it
    await revokeShareToken(page);

    // Create new share link with different settings
    await page.fill('#expires-in', '48');
    await page.getByRole('button', { name: /Create Share Link/i }).click();

    // Verify new share link is created
    await expect(page.locator('text="Share link created successfully"').first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('text="Active Share Link"')).toBeVisible();
  });

  test('should show warning about creating new link', async ({ page, setupState }) => {
    await loginAsAdmin(page);
    await setupState.createBugReportWithReplay(testProject.api_key, testProject.id);
    await navigateToFirstBugReport(page);
    // Session Replay tab is active - ShareTokenManager visible by default

    // Create a share link
    await page.getByRole('button', { name: /Create Share Link/i }).click();
    await expect(page.locator('text="Active Share Link"')).toBeVisible({ timeout: 5000 });

    // Verify warning message
    await expect(
      page.locator('text="Creating a new share link will automatically revoke the current one"')
    ).toBeVisible();
  });
});
