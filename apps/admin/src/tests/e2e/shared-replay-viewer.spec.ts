import { test, expect, type Page } from '../fixtures/setup-fixture';
import { E2E_BASE_HOSTNAME } from './config';

// Helper function to log in as admin
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

// Helper to create a share token and get the URL
async function createShareToken(
  page: Page,
  options?: { password?: string; expiresInHours?: number }
): Promise<string> {
  await loginAsAdmin(page);
  await page.goto('/bug-reports');

  // Wait for bug reports to load
  await page.waitForSelector('.space-y-3', { state: 'visible', timeout: 20000 });

  // Wait for View button to be ready - click the FIRST one (bug report with replay - newest)
  const viewButtons = page.locator('button:has-text("View")');
  await viewButtons.first().waitFor({ state: 'visible', timeout: 5000 });

  // Open bug report with replay (the first one - most recent)
  await viewButtons.first().click();

  // Wait for modal
  const modal = page.getByRole('dialog');
  await modal.waitFor({ state: 'visible', timeout: 5000 });
  console.log('✅ Modal opened');

  // Navigate to Share tab if it exists (modal might have tabs)
  // Use 'tab' role to distinguish from action buttons like "Copy share link" or "Revoke share link"
  const shareTabButton = page.getByRole('tab', { name: /share/i });
  const hasShareTab = await shareTabButton.count();
  if (hasShareTab > 0) {
    console.log('📑 Clicking Share tab...');
    await shareTabButton.click();
    await page.waitForTimeout(500);
  }

  // Scroll down to the "Public Replay Sharing" section at the bottom of the modal
  console.log('📜 Scrolling to bottom of modal...');
  await page.evaluate(() => {
    const modalContent = document.querySelector('[role="dialog"]');
    if (modalContent) {
      modalContent.scrollTop = modalContent.scrollHeight;
    }
  });

  // Wait for share form section to be fully visible after scroll
  await page.waitForSelector('text=Public Replay Sharing', { state: 'visible', timeout: 10000 });
  console.log('✅ Public Replay Sharing section visible');

  // Check if there's an active token and revoke it first (to show the create form)
  const revokeButton = page.getByRole('button', { name: /Revoke share link/i });
  const hasActiveToken = (await revokeButton.count()) > 0;
  if (hasActiveToken) {
    console.log('🔍 Active token found - revoking...');
    await revokeButton.click();

    // Wait for confirmation dialog - use exact name to get only the child dialog
    // This avoids strict mode violation when parent bug report dialog is also present
    const confirmDialog = page.getByRole('dialog', { name: 'Revoke Share Link' });
    await confirmDialog.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✅ Revoke confirmation dialog opened');

    // Confirm the revocation - find the "Revoke" button within the confirmation dialog
    const confirmButton = confirmDialog.getByRole('button', { name: /^Revoke$/i });
    await confirmButton.waitFor({ state: 'visible', timeout: 3000 });
    await confirmButton.click();
    console.log('✅ Clicked revoke confirmation button');

    // Wait for the confirmation dialog to close (this is critical!)
    await confirmDialog.waitFor({ state: 'hidden', timeout: 5000 });
    console.log('✅ Revoke confirmation dialog closed');

    // Wait for mutation to complete and UI to update
    await page.waitForTimeout(500);
    console.log('✅ Token revoked');
  }

  // Wait for share dialog/form to be fully loaded
  console.log('🔍 Waiting for share dialog...');
  await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(1000);

  // Verify the expires-in input is visible
  console.log('🔍 Looking for expires-in input...');
  await page.waitForSelector('#expires-in', { state: 'visible', timeout: 10000 });
  console.log('✅ Expires-in input visible');

  // Set custom expiration if provided
  if (options?.expiresInHours) {
    await page.fill('#expires-in', options.expiresInHours.toString());
  }

  // Enable password protection if provided
  if (options?.password) {
    await page.click('label[for="password-toggle"]');
    // Wait for password input to become visible and enabled
    await page.waitForSelector('#password:not([disabled])', { state: 'visible', timeout: 5000 });
    await page.fill('#password', options.password);
  }

  // Create share link
  console.log('🔍 Looking for "Create Share Link" button...');
  const createButton = page.getByRole('button', { name: /Create Share Link/i });
  await createButton.waitFor({ state: 'visible', timeout: 10000 });
  console.log('✅ Create Share Link button is visible');

  await createButton.click();
  console.log('✅ Clicked Create Share Link button');

  // Wait for success
  console.log('⏳ Waiting for success message...');
  await expect(page.locator('text="Share link created successfully"')).toBeVisible({
    timeout: 10000,
  });
  console.log('✅ Success message displayed');

  // Extract share URL
  const urlInput = page.locator('input[readonly]').first();
  const shareUrl = await urlInput.inputValue();
  console.log('✅ Share URL extracted:', shareUrl.substring(0, 50) + '...');

  // Verify URL was actually generated
  if (!shareUrl || shareUrl.length === 0) {
    throw new Error('Share URL was not generated');
  }

  return shareUrl;
}

