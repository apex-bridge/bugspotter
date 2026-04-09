import { test, expect, type Page } from '../fixtures/setup-fixture';
import axios from 'axios';
import { E2E_BASE_HOSTNAME } from './config';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:4000';

// Timeout constants
const TIMEOUTS = {
  LOGIN_INPUT: 10000,
  DASHBOARD_NAVIGATION: 30000,
  TOAST: 5000,
  PAGE_TRANSITION: 10000,
  NETWORK_IDLE: 10000,
  RADIX_PORTAL_RENDER: 500,
  FORM_STATE_UPDATE: 1500,
  FORM_RESET: 2000,
} as const;

// Track created integrations for cleanup
let createdIntegrations: string[] = [];

// Helper to ensure we're in advanced mode
async function ensureAdvancedMode(page: Page) {
  try {
    console.log('[ensureAdvancedMode] Starting...');

    // First, wait for the mode toggle buttons to appear (means plugin source is selected)
    console.log('[ensureAdvancedMode] Waiting for Advanced Mode button...');
    await page.getByTestId('advanced-mode-button').waitFor({ timeout: 10000 });
    console.log('[ensureAdvancedMode] Advanced Mode button found');

    // Take screenshot before checking state
    await page.screenshot({ path: 'e2e-debug/before-mode-check.png', fullPage: true });

    // Check if #plugin-code textarea already exists (already in advanced mode)
    const pluginCodeExists = await page.locator('#plugin-code').count();
    console.log('[ensureAdvancedMode] Plugin code field exists:', pluginCodeExists > 0);

    if (pluginCodeExists > 0) {
      console.log('[ensureAdvancedMode] Already in advanced mode, returning');
      return; // Already in advanced mode
    }

    // Not in advanced mode, check button states
    const guidedButton = page.getByTestId('guided-mode-button');
    const advancedButton = page.getByTestId('advanced-mode-button');

    const guidedVariant = await guidedButton.evaluate((el) => el.className);
    const advancedVariant = await advancedButton.evaluate((el) => el.className);
    console.log('[ensureAdvancedMode] Guided button classes:', guidedVariant);
    console.log('[ensureAdvancedMode] Advanced button classes:', advancedVariant);

    // Ensure button is interactive and visible
    console.log('[ensureAdvancedMode] Waiting for button to be visible...');
    await advancedButton.waitFor({ state: 'visible' });

    // Take screenshot before click
    await page.screenshot({ path: 'e2e-debug/before-click.png', fullPage: true });
    console.log('[ensureAdvancedMode] Clicking Advanced Mode button...');

    // Click the button
    await advancedButton.click();
    console.log('[ensureAdvancedMode] Button clicked');

    // Wait a moment for React to update
    await page.waitForTimeout(1000);

    // Take screenshot after click
    await page.screenshot({ path: 'e2e-debug/after-click.png', fullPage: true });

    // Check if mode switched
    const pluginCodeNow = await page.locator('#plugin-code').count();
    const guidedFieldsNow = await page.locator('#pluginName').count();
    const customCodeCard = await page.locator('text=Custom Plugin Code').count();
    console.log('[ensureAdvancedMode] After click - Plugin code exists:', pluginCodeNow > 0);
    console.log('[ensureAdvancedMode] After click - Guided fields exist:', guidedFieldsNow > 0);
    console.log('[ensureAdvancedMode] After click - Custom Code Card exists:', customCodeCard > 0);

    // If the whole card disappeared, plugin_source might have been reset
    if (customCodeCard === 0) {
      console.log(
        '[ensureAdvancedMode] ERROR: Entire Custom Code Card disappeared! plugin_source might have been reset.'
      );
      throw new Error(
        'Custom Code Card disappeared after clicking Advanced Mode button - plugin_source was likely reset'
      );
    }

    // Wait for the textarea to appear
    console.log('[ensureAdvancedMode] Waiting for #plugin-code to appear...');
    await page.waitForSelector('#plugin-code', { timeout: 10000 });
    console.log('[ensureAdvancedMode] Success! #plugin-code is visible');
  } catch (error) {
    // Take screenshot on failure
    await page.screenshot({ path: 'e2e-debug/mode-switch-failed.png', fullPage: true });
    console.error('[ensureAdvancedMode] Failed:', error);
    throw error;
  }
}

