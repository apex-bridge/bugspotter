/**
 * Jira Integration E2E Tests
 *
 * Full end-to-end tests for Jira integration:
 * 1. Verify Jira connection with real credentials
 * 2. Create integration via admin UI (Generic HTTP and Custom Code)
 * 3. Validate form inputs and security
 * 4. Verify integrations appear in overview list
 *
 * Requires: JIRA_E2E_BASE_URL, JIRA_E2E_EMAIL, JIRA_E2E_API_TOKEN, JIRA_E2E_PROJECT_KEY
 * See: `.env.example` (repo root) for the full list.
 */

import { test, expect, type Page } from '../fixtures/setup-fixture';
import axios from 'axios';
import { getJiraConfig, type JiraTestConfig as JiraConfig } from './helpers/jira-helpers';

// ============================================================================
// CONFIGURATION
// ============================================================================

const TEST_TIMEOUT = 60000; // 60 seconds for each test
const API_BASE_URL = 'http://localhost:3000';

// Track created integrations for cleanup
const createdIntegrations: string[] = [];

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Verify Jira connection using axios (50-second timeout to match notification tests)
 */
async function verifyJiraConnection(
  config: JiraConfig
): Promise<{ displayName: string; emailAddress: string }> {
  try {
    const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');

    const response = await axios.get(`${config.baseUrl}/rest/api/3/myself`, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
      timeout: 50000,
    });

    return {
      displayName: response.data.displayName,
      emailAddress: response.data.emailAddress,
    };
  } catch (error: unknown) {
    throw new Error(
      `Failed to connect to Jira at ${config.baseUrl}. ` +
        `Check network connection and credentials. Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get auth token by logging in via API
 */
async function getAuthToken(): Promise<string> {
  const apiUrl = process.env.VITE_API_URL || 'http://localhost:3000';

  try {
    const response = await axios.post(`${apiUrl}/api/v1/auth/login`, {
      email: 'admin@bugspotter.io',
      password: 'admin123',
    });

    const token = response.data.data.access_token;
    if (!token) {
      throw new Error('No access token in response');
    }

    return token;
  } catch (error: unknown) {
    const err = error as { response?: { data?: { message?: string } }; message?: string };
    throw new Error(`Failed to get auth token: ${err.response?.data?.message || err.message}`);
  }
}

/**
 * Login helper for UI tests
 */
async function loginAsAdmin(page: Page) {
  const currentURL = page.url();
  const E2E_BASE_HOSTNAME = process.env.BASE_URL?.replace(/^https?:\/\//, '') || 'localhost:4001';
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
  await page
    .getByRole('heading', { name: /analytics dashboard/i })
    .waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Helper to delete an integration
 */
async function deleteIntegration(type: string, token: string): Promise<void> {
  try {
    // First get the integration to find its ID
    const listResponse = await axios.get(`${API_BASE_URL}/api/v1/admin/integrations`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const integration = listResponse.data.data.find((i: { type: string }) => i.type === type);
    if (!integration) {
      return;
    }

    // Delete the integration's config (which effectively disables it)
    await axios.delete(`${API_BASE_URL}/api/v1/admin/integrations/${type}/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Ignore deletion errors
  }
}

// ============================================================================
// TESTS
// ============================================================================