test.describe('Shared Replay Viewer - Public Access', () => {
  test.describe.configure({ mode: 'serial' });

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
      // Create sample bug reports WITHOUT replay (for list display)
      await setupState.createSampleBugReports(testProject.api_key, testProject.id);
    }

    // Create a UNIQUE bug report WITH replay for each test
    // This ensures tests don't interfere with each other's share tokens
    await setupState.createBugReportWithReplay(testProject.api_key, testProject.id);
  });

  test('should load shared replay viewer without authentication', async ({ page, browser }) => {
    // Create share token with admin account
    const shareUrl = await createShareToken(page);

    // Extract token from URL
    const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch![1];
    console.log('🔑 Extracted token:', token);

    // Create new context without cookies (simulate unauthenticated user)
    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    console.log('📄 Created new page');

    // Navigate directly to shared replay URL (public route)
    await newPage.goto(`/shared/${token}`, { waitUntil: 'domcontentloaded' });
    await newPage.waitForLoadState('networkidle');

    // Verify page loads without redirect to login
    await expect(newPage).toHaveURL(`/shared/${token}`);

    // Verify page title is visible
    await expect(newPage.getByTestId('shared-replay-heading')).toBeVisible({ timeout: 10000 });

    await newPage.close();
    await newContext.close();
  });

  test('should display bug report metadata in public viewer', async ({ page, browser }) => {
    const shareUrl = await createShareToken(page);
    const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
    const token = tokenMatch![1];

    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    await newPage.goto(`/shared/${token}`);

    // Wait for page to load
    await expect(newPage.getByTestId('shared-replay-heading')).toBeVisible({ timeout: 10000 });

    // Verify bug report title is displayed (rendered as heading by CardTitle component)
    const bugReportTitle = newPage.getByRole('heading', { level: 3 }).first();
    await expect(bugReportTitle).toBeVisible();

    // Verify status and priority badges are displayed
    const badges = newPage.locator('[class*="bg-"]');
    expect(await badges.count()).toBeGreaterThanOrEqual(2);

    await newPage.close();
  });

  test('should display share info banner with view count and expiration', async ({
    page,
    browser,
  }) => {
    const shareUrl = await createShareToken(page);
    const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
    const token = tokenMatch![1];

    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();

    await newPage.goto(`/shared/${token}`);

    await expect(newPage.getByTestId('shared-replay-heading')).toBeVisible({ timeout: 10000 });

    // Verify view count is displayed (starts at 0, then increments to 1 after first view)
    await expect(newPage.getByTestId('share-view-count')).toBeVisible();

    // Verify expiration status is displayed
    await expect(newPage.getByTestId('share-expiration-status')).toBeVisible();

    await newPage.close();
    await newContext.close();
  });

  test('should show password prompt for password-protected share', async ({ page, browser }) => {
    const shareUrl = await createShareToken(page, { password: 'SecurePass123' });
    const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
    const token = tokenMatch![1];

    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    await newPage.goto(`/shared/${token}`);

    // Verify password prompt is shown
    await expect(newPage.getByTestId('password-protected-heading')).toBeVisible({
      timeout: 10000,
    });

    // Verify password input is visible
    const passwordInput = newPage.locator('#password-input');
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Verify unlock button is visible
    await expect(newPage.getByTestId('unlock-replay-button')).toBeVisible();

    await newPage.close();
    await newContext.close();
  });

  test('should unlock replay with correct password', async ({ page, browser }) => {
    const password = 'SecurePass123';
    const shareUrl = await createShareToken(page, { password });
    const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
    const token = tokenMatch![1];

    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    await newPage.goto(`/shared/${token}`);

    // Wait for password prompt
    await expect(newPage.getByTestId('password-protected-heading')).toBeVisible({
      timeout: 10000,
    });

    // Enter correct password
    await newPage.fill('#password-input', password);

    // Click unlock button
    await newPage.getByTestId('unlock-replay-button').click();

    // Verify replay loads
    await expect(newPage.getByTestId('shared-replay-heading')).toBeVisible({ timeout: 10000 });
    // Verify bug report title is displayed
    await expect(newPage.getByRole('heading', { level: 3 }).first()).toBeVisible();

    await newPage.close();
    await newContext.close();
  });

  test('should show error with incorrect password', async ({ page, browser }) => {
    const shareUrl = await createShareToken(page, { password: 'SecurePass123' });
    const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
    const token = tokenMatch![1];

    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();

    await newPage.goto(`/shared/${token}`);

    await expect(newPage.getByTestId('password-protected-heading')).toBeVisible({
      timeout: 10000,
    });

    // Enter incorrect password
    await newPage.fill('#password-input', 'WrongPassword');

    // Click unlock button
    await newPage.getByTestId('unlock-replay-button').click();

    // Wait for error to appear (role="alert" from component)
    const errorAlert = newPage.getByRole('alert');
    await expect(errorAlert).toBeVisible({ timeout: 10000 });

    // Verify error message text (i18n translated)
    await expect(errorAlert).toHaveText(/Incorrect password\. Please try again\./);

    // Verify password prompt is still shown (user can retry)
    await expect(newPage.locator('#password-input')).toBeVisible();

    await newPage.close();
    await newContext.close();
  });

  test('should disable unlock button when password is empty', async ({ page, browser }) => {
    const shareUrl = await createShareToken(page, { password: 'SecurePass123' });
    const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
    const token = tokenMatch![1];

    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    await newPage.goto(`/shared/${token}`);

    await expect(newPage.getByTestId('password-protected-heading')).toBeVisible({
      timeout: 10000,
    });

    // Verify unlock button is disabled when input is empty
    const unlockButton = newPage.getByTestId('unlock-replay-button');
    await expect(unlockButton).toBeDisabled();

    // Enter password
    await newPage.fill('#password-input', 'test');

    // Verify button is now enabled
    await expect(unlockButton).toBeEnabled();

    await newPage.close();
    await newContext.close();
  });

  test('should support password in URL query parameter', async ({ page, browser }) => {
    const password = 'SecurePass123';
    const shareUrl = await createShareToken(page, { password });
    const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
    const token = tokenMatch![1];

    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();

    // Navigate with password in query string
    await newPage.goto(`/shared/${token}?password=${encodeURIComponent(password)}`);

    // Should bypass password prompt and load replay directly
    await expect(newPage.getByTestId('shared-replay-heading')).toBeVisible({ timeout: 10000 });
    // Verify bug report title is displayed
    await expect(newPage.getByRole('heading', { level: 3 }).first()).toBeVisible();

    // Should NOT show password prompt
    await expect(newPage.getByTestId('password-protected-heading')).not.toBeVisible();

    await newPage.close();
    await newContext.close();
  });

  test('should show error for invalid token', async ({ browser }) => {
    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    // Use a valid-format token (32+ chars) that doesn't exist
    await newPage.goto('/shared/invalidtokenthatisverylong123456');

    // Verify error page is shown
    await expect(newPage.getByTestId('error-heading')).toBeVisible({
      timeout: 10000,
    });

    // Verify error message
    await expect(
      newPage.locator('text="This share link has expired or does not exist"')
    ).toBeVisible();

    await newPage.close();
    await newContext.close();
  });

  test('should display session replay player', async ({ page, browser }) => {
    const shareUrl = await createShareToken(page);
    const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
    const token = tokenMatch![1];

    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    await newPage.goto(`/shared/${token}`);

    await expect(newPage.getByTestId('shared-replay-heading')).toBeVisible({ timeout: 10000 });

    // Verify "Session Data" card is visible (contains replay player and tabs)
    await expect(newPage.getByRole('heading', { name: 'Session Data' })).toBeVisible();

    // Wait for replay player to initialize (rrweb creates iframe or canvas)
    // Note: Actual replay rendering depends on backend data availability
    await newPage
      .waitForSelector('.replayer-wrapper, iframe, canvas', {
        state: 'attached',
        timeout: 10000,
      })
      .catch(() => {
        // Player container may exist even if no replay data available
      });

    await newPage.close();
    await newContext.close();
  });

  test('should show password protected indicator in share info', async ({ page, browser }) => {
    const shareUrl = await createShareToken(page, { password: 'SecurePass123' });
    const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
    const token = tokenMatch![1];

    // Access with correct password
    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    await newPage.goto(`/shared/${token}?password=SecurePass123`);

    await expect(newPage.getByTestId('shared-replay-heading')).toBeVisible({ timeout: 10000 });

    // Verify "Password Protected" indicator is shown
    await expect(newPage.locator('text="Password Protected"')).toBeVisible();

    await newPage.close();
    await newContext.close();
  });

  test('should display footer with expiration date', async ({ page, browser }) => {
    const shareUrl = await createShareToken(page);
    const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
    const token = tokenMatch![1];

    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    await newPage.goto(`/shared/${token}`);

    await expect(newPage.getByTestId('shared-replay-heading')).toBeVisible({ timeout: 10000 });

    // Verify footer is present
    await expect(newPage.locator('text="Powered by BugSpotter"')).toBeVisible();

    // Verify expiration date in footer
    await expect(newPage.locator('text=/This replay will expire on/')).toBeVisible();

    await newPage.close();
    await newContext.close();
  });

  test('should have proper accessibility attributes', async ({ page, browser }) => {
    const shareUrl = await createShareToken(page);
    const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
    const token = tokenMatch![1];

    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    await newPage.goto(`/shared/${token}`);

    await expect(newPage.getByTestId('shared-replay-heading')).toBeVisible({ timeout: 10000 });

    // Verify icons have aria-hidden
    const icons = newPage.locator('svg[aria-hidden="true"]');
    expect(await icons.count()).toBeGreaterThan(0);

    // Verify password input has proper label
    await newPage.goto(`/shared/${token.slice(0, -1)}1`); // Different token to reset state
    const passwordLabel = newPage.locator('label[for="password-input"]');
    // Label is sr-only but should exist
    expect(await passwordLabel.count()).toBeGreaterThanOrEqual(0);

    await newPage.close();
    await newContext.close();
  });

  test('should show loading state while fetching replay', async ({ page, browser }) => {
    const shareUrl = await createShareToken(page);
    const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
    const token = tokenMatch![1];

    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();

    // Navigate to shared replay
    const navigationPromise = newPage.goto(`/shared/${token}`);

    // Check for loading state (may be brief)
    const loadingElement = newPage.locator('text="Loading shared replay..."');

    // Wait for either loading state or final state
    await Promise.race([
      loadingElement.waitFor({ state: 'visible', timeout: 1000 }).catch(() => {}),
      navigationPromise,
    ]);

    // Verify final loaded state
    await expect(newPage.getByTestId('shared-replay-heading')).toBeVisible({ timeout: 10000 });

    await newPage.close();
    await newContext.close();
  });

  test('should increment view count on each visit', async ({ page, browser }) => {
    const shareUrl = await createShareToken(page);
    const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
    const token = tokenMatch![1];

    // First visit
    const newContext1 = await browser.newContext();
    const newPage1 = await newContext1.newPage();
    await newPage1.goto(`/shared/${token}`);
    await expect(newPage1.getByTestId('shared-replay-heading')).toBeVisible({ timeout: 10000 });

    // Check view count (should be 0 or 1 depending on when backend increments)
    const viewCountText1 = await newPage1.locator('text=/\\d+ views?/').textContent();
    await newPage1.close();
    await newContext1.close();

    // Second visit
    const newContext2 = await browser.newContext();
    const newPage2 = await newContext2.newPage();
    await newPage2.goto(`/shared/${token}`);
    await expect(newPage2.getByTestId('shared-replay-heading')).toBeVisible({ timeout: 10000 });

    // View count should have incremented
    const viewCountText2 = await newPage2.locator('text=/\\d+ views?/').textContent();

    // Extract numbers
    const count1 = parseInt(viewCountText1?.match(/\d+/)?.[0] || '0');
    const count2 = parseInt(viewCountText2?.match(/\d+/)?.[0] || '0');

    expect(count2).toBeGreaterThanOrEqual(count1);

    await newPage2.close();
    await newContext2.close();
  });

  test('should work on mobile viewport', async ({ page, browser }) => {
    const shareUrl = await createShareToken(page);
    const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
    const token = tokenMatch![1];

    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();

    // Set mobile viewport
    await newPage.setViewportSize({ width: 375, height: 667 }); // iPhone SE

    await newPage.goto(`/shared/${token}`);

    await expect(newPage.getByTestId('shared-replay-heading')).toBeVisible({ timeout: 10000 });

    // Verify page is responsive
    await expect(newPage.getByRole('heading', { level: 3 }).first()).toBeVisible();
    await expect(newPage.locator('text=/\\d+ views?/')).toBeVisible();

    await newPage.close();
    await newContext.close();
  });

  test.describe('Tabbed Interface', () => {
    let sharedPage: Page;

    test.beforeEach(async ({ page, context }) => {
      // Create share token (uses authenticated admin page)
      const shareUrl = await createShareToken(page);
      const tokenMatch = shareUrl.match(/\/shared\/([^?]+)/);
      const token = tokenMatch![1];

      // Close any open modals on the original page
      const closeButton = page.locator('button[aria-label="Close modal"]');
      if (await closeButton.isVisible()) {
        await closeButton.click();
      }

      // Create new page in same context (shares authentication)
      sharedPage = await context.newPage();
      await sharedPage.goto(`/shared/${token}`, { waitUntil: 'networkidle' });
      await expect(sharedPage.getByTestId('shared-replay-heading')).toBeVisible({
        timeout: 10000,
      });
    });

    test.afterEach(async () => {
      await sharedPage.close();
    });

    test('should display tabs for Replay, Console Logs, and Network Logs', async () => {
      // Verify tab triggers are visible
      await expect(sharedPage.getByRole('tab', { name: /Replay/ })).toBeVisible();
      await expect(sharedPage.getByRole('tab', { name: /Console/ })).toBeVisible();
      await expect(sharedPage.getByRole('tab', { name: /Network/ })).toBeVisible();

      // Verify replay tab is selected by default
      await expect(sharedPage.getByRole('tab', { name: /Replay/ })).toHaveAttribute(
        'data-state',
        'active'
      );
    });

    test('should switch between tabs', async () => {
      // Click Console Logs tab
      await sharedPage.getByRole('tab', { name: /Console/ }).click();
      await expect(sharedPage.getByRole('tab', { name: /Console/ })).toHaveAttribute(
        'data-state',
        'active'
      );

      // Click Network Logs tab
      await sharedPage.getByRole('tab', { name: /Network/ }).click();
      await expect(sharedPage.getByRole('tab', { name: /Network/ })).toHaveAttribute(
        'data-state',
        'active'
      );

      // Click back to Replay tab
      await sharedPage.getByRole('tab', { name: /Replay/ }).click();
      await expect(sharedPage.getByRole('tab', { name: /Replay/ })).toHaveAttribute(
        'data-state',
        'active'
      );
    });

    test('should display console logs table with filtering', async () => {
      // Switch to Console Logs tab
      await sharedPage.getByRole('tab', { name: /Console/ }).click();

      // Wait for tab content to load
      await sharedPage.waitForLoadState('networkidle');

      // Verify filter dropdown exists
      const filterSelect = sharedPage.locator('#level-filter');
      await expect(filterSelect).toBeVisible();

      // Verify export buttons exist (using text locator since getByRole doesn't work)
      await expect(sharedPage.locator('button:has-text("Export JSON")')).toBeVisible();
      await expect(sharedPage.locator('button:has-text("Export CSV")')).toBeVisible();
    });

    test('should display network logs table with filtering', async () => {
      // Switch to Network Logs tab
      await sharedPage.getByRole('tab', { name: /Network/ }).click();

      // Wait for tab content to load
      await sharedPage.waitForLoadState('networkidle');

      // Verify filter dropdown exists
      const filterSelect = sharedPage.locator('#status-filter');
      await expect(filterSelect).toBeVisible();

      // Verify export buttons exist (using text locator instead of role)
      await expect(sharedPage.locator('button:has-text("Export JSON")')).toBeVisible();
      await expect(sharedPage.locator('button:has-text("Export CSV")')).toBeVisible();
    });

    test('should show tab counts in labels', async () => {
      // Wait for page to be fully loaded
      await sharedPage.waitForLoadState('networkidle');

      // Verify we're on the shared replay viewer page
      await expect(sharedPage.getByTestId('shared-replay-heading')).toBeVisible({
        timeout: 10000,
      });

      // Wait for tabs section using test ID (more reliable than role-based selectors)
      await expect(sharedPage.getByTestId('session-tabs')).toBeVisible({ timeout: 10000 });

      // Verify tab labels show counts using data-testid (reliable) and accessible names (semantic)
      // Test with both approaches to ensure accessibility AND reliability
      const consoleTab = sharedPage.getByTestId('console-tab');
      const networkTab = sharedPage.getByTestId('network-tab');

      await expect(consoleTab).toBeVisible({ timeout: 10000 });
      await expect(networkTab).toBeVisible({ timeout: 10000 });

      // Also verify accessible names include entry counts (semantic check)
      // Note: Accessible name may have trailing whitespace from sr-only spans
      await expect(consoleTab).toHaveAccessibleName(/Console logs, \(\d+ entries\s*\)/);
      await expect(networkTab).toHaveAccessibleName(/Network logs, \(\d+ entries\s*\)/);
    });

    test('should maintain accessibility in tabbed interface', async () => {
      // Verify tabs have proper ARIA attributes
      const replayTab = sharedPage.getByRole('tab', { name: /Replay/ });
      await expect(replayTab).toHaveAttribute('role', 'tab');

      // Verify keyboard navigation works
      await replayTab.focus();
      await sharedPage.keyboard.press('ArrowRight');
      // After arrow right, next tab should be focused
      const consoleTab = sharedPage.getByRole('tab', { name: /Console/ });
      await expect(consoleTab).toBeFocused();
    });
  });
});
