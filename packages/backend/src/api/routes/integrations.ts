/**
 * Integration routes
 * Generic API endpoints for external platform integrations (Jira, GitHub, etc.)
 * Works with any integration plugin through the plugin registry
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import { sendSuccess, sendCreated } from '../utils/response.js';
import { AppError } from '../middleware/error.js';
import { requireAuth, requireProjectRole } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/project-access.js';
import type { PluginRegistry } from '../../integrations/plugin-registry.js';
import { getEncryptionService } from '../../utils/encryption.js';
import { getLogger } from '../../logger.js';
import { validateSSRFProtection } from '../../integrations/security/ssrf-validator.js';

const logger = getLogger();

/**
 * Helper function to load a plugin and throw appropriate error if not found
 */
async function loadPluginOrThrow(registry: PluginRegistry, platform: string) {
  try {
    return await registry.loadDynamicPlugin(platform);
  } catch (error) {
    throw new AppError(
      `Integration platform '${platform}' not supported`,
      400,
      'BadRequest',
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Register integration routes
 */
export async function registerIntegrationRoutes(
  server: FastifyInstance,
  db: DatabaseClient,
  registry: PluginRegistry
): Promise<void> {
  const encryptionService = getEncryptionService();

  /**
   * List available integration platforms
   * GET /api/v1/integrations/platforms
   */
  server.get('/api/v1/integrations/platforms', async (request, reply) => {
    if (!request.authUser && !request.apiKey) {
      throw new AppError('Authentication required', 401, 'Unauthorized');
    }

    const platforms = registry.listPlugins();
    return sendSuccess(reply, platforms);
  });

  /**
   * Test integration connection with provided config
   * POST /api/v1/integrations/:platform/test
   */
  server.post<{ Params: { platform: string }; Body: Record<string, unknown> }>(
    '/api/v1/integrations/:platform/test',
    async (request, reply) => {
      if (!request.authUser && !request.apiKey) {
        throw new AppError('Authentication required', 401, 'Unauthorized');
      }

      const { platform } = request.params;
      const config = request.body;

      // Load plugin (supports database plugins via dynamic loading)
      const service = await loadPluginOrThrow(registry, platform);

      logger.info('Testing integration connection', {
        platform,
        userId: request.authUser?.id || 'api-key',
      });

      const result = await service.validateConfig(config);

      return sendSuccess(reply, result);
    }
  );

  /**
   * List projects on the external platform using caller-provided credentials.
   * POST /api/v1/integrations/:platform/projects
   *
   * Mirrors `/test` shape (flat config in body, no projectId): the signup
   * wizard calls this after "Test Connection" passes but before the
   * integration row exists in the DB, so credentials come from the
   * request, not from decryption. Authenticated users only — the route
   * performs an outbound HTTPS call to the platform.
   */
  server.post<{
    Params: { platform: string };
    Body: Record<string, unknown>;
    Querystring: { query?: string; maxResults?: string };
  }>('/api/v1/integrations/:platform/projects', async (request, reply) => {
    if (!request.authUser && !request.apiKey) {
      throw new AppError('Authentication required', 401, 'Unauthorized');
    }

    const { platform } = request.params;
    const config = request.body;
    const { query, maxResults: maxResultsRaw } = request.query;

    let maxResults: number | undefined;
    if (maxResultsRaw !== undefined && maxResultsRaw !== '') {
      // `parseInt` is too permissive — it accepts `"10.5"` (→ 10) and
      // `"10abc"` (→ 10). Match whole strings of digits only so the
      // error message "must be a positive integer" stays honest.
      if (!/^\d+$/.test(maxResultsRaw)) {
        throw new AppError('`maxResults` must be a positive integer', 400, 'BadRequest');
      }
      const parsed = Number(maxResultsRaw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new AppError('`maxResults` must be a positive integer', 400, 'BadRequest');
      }
      maxResults = parsed;
    }

    const service = await loadPluginOrThrow(registry, platform);

    if (!service.listProjects || typeof service.listProjects !== 'function') {
      throw new AppError(
        `Project listing not supported for ${platform} integration`,
        400,
        'BadRequest'
      );
    }

    logger.info('Listing projects for integration', {
      platform,
      userId: request.authUser?.id || 'api-key',
      hasQuery: !!query,
      maxResults,
    });

    const projects = await service.listProjects(config, query, maxResults);

    return sendSuccess(reply, { projects });
  });

  /**
   * Save integration configuration for project
   * POST /api/v1/integrations/:platform/:projectId
   */
  server.post<{
    Params: { platform: string; projectId: string };
    Body: {
      config: Record<string, unknown>;
      credentials: Record<string, unknown>;
      enabled?: boolean;
    };
  }>(
    '/api/v1/integrations/:platform/:projectId',
    {
      preHandler: [
        requireAuth,
        requireProjectAccess(db, { paramName: 'projectId' }),
        requireProjectRole('admin'),
      ],
    },
    async (request, reply) => {
      const { platform, projectId } = request.params;
      const { config, credentials: rawCredentials, enabled = true } = request.body;
      const credentials =
        rawCredentials && typeof rawCredentials === 'object' && !Array.isArray(rawCredentials)
          ? rawCredentials
          : {};

      // Load plugin to validate it exists (supports database plugins)
      await loadPluginOrThrow(registry, platform);

      logger.info('Saving integration configuration', {
        platform,
        projectId,
        userId: request.authUser?.id || 'api-key',
      });

      // Merge partial credentials with existing saved credentials
      const existing = await db.projectIntegrations.findByProjectAndPlatform(projectId, platform);
      let encryptedCredentials: string;

      if (Object.keys(credentials).length > 0) {
        let mergedCredentials = credentials;
        if (existing?.encrypted_credentials) {
          try {
            const decrypted = encryptionService.decrypt(existing.encrypted_credentials);
            if (decrypted) {
              const existingCreds = JSON.parse(decrypted);
              if (
                existingCreds &&
                typeof existingCreds === 'object' &&
                !Array.isArray(existingCreds)
              ) {
                mergedCredentials = { ...existingCreds, ...credentials };
              }
            }
          } catch (error) {
            logger.error('Failed to decrypt existing credentials during merge', {
              platform,
              projectId,
              error: error instanceof Error ? error.message : String(error),
            });
            throw new AppError(
              'Unable to merge credentials: failed to decrypt existing credentials. Please retry or provide all credential fields.',
              500,
              'InternalServerError'
            );
          }
        }
        encryptedCredentials = encryptionService.encrypt(JSON.stringify(mergedCredentials));
      } else {
        // Empty credentials object: preserve existing credentials (config-only update)
        encryptedCredentials =
          existing?.encrypted_credentials ?? encryptionService.encrypt(JSON.stringify({}));
      }

      // Save to database using repository
      await db.projectIntegrations.upsert(projectId, platform, {
        enabled,
        config,
        encrypted_credentials: encryptedCredentials,
      });

      return sendCreated(reply, { message: `${platform} configuration saved successfully` });
    }
  );

  /**
   * Get integration configuration for project
   * GET /api/v1/integrations/:platform/:projectId
   */
  server.get<{ Params: { platform: string; projectId: string } }>(
    '/api/v1/integrations/:platform/:projectId',
    {
      preHandler: [requireAuth, requireProjectAccess(db, { paramName: 'projectId' })],
    },
    async (request, reply) => {
      const { platform, projectId } = request.params;

      // Check if platform is supported
      if (!registry.isSupported(platform)) {
        throw new AppError(`Integration platform '${platform}' not supported`, 400, 'BadRequest');
      }

      // Load from database
      const integration = await db.projectIntegrations.findByProjectAndPlatform(
        projectId,
        platform
      );

      if (!integration) {
        return sendSuccess(reply, null);
      }

      // Extract credential hints (masked previews) so the UI knows what's configured
      const CREDENTIAL_MASK = '••••••••';
      const credentialHints: Record<string, string> = {};
      if (integration.encrypted_credentials) {
        try {
          const decrypted = encryptionService.decrypt(integration.encrypted_credentials);
          if (decrypted) {
            const parsed = JSON.parse(decrypted);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              for (const [key, value] of Object.entries(parsed)) {
                if (value == null || value === '') {
                  continue;
                }
                const strValue = String(value);
                if (key === 'email') {
                  // Mask email for PII protection (e.g. u***r@example.com)
                  const lastAt = strValue.lastIndexOf('@');
                  if (lastAt > 0 && lastAt < strValue.length - 1) {
                    const user = strValue.substring(0, lastAt);
                    const domain = strValue.substring(lastAt + 1);
                    credentialHints[key] =
                      user.length > 2
                        ? user[0] + '***' + user[user.length - 1] + '@' + domain
                        : user[0] + '***@' + domain;
                  } else {
                    credentialHints[key] = CREDENTIAL_MASK;
                  }
                } else if (key === 'apiToken') {
                  // Show first 4 chars + masked rest
                  credentialHints[key] =
                    strValue.length >= 4 ? strValue.slice(0, 4) + CREDENTIAL_MASK : CREDENTIAL_MASK;
                } else {
                  // Fully masked for passwords and other secrets
                  credentialHints[key] = CREDENTIAL_MASK;
                }
              }
            }
          }
        } catch (error) {
          logger.error('Failed to decrypt credentials for credential_hints extraction', {
            platform,
            projectId,
            error: error instanceof Error ? error.message : String(error),
          });
          throw new AppError(
            'Failed to decrypt integration credentials',
            500,
            'InternalServerError'
          );
        }
      }

      return sendSuccess(reply, {
        platform: integration.integration_type,
        enabled: integration.enabled,
        config: integration.config,
        credential_hints: credentialHints,
        // Backwards compatibility: credential_keys derived from credential_hints
        credential_keys: Object.keys(credentialHints),
      });
    }
  );

  /**
   * Update integration status (enable/disable)
   * PATCH /api/v1/integrations/:platform/:projectId
   */
  server.patch<{ Params: { platform: string; projectId: string }; Body: { enabled: boolean } }>(
    '/api/v1/integrations/:platform/:projectId',
    {
      preHandler: [
        requireAuth,
        requireProjectAccess(db, { paramName: 'projectId' }),
        requireProjectRole('admin'),
      ],
    },
    async (request, reply) => {
      const { platform, projectId } = request.params;
      const { enabled } = request.body;

      // Check if platform is supported
      if (!registry.isSupported(platform)) {
        throw new AppError(`Integration platform '${platform}' not supported`, 400, 'BadRequest');
      }

      logger.info('Updating integration status', {
        platform,
        projectId,
        enabled,
        userId: request.authUser?.id || 'api-key',
      });

      const updated = await db.projectIntegrations.setEnabled(projectId, platform, enabled);

      if (!updated) {
        throw new AppError(`${platform} integration not found for project`, 404, 'NotFound');
      }

      return sendSuccess(reply, {
        message: `${platform} integration ${enabled ? 'enabled' : 'disabled'} successfully`,
      });
    }
  );

  /**
   * Delete integration configuration
   * DELETE /api/v1/integrations/:platform/:projectId
   */
  server.delete<{ Params: { platform: string; projectId: string } }>(
    '/api/v1/integrations/:platform/:projectId',
    {
      preHandler: [
        requireAuth,
        requireProjectAccess(db, { paramName: 'projectId' }),
        requireProjectRole('admin'),
      ],
    },
    async (request, reply) => {
      const { platform, projectId } = request.params;

      // Check if platform is supported
      if (!registry.isSupported(platform)) {
        throw new AppError(`Integration platform '${platform}' not supported`, 400, 'BadRequest');
      }

      logger.info('Deleting integration configuration', {
        platform,
        projectId,
        userId: request.authUser?.id || 'api-key',
      });

      const deleted = await db.projectIntegrations.deleteByProjectAndPlatform(projectId, platform);

      if (!deleted) {
        throw new AppError(`${platform} integration not found for project`, 404, 'NotFound');
      }

      return sendSuccess(reply, {
        message: `${platform} configuration deleted successfully`,
      });
    }
  );

  /**
   * Search for users in external integration platform
   * GET /api/v1/integrations/:platform/:projectId/users?query=email@example.com
   * Currently supports: jira
   */
  server.get<{
    Params: { platform: string; projectId: string };
    Querystring: { query: string; maxResults?: string };
  }>(
    '/api/v1/integrations/:platform/:projectId/users',
    {
      preHandler: [requireAuth, requireProjectAccess(db, { paramName: 'projectId' })],
    },
    async (request, reply) => {
      const { platform, projectId } = request.params;
      const { query, maxResults } = request.query;

      if (!query || query.trim().length === 0) {
        throw new AppError('Search query is required', 400, 'BadRequest');
      }
      // Get integration configuration
      const integration = await db.projectIntegrations.findByProjectAndPlatform(
        projectId,
        platform
      );
      if (!integration) {
        throw new AppError(
          `${platform} integration not configured for this project`,
          404,
          'NotFound'
        );
      }

      // Decrypt credentials
      let credentials: Record<string, unknown> = {};
      if (integration.encrypted_credentials) {
        try {
          const decryptedString = encryptionService.decrypt(integration.encrypted_credentials);
          if (decryptedString) {
            credentials = JSON.parse(decryptedString);
          }
        } catch (error) {
          throw new AppError(
            'Failed to decrypt integration credentials',
            500,
            'InternalServerError',
            error instanceof Error ? error : undefined
          );
        }
      }

      // Merge config with credentials
      const fullConfig = { ...integration.config, ...credentials };

      // Load plugin
      const service = await loadPluginOrThrow(registry, platform);

      // Check if plugin supports user search
      if (!service.searchUsers || typeof service.searchUsers !== 'function') {
        throw new AppError(
          `User search not supported for ${platform} integration`,
          400,
          'BadRequest'
        );
      }

      logger.info('Searching users in integration', {
        platform,
        projectId,
        userId: request.authUser?.id || 'api-key',
        queryLength: query.length,
      });

      // Call the service's searchUsers method
      const users = await service.searchUsers(
        fullConfig,
        query,
        maxResults ? parseInt(maxResults, 10) : undefined
      );

      // Transform avatar URLs to use proxy endpoint
      const usersWithProxiedAvatars = users.map((user) => {
        if (user.avatarUrls) {
          const proxiedAvatarUrls: Record<string, string> = {};
          for (const [size, url] of Object.entries(user.avatarUrls)) {
            // Validate URL before encoding (defense in depth)
            try {
              new URL(url); // Throws if invalid
              const encodedUrl = encodeURIComponent(url);
              proxiedAvatarUrls[size] =
                `/api/v1/integrations/${integration.id}/avatar-proxy?url=${encodedUrl}`;
            } catch (error) {
              logger.warn('Skipping invalid avatar URL from external API', {
                platform,
                size,
                url: url.substring(0, 100), // Truncate for logging
                error: error instanceof Error ? error.message : String(error),
              });
              // Skip this avatar size if URL is invalid
            }
          }
          return { ...user, avatarUrls: proxiedAvatarUrls };
        }
        return user;
      });

      return sendSuccess(reply, { users: usersWithProxiedAvatars });
    }
  );

  /**
   * Proxy avatar images from external integrations (e.g., Jira)
   * GET /api/v1/integrations/:integrationId/avatar-proxy?url=<encoded-url>
   *
   * Security: Public endpoint (no auth) - access control enforced through domain validation
   * Note: Authentication is not needed because the URL hostname is validated against the
   * integration's configured domain (instanceUrl), preventing unauthorized access to avatars
   * from other instances. This domain-based security model is more appropriate than user
   * authentication for this use case.
   */
  server.get<{
    Params: { integrationId: string };
    Querystring: { url: string };
  }>(
    '/api/v1/integrations/:integrationId/avatar-proxy',
    { config: { public: true } },
    async (request, reply) => {
      const { integrationId } = request.params;
      const { url } = request.query;

      if (!url) {
        throw new AppError('Avatar URL parameter required', 400, 'BadRequest');
      }

      // Fetch integration to verify it exists and get allowed domain
      const integration = await db.projectIntegrations.findByIdWithType(integrationId);
      if (!integration) {
        throw new AppError('Integration not found', 404, 'NotFound');
      }

      // SSRF Protection: Comprehensive validation (protocol, IP ranges, cloud metadata)
      let validatedUrl: URL;
      try {
        validatedUrl = validateSSRFProtection(url);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'URL validation failed';
        logger.warn('SSRF protection blocked request', {
          integrationId,
          url,
          error: message,
        });
        throw new AppError(`Invalid URL: ${message}`, 400, 'BadRequest');
      }

      // Additional validation: hostname must match integration's allowed domains
      const instanceUrl = integration.config?.instanceUrl;
      if (!instanceUrl || typeof instanceUrl !== 'string') {
        throw new AppError(
          'Integration missing valid instanceUrl configuration',
          500,
          'InternalServerError'
        );
      }

      // Load plugin to get allowed avatar domains
      const service = await loadPluginOrThrow(registry, integration.integration_type);

      // Get allowed avatar domains from plugin (or fall back to instanceUrl hostname only)
      let allowedDomains: string[];
      if (service.getAllowedAvatarDomains) {
        allowedDomains = service.getAllowedAvatarDomains(integration.config);
      } else {
        // Fallback: only allow instanceUrl hostname
        try {
          const configUrl = new URL(instanceUrl);
          allowedDomains = [configUrl.hostname];
        } catch {
          throw new AppError(
            'Invalid instanceUrl in integration config',
            500,
            'InternalServerError'
          );
        }
      }

      // Validate request URL hostname matches one of the allowed domains
      const requestedHostname = validatedUrl.hostname;
      const isAllowed = allowedDomains.some((domain) => {
        // Support wildcard domains (e.g., *.atlassian.net)
        // Wildcard only matches subdomains, NOT the bare domain
        if (domain.startsWith('*.')) {
          const baseDomain = domain.slice(2); // Remove '*.'
          return requestedHostname.endsWith('.' + baseDomain);
        }
        return requestedHostname === domain;
      });

      if (!isAllowed) {
        logger.warn('SSRF attempt detected - hostname not in allowed domains', {
          integrationId,
          requestedHostname,
          allowedDomains,
        });
        throw new AppError(
          `URL hostname not allowed. Must be from: ${allowedDomains.join(', ')}`,
          403,
          'Forbidden'
        );
      }

      logger.debug('Proxying avatar request', {
        integrationId,
        hostname: validatedUrl.hostname,
      });

      // Fetch avatar from validated external source
      let response: Response;
      try {
        response = await fetch(validatedUrl.toString(), {
          headers: {
            'User-Agent': 'BugSpotter-Avatar-Proxy/1.0',
          },
        });
      } catch (error) {
        logger.error('Network error fetching avatar from external service', {
          integrationId,
          url: validatedUrl.toString(), // Full URL for debugging (already validated)
          hostname: validatedUrl.hostname,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new AppError(
          'Failed to fetch avatar from external service',
          500,
          'InternalServerError'
        );
      }

      if (!response.ok) {
        logger.warn('Avatar fetch failed from external service', {
          integrationId,
          externalStatus: response.status,
          externalStatusText: response.statusText,
        });
        throw new AppError('Failed to fetch avatar from external service', 502, 'BadGateway');
      }

      const contentType = response.headers.get('content-type') || 'image/png';

      // Set cache headers (24 hours)
      reply.header('Content-Type', contentType);
      reply.header('Cache-Control', 'public, max-age=86400');

      // Stream response directly - no memory buffering
      // Note: No CORS header needed - <img> tags load cross-origin by default
      return reply.send(response.body);
    }
  );

  logger.info('Integration routes registered', {
    supportedPlatforms: registry.listPlugins().map((p: { platform: string }) => p.platform),
  });
}
