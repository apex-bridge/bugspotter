import { expect } from '@playwright/test';
import { E2E_API_URL } from './config';
import { test } from '../fixtures/setup-fixture';
import { loginAsAdmin } from './helpers/auth-helpers';

// Test credentials constants
const TEST_ADMIN_EMAIL = 'admin@bugspotter.io';
const TEST_ADMIN_PASSWORD = 'admin123';
const TEST_ADMIN_NAME = 'Test Admin';

// Timeout constants
const STANDARD_TIMEOUT = 10000;
const TOAST_TIMEOUT = 5000;

test.describe('API Keys Management', () => {
  // Run tests sequentially to avoid conflicts
  test.describe.configure({ mode: 'serial' });

  let createdKeyPrefix: string | null = null;
  let authToken: string | null = null;
  let createdKeyIds: string[] = [];

  // Setup: Login before each test
  test.beforeEach(async ({ page, setupState, request }) => {
    // Ensure admin user exists first
    await setupState.ensureInitialized({
      email: TEST_ADMIN_EMAIL,
      password: TEST_ADMIN_PASSWORD,
      name: TEST_ADMIN_NAME,
    });

    // Get auth token for API calls if not already cached
    if (!authToken) {
      const loginResponse = await request.post(`${E2E_API_URL}/api/v1/auth/login`, {
        data: {
          email: TEST_ADMIN_EMAIL,
          password: TEST_ADMIN_PASSWORD,
        },
      });

      if (loginResponse.ok()) {
        const data = await loginResponse.json();
        authToken = data.data.access_token;
      }
    }

    // Ensure a test project exists (needed for API key creation)
    if (authToken) {
      await setupState.ensureProjectExists(authToken);
    }

    await loginAsAdmin(page);
    await page.goto('/api-keys', { waitUntil: 'domcontentloaded' });
    // Wait for table or empty state to ensure page is loaded
    await page
      .locator('table')
      .or(page.getByText(/no api keys/i))
      .waitFor({ timeout: STANDARD_TIMEOUT });
  });

  // Cleanup: Remove test data after each test
  test.afterEach(async ({ request }) => {
    // Clean up any API keys created during tests
    if (createdKeyIds.length > 0 && authToken) {
      for (const keyId of createdKeyIds) {
        try {
          // Verify key exists before attempting delete
          const getResponse = await request.get(`${E2E_API_URL}/api/v1/api-keys/${keyId}`, {
            headers: { Authorization: `Bearer ${authToken}` },
          });

          if (getResponse.ok()) {
            await request.delete(`${E2E_API_URL}/api/v1/api-keys/${keyId}`, {
              headers: { Authorization: `Bearer ${authToken}` },
            });
          }
        } catch (error) {
          // Log errors in development for debugging
          if (process.env.NODE_ENV !== 'production') {
            console.warn(`Cleanup failed for key ${keyId}:`, error);
          }
        }
      }
      createdKeyIds = [];
    }
  });

  test('should validate required fields in create dialog', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: /create api key/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Try to submit without filling required fields
    await dialog.getByRole('button', { name: /^create api key$/i }).click();

    // Validation should prevent submission - dialog remains open
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: /create api key/i })).toBeVisible();
  });

  test('should create a new API key successfully', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: /create api key/i }).click();
    const createDialog = page.getByRole('dialog');
    await expect(createDialog).toBeVisible();

    // Fill form
    await createDialog.getByLabel(/name/i).fill('Test E2E API Key');
    await createDialog.getByLabel(/type/i).click();
    await page.getByRole('option', { name: /development/i }).click();

    // Project selection uses checkboxes, not dropdown
    const firstProjectCheckbox = createDialog.getByRole('checkbox').first();
    await firstProjectCheckbox.check();

    // Submit form
    await createDialog.getByRole('button', { name: /^create api key$/i }).click();

    // Wait for success dialog
    const successDialog = page.getByRole('dialog');
    await expect(successDialog.getByRole('heading', { name: /api key created/i })).toBeVisible({
      timeout: STANDARD_TIMEOUT,
    });
    await expect(successDialog.getByText(/only time you'll see/i)).toBeVisible();

    // Get and store the API key prefix (using specific ID from ShowApiKeyDialog component)
    const apiKeyInput = successDialog.locator('#api-key-display');
    await expect(apiKeyInput).toBeVisible();
    const apiKeyValue = await apiKeyInput.inputValue();
    expect(apiKeyValue).toBeTruthy();
    expect(apiKeyValue).toMatch(/^bgs_/);
    createdKeyPrefix = apiKeyValue.substring(0, 10);

    // Verify copy button
    await expect(successDialog.getByRole('button', { name: /copy/i })).toBeVisible();

    // Close dialog (use the primary Close button, not the X)
    await successDialog.getByRole('button', { name: /close/i }).first().click();

    // Verify key appears in table
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator(`code:has-text("${createdKeyPrefix}")`)).toBeVisible();

    // Track created key ID for cleanup
    if (authToken && createdKeyPrefix) {
      const listResponse = await page.request.get(`${E2E_API_URL}/api/v1/api-keys`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (listResponse.ok()) {
        const data = await listResponse.json();
        const createdKey = data.data.find(
          (key: { key_prefix: string; id?: string }) => key.key_prefix === createdKeyPrefix
        );
        if (createdKey?.id) {
          createdKeyIds.push(createdKey.id);
        }
      }
    }
  });

  test('should copy API key prefix to clipboard', async ({ page }) => {
    // Grant clipboard permissions
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // Find and click the first copy button in the table
    const firstRow = page.locator('tbody tr').first();
    const copyButton = firstRow.getByRole('button', { name: /copy/i }).first();
    await copyButton.click();

    // Verify success toast
    await expect(page.getByText(/copied to clipboard/i)).toBeVisible({ timeout: TOAST_TIMEOUT });

    // Verify actual clipboard content
    const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardContent).toBeTruthy();
    expect(clipboardContent).toContain('bgs_');
    // Clipboard should contain the full key prefix (without ellipsis)
    expect(clipboardContent.length).toBeGreaterThanOrEqual(10);
  });

  test('should revoke an API key', async ({ page }) => {
    // Click revoke button
    const firstRow = page.locator('tbody tr').first();
    await firstRow.getByRole('button', { name: /revoke/i }).click();

    // Confirm revoke
    const alertDialog = page.getByRole('alertdialog');
    await expect(alertDialog).toBeVisible();
    await alertDialog.getByRole('button', { name: /^revoke$/i }).click();

    // Verify success toast
    await expect(page.getByText(/revoked successfully/i)).toBeVisible({
      timeout: STANDARD_TIMEOUT,
    });
  });
});
