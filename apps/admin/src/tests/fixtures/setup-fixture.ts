/**
 * Test Fixture for Setup State Management
 * Provides utilities to reset database and control system initialization state
 * Uses direct database access via testcontainers for complete isolation
 */

import { test as base, expect, type Page } from '@playwright/test';
import { resetDatabase } from '../utils/db-reset.js';

type SetupFixtures = {
  setupState: {
    ensureUninitialized: () => Promise<void>;
    ensureInitialized: (credentials?: {
      email: string;
      password: string;
      name?: string;
    }) => Promise<void>;
    checkStatus: () => Promise<boolean>;
    reset: () => Promise<void>;
    ensureProjectExists: (token: string) => Promise<{ id: string; name: string; api_key: string }>;
    /**
     * Resolve the id of the seeded `e2e-default` org for the given
     * admin token. Safer than `myOrgs[0]` because the backend's
     * `findByUserId` orders by name, and other specs (organizations,
     * my-organization, role-based-access) create orgs that can sort
     * ahead alphabetically.
     */
    getDefaultOrgId: (token: string) => Promise<string>;
    createSampleBugReports: (apiKey: string, projectId: string) => Promise<void>;
    createBugReportWithReplay: (apiKey: string, projectId: string) => Promise<string>;
  };
};

export const test = base.extend<SetupFixtures>({
  setupState: async ({ request }, use) => {
    // API requests should go to the backend, not the frontend
    const API_URL = process.env.API_URL || 'http://localhost:4000';

    const setupState = {
      /**
       * Check if system is initialized
       */
      checkStatus: async (): Promise<boolean> => {
        try {
          const response = await request.get(`${API_URL}/api/v1/setup/status`);
          const data = await response.json();
          return data.data?.initialized || false;
        } catch {
          return false;
        }
      },

      /**
       * Ensure system is uninitialized (clean state for setup tests)
       * Uses direct database truncation for reliable test isolation
       */
      ensureUninitialized: async (): Promise<void> => {
        // Reset database to clean state
        await resetDatabase();
        console.log('✓ Database reset to uninitialized state');
      },

      /**
       * Ensure system is initialized with admin user
       */
      ensureInitialized: async (credentials?: {
        email: string;
        password: string;
        name?: string;
      }): Promise<void> => {
        const creds = credentials || {
          email: 'admin@bugspotter.io',
          password: 'admin123',
          name: 'Admin User',
        };
        const isInitialized = await setupState.checkStatus();

        let accessToken: string;

        if (isInitialized) {
          console.log('✓ System already initialized');
          // We still need a token so the default-org seed below can run
          // idempotently — earlier setup paths (e.g. the setup-wizard
          // E2E tests) initialize the system without touching this
          // fixture and therefore without creating an org. Logging in
          // here picks up that case.
          const loginResponse = await request.post(`${API_URL}/api/v1/auth/login`, {
            data: { email: creds.email, password: creds.password },
          });
          if (!loginResponse.ok()) {
            throw new Error(
              `Failed to log in after init check: ${loginResponse.status()} ${await loginResponse.text()}`
            );
          }
          const { data: loginData } = await loginResponse.json();
          accessToken = loginData.access_token;
        } else {
          console.log('🔍 Initializing with credentials:', {
            email: creds.email,
            name: creds.name,
          });

          // Initialize the system with local storage for E2E tests
          // Note: Backend setup route requires S3 credentials even for local storage
          // These are dummy values that won't be used since STORAGE_BACKEND=local
          const response = await request.post(`${API_URL}/api/v1/setup/initialize`, {
            data: {
              admin_email: creds.email,
              admin_password: creds.password,
              admin_name: creds.name,
              instance_name: 'Test BugSpotter',
              instance_url: 'http://localhost:4001',
              storage_type: 'local',
              // Dummy S3 credentials (required by validation but not used)
              storage_access_key: 'dummy-access-key',
              storage_secret_key: 'dummy-secret-key',
              storage_bucket: 'dummy-bucket',
            },
          });

          if (!response.ok()) {
            const error = await response.json();
            throw new Error(`Failed to initialize system: ${JSON.stringify(error)}`);
          }

          // `/setup/initialize` returns the admin's access_token in its
          // response body — no separate login call needed.
          const { data: initData } = await response.json();
          accessToken = initData.access_token;

          console.log('✓ System initialized successfully');
        }

        // SaaS-mode default org (idempotent).
        //
        // The E2E backend runs with `DEPLOYMENT_MODE=saas` so the
        // `SaaSRoute`-gated pages in the admin (organizations list,
        // retention, billing, etc.) are reachable. But SaaS mode also
        // changes project creation semantics: from the hub domain
        // (no tenant subdomain) the backend requires `organization_id`
        // in the body — see `resolveOrganizationForProject` in
        // `packages/backend/src/api/routes/projects.ts`. Tests that
        // drive the admin's project-create form (audit-logs, api-keys,
        // bug-reports, etc.) need the admin to own at least one org so
        // the form's "select organization" flow resolves: the admin UI
        // auto-selects when exactly one org is present (see
        // `projects.tsx`), which keeps existing tests working without
        // per-test changes.
        //
        // Runs on EVERY call (not just first-time init) so the seed
        // still happens after setup paths that bypass this fixture
        // entirely (e.g. the setup-wizard E2E tests). Checks for the
        // specific `e2e-default` subdomain rather than "any org" —
        // otherwise `setupState.getDefaultOrgId` can throw if the
        // admin happens to already own a non-default org from a
        // prior test's cleanup gap.
        const authHeaders = { Authorization: `Bearer ${accessToken}` };
        const myOrgsResponse = await request.get(`${API_URL}/api/v1/organizations/me`, {
          headers: authHeaders,
        });
        if (myOrgsResponse.ok()) {
          const { data: existing } = await myOrgsResponse.json();
          if (
            Array.isArray(existing) &&
            existing.some((o: { subdomain?: string }) => o.subdomain === 'e2e-default')
          ) {
            return;
          }
        }

        const orgResponse = await request.post(`${API_URL}/api/v1/organizations`, {
          headers: authHeaders,
          data: {
            name: 'E2E Default Org',
            subdomain: 'e2e-default',
            data_residency_region: 'global',
          },
        });
        if (orgResponse.ok()) {
          console.log('✓ Default E2E org created');
          return;
        }

        // 409 = subdomain reserved by a soft-deleted org from a prior
        // run that didn't fully clean up. Treat as success only if the
        // admin already has the `e2e-default` org specifically; if
        // they have some other org but not this one, surface the
        // error — downstream `getDefaultOrgId` would throw anyway.
        if (orgResponse.status() === 409) {
          const recheck = await request.get(`${API_URL}/api/v1/organizations/me`, {
            headers: authHeaders,
          });
          if (recheck.ok()) {
            const { data: existing } = await recheck.json();
            if (
              Array.isArray(existing) &&
              existing.some((o: { subdomain?: string }) => o.subdomain === 'e2e-default')
            ) {
              console.log('✓ Default E2E org already exists (409)');
              return;
            }
          }
        }

        throw new Error(
          `Failed to create default E2E org: ${orgResponse.status()} ${await orgResponse.text()}`
        );
      },

      /**
       * Reset database to clean state
       * Uses direct database truncation for reliable resets
       */
      reset: async (): Promise<void> => {
        await resetDatabase();
      },

      /**
       * Resolve the seeded default E2E org's id for the given admin
       * token. Looks up by `subdomain === 'e2e-default'` — NOT by
       * `myOrgs[0]` — because the backend's
       * `OrganizationRepository.findByUserId` orders by name and
       * other specs can create orgs that sort ahead alphabetically.
       *
       * Extracted so specs that need a raw `organization_id` for a
       * direct-API project create (project-integrations-navigation,
       * etc.) share one lookup with `ensureProjectExists` below.
       */
      getDefaultOrgId: async (token: string): Promise<string> => {
        const response = await request.get(`${API_URL}/api/v1/organizations/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok()) {
          throw new Error(
            `Failed to fetch /organizations/me: ${response.status()} ${await response.text()}`
          );
        }
        const { data: myOrgs } = (await response.json()) as {
          data: Array<{ id: string; subdomain: string }>;
        };
        const defaultOrg = Array.isArray(myOrgs)
          ? myOrgs.find((o) => o.subdomain === 'e2e-default')
          : undefined;
        if (!defaultOrg?.id) {
          throw new Error(
            "admin is not a member of the seeded 'e2e-default' org — did ensureInitialized run?"
          );
        }
        return defaultOrg.id;
      },

      /**
       * Ensure a test project exists (needed for API keys, bug reports, etc.)
       * Returns existing project or creates a new one with an API key
       */
      ensureProjectExists: async (
        token: string
      ): Promise<{ id: string; name: string; api_key: string }> => {
        // Check if a project already exists
        const listResponse = await request.get(`${API_URL}/api/v1/projects`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        let project;
        if (listResponse.ok()) {
          const data = await listResponse.json();
          if (data.data && data.data.length > 0) {
            project = data.data[0];
          }
        }

        // Create a test project if none exists. Note: the create-project
        // schema has `additionalProperties: false` and the old `description`
        // field here was rejected with a 400 — the fixture had been
        // silently relying on `project` being resolved from the list
        // call. Keep only the supported fields.
        //
        // In SaaS mode on the hub domain (what E2E is), the backend's
        // `resolveOrganizationForProject` requires `organization_id`
        // in the body. Resolve via `getDefaultOrgId` so this lookup
        // stays in sync with other specs that need the same raw id.
        if (!project) {
          const organizationId = await setupState.getDefaultOrgId(token);

          const createResponse = await request.post(`${API_URL}/api/v1/projects`, {
            headers: { Authorization: `Bearer ${token}` },
            data: {
              name: 'E2E Test Project',
              organization_id: organizationId,
            },
          });

          if (!createResponse.ok()) {
            const error = await createResponse.json();
            throw new Error(`Failed to create test project: ${JSON.stringify(error)}`);
          }

          const data = await createResponse.json();
          project = data.data;
        }

        // Create an API key for the project
        const apiKeyResponse = await request.post(`${API_URL}/api/v1/api-keys`, {
          headers: { Authorization: `Bearer ${token}` },
          data: {
            name: 'E2E Test API Key',
            type: 'test', // Environment type: test, development, or production
            permission_scope: 'full', // Permission scope: full, read, write, custom
            allowed_projects: [project.id],
          },
        });

        if (!apiKeyResponse.ok()) {
          const error = await apiKeyResponse.json();
          throw new Error(`Failed to create API key: ${JSON.stringify(error)}`);
        }

        const apiKeyData = await apiKeyResponse.json();

        return {
          id: project.id,
          name: project.name,
          api_key: apiKeyData.data.api_key, // The actual API key value (only shown once)
        };
      },

      /**
       * Create sample bug reports for testing
       * Creates bug reports with different statuses and priorities
       */
      createSampleBugReports: async (apiKey: string, _projectId: string): Promise<void> => {
        const baseReport = {
          report: {
            console: [{ level: 'info', message: 'Test log', timestamp: Date.now() }],
            network: [{ url: 'https://api.test.com', method: 'GET', status: 200 }],
            metadata: {
              userAgent: 'Mozilla/5.0 (Test Browser)',
              viewport: { width: 1920, height: 1080 },
              url: 'https://test.app.com',
            },
          },
        };

        const sampleReports = [
          {
            ...baseReport,
            title: 'Open Critical Bug',
            description: 'A critical bug that needs attention',
            priority: 'critical',
          },
          {
            ...baseReport,
            title: 'In Progress High Priority',
            description: 'Currently being worked on',
            priority: 'high',
          },
          {
            ...baseReport,
            title: 'Resolved Medium Issue',
            description: 'This has been fixed',
            priority: 'medium',
          },
          {
            ...baseReport,
            title: 'Open Low Priority',
            description: 'Minor issue',
            priority: 'low',
          },
        ];

        for (const report of sampleReports) {
          const response = await request.post(`${API_URL}/api/v1/reports`, {
            headers: { 'X-API-Key': apiKey },
            data: report,
          });

          if (!response.ok()) {
            const body = await response.text();
            console.error(
              `Failed to create bug report: ${response.status()} ${response.statusText()}`
            );
            console.error(`Response body: ${body}`);
            throw new Error(`Failed to create sample bug report: ${response.status()}`);
          }
        }
      },

      /**
       * Create a bug report WITH session replay data (for shared replay tests)
       * Returns the bug report ID
       */
      createBugReportWithReplay: async (apiKey: string, _projectId: string): Promise<string> => {
        // Load replay data from test file
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const pako = await import('pako');

        const replayDataPath = join(process.cwd(), 'src/tests/e2e/fixtures/test-replay-data.json');
        const replayData = JSON.parse(readFileSync(replayDataPath, 'utf-8'));

        // Step 1: Create bug report with hasReplay flag to get upload URLs
        const reportData = {
          title: 'Bug Report with Session Replay',
          description: 'This bug report includes a complete rrweb session recording',
          priority: 'high',
          hasReplay: true,
          report: {
            console: [
              {
                level: 'error',
                message: 'Uncaught TypeError: Cannot read property "x"',
                timestamp: Date.now(),
              },
              { level: 'warn', message: 'Deprecated API call', timestamp: Date.now() },
            ],
            network: [
              {
                url: 'https://api.test.com/data',
                method: 'GET',
                status: 500,
                timestamp: Date.now(),
              },
            ],
            metadata: {
              userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
              viewport: { width: 1920, height: 1080 },
              url: 'http://localhost:3000/test-page',
              timestamp: Date.now(),
            },
          },
        };

        const createResponse = await request.post(`${API_URL}/api/v1/reports`, {
          headers: { 'X-API-Key': apiKey },
          data: reportData,
        });

        if (!createResponse.ok()) {
          const body = await createResponse.text();
          console.error(
            `Failed to create bug report: ${createResponse.status()} ${createResponse.statusText()}`
          );
          console.error(`Response body: ${body}`);
          throw new Error(`Failed to create bug report with replay: ${createResponse.status()}`);
        }

        const createResult = await createResponse.json();
        const bugReportId = createResult.data.id;
        const presignedUrls = createResult.data.presignedUrls;

        console.log('📦 Bug report created:', bugReportId);
        console.log('📦 Presigned URLs:', JSON.stringify(presignedUrls, null, 2));

        if (!presignedUrls?.replay?.uploadUrl) {
          throw new Error('No replay upload URL provided');
        }

        // Step 2: Upload replay data to presigned URL
        const replayJson = JSON.stringify(replayData.events);
        const compressed = pako.gzip(replayJson);

        console.log('📤 Uploading replay data...');
        console.log('   Size (uncompressed):', replayJson.length, 'bytes');
        console.log('   Size (compressed):', compressed.length, 'bytes');
        console.log('   Upload URL:', presignedUrls.replay.uploadUrl.substring(0, 80) + '...');

        const uploadResponse = await fetch(presignedUrls.replay.uploadUrl, {
          method: 'PUT',
          body: Buffer.from(compressed),
          headers: {
            'Content-Type': 'application/gzip',
          },
        });

        if (!uploadResponse.ok) {
          console.error('❌ Upload failed:', uploadResponse.status, uploadResponse.statusText);
          const errorText = await uploadResponse.text();
          console.error('   Error response:', errorText);
          throw new Error(`Failed to upload replay: ${uploadResponse.status}`);
        }

        console.log('✅ Replay uploaded successfully (status:', uploadResponse.status, ')');
        console.log('   Storage key:', presignedUrls.replay.storageKey);

        // Step 3: Mark upload as completed AND set replay_key
        // Get auth token first
        const loginResponse = await request.post(`${API_URL}/api/v1/auth/login`, {
          data: {
            email: 'admin@bugspotter.io',
            password: 'admin123',
          },
        });

        const loginData = await loginResponse.json();
        const authToken = loginData.data.access_token;

        // Mark the upload as completed via the dedicated confirm-upload
        // endpoint. The general PATCH /reports/:id schema has
        // `additionalProperties: false` and intentionally doesn't expose
        // `replay_upload_status` as a user-writable field — upload state
        // transitions go through POST /reports/:id/confirm-upload
        // instead, which also handles the storage headObject check and
        // queues the replay-processing job.
        const updateResponse = await request.post(
          `${API_URL}/api/v1/reports/${bugReportId}/confirm-upload`,
          {
            headers: { Authorization: `Bearer ${authToken}` },
            data: { fileType: 'replay' },
          }
        );

        if (!updateResponse.ok()) {
          const body = await updateResponse.text();
          console.error('❌ Failed to mark upload complete:', updateResponse.status(), body);
          throw new Error(`Failed to mark upload complete: ${updateResponse.status()} - ${body}`);
        }

        console.log('✅ Upload marked as completed');

        // Verify the bug report has replay_key set
        const verifyResponse = await request.get(`${API_URL}/api/v1/reports/${bugReportId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        if (verifyResponse.ok()) {
          const verifyData = await verifyResponse.json();
          console.log('🔍 Verifying bug report state:');
          console.log('   replay_key:', verifyData.data.replay_key);
          console.log('   replay_upload_status:', verifyData.data.replay_upload_status);

          if (!verifyData.data.replay_key) {
            throw new Error('Bug report does not have replay_key set!');
          }
        }

        console.log('✅ Bug report with replay created:', bugReportId);

        return bugReportId;
      },
    };

    await use(setupState);
  },
});

export { expect, type Page };
