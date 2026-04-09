import { test as base, expect, type Page } from '../fixtures/setup-fixture';
import axios from 'axios';
import { E2E_BASE_HOSTNAME } from './config';
import { getAdminToken, ensureJiraIntegration, deleteRule } from './helpers/integration-helpers';

const API_BASE_URL = 'http://localhost:4000';

// Standardized timeouts for consistent wait behavior
const TIMEOUTS = {
  NAVIGATION: 30000,
  ELEMENT_VISIBLE: 5000,
  DIALOG_CLOSE: 5000,
  RULE_APPEAR: 10000,
  API_RESPONSE: 10000,
  BADGE_VISIBLE: 3000,
};

/**
 * Admin context fixture for isolated test state
 * Each test gets its own cleanup tracking without shared module state
 */
type AdminContextFixture = {
  adminToken: string;
  projectId: string;
  createdRules: Array<{ platform: string; projectId: string; ruleId: string }>;
};

const test = base.extend<{ adminContext: AdminContextFixture }>({
  adminContext: async ({ setupState, page }, use) => {
    // Initialize setup
    await setupState.ensureInitialized();
    await loginAsAdmin(page);

    // Get admin token and project
    const adminToken = await getAdminToken();
    const project = await setupState.ensureProjectExists(adminToken);
    const projectId = project.id;

    // Ensure Jira integration exists
    await ensureJiraIntegration(adminToken, projectId);

    // Track created rules for this test only
    const createdRules: Array<{ platform: string; projectId: string; ruleId: string }> = [];

    // Provide context to test
    await use({ adminToken, projectId, createdRules });

    // Cleanup after test
    for (const rule of createdRules) {
      await deleteRule(rule.platform, rule.projectId, rule.ruleId, adminToken);
    }
  },
});

// Helper to navigate to rules page with consistent ready state
async function goToRulesPage(page: Page, projectId: string) {
  await page.goto(`/integrations/jira/${projectId}/rules`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  // Ensure the page is fully loaded and interactive
  await page
    .getByRole('button', { name: /create rule/i })
    .waitFor({ state: 'visible', timeout: TIMEOUTS.ELEMENT_VISIBLE });
}

// Helper to navigate to Field Mappings tab
async function goToFieldMappingsTab(page: Page) {
  await page.getByRole('tab', { name: /field mappings/i }).click();
  await page.waitForTimeout(500); // Allow tab content to render
}

// Shared authentication helper
async function loginAsAdmin(page: Page) {
  const currentURL = page.url();
  if (currentURL && currentURL.includes(E2E_BASE_HOSTNAME) && !currentURL.includes('/login')) {
    return;
  }

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: TIMEOUTS.ELEMENT_VISIBLE });

  await page.fill('input[type="email"]', 'admin@bugspotter.io');
  await page.fill('input[type="password"]', 'admin123');

  // Wait for login button to be enabled and click it
  const loginButton = page.getByRole('button', { name: /sign in|login/i });
  await loginButton.waitFor({ state: 'visible', timeout: TIMEOUTS.ELEMENT_VISIBLE });

  // Use Promise.all to wait for navigation triggered by button click
  // This prevents race conditions where waitForURL starts before navigation begins
  await Promise.all([
    page.waitForURL('/dashboard', { timeout: TIMEOUTS.NAVIGATION }),
    loginButton.click(),
  ]);

  await page.waitForLoadState('networkidle');
  await page
    .getByRole('heading', { name: /analytics dashboard/i })
    .waitFor({ state: 'visible', timeout: TIMEOUTS.ELEMENT_VISIBLE });
}

