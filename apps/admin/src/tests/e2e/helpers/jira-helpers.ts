/**
 * Jira E2E Test Helpers
 * Utilities for testing with real Jira Cloud instance
 *
 * Note: Environment variables are loaded by playwright.config.ts and global-setup.ts
 */

import { test as base } from '@playwright/test';
import axios from 'axios';

export interface JiraTestConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

/**
 * Get Jira test configuration from environment variables
 * Throws error if credentials are missing (fail-fast approach)
 */
export function getJiraConfig(): JiraTestConfig {
  const baseUrl = process.env.JIRA_E2E_BASE_URL;
  const email = process.env.JIRA_E2E_EMAIL;
  const apiToken = process.env.JIRA_E2E_API_TOKEN;
  const projectKey = process.env.JIRA_E2E_PROJECT_KEY || 'E2E';

  if (!baseUrl || !email || !apiToken) {
    throw new Error(
      'Jira E2E configuration not found. Set JIRA_E2E_BASE_URL, JIRA_E2E_EMAIL, ' +
        'JIRA_E2E_API_TOKEN, and JIRA_E2E_PROJECT_KEY environment variables. ' +
        'See apps/admin/JIRA_E2E_SETUP.md for setup instructions.'
    );
  }

  return { baseUrl, email, apiToken, projectKey };
}

/**
 * Test if Jira credentials are available
 */
export function hasJiraCredentials(): boolean {
  try {
    getJiraConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify Jira connection by calling /myself endpoint
 * Uses axios instead of fetch for proper timeout configuration
 */
export async function verifyJiraConnection(config: JiraTestConfig): Promise<boolean> {
  try {
    const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');

    const response = await axios.get(`${config.baseUrl}/rest/api/3/myself`, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
      timeout: 50000, // 50 seconds to match notification integration tests
    });

    if (response.status !== 200) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Create a test fixture that includes Jira configuration
 * Tests FAIL if credentials are not configured or connection fails
 */
export const test = base.extend<{ jiraConfig: JiraTestConfig }>({
  jiraConfig: async (_fixtures, use) => {
    // Fail if credentials not configured
    if (!hasJiraCredentials()) {
      throw new Error(
        'Jira E2E configuration not found. Set JIRA_E2E_BASE_URL, JIRA_E2E_EMAIL, ' +
          'JIRA_E2E_API_TOKEN, and JIRA_E2E_PROJECT_KEY environment variables. ' +
          'See apps/admin/JIRA_E2E_SETUP.md for setup instructions.'
      );
    }

    // Get config and verify connection
    const config = getJiraConfig();
    const connected = await verifyJiraConnection(config);

    if (!connected) {
      throw new Error('Failed to connect to Jira. Check your credentials and network connection.');
    }

    await use(config);
  },
});

/**
 * Skip test if Jira credentials are not configured
 * @deprecated Use the test fixture instead for fail-fast behavior
 */
export function skipIfNoJira(testFn: (...args: unknown[]) => unknown) {
  return hasJiraCredentials() ? testFn : base.skip;
}

/**
 * Format Jira credentials for HTTP Basic Auth
 */
export function getJiraAuthHeader(config: JiraTestConfig): string {
  const credentials = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  return `Basic ${credentials}`;
}

export { expect } from '@playwright/test';
