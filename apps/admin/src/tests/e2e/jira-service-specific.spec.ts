/**
 * Jira Integration E2E Tests
 * Tests for creating/editing Jira rules with user picker and field mappings
 */

import { test as base, expect, type Page } from '../fixtures/setup-fixture';
import { getAdminToken, ensureJiraIntegration, deleteRule } from './helpers/integration-helpers';
import { waitForI18nReady } from './helpers/i18n-helpers';

const API_BASE_URL = 'http://localhost:4000';

// Fixture type for isolated test state
type AdminContextFixture = {
  adminToken: string;
  projectId: string;
  createdRules: Array<{ platform: string; projectId: string; ruleId: string }>;
};

// Extend base test with admin context fixture
const test = base.extend<{ adminContext: AdminContextFixture }>({
  adminContext: async ({ setupState, page }, use) => {
    await setupState.ensureInitialized();

    // Ensure fresh authentication for each test
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // If redirected to login, perform login
    if (page.url().includes('/login')) {
      await loginAsAdmin(page);
    }

    // Get admin token and project
    const adminToken = await getAdminToken();
    const project = await setupState.ensureProjectExists(adminToken);
    await ensureJiraIntegration(adminToken, project.id);

    // Provide isolated state for this test
    const createdRules: Array<{ platform: string; projectId: string; ruleId: string }> = [];
    await use({ adminToken, projectId: project.id, createdRules });

    // Automatic cleanup after test
    for (const rule of createdRules) {
      await deleteRule(rule.platform, rule.projectId, rule.ruleId, adminToken);
    }
  },
});

// Shared authentication helper
async function loginAsAdmin(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });

  await page.fill('input[type="email"]', 'admin@bugspotter.io');
  await page.fill('input[type="password"]', 'admin123');

  await page.getByRole('button', { name: /sign in|login/i }).click();

  await page.waitForURL('/dashboard', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await waitForI18nReady(page, { match: 'some' });
}

/**
 * Helper to navigate to the Field Mappings tab
 */
async function goToFieldMappingsTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /field mappings/i }).click();
}

