/**
 * Project Integration Config API Tests
 * Tests GET/POST endpoints for /api/v1/integrations/:platform/:projectId
 * Focuses on credential_hints return, credential merging on save,
 * and partial credential updates.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createStorage } from '../../src/storage/index.js';
import type { IStorageService } from '../../src/storage/types.js';
import { PluginRegistry } from '../../src/integrations/plugin-registry.js';
import { createAdminUser } from '../test-helpers.js';

describe('Project Integration Config API', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let storage: IStorageService;
  let pluginRegistry: PluginRegistry;

  let authToken: string;
  let testProjectId: string;

  beforeAll(async () => {
    db = await createDatabaseClient();
    storage = createStorage({
      backend: 'local',
      local: {
        baseDirectory: './test-integration-config-' + Date.now(),
        baseUrl: 'http://localhost:3000/uploads',
      },
    });
    pluginRegistry = new PluginRegistry(db, storage);

    // Register a mock Jira plugin
    const mockJiraPlugin = {
      metadata: {
        platform: 'jira',
        version: '1.0.0',
        name: 'Jira Integration (Mock)',
      },
      factory: (_context: any) => ({
        async validateConfig() {
          return { valid: true };
        },
        async createFromBugReport() {
          return { externalId: 'JIRA-123', externalUrl: 'https://jira.example.com/JIRA-123' };
        },
        async listProjects(config: Record<string, unknown>) {
          // Echo back whether creds were received, so tests can assert
          // the route forwarded the body. Real plugin proxies to the
          // Jira REST API; mock keeps the assertion surface small.
          if (!config.instanceUrl || !config.email || !config.apiToken) {
            throw new Error('Jira configuration incomplete');
          }
          return [
            { id: '10000', key: 'ALPHA', name: 'Alpha' },
            { id: '10001', key: 'BETA', name: 'Beta' },
          ];
        },
      }),
    };
    await pluginRegistry.register(mockJiraPlugin as any);

    // A second plugin that does NOT implement listProjects, so we can
    // assert the route returns a helpful 400 rather than crashing for
    // non-Jira platforms.
    const mockNoListPlugin = {
      metadata: {
        platform: 'mock-no-list',
        version: '1.0.0',
        name: 'Mock plugin without project listing',
      },
      factory: (_context: any) => ({
        async validateConfig() {
          return { valid: true };
        },
        async createFromBugReport() {
          return { externalId: 'MOCK-1', externalUrl: 'https://mock.example.com/1' };
        },
      }),
    };
    await pluginRegistry.register(mockNoListPlugin as any);

    server = await createServer({
      db,
      storage,
      pluginRegistry,
    });
    await server.ready();

    const { token } = await createAdminUser(server, db, 'test-integration-config');
    authToken = token;

    // Create test project
    const projectResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${authToken}` },
      payload: { name: 'Integration Config Test Project', settings: {} },
    });
    testProjectId = projectResponse.json().data.id;
  });

  afterAll(async () => {
    if (db) {
      await db.query('DELETE FROM project_integrations WHERE project_id = $1', [testProjectId]);
      await db.query('DELETE FROM project_members WHERE project_id = $1', [testProjectId]);
      await db.query('DELETE FROM projects WHERE id = $1', [testProjectId]);
      await db.close();
    }
    if (server) {
      await server.close();
    }
  });

  describe('POST /api/v1/integrations/:platform/:projectId (save config)', () => {
    it('should save integration config and credentials', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          config: { instanceUrl: 'https://test.atlassian.net', projectKey: 'TEST' },
          credentials: { email: 'user@example.com', apiToken: 'secret-token' },
          enabled: true,
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().success).toBe(true);
    });

    it('should merge partial credentials with existing ones', async () => {
      // First save: email + apiToken
      await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          config: { instanceUrl: 'https://test.atlassian.net' },
          credentials: { email: 'user@example.com', apiToken: 'secret-token' },
          enabled: true,
        },
      });

      // Second save: only update email, apiToken should be preserved
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          config: { instanceUrl: 'https://test.atlassian.net' },
          credentials: { email: 'new-user@example.com' },
          enabled: true,
        },
      });

      expect(response.statusCode).toBe(201);

      // Verify via GET that both credential keys exist
      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });

      const data = getResponse.json().data;
      expect(data.credential_hints.email).toBeDefined();
      expect(data.credential_hints.apiToken).toBeDefined();
    });

    it('should not wipe credentials when saving with empty credentials object', async () => {
      // Save initial credentials
      await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          config: { instanceUrl: 'https://test.atlassian.net' },
          credentials: { email: 'user@example.com', apiToken: 'secret-token' },
          enabled: true,
        },
      });

      // Save again with empty credentials (config-only update)
      await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          config: { instanceUrl: 'https://updated.atlassian.net' },
          credentials: {},
          enabled: true,
        },
      });

      // Verify credentials are still there
      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });

      const data = getResponse.json().data;
      expect(data.config.instanceUrl).toBe('https://updated.atlassian.net');
      expect(data.credential_hints.email).toBeDefined();
      expect(data.credential_hints.apiToken).toBeDefined();
    });

    it('should preserve all config fields across saves', async () => {
      // Save full config with projectKey and credentials
      await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          config: { instanceUrl: 'https://test.atlassian.net', projectKey: 'BUG' },
          credentials: { email: 'user@example.com', apiToken: 'secret-token' },
          enabled: true,
        },
      });

      // Update config (change instanceUrl, keep projectKey) with no credential changes
      await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          config: { instanceUrl: 'https://updated.atlassian.net', projectKey: 'BUG' },
          credentials: {},
          enabled: true,
        },
      });

      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });

      const data = getResponse.json().data;
      expect(data.config.instanceUrl).toBe('https://updated.atlassian.net');
      expect(data.config.projectKey).toBe('BUG');
      expect(data.credential_hints.email).toBeDefined();
      expect(data.credential_hints.apiToken).toBeDefined();
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        payload: {
          config: {},
          credentials: {},
          enabled: true,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/integrations/:platform/projects (wizard project picker)', () => {
    it('should return projects shaped as { projects: [...] }', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/integrations/jira/projects',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          instanceUrl: 'https://test.atlassian.net',
          email: 'user@example.com',
          apiToken: 'secret-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data.projects).toEqual([
        { id: '10000', key: 'ALPHA', name: 'Alpha' },
        { id: '10001', key: 'BETA', name: 'Beta' },
      ]);
    });

    it('should NOT collide with POST /:platform/:projectId (UUID segment)', async () => {
      // Static-segment `/projects` must win over the parametric
      // `/:projectId` route for a path like `/integrations/jira/projects`,
      // otherwise the wizard would accidentally hit the save-config
      // endpoint with projectId="projects".
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/integrations/jira/projects',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          instanceUrl: 'https://test.atlassian.net',
          email: 'user@example.com',
          apiToken: 'secret-token',
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.projects).toBeDefined();
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/integrations/jira/projects',
        payload: {
          instanceUrl: 'https://test.atlassian.net',
          email: 'user@example.com',
          apiToken: 'secret-token',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 400 for unsupported platform', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/integrations/unsupported_platform/projects',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when platform does not support listProjects', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/integrations/mock-no-list/projects',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toMatch(/not supported|listing/i);
    });

    it('should surface generic plugin errors as 500', async () => {
      // Mock plugin throws `new Error(...)` (not AppError/ValidationError)
      // when required fields are missing — confirms the error middleware
      // maps unknown throws to 500. Real Jira plugin throws
      // ValidationError from the shared credential helper and would
      // reach the client as 400; see the next test for that path.
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/integrations/jira/projects',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          instanceUrl: 'https://test.atlassian.net',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    it('should return 400 when the plugin throws ValidationError', async () => {
      // The Jira plugin's real validator throws `ValidationError` for
      // missing/blank credentials. Swap the plugin's listProjects for
      // one that simulates that behavior, then restore it.
      const { ValidationError } = await import('../../src/api/middleware/error.js');
      const registeredService = await pluginRegistry.loadDynamicPlugin('jira');
      const originalListProjects = registeredService.listProjects!.bind(registeredService);
      registeredService.listProjects = async () => {
        throw new ValidationError('Jira configuration incomplete: missing: email, apiToken.');
      };

      try {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/integrations/jira/projects',
          headers: { authorization: `Bearer ${authToken}` },
          payload: {
            instanceUrl: 'https://test.atlassian.net',
          },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().message).toMatch(/Jira configuration incomplete/);
      } finally {
        registeredService.listProjects = originalListProjects;
      }
    });

    it('should forward query and parsed maxResults to the plugin', async () => {
      // Swap the Jira plugin's listProjects stub for a spy that
      // captures the args the route passes, then restore it.
      const registeredService = await pluginRegistry.loadDynamicPlugin('jira');
      const originalListProjects = registeredService.listProjects!.bind(registeredService);
      const captured: Array<{ query?: string; maxResults?: number }> = [];
      registeredService.listProjects = async (
        _config: Record<string, unknown>,
        q?: string,
        m?: number
      ) => {
        captured.push({ query: q, maxResults: m });
        return [{ id: '10000', key: 'ALPHA', name: 'Alpha' }];
      };

      try {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/integrations/jira/projects?query=alp&maxResults=10',
          headers: { authorization: `Bearer ${authToken}` },
          payload: {
            instanceUrl: 'https://test.atlassian.net',
            email: 'user@example.com',
            apiToken: 'secret-token',
          },
        });

        expect(response.statusCode).toBe(200);
        expect(captured).toEqual([{ query: 'alp', maxResults: 10 }]);
      } finally {
        registeredService.listProjects = originalListProjects;
      }
    });

    it('should 400 when maxResults is not a positive integer', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/integrations/jira/projects?maxResults=abc',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          instanceUrl: 'https://test.atlassian.net',
          email: 'user@example.com',
          apiToken: 'secret-token',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toMatch(/maxResults/);
    });

    it.each([['10.5'], ['10abc'], ['-5'], ['+10'], ['0']])(
      'should 400 when maxResults is %s (rejects non-integer / non-positive inputs)',
      async (bad) => {
        const response = await server.inject({
          method: 'POST',
          url: `/api/v1/integrations/jira/projects?maxResults=${encodeURIComponent(bad)}`,
          headers: { authorization: `Bearer ${authToken}` },
          payload: {
            instanceUrl: 'https://test.atlassian.net',
            email: 'user@example.com',
            apiToken: 'secret-token',
          },
        });

        expect(response.statusCode).toBe(400);
      }
    );

    it('should tolerate duplicate maxResults querystring entries without 500', async () => {
      // Fastify's default parser returns an array for repeated keys.
      // The route must pick a single entry instead of crashing with
      // `TypeError: maxResultsRaw.trim is not a function`.
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/integrations/jira/projects?maxResults=5&maxResults=20',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          instanceUrl: 'https://test.atlassian.net',
          email: 'user@example.com',
          apiToken: 'secret-token',
        },
      });

      // Either accepted as the first value (200) or rejected as malformed
      // (400) — the exact choice is up to the route. What matters is that
      // we don't crash with a 500.
      expect(response.statusCode).not.toBe(500);
    });

    it('should accept maxResults wrapped in whitespace after trimming', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/integrations/jira/projects?maxResults=%2010%20',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          instanceUrl: 'https://test.atlassian.net',
          email: 'user@example.com',
          apiToken: 'secret-token',
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /api/v1/integrations/:platform/:projectId', () => {
    it('should return null when no config exists', async () => {
      // Use a fresh project with no integration
      const projRes = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { name: 'Empty Project', settings: {} },
      });
      const emptyProjectId = projRes.json().data.id;

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/jira/${emptyProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toBeNull();

      // Cleanup
      await db.query('DELETE FROM project_members WHERE project_id = $1', [emptyProjectId]);
      await db.query('DELETE FROM projects WHERE id = $1', [emptyProjectId]);
    });

    it('should return config without credential values', async () => {
      // Save config with credentials
      await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          config: { instanceUrl: 'https://test.atlassian.net', projectKey: 'PROJ' },
          credentials: { email: 'user@example.com', apiToken: 'super-secret' },
          enabled: true,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json().data;

      // Config should be returned
      expect(data.config.instanceUrl).toBe('https://test.atlassian.net');
      expect(data.config.projectKey).toBe('PROJ');
      expect(data.platform).toBe('jira');
      expect(data.enabled).toBe(true);

      // Credential values must NOT be present
      expect(data.config.email).toBeUndefined();
      expect(data.config.apiToken).toBeUndefined();
      expect(data.encrypted_credentials).toBeUndefined();
    });

    it('should return credential_hints with masked previews for saved credentials', async () => {
      // Save config with credentials
      await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          config: { instanceUrl: 'https://test.atlassian.net' },
          credentials: { email: 'user@example.com', apiToken: 'token-123', password: 'pass' },
          enabled: true,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });

      const data = response.json().data;
      expect(data.credential_hints).toBeDefined();
      expect(typeof data.credential_hints).toBe('object');
      // Email shown with local-part partially masked
      expect(data.credential_hints.email).toBe('u***r@example.com');
      // API token shows first 4 chars + mask
      expect(data.credential_hints.apiToken).toBe('toke••••••••');
      // Password fully masked
      expect(data.credential_hints.password).toBe('••••••••');
      // Backward compat: credential_keys matches credential_hints keys
      expect(data.credential_keys).toEqual(Object.keys(data.credential_hints));
    });

    it('should return empty credential_hints object when no credentials are saved', async () => {
      // Use a fresh project so no prior credentials exist
      const projRes = await server.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { name: 'Empty Creds Project', settings: {} },
      });
      const freshProjectId = projRes.json().data.id;

      // Save config without credentials on the fresh project
      await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${freshProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          config: { instanceUrl: 'https://test.atlassian.net' },
          credentials: {},
          enabled: true,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/jira/${freshProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });

      const data = response.json().data;
      expect(data.credential_hints).toEqual({});

      // Cleanup
      await db.query('DELETE FROM project_integrations WHERE project_id = $1', [freshProjectId]);
      await db.query('DELETE FROM project_members WHERE project_id = $1', [freshProjectId]);
      await db.query('DELETE FROM projects WHERE id = $1', [freshProjectId]);
    });

    it('should exclude empty-string credential values from credential_hints object', async () => {
      await server.inject({
        method: 'POST',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          config: { instanceUrl: 'https://test.atlassian.net' },
          credentials: { email: 'user@example.com', apiToken: '', password: '' },
          enabled: true,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/jira/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });

      const data = response.json().data;
      expect(data.credential_hints.email).toBe('u***r@example.com');
      expect(data.credential_hints.apiToken).toBeUndefined();
      expect(data.credential_hints.password).toBeUndefined();
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/jira/${testProjectId}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 400 for unsupported platform', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/unsupported_platform/${testProjectId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
