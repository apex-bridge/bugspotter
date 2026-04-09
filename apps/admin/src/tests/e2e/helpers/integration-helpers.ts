import axios from 'axios';

const API_BASE_URL = 'http://localhost:4000';

/**
 * Helper to get admin access token
 */
export async function getAdminToken(): Promise<string> {
  const response = await axios.post(`${API_BASE_URL}/api/v1/auth/login`, {
    email: 'admin@bugspotter.io',
    password: 'admin123',
  });
  return response.data.data.access_token;
}

/**
 * Helper to ensure Jira integration exists for testing
 * @throws Re-throws any error that is not a 409 Conflict (integration already exists)
 */
export async function ensureJiraIntegration(token: string, projectId: string): Promise<void> {
  try {
    await axios.post(
      `${API_BASE_URL}/api/v1/integrations/jira/${projectId}`,
      {
        config: {
          url: 'https://test.atlassian.net',
          email: 'test@example.com',
          project_key: 'TEST',
          issue_type: 'Bug',
        },
        credentials: {
          apiToken: 'test-token',
        },
        enabled: true,
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
  } catch (error: unknown) {
    const err = error as { response?: { status?: number; data?: unknown }; message?: string };
    // Integration may already exist (409 Conflict is expected)
    if (err.response?.status === 409) {
      return;
    }
    // Re-throw unexpected errors to fail the test setup
    console.error('Failed to create Jira integration:', err.response?.data || err.message);
    throw error;
  }
}

/**
 * Helper to delete a rule
 */
export async function deleteRule(
  platform: string,
  projectId: string,
  ruleId: string,
  token: string
): Promise<void> {
  try {
    await axios.delete(
      `${API_BASE_URL}/api/v1/integrations/${platform}/${projectId}/rules/${ruleId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
  } catch (error: unknown) {
    const err = error as { response?: { status?: number; data?: unknown }; message?: string };
    if (err.response?.status === 404) {
      // Rule not found, skip deletion
      return;
    }
    console.error('Failed to delete rule:', err.response?.data || err.message);
  }
}
