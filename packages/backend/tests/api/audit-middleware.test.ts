/**
 * Audit Middleware Tests
 * Tests for automatic audit logging and sanitization
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { ApiKeyService } from '../../src/services/api-key/index.js';
import { createMockPluginRegistry, createMockStorage } from '../test-helpers.js';

describe('Audit Middleware', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let testAccessToken: string;
  let testUserId: string;

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();
    server = await createServer({ db, storage, pluginRegistry });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    // Generate unique identifiers for test isolation
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);

    // Create test user and get JWT token
    const registerResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `audit-test-${timestamp}-${randomId}@example.com`,
        password: 'TestPassword123!',
      },
    });

    const registerData = JSON.parse(registerResponse.body);
    testAccessToken = registerData.data.access_token;
    testUserId = registerData.data.user.id;
  });

  /**
   * Poll for audit log matching predicate with retry logic
   * More reliable than arbitrary setTimeout delays
   */
  async function waitForAuditLog(
    predicate: (logs: Awaited<ReturnType<typeof db.auditLogs.findByUserId>>) => boolean,
    maxAttempts = 20,
    delayMs = 50
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const logs = await db.auditLogs.findByUserId(testUserId, 20);
      if (predicate(logs)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error(`Audit log not found after ${maxAttempts * delayMs}ms`);
  }

  describe('Sensitive Data Sanitization', () => {
    it('should redact top-level sensitive fields', async () => {
      const timestamp = Date.now();

      // Create a project with sensitive data in settings (body has additionalProperties: false)
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          name: `Audit Project ${timestamp}`,
          settings: {
            password: 'secret123', // Should be redacted
            api_key: 'custom_key_123', // Should be redacted
            token: 'bearer_token_xyz', // Should be redacted
          },
        },
      });

      expect(response.statusCode).toBe(201);

      // Wait for async audit log creation with retry logic
      await waitForAuditLog((logs) => logs.some((log) => log.resource === '/api/v1/projects'));

      // Fetch recent audit logs for this user
      const auditLogs = await db.auditLogs.findByUserId(testUserId, 10);
      const projectCreationLog = auditLogs.find((log) => log.resource === '/api/v1/projects');

      expect(projectCreationLog).toBeDefined();
      expect(projectCreationLog?.details).toBeDefined();

      const details = projectCreationLog?.details as {
        body: { name: string; settings: Record<string, unknown> };
      };
      expect(details.body).toBeDefined();
      expect(details.body.name).toBe(`Audit Project ${timestamp}`);
      expect(details.body.settings.password).toBe('[REDACTED]');
      expect(details.body.settings.api_key).toBe('[REDACTED]');
      expect(details.body.settings.token).toBe('[REDACTED]');
    });

    it('should redact nested sensitive fields in objects', async () => {
      const timestamp = Date.now();

      // Create a project with nested sensitive data
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          name: `Nested Audit Project ${timestamp}`,
          settings: {
            user: {
              name: 'John Doe',
              password: 'nested_secret', // Should be redacted
              access_token: 'nested_token_123', // Should be redacted
            },
            api: {
              secret: 'api_secret_key', // Should be redacted
            },
          },
        },
      });

      expect(response.statusCode).toBe(201);

      // Wait for async audit log creation with retry logic
      await waitForAuditLog((logs) =>
        logs.some((log) => log.resource === '/api/v1/projects' && log.action === 'POST')
      );

      // Fetch recent audit logs
      const auditLogs = await db.auditLogs.findByUserId(testUserId, 10);
      const projectCreationLog = auditLogs.find(
        (log) => log.resource === '/api/v1/projects' && log.action === 'POST'
      );

      expect(projectCreationLog).toBeDefined();

      const details = projectCreationLog?.details as {
        body: {
          name: string;
          settings: {
            user: Record<string, unknown>;
            api: Record<string, unknown>;
          };
        };
      };

      expect(details.body.name).toBe(`Nested Audit Project ${timestamp}`);
      expect(details.body.settings.user.name).toBe('John Doe');
      expect(details.body.settings.user.password).toBe('[REDACTED]');
      expect(details.body.settings.user.access_token).toBe('[REDACTED]');
      expect(details.body.settings.api.secret).toBe('[REDACTED]');
    });

    it('should redact sensitive fields in arrays', async () => {
      const timestamp = Date.now();

      // Create project with array of sensitive data in settings (body has additionalProperties: false)
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          name: `Array Audit Project ${timestamp}`,
          settings: {
            credentials: [
              { service: 'github', api_key: 'github_key_123' }, // Should be redacted
              { service: 'jira', token: 'jira_token_456' }, // Should be redacted
            ],
          },
        },
      });

      expect(response.statusCode).toBe(201);

      // Wait for async audit log creation with retry logic
      await waitForAuditLog((logs) =>
        logs.some((log) => log.resource === '/api/v1/projects' && log.action === 'POST')
      );

      // Fetch recent audit logs
      const auditLogs = await db.auditLogs.findByUserId(testUserId, 10);
      const projectCreationLog = auditLogs.find(
        (log) => log.resource === '/api/v1/projects' && log.action === 'POST'
      );

      expect(projectCreationLog).toBeDefined();

      const details = projectCreationLog?.details as {
        body: {
          name: string;
          settings: {
            credentials: Array<{ service: string; api_key?: string; token?: string }>;
          };
        };
      };

      expect(details.body.name).toBe(`Array Audit Project ${timestamp}`);
      expect(details.body.settings.credentials).toHaveLength(2);
      expect(details.body.settings.credentials[0].service).toBe('github');
      expect(details.body.settings.credentials[0].api_key).toBe('[REDACTED]');
      expect(details.body.settings.credentials[1].service).toBe('jira');
      expect(details.body.settings.credentials[1].token).toBe('[REDACTED]');
    });

    it('should handle case-insensitive field matching', async () => {
      const timestamp = Date.now();

      // Create project with various password casings in settings (body has additionalProperties: false)
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          name: `Case Test Project ${timestamp}`,
          settings: {
            Password: 'should_be_redacted_1', // Should be redacted
            PASSWORD: 'should_be_redacted_2', // Should be redacted
            pAsSwOrD: 'should_be_redacted_3', // Should be redacted
          },
        },
      });

      expect(response.statusCode).toBe(201);

      // Wait for async audit log creation with retry logic
      await waitForAuditLog((logs) =>
        logs.some((log) => log.resource === '/api/v1/projects' && log.action === 'POST')
      );

      // Fetch recent audit logs
      const auditLogs = await db.auditLogs.findByUserId(testUserId, 10);
      const projectCreationLog = auditLogs.find(
        (log) => log.resource === '/api/v1/projects' && log.action === 'POST'
      );

      expect(projectCreationLog).toBeDefined();

      const details = projectCreationLog?.details as {
        body: { name: string; settings: Record<string, unknown> };
      };

      expect(details.body.name).toBe(`Case Test Project ${timestamp}`);
      expect(details.body.settings.Password).toBe('[REDACTED]');
      expect(details.body.settings.PASSWORD).toBe('[REDACTED]');
      expect(details.body.settings.pAsSwOrD).toBe('[REDACTED]');
    });

    it('should redact sensitive fields in query parameters', async () => {
      const timestamp = Date.now();

      // Create project with sensitive data in query params
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects?api_key=secret_key_123&reset_token=reset_abc&normal_param=value',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          name: `Query Param Project ${timestamp}`,
        },
      });

      expect(response.statusCode).toBe(201);

      // Wait for async audit log creation with retry logic
      await waitForAuditLog((logs) =>
        logs.some((log) => log.resource === '/api/v1/projects' && log.action === 'POST')
      );

      const auditLogs = await db.auditLogs.findByUserId(testUserId, 10);
      const projectCreationLog = auditLogs.find(
        (log) => log.resource === '/api/v1/projects' && log.action === 'POST'
      );

      expect(projectCreationLog).toBeDefined();

      const details = projectCreationLog?.details as {
        query: Record<string, unknown>;
      };

      expect(details.query).toBeDefined();
      expect(details.query.api_key).toBe('[REDACTED]');
      expect(details.query.reset_token).toBe('[REDACTED]');
      expect(details.query.normal_param).toBe('value');
    });

    it('should truncate long User-Agent headers', async () => {
      const timestamp = Date.now();
      const longUserAgent = 'A'.repeat(1000); // 1000 characters

      // Create project with extremely long User-Agent
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
          'user-agent': longUserAgent,
        },
        payload: {
          name: `User Agent Project ${timestamp}`,
        },
      });

      expect(response.statusCode).toBe(201);

      // Wait for async audit log creation with retry logic
      await waitForAuditLog((logs) =>
        logs.some((log) => log.resource === '/api/v1/projects' && log.action === 'POST')
      );

      const auditLogs = await db.auditLogs.findByUserId(testUserId, 10);
      const projectCreationLog = auditLogs.find(
        (log) => log.resource === '/api/v1/projects' && log.action === 'POST'
      );

      expect(projectCreationLog).toBeDefined();
      expect(projectCreationLog?.user_agent).toBeDefined();
      expect(projectCreationLog!.user_agent!.length).toBe(500);
      expect(projectCreationLog!.user_agent).toBe('A'.repeat(500));
    });

    it('should redact new sensitive field patterns (apikey, jwt, bearer)', async () => {
      const timestamp = Date.now();

      // Create project with new sensitive field patterns in settings (body has additionalProperties: false)
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          name: `New Fields Project ${timestamp}`,
          settings: {
            apikey: 'apikey_should_be_redacted',
            jwt: 'jwt_token_should_be_redacted',
            bearer: 'bearer_token_should_be_redacted',
            auth_token: 'auth_should_be_redacted',
          },
        },
      });

      expect(response.statusCode).toBe(201);

      // Wait for async audit log creation with retry logic
      await waitForAuditLog((logs) =>
        logs.some((log) => log.resource === '/api/v1/projects' && log.action === 'POST')
      );

      const auditLogs = await db.auditLogs.findByUserId(testUserId, 10);
      const projectCreationLog = auditLogs.find(
        (log) => log.resource === '/api/v1/projects' && log.action === 'POST'
      );

      expect(projectCreationLog).toBeDefined();

      const details = projectCreationLog?.details as {
        body: { name: string; settings: Record<string, unknown> };
      };

      expect(details.body.name).toBe(`New Fields Project ${timestamp}`);
      expect(details.body.settings.apikey).toBe('[REDACTED]');
      expect(details.body.settings.jwt).toBe('[REDACTED]');
      expect(details.body.settings.bearer).toBe('[REDACTED]');
      expect(details.body.settings.auth_token).toBe('[REDACTED]');
    });
  });

  describe('Audit Log Creation', () => {
    it('should create audit log for POST requests', async () => {
      const timestamp = Date.now();

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
        payload: {
          name: `POST Test Project ${timestamp}`,
        },
      });

      expect(response.statusCode).toBe(201);

      // Wait for async audit log creation with retry logic
      await waitForAuditLog((logs) =>
        logs.some((l) => l.action === 'POST' && l.resource === '/api/v1/projects')
      );

      const auditLogs = await db.auditLogs.findByUserId(testUserId, 10);
      const log = auditLogs.find((l) => l.action === 'POST' && l.resource === '/api/v1/projects');

      expect(log).toBeDefined();
      expect(log?.user_id).toBe(testUserId);
      expect(log?.success).toBe(true);
      expect(log?.action).toBe('POST');
    });

    it('should NOT create audit log for GET requests', async () => {
      // Get projects
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: {
          authorization: `Bearer ${testAccessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);

      // Give enough time to ensure no audit log is created (testing absence)
      await new Promise((resolve) => setTimeout(resolve, 200));

      const auditLogs = await db.auditLogs.findByUserId(testUserId, 10);
      const getLog = auditLogs.find((l) => l.action === 'GET');

      expect(getLog).toBeUndefined();
    });

    it('should NOT create audit log for public routes', async () => {
      // Login is a public route (excluded from audit)
      await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'password123',
        },
      });

      // Give enough time to ensure no audit log is created (testing absence)
      await new Promise((resolve) => setTimeout(resolve, 200));

      const auditLogs = await db.auditLogs.getRecent(50);
      const loginLog = auditLogs.find((l) => l.resource === '/api/v1/auth/login');

      expect(loginLog).toBeUndefined();
    });
  });

  // Runtime / DB-layer regression coverage for the GH-97 audit-identity
  // pairing. The ESLint rule (`no-restricted-syntax` for `'api-key'` literal)
  // catches source-level regressions at lint time, but a refactor that
  // accidentally drops `api_key_id` from `auditData.details` — or that
  // re-introduces the masked `'api-key'` literal via a runtime path the
  // selector doesn't reach — would still slip past. Asserting on the
  // produced audit row closes that gap.
  describe('API Key Identity Recording', () => {
    let bugReportId: string;
    let projectId: string;

    beforeEach(async () => {
      // Fresh project + bug-report per test so PATCH /api/v1/reports/:id
      // (which accepts api-key auth and is an auditable method) succeeds.
      // testUserId is the project's `created_by`, so they have implicit
      // owner role — the dual-header attribution cross-check uses this.
      const project = await db.projects.create({
        name: `audit-id-project-${Date.now()}-${Math.random()}`,
        created_by: testUserId,
      });
      projectId = project.id;
      const report = await db.bugReports.create({
        project_id: project.id,
        title: 'audit identity fixture',
        description: 'fixture for audit-identity regression coverage',
      });
      bugReportId = report.id;
    });

    async function findLatestReportAudit(reportId: string) {
      const logs = await db.auditLogs.findByResource(`/api/v1/reports/${reportId}`, undefined, 5);
      return logs.find((l) => l.action === 'PATCH');
    }

    async function waitForReportAudit(reportId: string) {
      // Budget: 60 attempts × 50ms = 3s. Generous because the audit
      // middleware writes fire-and-forget on the onResponse hook
      // (audit.ts: `db.auditLogs.create(...).catch(...)`), so on a
      // loaded CI runner the write can land tens to hundreds of ms
      // after the response. If this throws, the production failure
      // mode is the same: a row was *expected* but never landed —
      // either DB error swallowed by the .catch, or a regression
      // dropped the call entirely. (Underlying reliability gap —
      // fire-and-forget with no retry / DLQ — is pre-existing and
      // out of scope for PR-105; tracked separately.)
      const ATTEMPTS = 60;
      const DELAY_MS = 50;
      for (let i = 0; i < ATTEMPTS; i++) {
        const log = await findLatestReportAudit(reportId);
        if (log) {
          return log;
        }
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
      throw new Error(
        `audit row for PATCH /api/v1/reports/${reportId} not written within ` +
          `${(ATTEMPTS * DELAY_MS) / 1000}s. ` +
          `If this fires repeatedly: check the audit middleware's onResponse ` +
          `hook (audit.ts) — the route already returned 200, so either the ` +
          `db.auditLogs.create fire-and-forget swallowed an error (.catch ` +
          `at audit.ts) or a regression dropped the audit write entirely.`
      );
    }

    it('records api_key_id in details and user_id null on api-key-only request', async () => {
      const apiKeyService = new ApiKeyService(db);
      const { plaintext, key } = await apiKeyService.createKey({
        name: `audit-id-key-only-${Date.now()}`,
        type: 'development',
        permission_scope: 'full',
        permissions: ['bugs:read', 'bugs:write'],
        created_by: testUserId,
        allowed_projects: null,
      });

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/reports/${bugReportId}`,
        headers: { 'x-api-key': plaintext, 'content-type': 'application/json' },
        payload: JSON.stringify({ status: 'in-progress' }),
      });

      expect(response.statusCode).toBe(200);

      const log = await waitForReportAudit(bugReportId);
      expect(log.user_id).toBeNull();
      const details = log.details as { api_key_id?: string };
      expect(details.api_key_id).toBe(key.id);
    });

    it('records BOTH user_id and api_key_id on dual-header (JWT + api-key) request when scope cross-check passes', async () => {
      // GH-97 fully closed: the auth middleware verifies the
      // accompanying JWT (signature, user existence, and scope
      // membership) and stores the verified userId in
      // `request.jwtUserIdentity` for attribution-only.
      // `request.authUser` stays undefined (api-key remains the
      // authoritative authz path; precedence unchanged), so this
      // attribution flows through the audit middleware's
      // `getAuditUserId` fallback.
      //
      // This test uses a project-scoped api-key (allowed_projects =
      // [projectId]) and testUserId has implicit owner role on that
      // project (created_by) — so the cross-check passes and
      // attribution lands. Pins both halves of the contract:
      //   - user_id = the JWT user (human attribution)
      //   - details.api_key_id = the api-key id (machine attribution)
      //
      // Regression guards this catches:
      //   - Removing the JWT-verify-alongside-api-key block in auth
      //     middleware → user_id goes back to null.
      //   - Inadvertently populating `request.authUser` on the api-key
      //     path → would surface elsewhere (authz changes), but the
      //     audit row still records the right id thanks to the
      //     fallback ordering.
      //   - Replacing `getAuditUserId` with `authUser?.id ?? null`
      //     (dropping the jwtUserIdentity branch) → user_id null again.
      //   - Removing the scope cross-check → still passes (no false
      //     negative); verified by separate cross-org test below.
      const apiKeyService = new ApiKeyService(db);
      const { plaintext, key } = await apiKeyService.createKey({
        name: `audit-id-dual-${Date.now()}`,
        type: 'development',
        permission_scope: 'full',
        permissions: ['bugs:read', 'bugs:write'],
        created_by: testUserId,
        allowed_projects: [projectId],
      });

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/reports/${bugReportId}`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
          'x-api-key': plaintext,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ status: 'in-progress' }),
      });

      expect(response.statusCode).toBe(200);

      const log = await waitForReportAudit(bugReportId);
      expect(log.user_id).toBe(testUserId);
      const details = log.details as { api_key_id?: string };
      expect(details.api_key_id).toBe(key.id);
    });

    it('records user_id null on dual-header request when the accompanying JWT is invalid', async () => {
      // Defense-in-depth: a forged / expired / malformed JWT alongside
      // a valid api-key must not poison the audit row. The api-key
      // already authenticated the request; we simply have no second
      // identity to attribute. user_id falls back to null rather than
      // recording an unverified claim.
      const apiKeyService = new ApiKeyService(db);
      const { plaintext, key } = await apiKeyService.createKey({
        name: `audit-id-dual-bad-jwt-${Date.now()}`,
        type: 'development',
        permission_scope: 'full',
        permissions: ['bugs:read', 'bugs:write'],
        created_by: testUserId,
        allowed_projects: null,
      });

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/reports/${bugReportId}`,
        headers: {
          authorization: 'Bearer not.a.valid.jwt',
          'x-api-key': plaintext,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ status: 'in-progress' }),
      });

      expect(response.statusCode).toBe(200);

      const log = await waitForReportAudit(bugReportId);
      expect(log.user_id).toBeNull();
      const details = log.details as { api_key_id?: string };
      expect(details.api_key_id).toBe(key.id);
    });

    it('does not poison the audit row when a revoked api-key is presented alongside a valid JWT', async () => {
      // `handleNewApiKeyAuth` returns true for revoked / expired /
      // inactive keys (after sending its own 401), and that "true" is
      // *not* "auth succeeded." The dual-header attribution block in
      // auth/middleware.ts must guard on `request.apiKey` (only set
      // on the genuine success path), not on the handler return —
      // otherwise a rejected api-key request with a valid JWT would
      // record the JWT user as the actor on a 401-rejected row.
      //
      // What this test catches if it ever turns red:
      //   - Reverting the guard to `if (success) {`
      //   - Moving the jwtVerify block before the api-key check
      //   - Setting `request.apiKey` on a non-success path
      const apiKeyService = new ApiKeyService(db);
      const { plaintext, key } = await apiKeyService.createKey({
        name: `audit-id-dual-revoked-${Date.now()}`,
        type: 'development',
        permission_scope: 'full',
        permissions: ['bugs:read', 'bugs:write'],
        created_by: testUserId,
        allowed_projects: null,
      });
      // Revoke the key so handleNewApiKeyAuth sends a 401 and returns
      // true without populating request.apiKey.
      await apiKeyService.revokeKey(key.id, testUserId, 'test fixture');

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/reports/${bugReportId}`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
          'x-api-key': plaintext,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ status: 'in-progress' }),
      });

      // 401 — revoked api-key is rejected at auth time; no JWT
      // fallback (auth precedence is short-circuit on api-key).
      expect(response.statusCode).toBe(401);

      // Audit row IS still written (audit middleware fires on
      // onResponse for non-excluded routes regardless of status).
      // user_id MUST be null — neither identity is authoritative for
      // this request.
      const log = await waitForReportAudit(bugReportId);
      expect(log.user_id).toBeNull();
      expect(log.success).toBe(false);
    });

    it('does not attribute on dual-header when the JWT user has no membership in the api-key projects (cross-org poisoning)', async () => {
      // The attribution-poisoning attack the scope cross-check
      // closes: an actor with two unrelated valid credentials — a
      // leaked api-key for project P + a JWT for any user with no
      // relationship to P — could otherwise plant that user as the
      // audit actor for every request against P. Pre-PR-107 this
      // case recorded user_id null (honest); without the cross-
      // check, post-PR-107 would record the unrelated user, which
      // is strictly worse than null.
      //
      // The test mints a JWT for a brand-new user that has no
      // project_members row and no org membership for the project,
      // pairs it with a project-scoped api-key for that project,
      // and asserts user_id stays null.
      const outsider = await db.users.create({
        email: `outsider-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
        password_hash: 'unused',
        role: 'user',
      });
      const outsiderJwt = server.jwt.sign(
        { userId: outsider.id, isPlatformAdmin: false },
        { expiresIn: '5m' }
      );

      const apiKeyService = new ApiKeyService(db);
      const { plaintext, key } = await apiKeyService.createKey({
        name: `audit-id-dual-cross-org-${Date.now()}`,
        type: 'development',
        permission_scope: 'full',
        permissions: ['bugs:read', 'bugs:write'],
        created_by: testUserId,
        allowed_projects: [projectId],
      });

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/reports/${bugReportId}`,
        headers: {
          authorization: `Bearer ${outsiderJwt}`,
          'x-api-key': plaintext,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ status: 'in-progress' }),
      });

      expect(response.statusCode).toBe(200);

      const log = await waitForReportAudit(bugReportId);
      expect(log.user_id).toBeNull();
      const details = log.details as { api_key_id?: string };
      expect(details.api_key_id).toBe(key.id);
    });

    it('does not attribute on dual-header with a full-scope api-key (no verifiable scope to cross-check)', async () => {
      // Full-scope api-keys (allowed_projects = null/empty) have no
      // verifiable project relationship the cross-check can ground
      // on. Skipping attribution rather than recording an unverified
      // claim matches the pre-PR-107 shape exactly for these
      // requests, so this isn't a regression — full-scope keys are
      // typically platform-level credentials where the operator-vs-
      // key relationship can't be inferred from headers alone.
      const apiKeyService = new ApiKeyService(db);
      const { plaintext, key } = await apiKeyService.createKey({
        name: `audit-id-dual-full-scope-${Date.now()}`,
        type: 'development',
        permission_scope: 'full',
        permissions: ['bugs:read', 'bugs:write'],
        created_by: testUserId,
        allowed_projects: null,
      });

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/reports/${bugReportId}`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
          'x-api-key': plaintext,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ status: 'in-progress' }),
      });

      expect(response.statusCode).toBe(200);

      const log = await waitForReportAudit(bugReportId);
      expect(log.user_id).toBeNull();
      const details = log.details as { api_key_id?: string };
      expect(details.api_key_id).toBe(key.id);
    });

    it('records user_id null on dual-header request when the JWT user no longer exists', async () => {
      // Defense-in-depth: a JWT for a deleted user (still
      // signature-valid until expiry) must not be recorded as the
      // actor. The DB existence check after jwtVerify ensures we
      // attribute only to users that still exist at request time.
      // Without the check, a revoked / disabled / deleted user's
      // cached JWT could continue to poison attribution alongside any
      // valid api-key.
      const apiKeyService = new ApiKeyService(db);
      const { plaintext, key } = await apiKeyService.createKey({
        name: `audit-id-dual-deleted-user-${Date.now()}`,
        type: 'development',
        permission_scope: 'full',
        permissions: ['bugs:read', 'bugs:write'],
        created_by: testUserId,
        allowed_projects: null,
      });

      // JWT minted for a userId that doesn't exist in the DB.
      const ghostJwt = server.jwt.sign(
        { userId: '00000000-0000-0000-0000-000000000000', isPlatformAdmin: false },
        { expiresIn: '5m' }
      );

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/reports/${bugReportId}`,
        headers: {
          authorization: `Bearer ${ghostJwt}`,
          'x-api-key': plaintext,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ status: 'in-progress' }),
      });

      expect(response.statusCode).toBe(200);

      const log = await waitForReportAudit(bugReportId);
      expect(log.user_id).toBeNull();
      const details = log.details as { api_key_id?: string };
      expect(details.api_key_id).toBe(key.id);
    });

    it('records api_key_id null on JWT-only request', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/reports/${bugReportId}`,
        headers: {
          authorization: `Bearer ${testAccessToken}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ status: 'in-progress' }),
      });

      expect(response.statusCode).toBe(200);

      const log = await waitForReportAudit(bugReportId);
      expect(log.user_id).toBe(testUserId);
      const details = log.details as { api_key_id?: string | null };
      // Always present (uniform JSONB shape for the GH-104 column-level
      // migration), null for JWT-only.
      expect(details).toHaveProperty('api_key_id');
      expect(details.api_key_id).toBeNull();
    });
  });
});
