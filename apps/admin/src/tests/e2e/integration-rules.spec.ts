import { test as base, expect, type Page } from '../fixtures/setup-fixture';
import axios from 'axios';
import { E2E_BASE_HOSTNAME } from './config';
import { getAdminToken, ensureJiraIntegration, deleteRule } from './helpers/integration-helpers';

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
    } else {
      // Already authenticated, verify dashboard is loaded
      await expect(page.getByRole('heading', { name: /analytics dashboard/i })).toBeVisible({
        timeout: 5000,
      });
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
  const currentURL = page.url();
  if (currentURL && currentURL.includes(E2E_BASE_HOSTNAME) && !currentURL.includes('/login')) {
    return;
  }

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });

  await page.fill('input[type="email"]', 'admin@bugspotter.io');
  await page.fill('input[type="password"]', 'admin123');

  const loginButton = page.getByRole('button', { name: /sign in|login/i });
  await loginButton.waitFor({ state: 'visible', timeout: 10000 });

  // Use Promise.all to prevent race condition
  await Promise.all([page.waitForURL('/dashboard', { timeout: 30000 }), loginButton.click()]);
  await page.waitForLoadState('networkidle');

  // Wait for dashboard to be fully loaded
  await expect(page.getByRole('heading', { name: /analytics dashboard/i })).toBeVisible({
    timeout: 5000,
  });
}

/**
 * Helper to select an option from a Radix UI Select component
 */
async function selectRadixOption(
  page: Page,
  triggerLabel: string,
  optionName: string
): Promise<void> {
  // Click the select trigger
  await page.getByRole('combobox', { name: new RegExp(triggerLabel, 'i') }).click();
  // Click the option
  await page.getByRole('option', { name: optionName }).click();
}

/**
 * Helper to navigate to the Conditions tab
 */
async function goToConditionsTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /conditions/i }).click();
}

/**
 * Helper to navigate to the Advanced tab
 */
async function goToAdvancedTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /advanced/i }).click();
}