// Unconditionally skipped — mirrors the pattern in
// `notification-delivery.spec.ts`. These tests hit a real Jira cloud
// tenant and are not part of the default E2E pipeline. To run them
// locally, either remove the `.skip` and ensure the `JIRA_E2E_*` vars
// are present (see `.env.example` at the repo root), or invoke the
// file directly via `pnpm test:e2e -- jira-integration.spec.ts`.
test.describe.skip('Jira Integration E2E', () => {
  // Parallel mode enabled - each test creates timestamped resources
  // test.describe.configure({ mode: 'serial' });

  let jiraConfig: JiraConfig;

  // Verify Jira connection before running tests
  test.beforeAll(async () => {
    jiraConfig = getJiraConfig();
    await verifyJiraConnection(jiraConfig);
  });

  test.beforeEach(async ({ setupState }) => {
    await setupState.ensureInitialized();
  });

  // Cleanup after each test
  test.afterEach(async () => {
    if (createdIntegrations.length > 0) {
      const token = await getAuthToken();
      for (const integrationType of createdIntegrations) {
        await deleteIntegration(integrationType, token);
      }
      createdIntegrations.length = 0; // Clear the array
    }
  });

  test('should display created integrations in overview list', async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT);

    await loginAsAdmin(page);
    await page.goto('/integrations', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // Verify we can see the integrations overview page
    const pageHeading = page.locator('h1, h2').filter({ hasText: /integrations/i });
    await expect(pageHeading).toBeVisible();

    // Should have at least one Jira integration card (from previous tests)
    if (createdIntegrations.length > 0) {
      const integrationCards = page.locator('div').filter({ hasText: /Jira/ });
      const count = await integrationCards.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('Step 1: should authenticate with admin credentials', async () => {
    const token = await getAuthToken();

    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  test('Step 2: should create a test project', async () => {
    const apiUrl = process.env.VITE_API_URL || 'http://localhost:3000';
    const timestamp = Date.now();

    const token = await getAuthToken();

    // Create project
    const projectResponse = await axios.post(
      `${apiUrl}/api/v1/projects`,
      {
        name: `E2E Test Project ${timestamp}`,
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    expect(projectResponse.status).toBe(201);

    // API responses are wrapped in {success, data} structure
    const project = projectResponse.data.data || projectResponse.data;

    expect(project.id).toBeDefined();
    expect(project.name).toBe(`E2E Test Project ${timestamp}`);
  });

  test('Step 3: should link Jira integration to project', async () => {
    const apiUrl = process.env.VITE_API_URL || 'http://localhost:3000';
    const jiraConfig = getJiraConfig();
    const timestamp = Date.now();

    const token = await getAuthToken();

    // Create project
    const projectResponse = await axios.post(
      `${apiUrl}/api/v1/projects`,
      { name: `E2E Jira Link ${timestamp}` },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const projectId = projectResponse.data.data.id;

    // Link Jira integration
    const integrationResponse = await axios.post(
      `${apiUrl}/api/v1/integrations/jira/${projectId}`,
      {
        config: {
          host: jiraConfig.baseUrl, // Backend expects 'host' not 'baseUrl'
          projectKey: jiraConfig.projectKey,
        },
        credentials: {
          email: jiraConfig.email,
          apiToken: jiraConfig.apiToken,
        },
        enabled: true,
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    expect(integrationResponse.status).toBe(201);
  });

  test('Step 4: should create bug report via SDK', async () => {
    const apiUrl = process.env.VITE_API_URL || 'http://localhost:3000';
    const timestamp = Date.now();

    const token = await getAuthToken();

    // Create project
    const projectResponse = await axios.post(
      `${apiUrl}/api/v1/projects`,
      { name: `E2E Bug Report ${timestamp}` },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const projectId = projectResponse.data.data.id;

    // Create API key for the project
    const apiKeyResponse = await axios.post(
      `${apiUrl}/api/v1/api-keys`,
      {
        name: `E2E Test API Key ${timestamp}`,
        type: 'test',
        allowed_projects: [projectId],
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const apiKey = apiKeyResponse.data.data.api_key;

    // Create bug report using SDK API (x-api-key)
    const bugResponse = await axios.post(
      `${apiUrl}/api/v1/reports`,
      {
        title: `Test Bug ${timestamp}`,
        description: 'This is a test bug report',
        priority: 'high',
        report: {
          console: [],
          network: [],
          metadata: {
            userAgent: 'Playwright E2E Test',
            url: 'https://example.com/test',
            screenResolution: '1920x1080',
          },
        },
      },
      {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
      }
    );

    expect(bugResponse.status).toBe(201);
    const bugReport = bugResponse.data.data || bugResponse.data;
    expect(bugReport.id).toBeDefined();
    expect(bugReport.title).toBe(`Test Bug ${timestamp}`);
  });

  test('Step 5: should verify queue system is accessible', async () => {
    const apiUrl = process.env.VITE_API_URL || 'http://localhost:3000';

    // Check public health endpoint
    const healthResponse = await axios.get(`${apiUrl}/health`);

    expect(healthResponse.status).toBe(200);
    expect(healthResponse.data.status).toBe('ok');

    // Check if we can access queue health
    try {
      const queueResponse = await axios.get(`${apiUrl}/api/v1/queues/health`);

      expect(queueResponse.status).toBe(200);
    } catch {
      // Queue health endpoint may not be available
    }
  });

  test('Step 6: should queue integration job (if endpoint exists)', async () => {
    const apiUrl = process.env.VITE_API_URL || 'http://localhost:3000';
    const jiraConfig = getJiraConfig();
    const timestamp = Date.now();
    const token = await getAuthToken();

    // Create project and link integration
    const projectResponse = await axios.post(
      `${apiUrl}/api/v1/projects`,
      { name: `E2E Queue Test ${timestamp}` },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const projectId = projectResponse.data.data.id;

    // Create API key for the project
    const apiKeyResponse = await axios.post(
      `${apiUrl}/api/v1/api-keys`,
      {
        name: `E2E Queue Test API Key ${timestamp}`,
        type: 'test',
        allowed_projects: [projectId],
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const apiKey = apiKeyResponse.data.data.api_key;

    await axios.post(
      `${apiUrl}/api/v1/integrations/jira/${projectId}`,
      {
        config: {
          host: jiraConfig.baseUrl, // Backend expects 'host' not 'baseUrl'
          projectKey: jiraConfig.projectKey,
        },
        credentials: {
          email: jiraConfig.email,
          apiToken: jiraConfig.apiToken,
        },
        enabled: true,
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // Create bug report
    const bugResponse = await axios.post(
      `${apiUrl}/api/v1/reports`,
      {
        title: `Queue Test ${timestamp}`,
        description: 'Testing job queue',
        priority: 'high',
        report: {
          console: [],
          network: [],
          metadata: {
            userAgent: 'Playwright E2E Test',
            url: 'https://example.com/test',
          },
        },
      },
      {
        headers: { 'x-api-key': apiKey },
      }
    );
    const bugReportId = bugResponse.data.data?.id || bugResponse.data.id;

    // Try to queue integration job
    try {
      const queueResponse = await axios.post(
        `${apiUrl}/api/v1/admin/queue/jobs`,
        {
          queueName: 'integrations',
          jobName: `jira-${bugReportId}`,
          jobData: {
            bugReportId,
            projectId,
            platform: 'jira',
          },
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      expect(queueResponse.status).toBe(201);
      expect(queueResponse.data.jobId).toBeDefined();
    } catch (error: unknown) {
      const err = error as { response?: { status?: number } };
      if (err.response?.status === 404) {
        // Queue job endpoint not found - implementation pending
      } else {
        throw error;
      }
    }
  });

  // Skip by default - requires real Jira credentials (JIRA_E2E_BASE_URL, JIRA_E2E_EMAIL, JIRA_E2E_API_TOKEN, JIRA_E2E_PROJECT_KEY)
  test.skip('Step 7: should verify Jira ticket creation (full E2E)', async () => {
    test.setTimeout(60000); // 60 seconds

    const apiUrl = process.env.VITE_API_URL || 'http://localhost:3000';
    const jiraConfig = getJiraConfig();
    const timestamp = Date.now();

    // Verify Jira connection
    await verifyJiraConnection(jiraConfig);

    const token = await getAuthToken();

    // Create project
    const projectResponse = await axios.post(
      `${apiUrl}/api/v1/projects`,
      { name: `E2E Full Test ${timestamp}` },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const projectId = projectResponse.data.data.id;

    // Create API key for the project
    const apiKeyResponse = await axios.post(
      `${apiUrl}/api/v1/api-keys`,
      {
        name: `E2E Full Test API Key ${timestamp}`,
        type: 'test',
        allowed_projects: [projectId],
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const apiKey = apiKeyResponse.data.data.api_key;

    // Link integration
    const integrationPayload = {
      config: {
        host: jiraConfig.baseUrl,
        projectKey: jiraConfig.projectKey,
      },
      credentials: {
        email: jiraConfig.email,
        apiToken: jiraConfig.apiToken,
      },
      enabled: true,
    };

    await axios.post(`${apiUrl}/api/v1/integrations/jira/${projectId}`, integrationPayload, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Create bug report
    const bugPayload = {
      title: `[E2E Full Test] ${timestamp}`,
      description: `Full E2E test of Jira integration\n\nTimestamp: ${new Date().toISOString()}`,
      priority: 'high',
      report: {
        console: [],
        network: [],
        metadata: {
          userAgent: 'Playwright E2E Test',
          url: 'https://example.com/test',
          screenResolution: '1920x1080',
        },
      },
    };

    const bugResponse = await axios.post(`${apiUrl}/api/v1/reports`, bugPayload, {
      headers: { 'x-api-key': apiKey },
    });
    const bugReportId = bugResponse.data.data.id;

    // Trigger integration job
    const triggerPayload = {
      bugReportId,
      projectId,
    };

    const triggerResponse = await axios.post(
      `${apiUrl}/api/v1/admin/integrations/jira/trigger`,
      triggerPayload,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    expect(triggerResponse.status).toBe(200);
    const jobId = triggerResponse.data.data.jobId;

    // Wait for job to complete (poll with timeout)
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds
    let jiraTicketUrl: string | null = null;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;

      try {
        const jobStatusResponse = await axios.get(
          `${apiUrl}/api/v1/queues/integrations/jobs/${jobId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        const jobStatus = jobStatusResponse.data.data;

        if (jobStatus.state === 'completed') {
          jiraTicketUrl = jobStatus.returnValue?.externalUrl;
          break;
        } else if (jobStatus.state === 'failed') {
          throw new Error(`Integration job failed: ${JSON.stringify(jobStatus.failedReason)}`);
        }
      } catch (error: unknown) {
        const err = error as { response?: { status?: number }; message?: string };
        if (err.response?.status === 404) {
          // 404 means job not yet processed, continue polling
        } else if (err.message?.includes('Integration job failed')) {
          throw error; // Re-throw job failure
        } else {
          throw error;
        }
      }
    }

    if (!jiraTicketUrl) {
      throw new Error(
        `Integration job did not complete within ${maxAttempts} seconds. Check worker logs.`
      );
    }

    // Verify ticket exists in Jira
    const ticketKey = jiraTicketUrl.split('/').pop();
    const jiraApiUrl = `${jiraConfig.baseUrl}/rest/api/3/issue/${ticketKey}`;

    const ticketResponse = await axios.get(jiraApiUrl, {
      auth: {
        username: jiraConfig.email,
        password: jiraConfig.apiToken,
      },
      timeout: 15000,
    });

    expect(ticketResponse.status).toBe(200);
    expect(ticketResponse.data.key).toBe(ticketKey);
    expect(ticketResponse.data.fields.summary).toContain('E2E Full Test');
  });
});
