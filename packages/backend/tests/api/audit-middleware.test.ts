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

    beforeEach(async () => {
      // Fresh project + bug-report per test so PATCH /api/v1/reports/:id
      // (which accepts api-key auth and is an auditable method) succeeds.
      const project = await db.projects.create({
        name: `audit-id-project-${Date.now()}-${Math.random()}`,
        created_by: testUserId,
      });
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
      for (let i = 0; i < 30; i++) {
        const log = await findLatestReportAudit(reportId);
        if (log) {
          return log;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`audit row for /api/v1/reports/${reportId} not written within 1.5s`);
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

    it('records api_key_id and user_id null on dual-header (JWT + api-key) request', async () => {
      // Auth middleware short-circuits on the api-key header
      // (auth/middleware.ts:71) and never populates request.authUser even
      // when a JWT is present, so the audit row mirrors the api-key-only
      // case. This is the GH-97 attack-shape guard: a regression that
      // "fixes" the precedence by reading the JWT alongside the api-key
      // would surface here as user_id no longer being null.
      const apiKeyService = new ApiKeyService(db);
      const { plaintext, key } = await apiKeyService.createKey({
        name: `audit-id-dual-${Date.now()}`,
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
      // user_id stays null — api-key short-circuits, authUser is never set.
      // This is the documented dual-header limitation; closing it requires
      // a deeper auth-middleware change (out of scope for this PR).
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