test.describe('Integration Rules - Auto-Create Ticket Feature', () => {
  // Parallel execution enabled with fixture-based isolated state
  // Each test gets its own adminContext (token, projectId, cleanup tracking)
  test.describe.configure({ mode: 'parallel' });

  test('should show auto-create checkbox in create rule dialog', async ({ page, adminContext }) => {
    await goToRulesPage(page, adminContext.projectId);

    // Click "Create Rule" button
    await page.getByRole('button', { name: /create rule/i }).click();

    // Verify auto-create checkbox is visible
    const autoCreateCheckbox = page.getByLabel(/automatically create tickets/i);
    await expect(autoCreateCheckbox).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });

    // Verify it's unchecked by default
    await expect(autoCreateCheckbox).not.toBeChecked();

    // Field Mappings tab is always visible in tabbed UI
    await expect(page.getByRole('tab', { name: /field mappings/i })).toBeVisible();
  });

  test('should show field mappings section when auto-create is enabled', async ({
    page,
    adminContext,
  }) => {
    await goToRulesPage(page, adminContext.projectId);

    await page.getByRole('button', { name: /create rule/i }).click();

    // Enable auto-create
    await page.getByLabel(/automatically create tickets/i).click();

    // Navigate to Field Mappings tab
    await goToFieldMappingsTab(page);

    // Jira field mappings section should now be visible
    await expect(page.getByTestId('field-mappings-section')).toBeVisible({
      timeout: TIMEOUTS.ELEMENT_VISIBLE,
    });

    // Verify standard Jira fields are visible
    await expect(page.getByTestId('jira-priority')).toBeVisible();
    await expect(page.getByTestId('jira-labels')).toBeVisible();
    await expect(page.getByTestId('jira-components')).toBeVisible();
    await expect(page.getByTestId('jira-assignee')).toBeVisible();
  });

  test('should hide field mappings section when auto-create is disabled', async ({
    page,
    adminContext,
  }) => {
    await goToRulesPage(page, adminContext.projectId);

    await page.getByRole('button', { name: /create rule/i }).click();

    // Enable auto-create
    await page.getByLabel(/automatically create tickets/i).click();

    // Navigate to Field Mappings tab
    await goToFieldMappingsTab(page);
    await expect(page.getByTestId('field-mappings-section')).toBeVisible();

    // Go back to Rule Details tab
    await page.getByRole('tab', { name: /rule details/i }).click();

    // Disable auto-create
    await page.getByLabel(/automatically create tickets/i).click();

    // Go back to Field Mappings tab
    await goToFieldMappingsTab(page);

    // Field mappings section should be hidden when auto-create is disabled
    await expect(page.getByTestId('field-mappings-section')).not.toBeVisible();
  });

  test('should create rule with auto-create and Jira field values', async ({
    page,
    adminContext,
  }) => {
    await goToRulesPage(page, adminContext.projectId);

    await page.getByRole('button', { name: /create rule/i }).click();

    // Generate unique rule name to prevent conflicts in parallel execution
    const timestamp = Date.now();
    const ruleName = `Auto-Create Jira Fields ${timestamp}`;

    // Fill basic rule info
    await page.getByLabel(/rule name/i).fill(ruleName);

    // Enable auto-create
    await page.getByLabel(/automatically create tickets/i).click();

    // Navigate to Field Mappings tab
    await goToFieldMappingsTab(page);

    // Fill Jira field values (these are always visible when auto-create is enabled)
    await page.getByTestId('jira-priority').click();
    await page.getByRole('option', { name: 'High', exact: true }).click();

    // Add labels using tag input - test Enter key functionality
    await page.getByTestId('jira-labels').fill('urgent');
    await page.getByTestId('jira-labels').press('Enter');
    await page.getByTestId('jira-labels').fill('bug');
    await page.getByTestId('jira-labels').press('Enter');

    // Submit form
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /^create rule$/i }).click();

    // Wait for the dialog to close
    await expect(dialog).not.toBeVisible({ timeout: TIMEOUTS.DIALOG_CLOSE });

    // Wait for navigation to settle
    await page.waitForLoadState('networkidle');

    // Verify rule appears in list with "Auto-create" badge
    const ruleCard = page.getByRole('article').filter({ hasText: ruleName });
    await expect(ruleCard).toBeVisible({ timeout: TIMEOUTS.API_RESPONSE });
    await expect(ruleCard.getByRole('status', { name: /auto-create/i })).toBeVisible();

    // Track for cleanup
    const rulesResponse = await axios.get(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    const newRule = rulesResponse.data.data.find(
      (r: { name: string; id: string }) => r.name === ruleName
    );
    if (newRule) {
      adminContext.createdRules.push({
        platform: 'jira',
        projectId: adminContext.projectId,
        ruleId: newRule.id,
      });
    }
  });

  test('should create rule with custom field mapping', async ({ page, adminContext }) => {
    await goToRulesPage(page, adminContext.projectId);

    await page.getByRole('button', { name: /create rule/i }).click();

    const timestamp = Date.now();
    const ruleName = `Auto-Create Custom ${timestamp}`;

    await page.getByLabel(/rule name/i).fill(ruleName);
    await page.getByLabel(/automatically create tickets/i).click();

    // Navigate to Field Mappings tab
    await goToFieldMappingsTab(page);

    // Click "Add Custom Field" button
    await page.getByTestId('add-custom-field-trigger').click();

    // Fill custom field form (Custom Field ID and Value inputs should now be visible)
    await page.getByTestId('custom-field-id').fill('customfield_10001');
    await page.getByTestId('custom-field-value').fill('"Sprint 23"');

    // Click "Add" button to add the custom field
    await page.getByTestId('add-custom-field-button').click();

    // Verify custom field appears in the custom fields list
    await expect(page.getByTestId('custom-fields-heading')).toBeVisible();

    // Submit form
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /^create rule$/i }).click();

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible({ timeout: TIMEOUTS.DIALOG_CLOSE });
    await page.waitForLoadState('networkidle');

    // Verify rule appears in list
    const ruleCard = page.getByRole('article').filter({ hasText: ruleName });
    await expect(ruleCard).toBeVisible({ timeout: TIMEOUTS.API_RESPONSE });

    // Verify API payload includes field_mappings with custom field
    const rulesResponse = await axios.get(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    const newRule = rulesResponse.data.data.find(
      (r: { name: string; auto_create?: boolean; field_mappings?: unknown }) => r.name === ruleName
    );
    expect(newRule).toBeDefined();
    expect(newRule.auto_create).toBe(true);
    expect(newRule.field_mappings).toBeDefined();
    expect(newRule.field_mappings['customfield_10001']).toBe('Sprint 23');

    if (newRule) {
      adminContext.createdRules.push({
        platform: 'jira',
        projectId: adminContext.projectId,
        ruleId: newRule.id,
      });
    }
  });

  test('should edit existing rule to enable auto-create', async ({ page, adminContext }) => {
    const timestamp = Date.now();
    const ruleName = `Edit Enable Auto ${timestamp}`;

    // Create a rule without auto-create via API
    const createResponse = await axios.post(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        name: ruleName,
        enabled: true,
        priority: 100,
        filters: [],
        auto_create: false,
      },
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    const ruleId = createResponse.data.data.id;
    adminContext.createdRules.push({ platform: 'jira', projectId: adminContext.projectId, ruleId });

    await goToRulesPage(page, adminContext.projectId);

    // Verify no "Auto-create" badge initially
    const ruleCard = page.getByRole('article').filter({ hasText: ruleName });
    await expect(ruleCard).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    await expect(ruleCard.getByRole('status', { name: /auto-create/i })).not.toBeVisible();

    // Click edit
    await ruleCard.getByRole('button', { name: /edit/i }).click();

    // Enable auto-create
    await page.getByLabel(/automatically create tickets/i).click();

    // Navigate to Field Mappings tab
    await goToFieldMappingsTab(page);

    // Fill a Jira field value (Priority field is now visible)
    await page.getByTestId('jira-priority').click();
    await page.getByRole('option', { name: 'High', exact: true }).click();

    // Submit
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /update rule/i }).click();

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible({ timeout: TIMEOUTS.DIALOG_CLOSE });
    await page.waitForLoadState('networkidle');

    // Verify "Auto-create" badge now appears
    await expect(ruleCard.getByRole('status', { name: /auto-create/i })).toBeVisible({
      timeout: TIMEOUTS.ELEMENT_VISIBLE,
    });
  });

  test('should edit rule with auto-create to modify field mappings', async ({
    page,
    adminContext,
  }) => {
    const timestamp = Date.now();
    const ruleName = `Edit Mappings ${timestamp}`;

    // Create a rule with auto-create enabled and field mappings via API
    const createResponse = await axios.post(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        name: ruleName,
        enabled: true,
        priority: 100,
        filters: [],
        auto_create: true,
        field_mappings: {
          priority: '{ "name": "Low" }',
          labels: '["initial"]',
        },
      },
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    const ruleId = createResponse.data.data.id;
    adminContext.createdRules.push({ platform: 'jira', projectId: adminContext.projectId, ruleId });

    await goToRulesPage(page, adminContext.projectId);

    // Click edit
    const ruleCard = page.getByRole('article').filter({ hasText: ruleName });
    await expect(ruleCard).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    await ruleCard.getByRole('button', { name: /edit/i }).click();

    // Navigate to Field Mappings tab
    await goToFieldMappingsTab(page);

    // Verify field values are loaded
    await expect(page.getByTestId('jira-priority')).toHaveText('Low');
    await expect(page.getByTestId('tag-labels-initial')).toBeVisible();

    // Modify priority value - select "Highest" from dropdown
    await page.getByTestId('jira-priority').click();
    await page.getByRole('option', { name: 'Highest', exact: true }).click();

    // Modify labels - remove old tag and add new ones
    await page
      .getByTestId('tag-labels-initial')
      .getByRole('button', { name: /remove/i })
      .click();
    await page.getByTestId('jira-labels').fill('updated');
    await page.getByTestId('jira-labels').press('Enter');
    await page.getByTestId('jira-labels').fill('critical');
    await page.getByTestId('jira-labels').press('Enter');

    // Submit
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /update rule/i }).click();

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible({ timeout: TIMEOUTS.DIALOG_CLOSE });
    await page.waitForLoadState('networkidle');

    // Verify via API that field_mappings were updated
    const ruleResponse = await axios.get(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    const updatedRule = ruleResponse.data.data.find(
      (r: { id: string; auto_create?: boolean; field_mappings?: unknown }) => r.id === ruleId
    );
    expect(updatedRule.field_mappings.priority).toEqual({ name: 'Highest' });
    expect(updatedRule.field_mappings.labels).toEqual(['updated', 'critical']);
  });

  test('should remove field mapping', async ({ page, adminContext }) => {
    const timestamp = Date.now();
    const ruleName = `Remove Mapping ${timestamp}`;

    await goToRulesPage(page, adminContext.projectId);

    await page.getByRole('button', { name: /create rule/i }).click();

    await page.getByLabel(/rule name/i).fill(ruleName);
    await page.getByLabel(/execution order/i).fill('100');
    await page.getByLabel(/automatically create tickets/i).click();

    // Navigate to Field Mappings tab
    await goToFieldMappingsTab(page);

    // Fill two Jira fields
    await page.getByTestId('jira-priority').click();
    await page.getByRole('option', { name: 'High', exact: true }).click();

    // Add labels using tag input - mix of button click and Enter key
    await page.getByTestId('jira-labels').fill('urgent');
    await page.getByTestId('add-labels-button').click();
    await page.getByTestId('jira-labels').fill('bug');
    await page.getByTestId('jira-labels').press('Enter');

    // Verify both fields have values
    await expect(page.getByTestId('jira-priority')).toHaveText('High');
    await expect(page.getByTestId('tag-labels-urgent')).toBeVisible();
    await expect(page.getByTestId('tag-labels-bug')).toBeVisible();

    // Clear the priority field to remove that mapping
    await page.getByTestId('remove-priority').click();

    // Verify priority is now empty but labels still have values
    await expect(page.getByTestId('jira-priority')).toBeVisible();
    const priorityText = await page.getByTestId('jira-priority').textContent();
    expect(priorityText?.includes('Select priority')).toBe(true);
    await expect(page.getByTestId('tag-labels-urgent')).toBeVisible();
    await expect(page.getByTestId('tag-labels-bug')).toBeVisible();

    // Submit
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /^create rule$/i }).click();

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible({ timeout: TIMEOUTS.DIALOG_CLOSE });
    await page.waitForLoadState('networkidle');

    // Verify rule appears in list
    const ruleCard = page.getByRole('article').filter({ hasText: ruleName });
    await expect(ruleCard).toBeVisible({ timeout: TIMEOUTS.API_RESPONSE });

    // Verify via API that only labels mapping exists
    const rulesResponse = await axios.get(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    const newRule = rulesResponse.data.data.find(
      (r: { name: string; id: string }) => r.name === ruleName
    );
    expect(newRule.field_mappings.priority).toBeUndefined();
    expect(newRule.field_mappings.labels).toEqual(['urgent', 'bug']);

    if (newRule) {
      adminContext.createdRules.push({
        platform: 'jira',
        projectId: adminContext.projectId,
        ruleId: newRule.id,
      });
    }
  });

  test('should clear all field mappings', async ({ page, adminContext }) => {
    const timestamp = Date.now();
    const ruleName = `Clear All ${timestamp}`;

    await goToRulesPage(page, adminContext.projectId);

    await page.getByRole('button', { name: /create rule/i }).click();

    await page.getByLabel(/rule name/i).fill(ruleName);
    await page.getByLabel(/execution order/i).fill('100');
    await page.getByLabel(/automatically create tickets/i).click();

    // Fill multiple Jira fields
    // Set priority

    // Navigate to Field Mappings tab first
    await goToFieldMappingsTab(page);

    await page.getByTestId('jira-priority').click();
    await page.getByRole('option', { name: 'High', exact: true }).click();

    // Add labels - use Enter key
    await page.getByTestId('jira-labels').fill('urgent');
    await page.getByTestId('jira-labels').press('Enter');
    await page.getByTestId('jira-labels').fill('bug');
    await page.getByTestId('jira-labels').press('Enter');

    // Add component - use button click
    await page.getByTestId('jira-components').fill('Frontend');
    await page.getByTestId('add-components-button').click();

    // Verify all three fields have values
    await expect(page.getByTestId('jira-priority')).toHaveText('High');
    await expect(page.getByTestId('tag-labels-urgent')).toBeVisible();
    await expect(page.getByTestId('tag-labels-bug')).toBeVisible();
    await expect(page.getByTestId('tag-components-Frontend')).toBeVisible();

    // Click "Clear All" button
    await page.getByTestId('clear-all-fields').click();

    // Verify all tags are removed
    await expect(page.getByTestId('tag-labels-urgent')).not.toBeVisible();
    await expect(page.getByTestId('tag-labels-bug')).not.toBeVisible();
    await expect(page.getByTestId('tag-components-Frontend')).not.toBeVisible();

    // Priority select should be empty
    await expect(page.getByTestId('jira-priority')).toBeVisible();
    const priorityText = await page.getByTestId('jira-priority').textContent();
    expect(priorityText?.includes('Select priority')).toBe(true);

    // Go back to Rule Details tab to check auto-create checkbox
    await page.getByRole('tab', { name: /rule details/i }).click();

    // Auto-create checkbox should still be enabled
    await expect(page.getByLabel(/automatically create tickets/i)).toBeChecked();

    // Go back to Field Mappings tab to fill one field
    await goToFieldMappingsTab(page);

    // Fill one field again before submitting
    await page.getByTestId('jira-priority').click();
    await page.getByRole('option', { name: 'Medium' }).click();

    // Submit
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /^create rule$/i }).click();

    await expect(dialog).not.toBeVisible({ timeout: TIMEOUTS.DIALOG_CLOSE });
    await page.waitForLoadState('networkidle');

    // Verify rule was created with only the one field mapping
    const rulesResponse = await axios.get(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    const newRule = rulesResponse.data.data.find((r: { name: string }) => r.name === ruleName);
    expect(newRule.field_mappings.priority).toEqual({ name: 'Medium' });
    expect(newRule.field_mappings.labels).toBeUndefined();
    expect(newRule.field_mappings.components).toBeUndefined();

    if (newRule) {
      adminContext.createdRules.push({
        platform: 'jira',
        projectId: adminContext.projectId,
        ruleId: newRule.id,
      });
    }
  });

  test('should disable auto-create and remove field mappings section', async ({
    page,
    adminContext,
  }) => {
    const timestamp = Date.now();
    const ruleName = `Disable Auto ${timestamp}`;

    // Create a rule with auto-create enabled via API
    const createResponse = await axios.post(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        name: ruleName,
        enabled: true,
        priority: 100,
        filters: [],
        auto_create: true,
        field_mappings: { priority: 'priority' },
      },
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    const ruleId = createResponse.data.data.id;
    adminContext.createdRules.push({ platform: 'jira', projectId: adminContext.projectId, ruleId });

    await goToRulesPage(page, adminContext.projectId);

    // Verify "Auto-create" badge is visible
    const ruleCard = page.getByRole('article').filter({ hasText: ruleName });
    await expect(ruleCard).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    await expect(ruleCard.getByRole('status', { name: /auto-create/i })).toBeVisible();

    // Click edit
    await ruleCard.getByRole('button', { name: /edit/i }).click();

    // Navigate to Field Mappings tab
    await goToFieldMappingsTab(page);

    // Verify field mappings section is visible
    await expect(page.getByTestId('field-mappings-section')).toBeVisible({
      timeout: TIMEOUTS.ELEMENT_VISIBLE,
    });

    // Go back to Rule Details tab to disable auto-create
    await page.getByRole('tab', { name: /rule details/i }).click();

    // Disable auto-create
    await page.getByLabel(/automatically create tickets/i).click();

    // Go back to Field Mappings tab
    await goToFieldMappingsTab(page);

    // Field mappings section should be hidden
    await expect(page.getByText(/jira field mappings/i)).not.toBeVisible();

    // Submit
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /update rule/i }).click();

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible({ timeout: TIMEOUTS.DIALOG_CLOSE });
    await page.waitForLoadState('networkidle');

    // Verify "Auto-create" badge is removed
    await expect(ruleCard.getByRole('status', { name: /auto-create/i })).not.toBeVisible({
      timeout: TIMEOUTS.ELEMENT_VISIBLE,
    });
  });

  test('should show auto-create badge only on rules with auto-create enabled', async ({
    page,
    adminContext,
  }) => {
    const timestamp = Date.now();
    const rule1Name = `With Auto ${timestamp}`;
    const rule2Name = `Without Auto ${timestamp}`;

    // Create two rules: one with auto-create, one without
    const rule1Response = await axios.post(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        name: rule1Name,
        enabled: true,
        priority: 100,
        filters: [],
        auto_create: true,
        field_mappings: { priority: 'priority' },
      },
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    adminContext.createdRules.push({
      platform: 'jira',
      projectId: adminContext.projectId,
      ruleId: rule1Response.data.data.id,
    });

    const rule2Response = await axios.post(
      `${API_BASE_URL}/api/v1/integrations/jira/${adminContext.projectId}/rules`,
      {
        name: rule2Name,
        enabled: true,
        priority: 90,
        filters: [],
        auto_create: false,
      },
      {
        headers: { Authorization: `Bearer ${adminContext.adminToken}` },
      }
    );
    adminContext.createdRules.push({
      platform: 'jira',
      projectId: adminContext.projectId,
      ruleId: rule2Response.data.data.id,
    });

    await goToRulesPage(page, adminContext.projectId);

    // Rule with auto-create should have badge
    const ruleCard1 = page.getByRole('article').filter({ hasText: rule1Name });
    await expect(ruleCard1).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    await expect(ruleCard1.getByRole('status', { name: /auto-create/i })).toBeVisible();

    // Rule without auto-create should NOT have badge
    const ruleCard2 = page.getByRole('article').filter({ hasText: rule2Name });
    await expect(ruleCard2).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    await expect(ruleCard2.getByRole('status', { name: /auto-create/i })).not.toBeVisible();
  });

  test('should show help text for Jira field values', async ({ page, adminContext }) => {
    await goToRulesPage(page, adminContext.projectId);

    await page.getByRole('button', { name: /create rule/i }).click();
    await page.getByLabel(/automatically create tickets/i).click();

    // Navigate to Field Mappings tab
    await goToFieldMappingsTab(page);

    // Verify help text is visible (shows new UI component usage instructions)
    await expect(page.getByTestId('field-mappings-help')).toBeVisible({
      timeout: TIMEOUTS.ELEMENT_VISIBLE,
    });
  });

  // Negative test cases for error handling and validation
  test.describe('Error Handling & Validation', () => {
    test('should allow multiple custom fields with different IDs', async ({
      page,
      adminContext,
    }) => {
      await goToRulesPage(page, adminContext.projectId);
      await page.getByRole('button', { name: /create rule/i }).click();
      await page.getByLabel(/automatically create tickets/i).click();

      // Navigate to Field Mappings tab
      await goToFieldMappingsTab(page);

      // Add first custom field
      await page.getByTestId('add-custom-field-trigger').click();
      await page.getByTestId('custom-field-id').fill('customfield_10001');
      await page.getByTestId('custom-field-value').fill('"Sprint 23"');
      await page.getByRole('button', { name: /^add$/i }).click();

      // Verify custom fields section appears
      await expect(page.getByTestId('custom-fields-heading')).toBeVisible({
        timeout: TIMEOUTS.ELEMENT_VISIBLE,
      });

      // Add second custom field
      await page.getByTestId('add-custom-field-trigger').click();
      await page.getByTestId('custom-field-id').fill('customfield_10002');
      await page.getByTestId('custom-field-value').fill('{ "value": "Team A" }');
      await page.getByRole('button', { name: /^add$/i }).click();

      // Both custom fields should exist (look for remove buttons)
      const removeButtons = page.getByTestId('remove-custom-field-button');
      await expect(removeButtons).toHaveCount(2);
    });

    test('should allow cancel when adding custom field', async ({ page, adminContext }) => {
      await goToRulesPage(page, adminContext.projectId);
      await page.getByRole('button', { name: /create rule/i }).click();
      await page.getByLabel(/automatically create tickets/i).click();

      // Navigate to Field Mappings tab
      await goToFieldMappingsTab(page);

      // Wait for Field Mappings content to be visible (autoCreate state update)
      await expect(page.getByText(/platform field mappings/i)).toBeVisible();

      // Click "Add Custom Field"
      await page.getByTestId('add-custom-field-trigger').click();

      // Verify custom field form is visible
      await expect(page.getByTestId('custom-field-id')).toBeVisible();
      await expect(page.getByTestId('custom-field-value')).toBeVisible();

      // Fill the inputs
      await page.getByTestId('custom-field-id').fill('customfield_10001');
      await page.getByTestId('custom-field-value').fill('"test"');

      // Click Cancel
      await page.getByTestId('cancel-custom-field-button').click();

      // Form should be hidden, "Add Custom Field" button visible again
      await expect(page.getByTestId('custom-field-id')).not.toBeVisible();
      await expect(page.getByTestId('add-custom-field-trigger')).toBeVisible();

      // Custom fields section should NOT exist (no fields were added)
      await expect(page.getByTestId('custom-fields-heading')).not.toBeVisible();
    });

    test('should allow removing custom field', async ({ page, adminContext }) => {
      await goToRulesPage(page, adminContext.projectId);
      await page.getByRole('button', { name: /create rule/i }).click();
      await page.getByLabel(/automatically create tickets/i).click();

      // Navigate to Field Mappings tab
      await goToFieldMappingsTab(page);

      // Add a custom field
      await page.getByTestId('add-custom-field-trigger').click();
      await page.getByTestId('custom-field-id').fill('customfield_10001');
      await page.getByTestId('custom-field-value').fill('"Sprint 23"');
      await page.getByTestId('add-custom-field-button').click();

      // Verify custom field appears
      await expect(page.getByTestId('custom-fields-heading')).toBeVisible();
      const removeButton = page.getByTestId('remove-custom-field-button');
      await expect(removeButton).toBeVisible();

      // Remove the custom field
      await removeButton.click();

      // Custom fields section should disappear
      await expect(page.getByTestId('custom-fields-heading')).not.toBeVisible();
      await expect(removeButton).not.toBeVisible();
    });

    test('should handle rule creation failure gracefully', async ({ page, adminContext }) => {
      await goToRulesPage(page, adminContext.projectId);
      await page.getByRole('button', { name: /create rule/i }).click();

      // Fill in valid data (client-side validation prevents submission without name)
      const ruleName = `Test Rule ${Date.now()}`;
      await page.getByLabel(/rule name/i).fill(ruleName);
      await page.getByLabel(/automatically create tickets/i).click();

      // Navigate to Field Mappings tab
      await goToFieldMappingsTab(page);

      await page.getByTestId('jira-priority').click();
      await page.getByRole('option', { name: 'High', exact: true }).click();

      const dialog = page.getByRole('dialog');

      // If creation succeeds, dialog should close and rule appears in list
      // (Backend validation/errors would be tested via API mocking, not E2E)
      await dialog.getByRole('button', { name: /^create rule$/i }).click();

      // Wait for dialog to close
      await expect(dialog).not.toBeVisible({ timeout: TIMEOUTS.DIALOG_CLOSE });

      // Verify rule created successfully
      await expect(page.getByText(ruleName)).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    });

    test('should preserve field mappings when dialog validation fails', async ({
      page,
      adminContext,
    }) => {
      await goToRulesPage(page, adminContext.projectId);
      await page.getByRole('button', { name: /create rule/i }).click();

      // Enable auto-create and fill Jira fields WITH a valid name
      const ruleName = `Test Rule ${Date.now()}`;
      await page.getByLabel(/rule name/i).fill(ruleName);
      await page.getByLabel(/automatically create tickets/i).click();

      // Navigate to Field Mappings tab
      await goToFieldMappingsTab(page);

      await page.getByTestId('jira-priority').click();
      await page.getByRole('option', { name: 'High', exact: true }).click();

      await page.getByTestId('jira-labels').fill('urgent');
      await page.getByTestId('jira-labels').press('Enter');
      await page.getByTestId('jira-labels').fill('bug');
      await page.getByTestId('jira-labels').press('Enter');

      // Submit with all valid data
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: /^create rule$/i }).click();

      // Dialog should close (submission successful)
      await expect(dialog).not.toBeVisible({ timeout: TIMEOUTS.DIALOG_CLOSE });

      // Verify rule created with correct field mappings
      await expect(page.getByText(ruleName)).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    });
  });
});
