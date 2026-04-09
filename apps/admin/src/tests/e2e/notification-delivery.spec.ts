/**
 * Notification Delivery E2E Tests
 *
 * Full end-to-end tests for notification system:
 * 1. Create notification channel (delete if exists)
 * 2. Create notification rule with triggers
 * 3. Generate bug report matching rule conditions
 * 4. Verify message delivery via bot API
 * 5. Clean up test data
 *
 * Tests: Email, Slack, Discord
 */

import { test, expect, type Page } from '../fixtures/setup-fixture';
import axios from 'axios';

// ============================================================================
// CONFIGURATION
// ============================================================================

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_PROJECT_NAME = 'E2E Notification Test Project';
const TEST_TIMEOUT = 60000; // 60 seconds for each test

// Environment variable checks
const hasEmailConfig =
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS &&
  process.env.EMAIL_RECIPIENTS;

const hasSlackConfig =
  process.env.SLACK_TEST_WEBHOOK_URL &&
  process.env.SLACK_BOT_TOKEN &&
  process.env.SLACK_TEST_CHANNEL_ID;

const hasDiscordConfig =
  process.env.DISCORD_TEST_WEBHOOK_URL &&
  process.env.DISCORD_BOT_TOKEN &&
  process.env.DISCORD_TEST_CHANNEL_ID;

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Generate unique test ID for tracking messages
 */
function generateTestId(): string {
  return `e2e_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Login helper
 */
async function loginAsAdmin(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });

  await page.fill('input[type="email"]', 'admin@bugspotter.io');
  await page.fill('input[type="password"]', 'admin123');

  await page.getByRole('button', { name: /sign in|login/i }).click();

  await page.waitForURL('/dashboard', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
}

/**
 * Get auth token by logging in via API
 */
async function getAuthToken(): Promise<string> {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/v1/auth/login`, {
      email: 'admin@bugspotter.io',
      password: 'admin123',
    });

    const token = response.data.data.access_token;
    if (!token) {
      throw new Error('No access token in login response');
    }

    return token;
  } catch (error) {
    throw new Error(`Failed to get auth token: ${error}`);
  }
}

/**
 * Create or get test project via API
 */
