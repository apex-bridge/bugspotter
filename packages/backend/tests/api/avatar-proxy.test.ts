/**
 * Avatar Proxy Endpoint Tests
 * Tests the public avatar-proxy endpoint with comprehensive SSRF protection
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createStorage } from '../../src/storage/index.js';
import type { IStorageService } from '../../src/storage/types.js';
import { PluginRegistry } from '../../src/integrations/plugin-registry.js';
import { buildJiraAllowedAvatarDomains } from '../../src/integrations/jira/service.js';
import { createProjectIntegrationSQL } from '../test-helpers.js';

/**
 * Helper to create a ReadableStream from a Buffer (mimics fetch API response.body)
 */
function createReadableStream(buffer: Buffer): ReadableStream {
  return Readable.toWeb(Readable.from(buffer)) as ReadableStream;
}

// Mock fetch for external avatar requests
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('Avatar Proxy Endpoint', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;
  let storage: IStorageService;
  let pluginRegistry: PluginRegistry;

  let testProjectId: string;
  let testIntegrationId: string;

  beforeAll(async () => {
    db = await createDatabaseClient();
    storage = createStorage({
      backend: 'local',
      local: {
        baseDirectory: './test-avatar-proxy-' + Date.now(),
        baseUrl: 'http://localhost:3000/uploads',
      },
    });
    pluginRegistry = new PluginRegistry(db, storage);

    // Register a mock Jira plugin with searchUsers support
    const mockJiraPlugin = {
      metadata: {
        platform: 'jira',
        version: '1.0.0',
        name: 'Jira Integration (Mock)',
      },
      factory: (_context: any) => ({
        platform: 'jira',
        async validateConfig() {
          return { valid: true };
        },
        async createFromBugReport() {
          return { externalId: 'JIRA-123', externalUrl: 'https://jira.example.com/JIRA-123' };
        },
        async testConnection() {
          return true;
        },
        async searchUsers(_config: any, query: string, _maxResults?: number) {
          // Mock implementation returns test data based on query
          if (query === 'invalid-avatar-test') {
            return [
              {
                accountId: 'user-with-invalid-avatar',
                displayName: 'Invalid Avatar User',
                emailAddress: 'invalid@example.com',
                avatarUrls: {
                  '16x16': 'not-a-valid-url',
                  '24x24': 'also-invalid',
                  '32x32': 'https://test.atlassian.net/secure/useravatar?valid=true',
                },
              },
            ];
          }
          return [];
        },
        getAllowedAvatarDomains(config: Record<string, unknown>): string[] {
          // Use the same helper function as the real implementation to avoid duplication
          return buildJiraAllowedAvatarDomains(config);
        },
      }),
    };
    await pluginRegistry.register(mockJiraPlugin as any);

    server = await createServer({
      db,
      storage,
      pluginRegistry,
    });

    await server.ready();

    // Register user and get auth token (needed for project creation)
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);
    const registerResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `test-avatar-proxy-${timestamp}-${randomId}@example.com`,
        password: 'password123',
      },
    });
    const authToken = registerResponse.json().data.access_token;

    // Create test project
    const projectResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: {
        name: 'Test Project for Avatar Proxy',
        settings: {},
      },
    });
    testProjectId = projectResponse.json().data.id;

    // Create test integration with Jira instance URL (no encrypted credentials needed for mock)
    const integrationResult = await db.query<{ id: string }>(createProjectIntegrationSQL(), [
      testProjectId,
      'jira',
      true,
      JSON.stringify({ instanceUrl: 'https://test.atlassian.net' }),
      null, // No encrypted credentials needed for mock plugin
    ]);
    testIntegrationId = integrationResult.rows[0].id;
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
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('GET /api/v1/integrations/:integrationId/avatar-proxy', () => {
    it('should proxy avatar successfully with valid integration and URL', async () => {
      const avatarUrl = 'https://test.atlassian.net/secure/useravatar?size=small&ownerId=user123';
      const imageBuffer = Buffer.from('fake-image-data');

      // Mock successful fetch with ReadableStream (mimics real fetch API)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['content-type', 'image/png']]),
        body: createReadableStream(imageBuffer),
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
          avatarUrl
        )}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toBe('public, max-age=86400');
      expect(mockFetch).toHaveBeenCalledWith(
        avatarUrl,
        expect.objectContaining({
          headers: {
            'User-Agent': 'BugSpotter-Avatar-Proxy/1.0',
          },
        })
      );
    });

    it('should be a public endpoint (no authentication required)', async () => {
      const avatarUrl = 'https://test.atlassian.net/secure/useravatar?size=small&ownerId=user456';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['content-type', 'image/jpeg']]),
        body: createReadableStream(Buffer.from('image-data')),
      });

      // No Authorization header
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
          avatarUrl
        )}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/jpeg');
    });

    it('should return 404 when integration not found', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const avatarUrl = 'https://test.atlassian.net/secure/useravatar?size=small&ownerId=user789';

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/${nonExistentId}/avatar-proxy?url=${encodeURIComponent(
          avatarUrl
        )}`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('NotFound');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return 400 when URL parameter is missing', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('BadRequest');
      expect(response.json().message).toContain('Avatar URL parameter required');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    describe('SSRF Protection', () => {
      it('should block file:// protocol', async () => {
        const maliciousUrl = 'file:///etc/passwd';

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            maliciousUrl
          )}`,
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().message).toContain('Protocol not allowed');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should block ftp:// protocol', async () => {
        const maliciousUrl = 'ftp://internal-server/file.txt';

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            maliciousUrl
          )}`,
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().message).toContain('Protocol not allowed');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should block localhost access', async () => {
        const maliciousUrl = 'http://localhost:9200/admin';

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            maliciousUrl
          )}`,
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().message).toContain('internal/private networks');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should block 127.0.0.1 access', async () => {
        const maliciousUrl = 'http://127.0.0.1:8080/internal';

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            maliciousUrl
          )}`,
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().message).toContain('internal/private networks');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should block private IP range 10.x.x.x', async () => {
        const maliciousUrl = 'http://10.0.0.1/admin';

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            maliciousUrl
          )}`,
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().message).toMatch(/private|10\.0\.0\.1/i);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should block private IP range 192.168.x.x', async () => {
        const maliciousUrl = 'http://192.168.1.1/router-admin';

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            maliciousUrl
          )}`,
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().message).toMatch(/private|192\.168/i);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should block cloud metadata endpoint 169.254.169.254', async () => {
        const maliciousUrl = 'http://169.254.169.254/latest/meta-data/';

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            maliciousUrl
          )}`,
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().message).toMatch(/metadata|169\.254/i);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should block URLs with octal IP encoding', async () => {
        const maliciousUrl = 'http://0177.0.0.1/'; // Octal for 127.0.0.1

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            maliciousUrl
          )}`,
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().message).toContain('Alternative IP address formats');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should block hostname mismatch with integration domain', async () => {
        const maliciousUrl = 'https://attacker.com/fake-avatar.png';

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            maliciousUrl
          )}`,
        });

        expect(response.statusCode).toBe(403);
        expect(response.json().error).toBe('Forbidden');
        expect(response.json().message).toContain('URL hostname not allowed');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should allow URLs from the configured Jira instance', async () => {
        const validUrl = 'https://test.atlassian.net/secure/useravatar?size=xsmall&ownerId=abc';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'image/png']]),
          body: createReadableStream(Buffer.from('valid-image')),
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            validUrl
          )}`,
        });

        expect(response.statusCode).toBe(200);
        expect(mockFetch).toHaveBeenCalledWith(validUrl, expect.any(Object));
      });

      it('should allow Gravatar URLs for Jira integration', async () => {
        const gravatarUrl =
          'https://secure.gravatar.com/avatar/9fe43271a13a0291d2bb6883f98b942d?d=https%3A%2F%2Favatar-management--avatars.us-west-2.prod.public.atl-paas.net%2Finitials%2FAB-0.png';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'image/jpeg']]),
          body: createReadableStream(Buffer.from('gravatar-image')),
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            gravatarUrl
          )}`,
        });

        expect(response.statusCode).toBe(200);
        expect(mockFetch).toHaveBeenCalledWith(gravatarUrl, expect.any(Object));
      });

      it('should allow Atlassian avatar service URLs for Jira integration', async () => {
        const atlassianAvatarUrl =
          'https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/initials/AB-0.png';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'image/png']]),
          body: createReadableStream(Buffer.from('atlassian-avatar')),
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            atlassianAvatarUrl
          )}`,
        });

        expect(response.statusCode).toBe(200);
        expect(mockFetch).toHaveBeenCalledWith(atlassianAvatarUrl, expect.any(Object));
      });

      // Wildcard domain edge cases for *.atlassian.net
      it('should allow single-level subdomain of atlassian.net (foo.atlassian.net)', async () => {
        const subdomainUrl = 'https://foo.atlassian.net/secure/useravatar?ownerId=user1';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'image/png']]),
          body: createReadableStream(Buffer.from('subdomain-image')),
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            subdomainUrl
          )}`,
        });

        expect(response.statusCode).toBe(200);
        expect(mockFetch).toHaveBeenCalledWith(subdomainUrl, expect.any(Object));
      });

      it('should block bare domain atlassian.net (wildcard should NOT match bare domain)', async () => {
        const bareDomainUrl = 'https://atlassian.net/secure/useravatar?ownerId=user1';

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            bareDomainUrl
          )}`,
        });

        expect(response.statusCode).toBe(403);
        expect(response.json().error).toBe('Forbidden');
        expect(response.json().message).toContain('URL hostname not allowed');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should block domain that ends with but is not a subdomain of atlassian.net (evilatlassian.net)', async () => {
        const maliciousUrl = 'https://evilatlassian.net/fake-avatar.png';

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            maliciousUrl
          )}`,
        });

        expect(response.statusCode).toBe(403);
        expect(response.json().error).toBe('Forbidden');
        expect(response.json().message).toContain('URL hostname not allowed');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should allow multi-level subdomains of atlassian.net (foo.bar.atlassian.net)', async () => {
        const multiLevelUrl = 'https://foo.bar.atlassian.net/secure/useravatar?ownerId=user1';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'image/png']]),
          body: createReadableStream(Buffer.from('multi-level-image')),
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            multiLevelUrl
          )}`,
        });

        expect(response.statusCode).toBe(200);
        expect(mockFetch).toHaveBeenCalledWith(multiLevelUrl, expect.any(Object));
      });

      // Wildcard domain edge cases for *.atl-paas.net
      it('should allow single-level subdomain of atl-paas.net (api.atl-paas.net)', async () => {
        const subdomainUrl = 'https://api.atl-paas.net/avatar.png';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'image/png']]),
          body: createReadableStream(Buffer.from('paas-subdomain-image')),
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            subdomainUrl
          )}`,
        });

        expect(response.statusCode).toBe(200);
        expect(mockFetch).toHaveBeenCalledWith(subdomainUrl, expect.any(Object));
      });

      it('should block bare domain atl-paas.net (wildcard should NOT match bare domain)', async () => {
        const bareDomainUrl = 'https://atl-paas.net/avatar.png';

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            bareDomainUrl
          )}`,
        });

        expect(response.statusCode).toBe(403);
        expect(response.json().error).toBe('Forbidden');
        expect(response.json().message).toContain('URL hostname not allowed');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should allow multi-level subdomains of atl-paas.net (prod.public.atl-paas.net)', async () => {
        const multiLevelUrl = 'https://prod.public.atl-paas.net/avatar.png';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'image/png']]),
          body: createReadableStream(Buffer.from('paas-multi-level-image')),
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            multiLevelUrl
          )}`,
        });

        expect(response.statusCode).toBe(200);
        expect(mockFetch).toHaveBeenCalledWith(multiLevelUrl, expect.any(Object));
      });
    });

    describe('External Fetch Handling', () => {
      it('should return error when external fetch fails (404)', async () => {
        const avatarUrl = 'https://test.atlassian.net/secure/useravatar?size=small&ownerId=missing';

        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Map(),
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            avatarUrl
          )}`,
        });

        expect(response.statusCode).toBe(502);
        expect(response.json().error).toBe('BadGateway');
        expect(response.json().message).toContain('Failed to fetch avatar');
      });

      it('should return error when external fetch fails (500)', async () => {
        const avatarUrl =
          'https://test.atlassian.net/secure/useravatar?size=small&ownerId=error-user';

        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Map(),
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            avatarUrl
          )}`,
        });

        expect(response.statusCode).toBe(502);
        expect(response.json().error).toBe('BadGateway');
        expect(response.json().message).toContain('Failed to fetch avatar');
      });

      it('should handle DNS resolution failure (ENOTFOUND)', async () => {
        const avatarUrl =
          'https://test.atlassian.net/secure/useravatar?size=small&ownerId=dns-fail';

        const dnsError = new Error('getaddrinfo ENOTFOUND test.atlassian.net');
        (dnsError as any).code = 'ENOTFOUND';
        mockFetch.mockRejectedValueOnce(dnsError);

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            avatarUrl
          )}`,
        });

        expect(response.statusCode).toBe(500);
        expect(response.json().error).toBe('InternalServerError');
        expect(response.json().message).toBeDefined();
        // Should not expose internal error details
        expect(response.json().message).not.toContain('ENOTFOUND');
      });

      it('should handle connection timeout (ETIMEDOUT)', async () => {
        const avatarUrl = 'https://test.atlassian.net/secure/useravatar?size=small&ownerId=timeout';

        const timeoutError = new Error('connect ETIMEDOUT');
        (timeoutError as any).code = 'ETIMEDOUT';
        mockFetch.mockRejectedValueOnce(timeoutError);

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            avatarUrl
          )}`,
        });

        expect(response.statusCode).toBe(500);
        expect(response.json().error).toBe('InternalServerError');
        expect(response.json().message).toBeDefined();
        // Should not expose internal error details
        expect(response.json().message).not.toContain('ETIMEDOUT');
      });

      it('should handle connection refused (ECONNREFUSED)', async () => {
        const avatarUrl = 'https://test.atlassian.net/secure/useravatar?size=small&ownerId=refused';

        const refusedError = new Error('connect ECONNREFUSED');
        (refusedError as any).code = 'ECONNREFUSED';
        mockFetch.mockRejectedValueOnce(refusedError);

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            avatarUrl
          )}`,
        });

        expect(response.statusCode).toBe(500);
        expect(response.json().error).toBe('InternalServerError');
        expect(response.json().message).toBeDefined();
        // Should not expose internal error details
        expect(response.json().message).not.toContain('ECONNREFUSED');
      });

      it('should handle generic network errors', async () => {
        const avatarUrl =
          'https://test.atlassian.net/secure/useravatar?size=small&ownerId=network-error';

        mockFetch.mockRejectedValueOnce(new Error('Network request failed'));

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            avatarUrl
          )}`,
        });

        expect(response.statusCode).toBe(500);
        expect(response.json().error).toBe('InternalServerError');
        expect(response.json().message).toBeDefined();
      });
    });

    describe('Response Headers', () => {
      it('should set correct content-type from external response', async () => {
        const avatarUrl = 'https://test.atlassian.net/secure/useravatar?size=medium&ownerId=jpeg';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'image/jpeg']]),
          body: createReadableStream(Buffer.from('jpeg-data')),
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            avatarUrl
          )}`,
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('image/jpeg');
      });

      it('should default to image/png when content-type is missing', async () => {
        const avatarUrl = 'https://test.atlassian.net/secure/useravatar?size=large&ownerId=noct';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map(),
          body: createReadableStream(Buffer.from('image-data')),
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            avatarUrl
          )}`,
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('image/png');
      });

      it('should set 24-hour cache headers', async () => {
        const avatarUrl = 'https://test.atlassian.net/secure/useravatar?size=xlarge&ownerId=cache';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'image/png']]),
          body: createReadableStream(Buffer.from('cached-image')),
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            avatarUrl
          )}`,
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('public, max-age=86400');
      });

      it('should not include CORS headers (not needed for img tags)', async () => {
        const avatarUrl = 'https://test.atlassian.net/secure/useravatar?size=small&ownerId=cors';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'image/png']]),
          body: createReadableStream(Buffer.from('image-data')),
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            avatarUrl
          )}`,
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
      });
    });

    describe('Streaming Behavior', () => {
      it('should stream response body directly (no buffering)', async () => {
        const avatarUrl = 'https://test.atlassian.net/secure/useravatar?size=xxl&ownerId=stream';
        const largeImageBuffer = Buffer.alloc(5 * 1024 * 1024); // 5MB

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'image/png']]),
          body: createReadableStream(largeImageBuffer),
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            avatarUrl
          )}`,
        });

        expect(response.statusCode).toBe(200);
        // Verify fetch was called (streaming happens internally)
        expect(mockFetch).toHaveBeenCalledWith(
          avatarUrl,
          expect.objectContaining({
            headers: {
              'User-Agent': 'BugSpotter-Avatar-Proxy/1.0',
            },
          })
        );
      });
    });

    describe('Edge Cases', () => {
      it('should handle URL with special characters', async () => {
        const avatarUrl =
          'https://test.atlassian.net/secure/useravatar?size=small&ownerId=user%20with%20spaces';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'image/png']]),
          body: createReadableStream(Buffer.from('image-data')),
        });

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            avatarUrl
          )}`,
        });

        expect(response.statusCode).toBe(200);
      });

      it('should handle invalid URL format', async () => {
        const invalidUrl = 'not-a-valid-url';

        const response = await server.inject({
          method: 'GET',
          url: `/api/v1/integrations/${testIntegrationId}/avatar-proxy?url=${encodeURIComponent(
            invalidUrl
          )}`,
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().message).toContain('Invalid URL');
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });
  });

  describe('GET /api/v1/integrations/:platform/:projectId/users (Avatar URL Validation)', () => {
    it('should handle users with invalid avatar URLs gracefully', async () => {
      // Create auth token and user for the test
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(7);
      const registerResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: `avatar-url-test-${timestamp}-${randomId}@example.com`,
          password: 'password123',
        },
      });
      const authToken = registerResponse.json().data.access_token;
      const userId = registerResponse.json().data.user.id;

      // Add user as project member with owner role
      await db.projectMembers.addMember(testProjectId, userId, 'owner');

      // Search for user with invalid avatar URLs
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/integrations/jira/${testProjectId}/users?query=invalid-avatar-test`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = response.json();
      expect(result.data.users).toHaveLength(1);

      const user = result.data.users[0];
      expect(user.accountId).toBe('user-with-invalid-avatar');
      expect(user.displayName).toBe('Invalid Avatar User');
      expect(user.emailAddress).toBe('invalid@example.com');

      // Invalid URLs should be skipped, only valid one should be proxied
      expect(user.avatarUrls).toBeDefined();
      expect(user.avatarUrls['16x16']).toBeUndefined(); // Invalid: 'not-a-valid-url'
      expect(user.avatarUrls['24x24']).toBeUndefined(); // Invalid: 'also-invalid'
      expect(user.avatarUrls['32x32']).toBeDefined(); // Valid URL
      expect(user.avatarUrls['32x32']).toContain('/avatar-proxy?url=');
    });
  });
});