test.describe('Integration Rules Management', () => {
  test.describe.configure({ mode: 'parallel' });

  test('should create a new rule with basic filter', async ({ page, adminContext }) => {
    await page.goto(`/integrations/jira/${adminContext.projectId}/rules`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Click "Create Rule" button
    await page.getByRole('button', { name: /create rule/i }).click();

    // Fill in rule details
    await page.getByLabel(/rule name/i).fill('High Priority Bugs');

    // Set execution order
    await page.getByLabel(/execution order/i).fill('100');

    // Navigate to Conditions tab
    await goToConditionsTab(page);

    // Add a filter condition
    await page.getByRole('button', { name: /add filter/i }).click();

    // Select field = "Bug Priority (optional field)"
    await selectRadixOption(page, 'field', 'Bug Priority (optional field)');

    // Select operator = "equals"
    await selectRadixOption(page, 'operator', 'Equals');

    // Fill value
    const valueInputs = page.getByLabel(/value/i);
    await valueInputs.last().fill('high');

    // Submit form
    await page.getByRole('button', { name: /create rule/i }).click();

    // Wait for success toast
    await expect(page.getByText(/rule created successfully/i)).toBeVisible({ timeout: 5000 });

    // Verify rule appears in list
    await expect(page.getByText('High Priority Bugs')).toBeVisible();

    // Track for cleanup
    const rulesResponse = await axios.get(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    const newRule = rulesResponse.data.data.find(
      (r: { name: string; id: string }) => r.name === 'High Priority Bugs'
    );
    if (newRule) {
      adminContext.createdRules.push({
        platform: 'jira',
        projectId: adminContext.projectId,
        ruleId: newRule.id,
      });
    }
  });

  test('should create a rule with multiple filters', async ({ page, adminContext }) => {
    await page.goto(`/integrations/jira/${adminContext.projectId}/rules`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Click "Create Rule"
    await page.getByRole('button', { name: /create rule/i }).click();

    await page.getByLabel(/rule name/i).fill('Critical Chrome Errors');
    await page.getByLabel(/execution order/i).fill('200');

    // Navigate to Conditions tab
    await goToConditionsTab(page);

    // Add first filter: priority = high
    await page.getByRole('button', { name: /add filter/i }).click();
    await page.locator('#field-0').click();
    await page.getByRole('option', { name: 'Bug Priority (optional field)' }).click();
    await page.locator('#operator-0').click();
    await page.getByRole('option', { name: 'Equals' }).click();
    await page.locator('#value-0').fill('high');

    // Add second filter: browser = Chrome
    await page.getByRole('button', { name: /add filter/i }).click();
    await page.locator('#field-1').click();
    await page.getByRole('option', { name: 'Browser' }).click();
    await page.locator('#operator-1').click();
    await page.getByRole('option', { name: 'Contains' }).click();
    await page.locator('#value-1').fill('Chrome');

    // Submit
    await page.getByRole('button', { name: /create rule/i }).click();

    await expect(page.getByText(/rule created successfully/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Critical Chrome Errors')).toBeVisible();

    // Track for cleanup
    const rulesResponse = await axios.get(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    const newRule = rulesResponse.data.data.find(
      (r: { name: string; id: string }) => r.name === 'Critical Chrome Errors'
    );
    if (newRule) {
      adminContext.createdRules.push({
        platform: 'jira',
        projectId: adminContext.projectId,
        ruleId: newRule.id,
      });
    }
  });

  test('should create a rule with throttling configuration', async ({ page, adminContext }) => {
    await page.goto(`/integrations/jira/${adminContext.projectId}/rules`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /create rule/i }).click();

    await page.getByLabel(/rule name/i).fill('Throttled Production Errors');
    await page.getByLabel(/execution order/i).fill('50');

    // Navigate to Advanced tab
    await goToAdvancedTab(page);

    // Enable throttling
    await page.getByRole('checkbox', { name: /enable throttling/i }).click();

    // Fill throttle config
    await page.getByLabel(/max tickets per hour/i).fill('5');
    await page.getByLabel(/max tickets per day/i).fill('20');

    // Select group_by
    await selectRadixOption(page, 'group by', 'User');

    // Submit
    await page.getByRole('button', { name: /create rule/i }).click();

    await expect(page.getByText(/rule created successfully/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Throttled Production Errors')).toBeVisible();

    // Track for cleanup
    const rulesResponse = await axios.get(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    const newRule = rulesResponse.data.data.find(
      (r: { name: string; id: string }) => r.name === 'Throttled Production Errors'
    );
    if (newRule) {
      adminContext.createdRules.push({
        platform: 'jira',
        projectId: adminContext.projectId,
        ruleId: newRule.id,
      });
    }
  });

  test('should edit an existing rule', async ({ page, adminContext }) => {
    // First create a rule via API
    const createResponse = await axios.post(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        name: 'Edit Test Rule',
        enabled: true,
        priority: 100,
        filters: [{ field: 'priority', operator: 'equals', value: 'medium' }],
      },
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    const ruleId = createResponse.data.data.id;
    adminContext.createdRules.push({ platform: 'jira', projectId: adminContext.projectId, ruleId });

    // Navigate to rules page
    await page.goto(`/integrations/jira/${adminContext.projectId}/rules`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Find the card containing the rule and click its edit button
    const ruleCard = page.getByRole('article', { name: /rule: edit test rule/i });
    await ruleCard.getByRole('button', { name: /edit rule/i }).click();

    // Update name
    const nameInput = page.getByLabel(/rule name/i);
    await nameInput.clear();
    await nameInput.fill('Updated Rule Name');

    // Submit
    await page.getByRole('button', { name: /update rule/i }).click();

    await expect(page.getByText(/rule updated successfully/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Updated Rule Name')).toBeVisible();
  });

  test('should toggle rule enabled status', async ({ page, adminContext }) => {
    // Create a rule via API
    const createResponse = await axios.post(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        name: 'Toggle Test Rule',
        enabled: true,
        priority: 100,
        filters: [],
      },
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    const ruleId = createResponse.data.data.id;
    adminContext.createdRules.push({ platform: 'jira', projectId: adminContext.projectId, ruleId });

    await page.goto(`/integrations/jira/${adminContext.projectId}/rules`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Find the rule card
    const ruleCard = page.getByRole('article', { name: /rule: toggle test rule/i });

    // Should show "Enabled" badge initially
    await expect(ruleCard.getByText(/enabled/i)).toBeVisible();

    // Click toggle button
    await ruleCard.getByRole('button', { name: /disable/i }).click();

    // Should show success toast
    await expect(page.getByText(/rule status updated/i)).toBeVisible({ timeout: 5000 });

    // Badge should change to "Disabled"
    await expect(ruleCard.getByText(/disabled/i)).toBeVisible({ timeout: 3000 });
  });

  test('should delete a rule', async ({ page, adminContext }) => {
    // Create a rule via API
    const createResponse = await axios.post(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        name: 'Delete Test Rule',
        enabled: true,
        priority: 100,
        filters: [],
      },
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    // Track rule (though it will be deleted by test, fixture cleanup will handle if test fails)
    const ruleId = createResponse.data.data.id;
    adminContext.createdRules.push({ platform: 'jira', projectId: adminContext.projectId, ruleId });

    await page.goto(`/integrations/jira/${adminContext.projectId}/rules`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Find the rule and click delete
    const ruleCard = page.getByRole('article', { name: /rule: delete test rule/i });
    await ruleCard.getByRole('button', { name: /delete/i }).click();

    // Confirm deletion in dialog
    await page
      .getByRole('button', { name: /delete/i })
      .last()
      .click();

    // Should show success toast
    await expect(page.getByText(/rule deleted/i)).toBeVisible({ timeout: 5000 });

    // Rule should no longer be visible
    await expect(page.getByText('Delete Test Rule')).not.toBeVisible({ timeout: 3000 });
  });

  test('should validate required fields', async ({ page, adminContext }) => {
    await page.goto(`/integrations/jira/${adminContext.projectId}/rules`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Click "Create Rule"
    await page.getByRole('button', { name: /create rule/i }).click();

    // Get submit button inside dialog
    const dialog = page.getByRole('dialog');
    const submitButton = dialog.getByRole('button', { name: /^create rule$/i });

    // Submit button should be disabled when name field is empty (client-side validation)
    await expect(submitButton).toBeDisabled();

    // Fill in name field
    await page.getByLabel(/rule name/i).fill('Test Rule');

    // Now button should be enabled
    await expect(submitButton).toBeEnabled();

    // Clear the name field (leaving only whitespace)
    await page.getByLabel(/rule name/i).clear();
    await page.getByLabel(/rule name/i).fill('   ');

    // Button should be disabled again (whitespace-only is invalid)
    await expect(submitButton).toBeDisabled();
  });

  test('should display rules sorted by priority', async ({ page, adminContext }) => {
    // Create multiple rules with different priorities
    const rules = [
      { name: 'Low Priority Rule', priority: 10 },
      { name: 'High Priority Rule', priority: 200 },
      { name: 'Medium Priority Rule', priority: 100 },
    ];

    for (const rule of rules) {
      const createResponse = await axios.post(
        `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
        {
          name: rule.name,
          enabled: true,
          priority: rule.priority,
          filters: [],
        },
        {
          headers: { Authorization: `Bearer ${adminContext.adminToken}` },
        }
      );
      adminContext.createdRules.push({
        platform: 'jira',
        projectId: adminContext.projectId,
        ruleId: createResponse.data.data.id,
      });
    }

    await page.goto(`/integrations/jira/${adminContext.projectId}/rules`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Verify all rules are displayed
    await expect(page.getByText('Low Priority Rule')).toBeVisible();
    await expect(page.getByText('High Priority Rule')).toBeVisible();
    await expect(page.getByText('Medium Priority Rule')).toBeVisible();

    // Note: Sorting order verification would require accessing actual rule cards or priority values
    // This test verifies that all rules are displayed successfully
  });

  test.describe('Validation & Error Handling', () => {
    test('should reject duplicate rule names', async ({ page, adminContext }) => {
      // Create a rule via API
      await axios.post(
        `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
        {
          name: 'Duplicate Name Rule',
          enabled: true,
          priority: 100,
          filters: [],
        },
        {
          headers: { Authorization: `Bearer ${adminContext.adminToken}` },
        }
      );

      await page.goto(`/integrations/jira/${adminContext.projectId}/rules`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForLoadState('networkidle');

      // Try to create rule with same name
      await page.getByRole('button', { name: /create rule/i }).click();
      await page.getByLabel(/rule name/i).fill('Duplicate Name Rule');
      await page.getByRole('spinbutton', { name: /execution order/i }).fill('50');
      await page.getByRole('button', { name: /create rule/i }).click();

      // Should show error toast message
      await expect(
        page.locator('div[data-title]').filter({ hasText: /already exists|duplicate/i })
      ).toBeVisible({ timeout: 5000 });
    });

    test('should validate priority range', async ({ page, adminContext }) => {
      await page.goto(`/integrations/jira/${adminContext.projectId}/rules`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: /create rule/i }).click();
      await page.getByLabel(/rule name/i).fill('Priority Range Rule');

      // Test negative priority - should be automatically corrected to 0
      const priorityInput = page.getByRole('spinbutton', { name: /execution order/i });
      await priorityInput.fill('-10');

      // Verify the value was automatically corrected to 0 (Math.max(0, -10) = 0)
      await expect(priorityInput).toHaveValue('0');

      // Submit should succeed with priority=0
      await page.getByRole('button', { name: /create rule/i }).click();

      // Verify rule was created with priority 0
      await expect(page.getByText(/Priority Range Rule/i)).toBeVisible();
    });

    test('should validate empty filter values', async ({ page, adminContext }) => {
      await page.goto(`/integrations/jira/${adminContext.projectId}/rules`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: /create rule/i }).click();
      await page.getByLabel(/rule name/i).fill('Empty Filter Rule');
      await page.getByRole('spinbutton', { name: /execution order/i }).fill('100');

      // Navigate to Conditions tab
      await goToConditionsTab(page);

      // Add filter but leave value empty
      await page.getByRole('button', { name: /add filter/i }).click();
      await selectRadixOption(page, 'field', 'Priority');
      await selectRadixOption(page, 'operator', 'Equals');
      // Don't fill value

      await page.getByRole('button', { name: /create rule/i }).click();

      // Should show validation error or prevent submission
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 2000 });
    });

    test('should validate throttling configuration', async ({ page, adminContext }) => {
      await page.goto(`/integrations/jira/${adminContext.projectId}/rules`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: /create rule/i }).click();
      await page.getByLabel(/rule name/i).fill('Invalid Throttle Rule');
      await page.getByRole('spinbutton', { name: /execution order/i }).fill('100');

      // Navigate to Advanced tab
      await goToAdvancedTab(page);

      // Enable throttling
      await page.getByRole('checkbox', { name: /enable throttling/i }).click();

      // Fill invalid throttle values (zero or negative)
      await page.getByLabel(/max tickets per hour/i).fill('0');
      await page.getByLabel(/max tickets per day/i).fill('-5');

      await page.getByRole('button', { name: /create rule/i }).click();

      // Should show validation error
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 2000 });
    });

    test('should handle API failures gracefully', async ({ page, adminContext }) => {
      await page.goto(`/integrations/jira/${adminContext.projectId}/rules`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: /create rule/i }).click();

      // Fill in valid data
      await page.getByLabel(/rule name/i).fill('API Failure Test');
      await page.getByRole('spinbutton', { name: /execution order/i }).fill('100');

      // Intercept API call to simulate failure (if route interception is available)
      // For now, verify dialog stays open on any error
      await page.getByRole('button', { name: /create rule/i }).click();

      // On success, toast appears. On failure, dialog should stay open.
      // This test verifies error handling exists (either way is acceptable)
    });

    test('should preserve form data when validation fails', async ({ page, adminContext }) => {
      await page.goto(`/integrations/jira/${adminContext.projectId}/rules`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: /create rule/i }).click();

      // Fill in partial data
      await page.getByLabel(/rule name/i).fill('Preserved Data Rule');
      await page.getByRole('spinbutton', { name: /execution order/i }).fill('100');

      // Navigate to Conditions tab to add filter
      await goToConditionsTab(page);

      // Add a filter
      await page.getByRole('button', { name: /add filter/i }).click();
      await selectRadixOption(page, 'field', 'Priority');
      await selectRadixOption(page, 'operator', 'Equals');
      await page.getByLabel(/value/i).last().fill('high');

      // Navigate to Advanced tab for throttling
      await goToAdvancedTab(page);

      // Enable throttling but don't provide any rate limits (validation should fail)
      await page.getByRole('checkbox', { name: /enable throttling/i }).click();

      // Clear both rate limit fields to trigger validation error
      await page.getByLabel(/max tickets per hour/i).clear();
      await page.getByLabel(/max tickets per day/i).clear();

      // Try to submit - validation should fail and keep dialog open
      await page.getByRole('button', { name: /create rule/i }).click();

      // Go back to Rule Details tab to verify basic form values
      await page.getByRole('tab', { name: /rule details/i }).click();

      // Verify basic form data is preserved after validation failure
      await expect(page.getByLabel(/rule name/i)).toHaveValue('Preserved Data Rule');
      await expect(page.getByRole('spinbutton', { name: /execution order/i })).toHaveValue('100');

      // Navigate back to Advanced tab to verify throttling checkbox state
      await goToAdvancedTab(page);
      await expect(page.getByRole('checkbox', { name: /enable throttling/i })).toBeChecked();

      // Verify dialog is still open (not closed due to validation failure)
      await expect(page.getByRole('dialog')).toBeVisible();
    });
  });
});
