/**
 * Shared helpers for intelligence E2E tests
 */

import type { APIRequestContext } from '@playwright/test';
import { E2E_API_URL } from '../config';

/**
 * Create a test organization and return its ID.
 */
export async function createTestOrg(
  request: APIRequestContext,
  authToken: string
): Promise<string> {
  const now = Date.now();
  const response = await request.post(`${E2E_API_URL}/api/v1/organizations`, {
    headers: { Authorization: `Bearer ${authToken}` },
    data: {
      name: `Intel E2E ${now}`,
      subdomain: `intel-e2e-${now}`,
    },
  });

  if (!response.ok()) {
    throw new Error(`Failed to create test org: ${response.status()} ${await response.text()}`);
  }

  const data = await response.json();
  return data.data.id;
}

/**
 * Get auth token for the given credentials.
 */
export async function getAuthToken(
  request: APIRequestContext,
  email: string,
  password: string
): Promise<string> {
  const response = await request.post(`${E2E_API_URL}/api/v1/auth/login`, {
    data: { email, password },
  });

  if (!response.ok()) {
    throw new Error(`Failed to get auth token: ${response.status()} ${await response.text()}`);
  }

  const data = await response.json();
  return data.data.access_token;
}

/**
 * Clean up test organization via admin endpoint. Best-effort — logs errors but does not throw.
 */
export async function deleteTestOrg(
  request: APIRequestContext,
  orgId: string,
  authToken: string
): Promise<void> {
  try {
    const response = await request.delete(`${E2E_API_URL}/api/v1/admin/organizations/${orgId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (!response.ok()) {
      console.warn(`[Cleanup] Failed to delete org ${orgId}: ${response.status()}`);
    }
  } catch (error) {
    console.warn(`[Cleanup] Error deleting org ${orgId}:`, error);
  }
}

/**
 * Create a test project under an organization, then create an API key for it.
 * Returns the project ID and API key.
 */
export async function createTestProject(
  request: APIRequestContext,
  authToken: string,
  orgId: string
): Promise<{ id: string; api_key: string }> {
  // Create the project
  const projectResponse = await request.post(`${E2E_API_URL}/api/v1/projects`, {
    headers: { Authorization: `Bearer ${authToken}` },
    data: {
      name: `Intel Test Project ${Date.now()}`,
      organization_id: orgId,
    },
  });

  if (!projectResponse.ok()) {
    throw new Error(
      `Failed to create test project: ${projectResponse.status()} ${await projectResponse.text()}`
    );
  }

  const projectData = await projectResponse.json();
  const projectId = projectData.data.id;

  // Create an API key scoped to the project
  const apiKeyResponse = await request.post(`${E2E_API_URL}/api/v1/api-keys`, {
    headers: { Authorization: `Bearer ${authToken}` },
    data: {
      name: `Intel E2E Key ${Date.now()}`,
      type: 'test',
      permission_scope: 'full',
      allowed_projects: [projectId],
    },
  });

  if (!apiKeyResponse.ok()) {
    throw new Error(
      `Failed to create API key: ${apiKeyResponse.status()} ${await apiKeyResponse.text()}`
    );
  }

  const apiKeyData = await apiKeyResponse.json();
  return { id: projectId, api_key: apiKeyData.data.api_key };
}

/**
 * Create a test bug report via API key.
 * Uses the report schema expected by the backend (report object with console/network/metadata).
 */
export async function createTestBugReport(
  request: APIRequestContext,
  apiKey: string
): Promise<string> {
  const response = await request.post(`${E2E_API_URL}/api/v1/reports`, {
    headers: { 'X-API-Key': apiKey },
    data: {
      title: `Test bug ${Date.now()}`,
      description: 'This is a test bug report for intelligence e2e tests',
      report: {
        console: [{ level: 'info', message: 'Test log', timestamp: Date.now() }],
        network: [{ url: 'https://api.test.com', method: 'GET', status: 200 }],
        metadata: {
          userAgent: 'Mozilla/5.0 (Test Browser)',
          viewport: { width: 1920, height: 1080 },
          url: 'https://test.app.com',
        },
      },
    },
  });

  if (!response.ok()) {
    throw new Error(
      `Failed to create test bug report: ${response.status()} ${await response.text()}`
    );
  }

  const data = await response.json();
  return data.data.id;
}