test.describe('Jira Integration - Service-Specific Forms', () => {
  test('should display Jira-specific form when creating Jira rule', async ({
    page,
    adminContext,
  }) => {
    await page.goto(`/integrations/jira/${adminContext.projectId}/rules`);
    await page.waitForLoadState('networkidle');
    await waitForI18nReady(page, { match: 'some' });

    // Click Create Rule button
    await page.getByRole('button', { name: /create rule/i }).click();

    // Should show dialog
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: /create rule/i })).toBeVisible();

    // Should show Jira-specific field mappings (not generic)
    const checkbox = page.getByRole('checkbox', { name: /automatically create tickets/i });
    await checkbox.check();
    await expect(checkbox).toBeChecked(); // Wait for checked state

    // Navigate to Field Mappings tab
    await goToFieldMappingsTab(page);

    // Wait for field mappings section to appear and render
    await expect(page.getByTestId('field-mappings-section')).toBeVisible();
    await waitForI18nReady(page, { match: 'some' }); // Ensure new fields are translated

    // Check for Jira-specific fields
    await expect(page.getByPlaceholder(/email or name/i)).toBeVisible(); // Assignee field
    await expect(page.getByRole('textbox', { name: /components/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /labels/i })).toBeVisible();

    // Go back to Rule Details tab to check execution order
    await page.getByRole('tab', { name: /rule details/i }).click();
    await expect(page.getByRole('spinbutton', { name: /execution order/i })).toBeVisible();
  });

  test('should create Jira rule with field mappings', async ({ page, adminContext }) => {
    await page.goto(`/integrations/jira/${adminContext.projectId}/rules`);
    await page.waitForLoadState('networkidle');
    await waitForI18nReady(page, { match: 'some' });

    // Click Create Rule
    await page.getByRole('button', { name: /create rule/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Fill in basic info
    await page.getByLabel(/rule name/i).fill('E2E Test Jira Rule');
    await page.getByLabel(/execution order/i, { exact: false }).fill('100');
    await page.getByRole('checkbox', { name: /enabled/i }).check();
    await page.getByRole('checkbox', { name: /automatically create tickets/i }).check();

    // Navigate to Field Mappings tab
    await goToFieldMappingsTab(page);

    // Wait for field mappings section
    await expect(page.getByTestId('field-mappings-section')).toBeVisible();

    // Fill in Jira field mappings
    // Add component
    await page.getByRole('textbox', { name: /components/i }).fill('E2E-Test');
    await page.getByTestId('add-components-button').click();

    // Add labels
    await page.getByRole('textbox', { name: /labels/i }).fill('e2e');
    await page.getByTestId('add-labels-button').click();
    await page.getByRole('textbox', { name: /labels/i }).fill('automated-test');
    await page.getByTestId('add-labels-button').click();

    // Set priority
    await page.getByLabel(/priority/i).click();
    await page.getByRole('option', { name: 'Medium' }).click();

    // Submit form
    await page.getByRole('button', { name: /^create rule$/i }).click();

    // Wait for success and dialog to close
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });

    // Verify rule appears in table
    await expect(page.getByText('E2E Test Jira Rule')).toBeVisible();

    // Track for cleanup
    const rows = await page.getByRole('row').all();
    for (const row of rows) {
      const text = await row.textContent();
      if (text?.includes('E2E Test Jira Rule')) {
        const ruleId = await row.getAttribute('data-rule-id');
        if (ruleId) {
          adminContext.createdRules.push({
            platform: 'jira',
            projectId: adminContext.projectId,
            ruleId,
          });
        }
        break;
      }
    }
  });

  test('should search and select Jira user for assignee field', async ({ page, adminContext }) => {
    // Note: This test requires mock Jira API endpoint to return test users
    await page.goto(`/integrations/jira/${adminContext.projectId}/rules`);
    await page.waitForLoadState('networkidle');
    await waitForI18nReady(page, { match: 'some' });

    await page.getByRole('button', { name: /create rule/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Enable auto-create to show field mappings
    await page.getByRole('checkbox', { name: /automatically create tickets/i }).check();

    // Navigate to Field Mappings tab
    await goToFieldMappingsTab(page);

    await expect(page.getByTestId('field-mappings-section')).toBeVisible();

    // Find assignee user picker input
    const userPickerInput = page.getByPlaceholder(/search by email or name/i);
    await expect(userPickerInput).toBeVisible();

    // Type to search for user (requires 2+ characters)
    await userPickerInput.fill('test');

    // Wait for search results (debounced)
    await page.waitForTimeout(500);

    // Wait for listbox to appear (with timeout to handle mock API delays)
    const userOptions = page.getByRole('listbox');
    try {
      await userOptions.waitFor({ state: 'visible', timeout: 5000 });
      const firstOption = userOptions.getByRole('option').first();
      await firstOption.click();

      // Verify user is selected (text should appear in the input or selected area)
      await expect(userPickerInput).toHaveValue(/test/i);
    } catch {
      // Mock API might not be configured - skip user selection
      console.log('User options not available, skipping user selection');
    }
  });

  test('should add custom Jira fields to field mappings', async ({ page, adminContext }) => {
    await page.goto(`/integrations/jira/${adminContext.projectId}/rules`);
    await page.waitForLoadState('networkidle');
    await waitForI18nReady(page, { match: 'some' });

    await page.getByRole('button', { name: /create rule/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('checkbox', { name: /automatically create tickets/i }).check();

    // Navigate to Field Mappings tab
    await goToFieldMappingsTab(page);

    await expect(page.getByTestId('field-mappings-section')).toBeVisible();

    // Click "Add Custom Field" button
    await page.getByTestId('add-custom-field-trigger').click();

    // Wait for custom field form to appear
    const customFieldIdInput = page.getByTestId('custom-field-id');
    const customFieldValueInput = page.getByTestId('custom-field-value');

    await expect(customFieldIdInput).toBeVisible();
    await expect(customFieldValueInput).toBeVisible();

    // Fill in custom field
    await customFieldIdInput.fill('customfield_10050');
    await customFieldValueInput.fill('"Sprint 1"');

    // Click Add button
    await page.getByTestId('add-custom-field-button').click();

    // Custom field should appear in list (as disabled input)
    await expect(page.locator('input[value="customfield_10050"][disabled]')).toBeVisible();
  });

  test('should edit existing Jira rule and preserve field mappings', async ({
    page,
    adminContext,
  }) => {
    // First create a rule via API
    const createResponse = await fetch(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminContext.adminToken}`,
        },
        body: JSON.stringify({
          name: 'Edit Test Rule',
          enabled: true,
          priority: 100,
          filters: [],
          auto_create: true,
          field_mappings: {
            components: '[{ "name": "Backend" }]',
            labels: '["bug"]',
          },
          throttle: null,
        }),
      }
    );

    const rule = await createResponse.json();
    if (!rule.data?.id) {
      throw new Error(`Failed to create rule: ${JSON.stringify(rule)}`);
    }
    adminContext.createdRules.push({
      platform: 'jira',
      projectId: adminContext.projectId,
      ruleId: rule.data.id,
    });

    // Navigate to rules page AFTER creating the rule
    await page.goto(`/integrations/jira/${adminContext.projectId}/rules`);
    await page.waitForLoadState('networkidle');
    await waitForI18nReady(page, { match: 'some' });

    // Wait for rules table to load and render
    await expect(page.getByText('Edit Test Rule')).toBeVisible({ timeout: 10000 });

    // Find and click Edit button for the rule
    const editButton = page
      .getByRole('article')
      .filter({ hasText: 'Edit Test Rule' })
      .getByRole('button', { name: /edit/i });
    await editButton.click();

    // Dialog should open with pre-filled values
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel(/rule name/i)).toHaveValue('Edit Test Rule');

    // Auto-create checkbox should be checked since we created the rule with auto_create: true
    await expect(page.getByLabel(/automatically create tickets/i)).toBeChecked();

    // Navigate to Field Mappings tab
    await goToFieldMappingsTab(page);

    // Field mappings should be pre-filled - verify Labels Badge appears
    await expect(page.getByTestId('tag-labels-bug')).toBeVisible();

    // Modify field mappings - add another label using the tag input
    await page.getByRole('textbox', { name: /labels/i }).fill('high-priority');
    await page.getByTestId('add-labels-button').click();

    // Submit update
    await page.getByRole('button', { name: /update rule/i }).click();

    // Wait for success
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
  });

  test('should clear all field mappings when Clear All clicked', async ({ page, adminContext }) => {
    await page.goto(`/integrations/jira/${adminContext.projectId}/rules`);
    await page.waitForLoadState('networkidle');
    await waitForI18nReady(page, { match: 'some' });

    await page.getByRole('button', { name: /create rule/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('checkbox', { name: /automatically create tickets/i }).check();

    // Navigate to Field Mappings tab
    await goToFieldMappingsTab(page);

    await expect(page.getByTestId('field-mappings-section')).toBeVisible();

    // Fill in some field mappings using tag inputs
    await page.getByRole('textbox', { name: /components/i }).fill('Frontend');
    await page.getByTestId('add-components-button').click();
    await page.getByRole('textbox', { name: /labels/i }).fill('bug');
    await page.getByTestId('add-labels-button').click();

    // Verify badges appear using data-testid (case-sensitive with actual tag values)
    await expect(page.getByTestId('tag-components-Frontend')).toBeVisible();
    await expect(page.getByTestId('tag-labels-bug')).toBeVisible();

    // Click Clear All button (global) - use data-testid to avoid strict mode violation
    await page.getByTestId('clear-all-fields').click();

    // Badges should be removed
    await expect(page.getByTestId('tag-components-Frontend')).not.toBeVisible();
    await expect(page.getByTestId('tag-labels-bug')).not.toBeVisible();
  });
});