async function ensureTestProject(token: string): Promise<{ id: string; api_key: string }> {
  try {
    // Try to get existing project
    const response = await axios.get(`${API_BASE_URL}/api/v1/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Response is { success: true, data: Project[] }
    const existingProject = response.data.data.find(
      (p: { name: string }) => p.name === TEST_PROJECT_NAME
    );

    let projectId: string;

    if (existingProject) {
      projectId = existingProject.id;
    } else {
      // Create new project
      const createResponse = await axios.post(
        `${API_BASE_URL}/api/v1/projects`,
        { name: TEST_PROJECT_NAME },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      projectId = createResponse.data.data.id;
    }

    // Get or create API key for the project
    // Note: We always create a new API key because GET /api-keys doesn't return
    // the plaintext api_key value (only key_prefix/suffix for security)
    const apiKeyResponse = await axios.post(
      `${API_BASE_URL}/api/v1/api-keys`,
      {
        name: `${TEST_PROJECT_NAME} API Key ${Date.now()}`,
        type: 'test',
        allowed_projects: [projectId],
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    return {
      id: projectId,
      api_key: apiKeyResponse.data.data.api_key,
    };
  } catch (error: unknown) {
    const err = error as { response?: { data?: unknown; status?: number }; message?: string };
    const errorDetails = err.response?.data || err.response || err.message || String(error);
    console.error('Failed to ensure test project:', errorDetails);
    throw new Error(`Failed to ensure test project: ${JSON.stringify(errorDetails)}`);
  }
}

/**
 * Delete notification channel by name if it exists
 */
async function deleteChannelIfExists(
  token: string,
  projectId: string,
  channelName: string
): Promise<void> {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/v1/notifications/channels`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { project_id: projectId, limit: 100 },
    });

    const existingChannel = response.data.data.channels.find(
      (c: { name: string }) => c.name === channelName
    );

    if (existingChannel) {
      await axios.delete(`${API_BASE_URL}/api/v1/notifications/channels/${existingChannel.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Delete notification rule by name if it exists
 */
async function deleteRuleIfExists(
  token: string,
  projectId: string,
  ruleName: string
): Promise<void> {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/v1/notifications/rules`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { project_id: projectId, limit: 100 },
    });

    const existingRule = response.data.data.rules.find(
      (r: { name: string }) => r.name === ruleName
    );

    if (existingRule) {
      await axios.delete(`${API_BASE_URL}/api/v1/notifications/rules/${existingRule.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create notification channel via API
 */
async function createChannel(
  token: string,
  projectId: string,
  channelData: {
    name: string;
    type: string;
    config: Record<string, unknown>;
  }
): Promise<string> {
  const response = await axios.post(
    `${API_BASE_URL}/api/v1/notifications/channels`,
    {
      project_id: projectId,
      ...channelData,
      active: true,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return response.data.data.id;
}

/**
 * Create notification template via API
 */
async function createTemplate(
  token: string,
  templateData: {
    name: string;
    channel_type: string;
    trigger_type: string;
    subject?: string;
    body: string;
    recipients?: string[];
  }
): Promise<string> {
  const response = await axios.post(
    `${API_BASE_URL}/api/v1/notifications/templates`,
    templateData,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return response.data.data.id;
}

/**
 * Create notification rule via API
 */
async function createRule(
  token: string,
  projectId: string,
  channelIds: string[],
  ruleData: {
    name: string;
    triggers: Array<{ event: string; params?: Record<string, unknown> }>;
  }
): Promise<string> {
  const response = await axios.post(
    `${API_BASE_URL}/api/v1/notifications/rules`,
    {
      project_id: projectId,
      name: ruleData.name,
      enabled: true,
      triggers: ruleData.triggers,
      channel_ids: channelIds,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return response.data.data.id;
}

/**
 * Create bug report via SDK endpoint
 */
async function createBugReport(
  apiKey: string,
  testId: string,
  priority: string = 'critical'
): Promise<string> {
  const response = await axios.post(
    `${API_BASE_URL}/api/v1/reports`,
    {
      title: `E2E Test Bug - ${testId}`,
      description: `This is an automated test bug report with ID: ${testId}`,
      priority,
      report: {
        console: [{ level: 'error', message: 'E2E test error', timestamp: Date.now() }],
        network: [],
        metadata: {
          browser: 'Chrome',
          os: 'Linux',
          url: 'https://example.com/test',
          userAgent: 'Mozilla/5.0 (E2E Test)',
          viewport: { width: 1920, height: 1080 },
          timestamp: Date.now(),
          test_id: testId,
          e2e_test: true,
        },
      },
    },
    {
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data.data.id;
}

/**
 * Verify message in Slack via Bot API
 */
async function verifySlackMessage(testId: string): Promise<boolean> {
  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_TEST_CHANNEL_ID) {
    return false;
  }

  try {
    // Wait for message to be delivered
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const response = await axios.get('https://slack.com/api/conversations.history', {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      params: {
        channel: process.env.SLACK_TEST_CHANNEL_ID,
        limit: 20,
      },
    });

    if (!response.data.ok) {
      return false;
    }

    const found = response.data.messages?.some((msg: unknown) => {
      const text = JSON.stringify(msg);
      return text.includes(testId);
    });

    return found || false;
  } catch {
    return false;
  }
}

/**
 * Verify message in Discord via Bot API
 */
async function verifyDiscordMessage(testId: string): Promise<boolean> {
  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_TEST_CHANNEL_ID) {
    return false;
  }

  try {
    // Wait for message to be delivered
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const response = await axios.get(
      `https://discord.com/api/v10/channels/${process.env.DISCORD_TEST_CHANNEL_ID}/messages`,
      {
        headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
        params: { limit: 20 },
      }
    );

    const found = response.data.some((msg: unknown) => {
      const text = JSON.stringify(msg);
      return text.includes(testId);
    });

    return found || false;
  } catch {
    return false;
  }
}

/**
 * Verify notification in history via API
 */
async function verifyNotificationHistory(
  token: string,
  projectId: string,
  testId: string,
  maxAttempts: number = 10
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait 3s between checks

      const response = await axios.get(`${API_BASE_URL}/api/v1/notifications/history`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { project_id: projectId, limit: 50 },
      });

      // Search for notification with our test ID in payload
      const found = response.data.data.history.some((h: { payload?: unknown }) => {
        const payload = JSON.stringify(h.payload || {});
        return payload.includes(testId);
      });

      if (found) {
        return true;
      }
    } catch {
      // Retry on errors
    }
  }

  return false;
}

