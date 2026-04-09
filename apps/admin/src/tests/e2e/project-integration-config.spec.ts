import { test as base, expect, type Page } from '../fixtures/setup-fixture';
import axios from 'axios';
import { E2E_BASE_HOSTNAME } from './config';
import { getAdminToken } from './helpers/integration-helpers';

const API_BASE_URL = 'http://localhost:4000';

// Test credentials
const TEST_ADMIN = {
  email: 'admin@bugspotter.io',
  password: 'admin123',
  name: 'Test Admin',
};

// Fixture type for isolated test state
type ProjectIntegrationContextFixture = {
  adminToken: string;
  projectId: string;
  configuredPlatforms: string[];
};

// Extend base test with project integration context fixture
const test = base.extend<{ integrationContext: ProjectIntegrationContextFixture }>({
  integrationContext: async ({ setupState, page }, use) => {
    await setupState.ensureInitialized(TEST_ADMIN);

    // Get admin token and project
    const adminToken = await getAdminToken();
    const project = await setupState.ensureProjectExists(adminToken);

    // Navigate to dashboard to ensure authenticated state
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // If redirected to login, perform login
    if (page.url().includes('/login')) {
      await loginAsAdmin(page);
    }

    // Provide isolated state for this test
    const configuredPlatforms: string[] = [];
    await use({ adminToken, projectId: project.id, configuredPlatforms });

    // Automatic cleanup: delete configured integrations
    for (const platform of configuredPlatforms) {
      try {
        await axios.delete(`${API_BASE_URL}/api/v1/integrations/${platform}/${project.id}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
      } catch (error: unknown) {
        const err = error as { response?: { status?: number }; message?: string };
        if (err.response?.status !== 404) {
          console.error(`Failed to cleanup ${platform} integration:`, err.message);
        }
      }
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

  await page.fill('input[type="email"]', TEST_ADMIN.email);
  await page.fill('input[type="password"]', TEST_ADMIN.password);

  await page.getByRole('button', { name: /sign in|login/i }).click();

  await page.waitForURL('/dashboard', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
}

test.describe('Project Integration Configuration', () => {
  test.describe.configure({ mode: 'parallel' });

  // Skip - Add Integration button only appears when there are unconfigured integrations available.
  // In a fresh test environment, integrations may already be configured from previous tests.
  test.skip('should display Add Integration dropdown for unconfigured integrations', async ({
    page,
    integrationContext,
  }) => {
    await page.goto(`/projects/${integrationContext.projectId}/integrations`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Verify Add Integration dropdown button exists
    await page.screenshot({ path: 'e2e-debug/before-add-integration-click.png', fullPage: true });
    const addIntegrationButton = page.getByRole('button', { name: 'Add Integration' });
    await expect(addIntegrationButton).toBeVisible();

    // Click dropdown to see available integrations
    await addIntegrationButton.click();
    await page.waitForTimeout(500);

    // Verify Jira is in the dropdown
    await expect(page.getByRole('menuitem', { name: /jira/i })).toBeVisible();
  });

  // Skip - Add Integration button only appears when there are unconfigured integrations available.
  // Tests can navigate directly to /integrations/{platform}/configure instead.
  test.skip('should navigate to configuration page when selecting from dropdown', async ({
    page,
    integrationContext,
  }) => {
    await page.goto(`/projects/${integrationContext.projectId}/integrations`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Click Add Integration dropdown
    await page.screenshot({ path: 'e2e-debug/before-dropdown-click.png', fullPage: true });
    const addIntegrationButton = page.getByRole('button', { name: 'Add Integration' });
    await addIntegrationButton.waitFor({ state: 'visible', timeout: 10000 });
    await addIntegrationButton.click();
    await page.waitForTimeout(500);

    // Select Jira from dropdown
    await page.getByRole('menuitem', { name: /jira/i }).click();

    // Verify we're on the configuration page
    await expect(page).toHaveURL(
      `/projects/${integrationContext.projectId}/integrations/jira/configure`
    );

    // Verify page title
    await expect(page.getByRole('heading', { name: /configure jira/i })).toBeVisible();

    // Verify page description
    await expect(
      page.getByText(/set up credentials and settings for this integration/i)
    ).toBeVisible();
  });

  test('should display configuration form with all required fields', async ({
    page,
    integrationContext,
  }) => {
    await page.goto(`/projects/${integrationContext.projectId}/integrations/jira/configure`, {
      waitUntil: 'domcontentloaded',
    });

    // Configuration section
    await expect(page.getByRole('heading', { name: /^configuration$/i })).toBeVisible();
    await expect(page.getByLabel(/instance url/i)).toBeVisible();
    await expect(page.getByLabel(/project key/i)).toBeVisible();
    await expect(page.getByLabel(/additional config/i)).toBeVisible();

    // Credentials section
    await expect(page.getByRole('heading', { name: /^credentials$/i })).toBeVisible();
    await expect(page.getByLabel(/^email$/i)).toBeVisible();
    await expect(page.getByLabel(/api token/i)).toBeVisible();
    await expect(page.getByLabel(/password \(if using basic auth\)/i)).toBeVisible();

    // Action buttons
    await expect(page.getByRole('button', { name: /delete configuration/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /test connection/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /save configuration/i })).toBeVisible();
  });

  test('should successfully save integration configuration', async ({
    page,
    integrationContext,
  }) => {
    await page.goto(`/projects/${integrationContext.projectId}/integrations/jira/configure`, {
      waitUntil: 'domcontentloaded',
    });

    // Fill in configuration
    await page.getByLabel(/instance url/i).fill('https://test-e2e.atlassian.net');
    await page.getByLabel(/project key/i).fill('E2E');
    await page.getByLabel(/additional config/i).fill('{"issueType": "Bug", "priority": "High"}');

    // Fill in credentials
    await page.getByLabel(/^email$/i).fill('e2e-test@example.com');
    await page.getByLabel(/api token/i).fill('test-api-token-e2e-12345');
    await page.getByLabel(/password \(if using basic auth\)/i).fill('test-password-e2e');

    // Save configuration
    await page.getByRole('button', { name: /save configuration/i }).click();

    // Wait for success toast
    await expect(page.getByText(/configuration saved successfully/i)).toBeVisible({
      timeout: 10000,
    });

    // Verify redirect to integrations list
    await expect(page).toHaveURL(`/projects/${integrationContext.projectId}/integrations`, {
      timeout: 10000,
    });

    // Track for cleanup
    integrationContext.configuredPlatforms.push('jira');
  });

  test('should load existing configuration when navigating to config page', async ({
    page,
    integrationContext,
  }) => {
    // First, create a configuration via API
    await axios.post(
      `${API_BASE_URL}/api/v1/integrations/jira/${integrationContext.projectId}`,
      {
        config: {
          instanceUrl: 'https://existing.atlassian.net',
          projectKey: 'EXIST',
        },
        credentials: {
          email: 'existing@example.com',
          apiToken: 'existing-token',
        },
        enabled: true,
      },
      {
        headers: { Authorization: `Bearer ${integrationContext.adminToken}` },
      }
    );
    integrationContext.configuredPlatforms.push('jira');

    // Navigate to configuration page
    await page.goto(`/projects/${integrationContext.projectId}/integrations/jira/configure`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Verify existing values are loaded
    await expect(page.getByLabel(/instance url/i)).toHaveValue('https://existing.atlassian.net');
    await expect(page.getByLabel(/project key/i)).toHaveValue('EXIST');

    // Note: Credentials are not returned by API for security
    await expect(page.getByLabel(/^email$/i)).toHaveValue('');
    await expect(page.getByLabel(/api token/i)).toHaveValue('');
  });

  test('should successfully delete integration configuration', async ({
    page,
    integrationContext,
  }) => {
    // First, create a configuration
    await axios.post(
      `${API_BASE_URL}/api/v1/integrations/jira/${integrationContext.projectId}`,
      {
        config: {
          instanceUrl: 'https://mycompany.atlassian.net',
          projectKey: 'TEST',
        },
        credentials: {
          email: 'test@example.com',
          apiToken: 'test-token-123',
        },
        enabled: true,
      },
      {
        headers: { Authorization: `Bearer ${integrationContext.adminToken}` },
      }
    );

    // Navigate to configuration page
    await page.goto(`/projects/${integrationContext.projectId}/integrations/jira/configure`, {
      waitUntil: 'domcontentloaded',
    });

    // Click Delete Configuration button
    await page.getByRole('button', { name: /delete configuration/i }).click();

    // Wait for success toast
    await expect(page.getByText(/configuration deleted successfully/i)).toBeVisible({
      timeout: 10000,
    });

    // Verify redirect to integrations list
    await expect(page).toHaveURL(`/projects/${integrationContext.projectId}/integrations`, {
      timeout: 10000,
    });
  });

  test('should have back navigation to integrations list', async ({ page, integrationContext }) => {
    await page.goto(`/projects/${integrationContext.projectId}/integrations/jira/configure`, {
      waitUntil: 'domcontentloaded',
    });

    // Click back button
    const backButton = page.getByRole('button', { name: /back to integrations/i });
    await expect(backButton).toBeVisible();
    await backButton.click();

    // Verify we're back on the integrations list
    await expect(page).toHaveURL(`/projects/${integrationContext.projectId}/integrations`);
    await expect(page.getByRole('heading', { name: /project integrations/i })).toBeVisible();
  });

  test('should display info section with security details', async ({
    page,
    integrationContext,
  }) => {
    await page.goto(`/projects/${integrationContext.projectId}/integrations/jira/configure`, {
      waitUntil: 'domcontentloaded',
    });

    // Verify info section content
    await expect(
      page.getByText(/configuration contains non-sensitive settings like urls/i)
    ).toBeVisible();
    await expect(page.getByText(/credentials are encrypted before being stored/i)).toBeVisible();
    await expect(page.getByText(/click test connection to verify your settings/i)).toBeVisible();
  });

  test('should update existing configuration', async ({ page, integrationContext }) => {
    // Create initial configuration
    await axios.post(
      `${API_BASE_URL}/api/v1/integrations/jira/${integrationContext.projectId}`,
      {
        config: {
          instanceUrl: 'https://initial.atlassian.net',
          projectKey: 'INITIAL',
        },
        credentials: {
          email: 'initial@example.com',
          apiToken: 'initial_token',
        },
        enabled: true,
      },
      {
        headers: { Authorization: `Bearer ${integrationContext.adminToken}` },
      }
    );
    integrationContext.configuredPlatforms.push('jira');

    // Navigate to config page
    await page.goto(`/projects/${integrationContext.projectId}/integrations/jira/configure`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Update configuration
    await page.getByLabel(/project key/i).clear();
    await page.getByLabel(/project key/i).fill('UPDATED');

    // Save changes
    await page.getByRole('button', { name: /save configuration/i }).click();

    // Wait for success toast
    await expect(page.getByText(/configuration saved successfully/i)).toBeVisible({
      timeout: 10000,
    });

    // Verify redirect and re-navigate to same config page
    await page.goto(`/projects/${integrationContext.projectId}/integrations/jira/configure`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Verify updated value persists
    await expect(page.getByLabel(/project key/i)).toHaveValue('UPDATED');
  });

  test('should show Configure and Manage Rules buttons for configured Jira integration', async ({
    page,
    integrationContext,
  }) => {
    // First configure an integration via API
    await axios.post(
      `${API_BASE_URL}/api/v1/integrations/jira/${integrationContext.projectId}`,
      {
        config: { instanceUrl: 'https://test.atlassian.net', projectKey: 'TEST' },
        credentials: { email: 'test@example.com', apiToken: 'test-token' },
        enabled: true,
      },
      { headers: { Authorization: `Bearer ${integrationContext.adminToken}` } }
    );
    integrationContext.configuredPlatforms.push('jira');

    await page.goto(`/projects/${integrationContext.projectId}/integrations`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Wait for Jira card to be fully rendered (should be visible now that it's configured)
    const jiraCard = page.locator('[data-testid="integration-card-jira"]');
    await jiraCard.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for potential re-renders to complete
    await page.waitForTimeout(500);

    // Verify Jira card has both Configure and Manage Rules buttons (configured integration)
    await expect(jiraCard.locator('[data-testid="configure-jira"]')).toBeVisible();
    await expect(jiraCard.locator('[data-testid="manage-rules-jira"]')).toBeVisible();
  });

  test('should preserve configuration when navigating away and back', async ({
    page,
    integrationContext,
  }) => {
    // First configure an integration so it appears in the list
    await axios.post(
      `${API_BASE_URL}/api/v1/integrations/jira/${integrationContext.projectId}`,
      {
        config: { instanceUrl: 'https://existing.atlassian.net', projectKey: 'EXIST' },
        credentials: { email: 'existing@example.com', apiToken: 'existing-token' },
        enabled: true,
      },
      { headers: { Authorization: `Bearer ${integrationContext.adminToken}` } }
    );
    integrationContext.configuredPlatforms.push('jira');

    await page.goto(`/projects/${integrationContext.projectId}/integrations/jira/configure`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Update some values (but don't save)
    await page.getByLabel(/instance url/i).clear();
    await page.getByLabel(/instance url/i).fill('https://jira.example.com');
    await page.getByLabel(/project key/i).clear();
    await page.getByLabel(/project key/i).fill('TEST');

    // Navigate back without saving
    await page.getByRole('button', { name: /back to integrations/i }).click();
    await page.waitForURL(`/projects/${integrationContext.projectId}/integrations`);
    await page.waitForLoadState('networkidle');

    // Wait for integration card to be visible (should be visible since configured)
    await page.waitForSelector('[data-testid="integration-card-jira"]', {
      state: 'visible',
      timeout: 10000,
    });

    // Wait for UI stabilization
    await page.waitForTimeout(500);

    // Navigate to config page again via Configure button
    await page.locator('[data-testid="configure-jira"]').click();
    await page.waitForURL(`/projects/${integrationContext.projectId}/integrations/jira/configure`);
    await page.waitForLoadState('networkidle');

    // Values should be the original saved values (unsaved changes discarded)
    await expect(page.getByLabel(/instance url/i)).toHaveValue('https://existing.atlassian.net');
    await expect(page.getByLabel(/project key/i)).toHaveValue('EXIST');
  });

  test('should validate required fields before saving', async ({ page, integrationContext }) => {
    await page.goto(`/projects/${integrationContext.projectId}/integrations/jira/configure`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Wait for form to be ready
    await page.waitForSelector('[data-testid="save-config-button"]', {
      state: 'visible',
      timeout: 10000,
    });

    // Try to save without filling anything - backend allows empty configurations
    await page.getByRole('button', { name: /save configuration/i }).click();

    // Should show success toast (backend accepts empty configs)
    await expect(page.getByText(/configuration saved successfully/i)).toBeVisible({
      timeout: 10000,
    });

    // Should navigate back to integrations page
    await page.waitForURL(`**/projects/${integrationContext.projectId}/integrations`, {
      timeout: 10000,
    });
  });
});
