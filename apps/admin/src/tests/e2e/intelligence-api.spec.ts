/**
 * E2E Tests — Intelligence API
 *
 * API-level tests for intelligence settings, feature flags, key provisioning,
 * enrichment endpoints, feedback endpoints, and bug report duplicate_of field.
 *
 * These tests run against the backend API without requiring the intelligence
 * service to be running — they validate endpoint availability, auth, validation,
 * and feature flag enforcement.
 */

import { test, expect } from '../fixtures/setup-fixture';
import { E2E_API_URL } from './config';
import {
  getAuthToken,
  createTestOrg,
  deleteTestOrg,
  createTestProject,
  createTestBugReport,
} from './helpers/intelligence-helpers';

const TEST_ADMIN = {
  email: 'admin@bugspotter.io',
  password: 'admin123',
  name: 'Admin User',
};

test.describe('Intelligence API', () => {
  test.describe.configure({ mode: 'serial' });

  let authToken: string;
  let orgId: string;
  let projectId: string;
  let apiKey: string;
  let bugReportId: string;

  test.beforeAll(async ({ request, setupState }) => {
    await setupState.ensureInitialized(TEST_ADMIN);
    authToken = await getAuthToken(request, TEST_ADMIN.email, TEST_ADMIN.password);
    orgId = await createTestOrg(request, authToken);
    const project = await createTestProject(request, authToken, orgId);
    projectId = project.id;
    apiKey = project.api_key;
    bugReportId = await createTestBugReport(request, apiKey);
  });

  test.afterAll(async ({ request }) => {
    if (orgId && authToken) {
      await deleteTestOrg(request, orgId, authToken);
    }
  });

  // ==========================================================================
  // Intelligence Settings
  // ==========================================================================

  test.describe('Settings', () => {
    test('GET settings returns defaults for new org', async ({ request }) => {
      const response = await request.get(
        `${E2E_API_URL}/api/v1/organizations/${orgId}/intelligence/settings`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      expect(response.status()).toBe(200);
      const data = await response.json();
      const settings = data.data;

      expect(settings.intelligence_enabled).toBe(false);
      expect(settings.intelligence_auto_analyze).toBe(true);
      expect(settings.intelligence_auto_enrich).toBe(true);
      expect(settings.intelligence_dedup_enabled).toBe(true);
      expect(settings.intelligence_dedup_action).toBe('flag');
      expect(settings.intelligence_self_service_enabled).toBe(true);
      expect(settings.intelligence_similarity_threshold).toBe(0.75);
      expect(settings.key_status).toBeDefined();
      expect(settings.key_status.provisioned).toBe(false);
    });

    test('PATCH settings updates individual fields', async ({ request }) => {
      const response = await request.patch(
        `${E2E_API_URL}/api/v1/organizations/${orgId}/intelligence/settings`,
        {
          headers: { Authorization: `Bearer ${authToken}` },
          data: {
            intelligence_auto_analyze: false,
            intelligence_dedup_action: 'auto_close',
            intelligence_similarity_threshold: 0.85,
          },
        }
      );

      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.data.intelligence_auto_analyze).toBe(false);
      expect(data.data.intelligence_dedup_action).toBe('auto_close');
      expect(data.data.intelligence_similarity_threshold).toBe(0.85);
    });

    test('PATCH settings rejects invalid dedup_action', async ({ request }) => {
      const response = await request.patch(
        `${E2E_API_URL}/api/v1/organizations/${orgId}/intelligence/settings`,
        {
          headers: { Authorization: `Bearer ${authToken}` },
          data: { intelligence_dedup_action: 'invalid_action' },
        }
      );

      expect(response.status()).toBe(400);
    });

    test('PATCH settings rejects invalid similarity threshold', async ({ request }) => {
      const response = await request.patch(
        `${E2E_API_URL}/api/v1/organizations/${orgId}/intelligence/settings`,
        {
          headers: { Authorization: `Bearer ${authToken}` },
          data: { intelligence_similarity_threshold: 1.5 },
        }
      );

      expect(response.status()).toBe(400);
    });

    test('PATCH feature flags updates dedup_enabled and self_service_enabled', async ({
      request,
    }) => {
      try {
        const response = await request.patch(
          `${E2E_API_URL}/api/v1/organizations/${orgId}/intelligence/settings`,
          {
            headers: { Authorization: `Bearer ${authToken}` },
            data: {
              intelligence_dedup_enabled: false,
              intelligence_self_service_enabled: false,
            },
          }
        );

        expect(response.status()).toBe(200);
        const data = await response.json();
        expect(data.data.intelligence_dedup_enabled).toBe(false);
        expect(data.data.intelligence_self_service_enabled).toBe(false);
      } finally {
        // Restore defaults for subsequent tests
        const restoreResponse = await request.patch(
          `${E2E_API_URL}/api/v1/organizations/${orgId}/intelligence/settings`,
          {
            headers: { Authorization: `Bearer ${authToken}` },
            data: {
              intelligence_dedup_enabled: true,
              intelligence_self_service_enabled: true,
            },
          }
        );
        if (!restoreResponse.ok()) {
          console.warn(`[Cleanup] Failed to restore settings: ${restoreResponse.status()}`);
        }
      }
    });

    test('settings require admin auth (rejects unauthenticated)', async ({ request }) => {
      const response = await request.get(
        `${E2E_API_URL}/api/v1/organizations/${orgId}/intelligence/settings`
      );

      expect(response.status()).toBe(401);
    });
  });

  // ==========================================================================
  // Key Provisioning
  // ==========================================================================

  test.describe('Key Provisioning', () => {
    test('provision key stores encrypted key', async ({ request }) => {
      const response = await request.post(
        `${E2E_API_URL}/api/v1/organizations/${orgId}/intelligence/key`,
        {
          headers: { Authorization: `Bearer ${authToken}` },
          data: { api_key: 'test-intelligence-api-key-for-e2e' },
        }
      );

      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.data.provisioned).toBe(true);
      expect(data.data.provisioned_at).toBeTruthy();
      expect(data.data.key_hint).toBeTruthy();
      // Key hint should mask most of the key
      expect(data.data.key_hint).toContain('****');
    });

    test('cannot enable intelligence without provisioned key after revocation', async ({
      request,
    }) => {
      // Revoke key first
      const revokeResponse = await request.delete(
        `${E2E_API_URL}/api/v1/organizations/${orgId}/intelligence/key`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      expect(revokeResponse.status()).toBe(204);

      // Try to enable intelligence — should fail
      const enableResponse = await request.patch(
        `${E2E_API_URL}/api/v1/organizations/${orgId}/intelligence/settings`,
        {
          headers: { Authorization: `Bearer ${authToken}` },
          data: { intelligence_enabled: true },
        }
      );

      // Should be rejected (400 or 409)
      expect([400, 409]).toContain(enableResponse.status());
    });

    test('key status reflects provisioning state', async ({ request }) => {
      // Re-provision key for subsequent tests
      const provisionResponse = await request.post(
        `${E2E_API_URL}/api/v1/organizations/${orgId}/intelligence/key`,
        {
          headers: { Authorization: `Bearer ${authToken}` },
          data: { api_key: 'test-intelligence-api-key-for-e2e-v2' },
        }
      );
      expect(provisionResponse.ok()).toBe(true);

      const response = await request.get(
        `${E2E_API_URL}/api/v1/organizations/${orgId}/intelligence/settings`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      const data = await response.json();
      expect(data.data.key_status.provisioned).toBe(true);
      expect(data.data.key_status.decryptable).toBe(true);
    });
  });

  // ==========================================================================
  // Enrichment Endpoints
  // ==========================================================================

  test.describe('Enrichment', () => {
    test('GET enrichment returns 404 for bug without enrichment data', async ({ request }) => {
      const response = await request.get(
        `${E2E_API_URL}/api/v1/intelligence/bugs/${bugReportId}/enrichment`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      // Fresh bug report has no enrichment row — returns 404
      expect(response.status()).toBe(404);
    });

    test('GET enrichment rejects unauthenticated request', async ({ request }) => {
      const response = await request.get(
        `${E2E_API_URL}/api/v1/intelligence/bugs/${bugReportId}/enrichment`
      );

      expect(response.status()).toBe(401);
    });

    test('GET enrichment returns 404 for non-existent bug', async ({ request }) => {
      const fakeBugId = '00000000-0000-0000-0000-000000000000';
      const response = await request.get(
        `${E2E_API_URL}/api/v1/intelligence/bugs/${fakeBugId}/enrichment`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      expect(response.status()).toBe(404);
    });
  });

  // ==========================================================================
  // Feedback Endpoints
  // ==========================================================================

  test.describe('Feedback', () => {
    test('POST feedback rejects invalid payload', async ({ request }) => {
      const response = await request.post(`${E2E_API_URL}/api/v1/intelligence/feedback`, {
        headers: { Authorization: `Bearer ${authToken}` },
        data: {}, // Missing required fields
      });

      expect(response.status()).toBe(400);
    });

    test('GET feedback stats returns data for project', async ({ request }) => {
      const response = await request.get(
        `${E2E_API_URL}/api/v1/intelligence/projects/${projectId}/feedback/stats`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      expect(response.status()).toBe(200);
    });

    test('GET feedback rejects unauthenticated request', async ({ request }) => {
      const response = await request.get(
        `${E2E_API_URL}/api/v1/intelligence/projects/${projectId}/feedback/stats`
      );

      expect(response.status()).toBe(401);
    });
  });

  // ==========================================================================
  // Bug Report duplicate_of field
  // ==========================================================================

  test.describe('Bug Report duplicate_of', () => {
    test('bug report API response includes duplicate_of field', async ({ request }) => {
      const response = await request.get(`${E2E_API_URL}/api/v1/reports/${bugReportId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.status()).toBe(200);
      const data = await response.json();
      // duplicate_of should be present (null for non-duplicates)
      expect(data.data).toHaveProperty('duplicate_of');
      expect(data.data.duplicate_of).toBeNull();
    });
  });

  // ==========================================================================
  // Self-Service (gated by INTELLIGENCE_ENABLED plugin)
  // ==========================================================================

  test.describe('Self-Service Routes (intelligence disabled)', () => {
    // These tests verify routes are not registered when INTELLIGENCE_ENABLED is false.
    // Skip if intelligence is actually enabled in this environment.
    test.beforeEach(async ({ request }) => {
      const probe = await request.get(`${E2E_API_URL}/api/v1/intelligence/health`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      test.skip(probe.status() !== 404, 'Intelligence is enabled — skipping disabled-route tests');
    });

    test('self-service check returns 404 when intelligence disabled', async ({ request }) => {
      const response = await request.post(`${E2E_API_URL}/api/v1/self-service/check`, {
        headers: { Authorization: `Bearer ${authToken}` },
        data: {
          description: 'My login page is crashing when I click submit',
          project_id: projectId,
        },
      });

      // Routes not registered when intelligence is disabled
      expect(response.status()).toBe(404);
    });

    test('self-service deflected returns 404 when intelligence disabled', async ({ request }) => {
      const response = await request.post(`${E2E_API_URL}/api/v1/self-service/deflected`, {
        headers: { Authorization: `Bearer ${authToken}` },
        data: {
          project_id: projectId,
          matched_bug_id: bugReportId,
          description: 'My login page is crashing',
        },
      });

      expect(response.status()).toBe(404);
    });

    test('self-service stats returns 404 when intelligence disabled', async ({ request }) => {
      const response = await request.get(
        `${E2E_API_URL}/api/v1/self-service/stats?project_id=${projectId}`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      expect(response.status()).toBe(404);
    });
  });

  // ==========================================================================
  // Intelligence Proxy Routes (gated by INTELLIGENCE_ENABLED plugin)
  // ==========================================================================

  test.describe('Proxy Routes (intelligence disabled)', () => {
    test.beforeEach(async ({ request }) => {
      const probe = await request.get(`${E2E_API_URL}/api/v1/intelligence/health`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      test.skip(probe.status() !== 404, 'Intelligence is enabled — skipping disabled-route tests');
    });

    test('health endpoint returns 404 when intelligence disabled', async ({ request }) => {
      const response = await request.get(`${E2E_API_URL}/api/v1/intelligence/health`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      // Routes not registered when intelligence is disabled
      expect(response.status()).toBe(404);
    });

    test('similar bugs returns 404 when intelligence disabled', async ({ request }) => {
      const response = await request.get(
        `${E2E_API_URL}/api/v1/intelligence/projects/${projectId}/bugs/${bugReportId}/similar`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      expect(response.status()).toBe(404);
    });
  });
});