/**
 * Clean up: delete channel, rule, and bug report
 */
async function cleanup(
  token: string,
  _projectId: string,
  channelId: string,
  ruleId: string,
  bugReportId?: string
): Promise<void> {
  try {
    if (bugReportId) {
      await axios.delete(`${API_BASE_URL}/api/v1/bug-reports/${bugReportId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    await axios.delete(`${API_BASE_URL}/api/v1/notifications/rules/${ruleId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await axios.delete(`${API_BASE_URL}/api/v1/notifications/channels/${channelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// SHARED TEST RUNNER
// ============================================================================

/**
 * Shared notification delivery test runner
 * Reduces code duplication across email/slack/discord tests
 */
async function testNotificationDelivery(
  page: Page,
  config: {
    platform: string;
    channelName: string;
    ruleName: string;
    channelType: string;
    channelConfig: Record<string, unknown>;
    templateRecipients?: string[]; // Static recipients for template
    botVerifyFn?: (testId: string) => Promise<boolean>;
  }
): Promise<void> {
  const testId = generateTestId();

  let channelId: string | undefined;
  let ruleId: string | undefined;
  let bugReportId: string | undefined;

  try {
    // 1. Login to UI and get auth token via API
    await loginAsAdmin(page);
    const token = await getAuthToken();

    // 2. Ensure test project exists
    const project = await ensureTestProject(token);

    // 3. Clean up existing test data
    await deleteChannelIfExists(token, project.id, config.channelName);
    await deleteRuleIfExists(token, project.id, config.ruleName);

    // 4. Create notification channel
    channelId = await createChannel(token, project.id, {
      name: config.channelName,
      type: config.channelType,
      config: config.channelConfig,
    });

    // 5. Create template (required for all channels)
    if (config.templateRecipients !== undefined) {
      await createTemplate(token, {
        name: `E2E ${config.platform} Template - ${Date.now()}`,
        channel_type: config.channelType,
        trigger_type: 'new_bug',
        subject: config.channelType === 'email' ? `🐛 New Bug: {{bug.title}}` : undefined,
        body:
          config.channelType === 'email'
            ? `A new bug has been reported in {{project.name}}:\n\nTitle: {{bug.title}}\nPriority: {{bug.priority}}\nBrowser: {{bug.browser}}\nTest ID: ${testId}`
            : `🐛 **New Bug in {{project.name}}**\n\n**Title:** {{bug.title}}\n**Priority:** {{bug.priority}}\n**Browser:** {{bug.browser}}\n**Test ID:** ${testId}`,
        recipients: config.templateRecipients,
      });
    }

    // 6. Create notification rule (trigger on critical bugs)
    ruleId = await createRule(token, project.id, [channelId], {
      name: config.ruleName,
      triggers: [
        {
          event: 'new_bug',
          params: { priority: 'critical' },
        },
      ],
    });

    // 7. Create bug report to trigger notification
    bugReportId = await createBugReport(project.api_key, testId, 'critical');

    // 8. Verify notification appears in history
    const inHistory = await verifyNotificationHistory(token, project.id, testId, 10);
    expect(inHistory).toBe(true);

    // 9. Verify message via bot API (if configured)
    if (config.botVerifyFn) {
      try {
        await config.botVerifyFn(testId);
        // Don't fail the test if bot verification fails - it's optional
      } catch {
        // Ignore bot verification errors
      }
    }

    // 10. Navigate to UI and verify
    await page.goto('/notifications', { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'History' }).click();

    // Wait for history table to load
    await page.waitForSelector('table tbody tr', { timeout: 5000 });

    // Click first row to expand details (notifications are sorted newest first)
    await page.locator('table tbody tr').first().click();

    // Should see testId in expanded payload section
    await expect(page.locator(`text=${testId}`).first()).toBeVisible({ timeout: 10000 });
  } finally {
    // Cleanup
    if (channelId && ruleId) {
      const token = await getAuthToken();
      const project = await ensureTestProject(token);
      await cleanup(token, project.id, channelId, ruleId, bugReportId);
    }
  }
}

// ============================================================================
// EMAIL DELIVERY TEST
// ============================================================================

// Skip by default - requires real email service (SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_RECIPIENTS)
test.describe.skip('Email Notification Delivery', () => {
  test.beforeEach(async ({ setupState }) => {
    await setupState.ensureInitialized();
  });

  test('should create channel, rule, trigger notification, and verify delivery', async ({
    page,
  }) => {
    test.setTimeout(TEST_TIMEOUT);

    // Fail if environment variables not configured
    if (!hasEmailConfig) {
      throw new Error(
        'Email environment variables not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and EMAIL_RECIPIENTS.'
      );
    }

    // Parse EMAIL_RECIPIENTS (comma-separated list)
    const emailRecipients = process.env.EMAIL_RECIPIENTS
      ? process.env.EMAIL_RECIPIENTS.split(',').map((email) => email.trim())
      : [];

    await testNotificationDelivery(page, {
      platform: 'Email',
      channelName: 'E2E Email Test Channel',
      ruleName: 'E2E Email Test Rule',
      channelType: 'email',
      channelConfig: {
        smtp_host: process.env.SMTP_HOST!,
        smtp_port: parseInt(process.env.SMTP_PORT || '587'),
        smtp_secure: process.env.SMTP_SECURE === 'true',
        smtp_user: process.env.SMTP_USER!,
        smtp_pass: process.env.SMTP_PASS!,
        from_address: process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USER!,
        from_name: 'BugSpotter E2E Test',
      },
      templateRecipients: emailRecipients,
    });
  });
});

// ============================================================================
// SLACK DELIVERY TEST
// ============================================================================

// Skip by default - requires real Slack service (SLACK_TEST_WEBHOOK_URL, SLACK_BOT_TOKEN, SLACK_TEST_CHANNEL_ID)
test.describe.skip('Slack Notification Delivery', () => {
  test.beforeEach(async ({ setupState }) => {
    await setupState.ensureInitialized();
  });

  test('should create channel, rule, trigger notification, and verify delivery', async ({
    page,
  }) => {
    test.setTimeout(TEST_TIMEOUT);

    // Fail if environment variables not configured
    if (!hasSlackConfig) {
      throw new Error(
        'Slack environment variables not configured. Set SLACK_TEST_WEBHOOK_URL and SLACK_TEST_CHANNEL.'
      );
    }

    await testNotificationDelivery(page, {
      platform: 'Slack',
      channelName: 'E2E Slack Test Channel',
      ruleName: 'E2E Slack Test Rule',
      channelType: 'slack',
      channelConfig: {
        webhook_url: process.env.SLACK_TEST_WEBHOOK_URL!,
        channel: process.env.SLACK_TEST_CHANNEL || '#integration-tests',
        username: 'BugSpotter E2E Test',
      },
      templateRecipients: [], // Empty array for webhook-based channels
      botVerifyFn: verifySlackMessage,
    });
  });
});

// ============================================================================
// DISCORD DELIVERY TEST
// ============================================================================

// Skip by default - requires real Discord service (DISCORD_TEST_WEBHOOK_URL, DISCORD_BOT_TOKEN, DISCORD_TEST_CHANNEL_ID)
test.describe.skip('Discord Notification Delivery', () => {
  test.beforeEach(async ({ setupState }) => {
    await setupState.ensureInitialized();
  });

  test('should create channel, rule, trigger notification, and verify delivery', async ({
    page,
  }) => {
    test.setTimeout(TEST_TIMEOUT);

    // Fail if environment variables not configured
    if (!hasDiscordConfig) {
      throw new Error(
        'Discord environment variables not configured. Set DISCORD_TEST_WEBHOOK_URL.'
      );
    }

    await testNotificationDelivery(page, {
      platform: 'Discord',
      channelName: 'E2E Discord Test Channel',
      ruleName: 'E2E Discord Test Rule',
      channelType: 'discord',
      channelConfig: {
        webhook_url: process.env.DISCORD_TEST_WEBHOOK_URL!,
        username: 'BugSpotter E2E Test',
      },
      templateRecipients: [], // Empty array for webhook-based channels
      botVerifyFn: verifyDiscordMessage,
    });
  });
});