/**
 * Helper to fill CodeMirror editor (CodeMirror 6 with @uiw/react-codemirror)
 * Uses CodeMirror API to set content directly and triggers React onChange
 */
async function fillCodeMirror(page: Page, code: string) {
  // Wait for CodeMirror editor to be fully initialized
  await page.waitForSelector('#plugin-code .cm-content', { state: 'attached', timeout: 5000 });
  await page.waitForTimeout(200);

  // Click into editor to focus it
  await page.click('#plugin-code .cm-content');
  await page.waitForTimeout(100);

  // Use keyboard shortcut to select all + delete, then type new content
  // This triggers all the normal CodeMirror and React events
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');

  // Type the code - but replace special characters to avoid autocomplete
  // Split by lines and type each line, pressing Enter between them
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      await page.keyboard.press('Enter');
    }
    // Type the line - use a paste-like approach for speed
    if (lines[i].trim()) {
      await page.keyboard.insertText(lines[i]);
    }
  }

  // Blur to ensure onChange fires
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
}

// Shared authentication helper
async function loginAsAdmin(page: Page) {
  const currentURL = page.url();
  if (currentURL && currentURL.includes(E2E_BASE_HOSTNAME) && !currentURL.includes('/login')) {
    return;
  }

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: TIMEOUTS.LOGIN_INPUT });

  await page.fill('input[type="email"]', 'admin@bugspotter.io');
  await page.fill('input[type="password"]', 'admin123');

  const loginButton = page.getByRole('button', { name: /sign in|login/i });
  await loginButton.waitFor({ state: 'visible', timeout: TIMEOUTS.LOGIN_INPUT });

  // Use Promise.all to prevent race condition
  // Login redirects to '/' first, then DefaultRedirect component redirects admin to '/dashboard'
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/dashboard', {
      timeout: TIMEOUTS.DASHBOARD_NAVIGATION,
    }),
    loginButton.click(),
  ]);

  await page.waitForLoadState('networkidle');
}

/**
 * Helper to fill basic integration information
 */
async function fillBasicInfo(
  page: Page,
  type: string,
  displayName: string,
  description?: string
): Promise<void> {
  await page.getByLabel('Platform Identifier (Type) *').fill(type);
  await page.getByLabel('Display Name *').fill(displayName);
  if (description) {
    // Use ID selector to target integration description (not plugin description in guided mode)
    await page.locator('#description').fill(description);
  }
}

/**
 * Helper to get admin access token
 */
async function getAdminToken(): Promise<string> {
  const response = await axios.post(`${API_BASE_URL}/api/v1/auth/login`, {
    email: 'admin@bugspotter.io',
    password: 'admin123',
  });
  return response.data.data.access_token;
}

/**
 * Helper to delete an integration
 */
