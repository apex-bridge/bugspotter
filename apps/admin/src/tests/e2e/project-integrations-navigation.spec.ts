import { test, expect, type Page } from '../fixtures/setup-fixture';
import { waitForI18nReady } from './helpers/i18n-helpers';
import { E2E_API_URL } from './config';

// Use the shared helper so `API_PORT` / `API_URL` overrides (see
// `src/tests/e2e/config.ts`) actually apply here too.
const API_URL = E2E_API_URL;

// Test credentials
const TEST_ADMIN = {
  email: 'admin@bugspotter.io',
  password: 'admin123',
  name: 'Test Admin',
};

/**
 * E2E tests for project integrations navigation UI
 * Verifies the navigation path: Projects -> Project Integrations -> Integration Rules
 */

// Shared authentication helper
async function loginAsAdmin(page: Page) {
  const currentURL = page.url();
  if (currentURL && currentURL.includes('localhost') && !currentURL.includes('/login')) {
    return; // Already logged in
  }

  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', TEST_ADMIN.email);
  await page.fill('input[type="password"]', TEST_ADMIN.password);
  await page.getByRole('button', { name: /sign in|login/i }).click();
  await page.waitForURL('/dashboard', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await waitForI18nReady(page, { match: 'some' });
}

test.describe('Project Integrations Navigation', () => {
  test.describe.configure({ mode: 'serial' });

  let adminToken: string;
  let projectId: string;

  test.beforeEach(async ({ setupState, request }) => {
    // Ensure admin user exists
    await setupState.ensureInitialized(TEST_ADMIN);

    // Get auth token for API calls
    if (!adminToken) {
      const loginResponse = await request.post(`${API_URL}/api/v1/auth/login`, {
        data: {
          email: TEST_ADMIN.email,
          password: TEST_ADMIN.password,
        },
      });

      if (loginResponse.ok()) {
        const data = await loginResponse.json();
        adminToken = data.data.access_token;
      }
    }

    // Create a test project. In SaaS mode, the hub domain requires
    // `organization_id` in the body (see `resolveOrganizationForProject`
    // in packages/backend/src/api/routes/projects.ts). The admin user is
    // seeded into a single default org by `ensureInitialized`, so
    // taking `[0]` is deterministic.
    const myOrgsResponse = await request.get(`${API_URL}/api/v1/organizations/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!myOrgsResponse.ok()) {
      // Include status + body so a 401 (adminToken never populated
      // because login failed) doesn't masquerade as "admin has no
      // org memberships".
      throw new Error(
        `Failed to fetch /organizations/me: ${myOrgsResponse.status()} ${await myOrgsResponse.text()}`
      );
    }
    const myOrgs = (await myOrgsResponse.json()).data as Array<{ id: string }> | undefined;
    const organizationId = Array.isArray(myOrgs) ? myOrgs[0]?.id : undefined;
    if (!organizationId) {
      throw new Error('Failed to resolve organization_id for test project');
    }

    const projectResponse = await request.post(`${API_URL}/api/v1/projects`, {
      data: { name: 'E2E Navigation Test Project', organization_id: organizationId },
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    if (projectResponse.ok()) {
      const data = await projectResponse.json();
      projectId = data.data.id;
    }
  });

  test.afterEach(async ({ request }) => {
    // Cleanup: Delete the test project
    if (projectId && adminToken) {
      try {
        await request.delete(`${API_URL}/api/v1/projects/${projectId}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
      } catch (error) {
        console.error('Cleanup failed:', error);
      }
    }
  });

  test('should navigate from Projects page to Project Integrations page', async ({ page }) => {
    await loginAsAdmin(page);

    // Navigate to projects page
    await page.goto('/projects', { waitUntil: 'domcontentloaded' });
    await waitForI18nReady(page, { match: 'some' });

    // Wait for projects to load
    await page.waitForSelector('[data-testid^="project-card-"]', { timeout: 10000 });

    // Find the Integrations button for our test project
    const projectCard = page.locator(`[data-testid="project-card-${projectId}"]`);
    await expect(projectCard).toBeVisible();

    // Click the Integrations button
    const integrationsButton = projectCard.getByRole('button', { name: /integrations/i });
    await expect(integrationsButton).toBeVisible();
    await integrationsButton.click();

    // Verify we're on the project integrations page
    await expect(page).toHaveURL(`/projects/${projectId}/integrations`);

    // Verify page title
    await expect(page.getByRole('heading', { name: /project integrations/i })).toBeVisible();

    // Verify page description
    await expect(page.getByText(/manage integrations and automation rules/i)).toBeVisible();
  });

  test('should show empty state when no integrations configured', async ({ page }) => {
    await loginAsAdmin(page);

    // Navigate directly to project integrations page
    await page.goto(`/projects/${projectId}/integrations`, { waitUntil: 'domcontentloaded' });
    await waitForI18nReady(page, { match: 'some' });

    // Should show empty state (no configured integrations yet)
    await expect(page.getByText(/no integrations configured/i)).toBeVisible();

    // Should show Add Integration dropdown button
    const addButton = page.getByRole('button', { name: /add integration/i });
    await expect(addButton).toBeVisible();

    // Click dropdown to verify available integrations
    await addButton.click();
    await page.waitForTimeout(500);

    // Verify Jira is in the dropdown
    await expect(page.getByRole('menuitem', { name: /jira/i })).toBeVisible();
  });

  test('should navigate from configured Jira card to Integration Rules page', async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page);

    // First configure Jira integration via API
    await request.post(`${API_URL}/api/v1/integrations/jira/${projectId}`, {
      data: {
        config: { instanceUrl: 'https://test.atlassian.net', projectKey: 'TEST' },
        credentials: { email: 'test@example.com', apiToken: 'test-token' },
        enabled: true,
      },
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    // Navigate to project integrations page
    await page.goto(`/projects/${projectId}/integrations`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await waitForI18nReady(page, { match: 'some' });

    // Now Jira card should be visible (configured integration)
    const jiraCard = page.locator('[data-testid="integration-card-jira"]');
    await expect(jiraCard).toBeVisible();

    // Find and click the Manage Rules button for Jira using data-testid
    const manageRulesButton = page.locator('[data-testid="manage-rules-jira"]');
    await expect(manageRulesButton).toBeVisible();
    await manageRulesButton.click();

    // Verify we're on the integration rules page
    await expect(page).toHaveURL(`/integrations/jira/${projectId}/rules`);

    // Verify page title
    await expect(page.getByRole('heading', { name: /integration rules/i })).toBeVisible();

    // Verify page description mentions jira
    await expect(
      page.getByText(/configure filtering and throttling rules for jira integration/i)
    ).toBeVisible();

    // Verify Create Rule button is present
    await expect(page.getByRole('button', { name: /create rule/i })).toBeVisible();
  });

  // Note: Tests for unconfigured integrations removed since new UI only shows configured integrations
  // To access unconfigured integrations, use the "Add Integration" dropdown

  test('should have back navigation from Project Integrations to Projects', async ({ page }) => {
    await loginAsAdmin(page);

    // Navigate to project integrations page
    await page.goto(`/projects/${projectId}/integrations`, { waitUntil: 'domcontentloaded' });
    await waitForI18nReady(page, { match: 'some' });

    // Find and click the back button using data-testid
    const backButton = page.locator('[data-testid="back-to-projects"]');
    await expect(backButton).toBeVisible();
    await backButton.click();

    // Verify we're back on the projects page
    await expect(page).toHaveURL('/projects');
    await expect(page.getByRole('heading', { name: /^projects$/i })).toBeVisible();
  });

  test('should have back navigation from Integration Rules to Project Integrations', async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page);

    // First configure Jira integration so it appears in the list
    await request.post(`${API_URL}/api/v1/integrations/jira/${projectId}`, {
      data: {
        config: { instanceUrl: 'https://test.atlassian.net', projectKey: 'TEST' },
        credentials: { email: 'test@example.com', apiToken: 'test-token' },
        enabled: true,
      },
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    // Simulate full user journey to populate browser history correctly
    // Step 1: Navigate to projects page
    await page.goto('/projects', { waitUntil: 'domcontentloaded' });
    await waitForI18nReady(page, { match: 'some' });
    await page.waitForSelector('[data-testid^="project-card-"]', { timeout: 10000 });

    // Step 2: Click Integrations button to go to project integrations page
    const projectCard = page.locator(`[data-testid="project-card-${projectId}"]`);
    const integrationsButton = projectCard.getByRole('button', { name: /integrations/i });
    await integrationsButton.click();
    await expect(page).toHaveURL(`/projects/${projectId}/integrations`);
    await page.waitForLoadState('networkidle');

    // Step 3: Click Manage Rules button to go to integration rules page using data-testid
    const manageRulesButton = page.locator('[data-testid="manage-rules-jira"]');
    await expect(manageRulesButton).toBeVisible({ timeout: 10000 });
    await manageRulesButton.click();
    await expect(page).toHaveURL(`/integrations/jira/${projectId}/rules`);

    // Step 4: Test back navigation - should go back to project integrations page
    const backButton = page.getByRole('button', { name: /back to integration/i });
    await expect(backButton).toBeVisible();
    await backButton.click();

    // Verify we're back on the project integrations page
    await expect(page).toHaveURL(`/projects/${projectId}/integrations`);
    await expect(page.getByRole('heading', { name: /project integrations/i })).toBeVisible();
  });

  test('should show Add Integration dropdown with all available integrations', async ({ page }) => {
    await loginAsAdmin(page);

    // Navigate to project integrations page
    await page.goto(`/projects/${projectId}/integrations`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await waitForI18nReady(page, { match: 'some' });

    // Click Add Integration dropdown
    const addButton = page.getByRole('button', { name: /add integration/i });
    await expect(addButton).toBeVisible();
    await addButton.click();
    await page.waitForTimeout(500);

    // Verify all available integrations are in dropdown
    await expect(page.getByRole('menuitem', { name: /jira/i })).toBeVisible();
    // Can add more assertions for other integrations if needed
  });

  test('should handle missing project ID gracefully', async ({ page }) => {
    await loginAsAdmin(page);

    // Navigate to project integrations page without project ID
    await page.goto('/projects/invalid-uuid-format/integrations', {
      waitUntil: 'domcontentloaded',
    });
    await waitForI18nReady(page, { match: 'some' });

    // The page should still load (React will render)
    // Should show Add Integration dropdown even without valid project
    const addButton = page.getByRole('button', { name: /add integration/i });
    await expect(addButton).toBeVisible();
  });
});