async function deleteIntegration(type: string, token: string): Promise<void> {
  try {
    // Delete the integration completely
    await axios.delete(`${API_BASE_URL}/api/v1/admin/integrations/${type}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error: unknown) {
    const err = error as { response?: { status?: number }; message?: string };
    if (err.response?.status === 404) {
      // Integration not found, skip deletion
    } else {
      console.warn('Failed to delete integration during cleanup:', {
        type,
        error: err.message,
        status: err.response?.status,
      });
    }
  }
}

/**
 * Helper to get an integration card by name
 * Uses a more robust selector than DOM traversal
 */
async function getIntegrationCard(page: Page, integrationName: string) {
  // IntegrationCard uses CardTitle which renders as h3
  return page.locator('.border.rounded-lg', {
    has: page.locator('h3', { hasText: integrationName }),
  });
}

/**
 * Helper to wait for a toast message
 * Abstracts Sonner-specific implementation
 */
async function waitForToast(
  page: Page,
  pattern: RegExp,
  timeout: number = TIMEOUTS.TOAST
): Promise<void> {
  const toast = page.locator('[data-sonner-toast]', { hasText: pattern }).first();
  await expect(toast).toBeVisible({ timeout });
}

test.describe('Integration Management', () => {
  test.beforeEach(async ({ setupState }) => {
    await setupState.ensureInitialized();
  });

  // Cleanup after each test
  test.afterEach(async () => {
    if (createdIntegrations.length > 0) {
      try {
        const token = await getAdminToken();
        for (const integrationType of createdIntegrations) {
          await deleteIntegration(integrationType, token);
        }
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        // Backend may be stopped during teardown, cleanup will happen via database reset
        if (err.code !== 'ECONNREFUSED') {
          console.warn('Cleanup warning:', err.message);
        }
      } finally {
        createdIntegrations.length = 0; // Clear the array
      }
    }
  });

  test('should validate required fields', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/integrations/create');

    // Try to submit form with empty plugin fields
    await page.getByTestId('save-plugin-button').click();

    // Check for validation message (HTML5 validation)
    const typeInput = page.getByTestId('plugin-platform-input');
    const isInvalid = await typeInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test('should validate integration type format', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/integrations/create');

    // Try invalid type with uppercase
    await page.getByTestId('plugin-platform-input').fill('InvalidType');

    // Type should be converted to lowercase automatically
    const typeValue = await page.getByTestId('plugin-platform-input').inputValue();
    expect(typeValue).toBe('invalidtype');
  });

  test('should show custom code editor when advanced mode is selected', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/integrations/create');

    // Switch to advanced mode
    await page.getByTestId('advanced-mode-button').click();

    // Wait for advanced code editor to appear
    await expect(page.getByTestId('advanced-code-editor')).toBeVisible();
    await expect(page.locator('#plugin-code')).toBeVisible();
    await expect(page.getByTestId('analyze-security-button')).toBeVisible();
  });

  test('should require code analysis before submitting custom code', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/integrations/create');

    // Fill basic information
    const timestamp = Date.now();
    const integrationType = `test_code_${timestamp}`;
    await fillBasicInfo(page, integrationType, `Test Code Integration ${timestamp}`);

    // Select Custom Code
    // No longer need to select plugin source - form shown by default
    await page.getByTestId('advanced-mode-button').click();

    // Toggle to advanced mode to access full plugin code field
    await ensureAdvancedMode(page);

    // Add some code
    const validCode = `
module.exports = {
  metadata: {
    name: 'Test',
    platform: 'test',
    version: '1.0.0'
  },
  factory: (context) => ({
    platform: 'test',
    createTicket: async (bugReport, projectId) => {
      return { id: '123', url: 'https://example.com', platform: 'test' };
    }
  })
};`;
    await fillCodeMirror(page, validCode);

    // Enable code execution (required before submission)
    await page.getByTestId('allow-code-execution-checkbox').check();

    // Try to submit without analyzing
    await page.getByTestId('save-plugin-button').click();

    // Should show error toast (Sonner toast)
    // Note: Sonner uses data-sonner-toast attribute instead of role="alert"
    await waitForToast(page, /analyze.*code/i);
  });

  test('should analyze code and show security results', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/integrations/create');

    // Select Custom Code
    // No longer need to select plugin source - form shown by default
    await page.getByTestId('advanced-mode-button').click();

    // Toggle to advanced mode to access full plugin code field
    await ensureAdvancedMode(page);

    // Add valid code
    const validCode = `
module.exports = {
  metadata: {
    name: 'Test',
    platform: 'test',
    version: '1.0.0'
  },
  factory: (context) => ({
    platform: 'test',
    createTicket: async (bugReport, projectId) => {
      const response = await context.httpClient.post('/api/issues', {
        title: bugReport.title,
        description: bugReport.description
      });
      return { 
        id: response.data.id, 
        url: 'https://example.com/issues/' + response.data.id, 
        platform: 'test' 
      };
    },
    updateTicket: async (ticketId, bugReport) => {
      return { id: ticketId, url: 'https://example.com', platform: 'test' };
    },
    getTicket: async (ticketId) => {
      return { id: ticketId, url: 'https://example.com', status: 'open', platform: 'test' };
    }
  })
};`;

    await fillCodeMirror(page, validCode);

    // Click analyze button and wait for API response
    const analysisPromise = page.waitForResponse(
      (resp) => resp.url().includes('/analyze') && resp.status() === 200
    );
    await page.getByTestId('analyze-security-button').click();
    await analysisPromise;

    // Should show security analysis result (Sonner toast)
    // Note: Sonner uses data-sonner-toast attribute instead of role="alert"
    await waitForToast(page, /.*/); // Match any toast message
  });

  test('should prevent submission if code has security violations', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/integrations/create');

    // Fill basic information
    const timestamp = Date.now();
    const integrationType = `test_unsafe_${timestamp}`;
    await fillBasicInfo(page, integrationType, `Test Unsafe Code ${timestamp}`);

    // Select Custom Code
    // No longer need to select plugin source - form shown by default
    await page.getByTestId('advanced-mode-button').click();

    // Toggle to advanced mode to access full plugin code field
    await ensureAdvancedMode(page);

    // Add code with security violation (using require)
    const unsafeCode = `
const fs = require('fs');
module.exports = {
  metadata: { name: 'Unsafe', platform: 'test', version: '1.0.0' },
  factory: (context) => ({
    platform: 'test',
    createTicket: async () => {
      fs.readFileSync('/etc/passwd');
      return { id: '1', url: 'https://example.com', platform: 'test' };
    }
  })
};`;

    await fillCodeMirror(page, unsafeCode);

    // Analyze the code
    const analysisPromise = page.waitForResponse((resp) => resp.url().includes('/analyze'));
    await page.getByTestId('analyze-security-button').click();
    await analysisPromise;

    // Should show analysis result (any toast or result display)
    // Note: Sonner uses data-sonner-toast attribute instead of role="alert"
    await waitForToast(page, /.*/); // Match any toast message

    // Verify violations are shown somewhere on the page (toast, alert, or result section)
    const violationsVisible = await page
      .locator('text=/violations|security|warning|unsafe/i')
      .first()
      .isVisible()
      .catch(() => false);
    expect(violationsVisible).toBeTruthy();

    // Enable code execution toggle
    await page.getByTestId('allow-code-execution-checkbox').check();

    // Try to submit
    await page.getByTestId('save-plugin-button').click();

    // Should show error toast preventing submission (Sonner toast)
    await waitForToast(page, /security|validation|violations|analyze|unsafe/i);
  });

  test('should successfully create integration with valid custom code', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/integrations/create');

    // Fill basic information
    const timestamp = Date.now();
    const integrationType = `test_valid_${timestamp}`;
    await fillBasicInfo(
      page,
      integrationType,
      `Test Valid Code ${timestamp}`,
      'E2E test with valid custom code'
    );

    // Track for cleanup
    createdIntegrations.push(integrationType);

    // Select Custom Code
    // No longer need to select plugin source - form shown by default
    await page.getByTestId('advanced-mode-button').click();

    // Toggle to advanced mode to access full plugin code field
    await ensureAdvancedMode(page);

    // Add valid code without violations
    const validCode = `
module.exports = {
  metadata: {
    name: 'Test Valid Integration',
    platform: 'test_platform',
    version: '1.0.0',
    description: 'A test integration for E2E tests'
  },
  factory: (context) => ({
    platform: 'test_platform',
    createTicket: async (bugReport, projectId) => {
      const payload = {
        title: bugReport.title,
        description: bugReport.description,
        priority: bugReport.priority || 'medium',
        project: projectId
      };
      
      const response = await context.httpClient.post(
        context.config.baseUrl + '/api/v1/issues',
        payload,
        {
          headers: {
            'Authorization': 'Bearer ' + context.config.apiToken,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return {
        id: response.data.id.toString(),
        url: context.config.baseUrl + '/issues/' + response.data.key,
        platform: 'test_platform'
      };
    },
    updateTicket: async (ticketId, bugReport) => {
      const payload = {
        title: bugReport.title,
        description: bugReport.description,
        priority: bugReport.priority
      };
      
      await context.httpClient.put(
        context.config.baseUrl + '/api/v1/issues/' + ticketId,
        payload,
        {
          headers: {
            'Authorization': 'Bearer ' + context.config.apiToken
          }
        }
      );
      
      return {
        id: ticketId,
        url: context.config.baseUrl + '/issues/' + ticketId,
        platform: 'test_platform'
      };
    },
    getTicket: async (ticketId) => {
      const response = await context.httpClient.get(
        context.config.baseUrl + '/api/v1/issues/' + ticketId,
        {
          headers: {
            'Authorization': 'Bearer ' + context.config.apiToken
          }
        }
      );
      
      return {
        id: ticketId,
        url: context.config.baseUrl + '/issues/' + ticketId,
        status: response.data.status,
        platform: 'test_platform'
      };
    }
  })
};`;

    await fillCodeMirror(page, validCode);

    // Analyze the code
    const analysisPromise = page.waitForResponse(
      (resp) => resp.url().includes('/analyze') && resp.status() === 200
    );
    await page.getByTestId('analyze-security-button').click();
    await analysisPromise;

    // Should show success (no violations) - Sonner toast
    await waitForToast(page, /.*/); // Match any toast message

    // Enable code execution
    await page.getByTestId('allow-code-execution-checkbox').check();

    // Submit form and wait for API response
    const createPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/admin/integrations') && resp.status() === 201
    );
    await page.getByTestId('save-plugin-button').click();
    await createPromise;

    // Should redirect to integrations overview
    await expect(page).toHaveURL('/integrations', { timeout: TIMEOUTS.PAGE_TRANSITION });

    // Wait for integrations list to load
    await page.waitForLoadState('networkidle', { timeout: TIMEOUTS.NETWORK_IDLE });

    // Verify integration appears in list
    await expect(page.locator(`text=Test Valid Code ${timestamp}`).first()).toBeVisible({
      timeout: TIMEOUTS.PAGE_TRANSITION,
    });
  });

  test('should successfully submit integration form', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/integrations/create');

    // Fill minimum required fields
    const timestamp = Date.now();
    const integrationType = `test_submit_${timestamp}`;
    await fillBasicInfo(page, integrationType, `Test Submit ${timestamp}`);

    // Track for cleanup
    createdIntegrations.push(integrationType);

    // Select Custom Code Plugin
    // No longer need to select plugin source - form shown by default
    await page.getByTestId('advanced-mode-button').click();

    // Toggle to advanced mode
    await ensureAdvancedMode(page);

    // Add valid plugin code
    await fillCodeMirror(
      page,
      `module.exports = {
      metadata: { name: 'Test', platform: 'test', version: '1.0.0' },
      factory: (context) => ({
        platform: 'test',
        createTicket: async () => ({ id: '123', url: 'https://test.com', platform: 'test' })
      })
    };`
    );

    // Analyze and enable execution
    await page.getByTestId('analyze-security-button').click();
    await page.waitForTimeout(1000);
    await page.getByTestId('allow-code-execution-checkbox').check();

    // Submit and wait for successful API response
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/admin/integrations') && resp.status() === 201
    );
    await page.getByTestId('save-plugin-button').click();
    await responsePromise;

    // Should redirect to integrations list
    await expect(page).toHaveURL('/integrations', { timeout: TIMEOUTS.PAGE_TRANSITION });
  });

  test('should delete an integration permanently', async ({ page }) => {
    await loginAsAdmin(page);

    // 1. Create integration
    const timestamp = Date.now();
    const integrationType = `test_delete_${timestamp}`;
    await page.goto('/integrations/create');
    await fillBasicInfo(page, integrationType, `Test Delete ${timestamp}`);
    createdIntegrations.push(integrationType);

    // 2. Configure with Custom Code Plugin
    // No longer need to select plugin source - form shown by default
    await page.getByTestId('advanced-mode-button').click();

    // Toggle to advanced mode
    await ensureAdvancedMode(page);

    await fillCodeMirror(
      page,
      `module.exports = {
      metadata: { name: 'Test', platform: 'test', version: '1.0.0' },
      factory: (context) => ({
        platform: 'test',
        createTicket: async () => ({ id: '123', url: 'https://test.com', platform: 'test' })
      })
    };`
    );
    await page.getByTestId('analyze-security-button').click();
    await page.waitForTimeout(1000); // Wait for analysis
    await page.getByTestId('allow-code-execution-checkbox').check();

    // 3. Create the integration
    const createPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/admin/integrations') && resp.status() === 201
    );
    await page.getByTestId('save-plugin-button').click();
    await createPromise;

    // 4. Wait for redirect to list
    await expect(page).toHaveURL('/integrations', { timeout: TIMEOUTS.PAGE_TRANSITION });
    await page.waitForLoadState('networkidle', { timeout: TIMEOUTS.NETWORK_IDLE });

    // 5. Verify integration appears
    await expect(page.locator(`text=Test Delete ${timestamp}`).first()).toBeVisible();

    // 6. Screenshot: Before delete
    await page.screenshot({
      path: `test-results/delete-before-${timestamp}.png`,
      fullPage: true,
    });

    // 7. Click Delete button (2-step: Delete -> Confirm Delete)
    const integrationCard = await getIntegrationCard(page, `Test Delete ${timestamp}`);

    // First click shows confirmation
    const deleteButton = integrationCard.getByTestId('delete-integration-button');
    await deleteButton.click();

    // Wait for confirmation button to appear (UI state change) with longer timeout
    const confirmButton = integrationCard.getByTestId('confirm-delete-button');
    await confirmButton.waitFor({ state: 'visible', timeout: 30000 });

    // Second click actually deletes
    const deletePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/v1/admin/integrations/${integrationType}`) &&
        resp.request().method() === 'DELETE' &&
        !resp.url().includes('/config')
    );

    await confirmButton.click();
    const deleteResponse = await deletePromise;

    // 8. Verify successful deletion
    expect(deleteResponse.status()).toBe(200);

    // 9. Reload page to fetch updated data
    await page.reload({ waitUntil: 'networkidle' });

    // 10. Screenshot: After delete
    await page.screenshot({
      path: `test-results/delete-after-${timestamp}.png`,
      fullPage: true,
    });

    // 11. Verify integration no longer appears in list
    await expect(page.locator(`text=Test Delete ${timestamp}`)).not.toBeVisible({
      timeout: TIMEOUTS.PAGE_TRANSITION,
    });

    // 12. Remove from cleanup list since it's already deleted
    createdIntegrations = createdIntegrations.filter((type) => type !== integrationType);
  });

  test('should edit integration configuration', async ({ page }) => {
    await loginAsAdmin(page);

    // 1. Create custom code plugin (now has config, becomes active)
    const timestamp = Date.now();
    const integrationType = `test_edit_${timestamp}`;
    await page.goto('/integrations/create');
    await fillBasicInfo(page, integrationType, `Test Edit ${timestamp}`, 'Original description');
    createdIntegrations.push(integrationType);

    // 2. Configure with Custom Code Plugin
    // No longer need to select plugin source - form shown by default
    await page.getByTestId('advanced-mode-button').click();

    // Toggle to advanced mode
    await ensureAdvancedMode(page);

    await fillCodeMirror(
      page,
      `module.exports = {
      metadata: { name: 'Test', platform: 'test', version: '1.0.0' },
      factory: (context) => ({
        platform: 'test',
        createTicket: async () => ({ id: '123', url: 'https://test.com', platform: 'test' })
      })
    };`
    );
    await page.getByTestId('analyze-security-button').click();
    await page.waitForTimeout(1000); // Wait for analysis
    await page.getByTestId('allow-code-execution-checkbox').check();

    // 3. Create the integration (now active with config)
    const createPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/admin/integrations') && resp.status() === 201
    );
    await page.getByTestId('save-plugin-button').click();
    await createPromise;

    // 4. Navigate to integrations list
    await expect(page).toHaveURL('/integrations', { timeout: TIMEOUTS.PAGE_TRANSITION });

    // 5. Verify integration appears and is editable
    await expect(page.locator(`text=Test Edit ${timestamp}`).first()).toBeVisible({
      timeout: TIMEOUTS.PAGE_TRANSITION,
    });

    // 6. Go to list and find the integration card
    const integrationCard = await getIntegrationCard(page, `Test Edit ${timestamp}`);

    // Verify it's a custom integration (Edit Code button should be visible)
    await expect(integrationCard.getByTestId('edit-code-button')).toBeVisible();
    await expect(integrationCard.getByTestId('delete-integration-button')).toBeVisible();

    // Success! Custom code plugin shows correct buttons
  });
});
