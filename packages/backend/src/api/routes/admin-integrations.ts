/**
 * Admin Integration Management API Routes
 * Admin-only endpoints for configuring and managing third-party integrations
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { Integration } from '../../db/repositories/integration.repository.js';
import type { PluginRegistry } from '../../integrations/plugin-registry.js';
import { randomBytes } from 'crypto';
import { getLogger } from '../../logger.js';
import { requirePlatformAdmin } from '../middleware/auth.js';
import { sendSuccess, sendCreated, sendPaginated } from '../utils/response.js';
import { CodeSecurityAnalyzer } from '../../integrations/security/index.js';
import { AppError } from '../middleware/error.js';
import { extractJsonObject, extractFunctionBody } from '../utils/code-parsing.js';

type PluginSource = Integration['plugin_source'];
type TrustLevel = Integration['trust_level'];
type IntegrationStatus = Integration['status'];

const logger = getLogger();
const securityAnalyzer = new CodeSecurityAnalyzer();

interface ListIntegrationsQuery {
  status?: IntegrationStatus;
  page?: number;
  limit?: number;
}

interface ActivityLogQuery {
  integration_type?: string;
  bug_id?: string;
  status?: 'pending' | 'success' | 'failed' | 'skipped';
  action?: 'create' | 'update' | 'sync' | 'test' | 'error';
  page?: number;
  limit?: number;
}

// Maximum number of integrations allowed
const MAX_INTEGRATIONS = 10;

// Maximum plugin code size (1MB)
const MAX_PLUGIN_CODE_SIZE = 1024 * 1024;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate full plugin code from user-provided parts
 * Simplifies plugin creation by wrapping user code in proper plugin structure
 *
 * ⚠️ WARNING: TIGHTLY COUPLED WITH parsePluginCode() ⚠️
 *
 * This function generates plugin code with specific formatting, comments, and indentation
 * that parsePluginCode() depends on for deconstructing code back into guided mode parts.
 *
 * DO NOT modify any of the following without updating parsePluginCode():
 * - Comment markers: "// Basic Authentication Helper", "// User-provided ticket creation logic", etc.
 * - Indentation constants: AUTH_INDENT, USER_CODE_INDENT (currently 6 spaces)
 * - Code structure: metadata object placement, function signatures, etc.
 *
 * Any formatting changes here will break the guided mode editor's ability to parse
 * existing plugin code. Consider this a tightly-coupled pair of functions.
 *
 * For a more robust long-term solution, consider using an Abstract Syntax Tree (AST)
 * parser (e.g., @babel/parser), though this adds significant complexity.
 *
 * @param parts - Structured plugin components
 * @returns Complete plugin code with module.exports and factory pattern
 */
function generatePluginCode(parts: {
  metadata: {
    name: string;
    platform: string;
    version: string;
    description?: string;
    author?: string;
  };
  authType?: 'basic' | 'bearer' | 'api_key' | 'custom';
  createTicketBody: string;
  testConnectionBody?: string;
  validateConfigBody?: string;
}): string {
  // Indentation constants for generated code structure
  const AUTH_INDENT = '      ';
  const USER_CODE_INDENT = '      ';
  const NEWLINE_REPLACEMENT = `\n${USER_CODE_INDENT}`;

  // Generate authentication helper based on type
  let authHelper = '';
  switch (parts.authType) {
    case 'basic':
      authHelper = `${AUTH_INDENT}// Basic Authentication Helper (auto-generated)
${AUTH_INDENT}const auth = Buffer.from(
${AUTH_INDENT}  context.config.email + ':' + context.config.apiToken
${AUTH_INDENT}).toString('base64');`;
      break;
    case 'bearer':
      authHelper = `${AUTH_INDENT}// Bearer Token Helper (auto-generated)
${AUTH_INDENT}const auth = context.config.apiToken;`;
      break;
    case 'api_key':
      authHelper = `${AUTH_INDENT}// API Key Helper (auto-generated)
${AUTH_INDENT}const apiKey = context.config.apiKey;`;
      break;
    case 'custom':
      // No auto-generated helper for custom auth
      break;
  }

  // Build the complete plugin code
  const code = `module.exports = {
  metadata: ${JSON.stringify(parts.metadata, null, 2)},
  
  factory: (context) => ({
    platform: '${parts.metadata.platform}',
    
    createTicket: async (bugReport, projectId, integrationId, metadata) => {
${authHelper ? authHelper + '\n\n' : ''}${AUTH_INDENT}// User-provided ticket creation logic
${AUTH_INDENT}${parts.createTicketBody.replace(/\n/g, NEWLINE_REPLACEMENT)}
    }${
      parts.testConnectionBody
        ? `,
    
    testConnection: async (projectId) => {
${authHelper ? authHelper + '\n\n' : ''}${AUTH_INDENT}// User-provided test connection logic
${AUTH_INDENT}${parts.testConnectionBody.replace(/\n/g, NEWLINE_REPLACEMENT)}
    }`
        : ''
    }${
      parts.validateConfigBody
        ? `,
    
    validateConfig: async (config) => {
${AUTH_INDENT}// User-provided config validation logic
${AUTH_INDENT}${parts.validateConfigBody.replace(/\n/g, NEWLINE_REPLACEMENT)}
    }`
        : ''
    }
  })
};`;

  return code;
}

/**
 * Extract and de-indent user-provided code from a function body
 * Removes auto-generated helpers and standardized indentation
 *
 * @param code - The complete plugin code
 * @param functionPattern - Regex pattern to match the function signature
 * @param userCommentPattern - Regex pattern for the user comment marker
 * @param indentSpaces - Number of spaces to remove from each line (default: 6)
 * @returns Extracted user code, or undefined if function not found
 */
function extractUserCode(
  code: string,
  functionPattern: RegExp,
  userCommentPattern: RegExp,
  indentSpaces = 6
): string | undefined {
  const functionBody = extractFunctionBody(code, functionPattern);
  if (!functionBody) {
    return undefined;
  }

  const indentPattern = new RegExp(`^\\s{${indentSpaces}}`);
  const userCommentMatch = functionBody.match(userCommentPattern);

  const codeToProcess = userCommentMatch
    ? functionBody.substring(userCommentMatch.index! + userCommentMatch[0].length)
    : functionBody;

  return codeToProcess
    .split('\n')
    .map((line) => line.replace(indentPattern, ''))
    .join('\n')
    .trim();
}

/**
 * Parse plugin code back into structured parts for editing in guided mode
 * Returns null if code doesn't match the expected generated structure
 *
 * ⚠️ WARNING: BRITTLE STRING-BASED PARSING - TIGHTLY COUPLED WITH generatePluginCode() ⚠️
 *
 * This function uses string matching, comment-based markers, and fixed indentation patterns
 * to deconstruct plugin code generated by generatePluginCode(). This approach is VERY BRITTLE
 * and will break if any of the following change in generatePluginCode():
 *
 * - Comment markers: "// Basic Authentication Helper", "// Bearer Token Helper",
 *   "// API Key Helper", "// User-provided ticket creation logic", etc.
 * - Indentation: Currently expects 6-space indentation (.replace(/^\s{6}/, ''))
 * - Code structure: metadata object format, function signatures, placement, etc.
 *
 * Known Limitations:
 * - Cannot parse custom-formatted plugin code (returns null, forces advanced mode)
 * - Sensitive to whitespace and formatting changes
 * - Relies on extractJsonObject and extractFunctionBody brace-counting utilities
 * - Comment markers must match exactly (case-sensitive, punctuation-sensitive)
 *
 * Long-term Solution:
 * For improved maintainability, consider migrating to Abstract Syntax Tree (AST) parsing
 * using libraries like @babel/parser or acorn. This would:
 * - Allow parsing any valid JavaScript structure
 * - Be resilient to formatting/whitespace changes
 * - Enable detection of specific patterns via AST traversal
 * - Significantly increase code complexity and bundle size
 *
 * Current Trade-off:
 * We accept this brittleness in exchange for simplicity and zero additional dependencies.
 * The guided mode is optional - users can always fall back to advanced mode (full code editor)
 * if their plugin code doesn't match the expected generated structure.
 *
 * @returns Parsed plugin parts or null if code doesn't match expected structure
 */
function parsePluginCode(code: string): {
  metadata: {
    name: string;
    platform: string;
    version: string;
    description?: string;
    author?: string;
  };
  authType: 'basic' | 'bearer' | 'api_key' | 'custom';
  createTicketCode: string;
  testConnectionCode?: string;
  validateConfigCode?: string;
} | null {
  try {
    // Extract metadata object using brace counting for nested objects
    const metadataJson = extractJsonObject(code, /metadata:\s*/);
    if (!metadataJson) {
      logger.warn('Failed to match metadata in plugin code');
      return null;
    }

    const metadata = JSON.parse(metadataJson);
    if (!metadata.name || !metadata.platform || !metadata.version) {
      logger.warn('Metadata missing required fields', { metadata });
      return null;
    }

    // Detect auth type from the helper code
    let authType: 'basic' | 'bearer' | 'api_key' | 'custom' = 'custom';
    if (code.includes('// Basic Authentication Helper')) {
      authType = 'basic';
    } else if (code.includes('// Bearer Token Helper')) {
      authType = 'bearer';
    } else if (code.includes('// API Key Helper')) {
      authType = 'api_key';
    }

    // Extract createTicket function body using brace counting
    const createTicketCode = extractUserCode(
      code,
      /createTicket:\s*async\s*\([^)]*\)\s*=>\s*{/,
      /\/\/\s*User-provided ticket creation logic\s*/
    );

    if (!createTicketCode) {
      logger.warn('Failed to extract createTicket function body', {
        hasCreateTicket: code.includes('createTicket'),
      });
      return null;
    }

    // Extract testConnection if present
    const testConnectionCode = extractUserCode(
      code,
      /testConnection:\s*async\s*\([^)]*\)\s*=>\s*{/,
      /\/\/\s*User-provided test connection logic\s*/
    );

    // Extract validateConfig if present
    const validateConfigCode = extractUserCode(
      code,
      /validateConfig:\s*async\s*\([^)]*\)\s*=>\s*{/,
      /\/\/\s*User-provided config validation logic\s*/
    );

    return {
      metadata,
      authType,
      createTicketCode,
      testConnectionCode,
      validateConfigCode,
    };
  } catch (error) {
    // If parsing fails, return null (code is in advanced/custom format)
    logger.warn('Failed to parse plugin code into guided mode parts', {
      error: error instanceof Error ? error.message : String(error),
      codeSnippet: code.substring(0, 200),
    });
    return null;
  }
}

/**
 * Get integration by type or throw 404 error
 */
async function getIntegrationOrThrow(db: DatabaseClient, type: string): Promise<Integration> {
  const integration = await db.integrations.findByType(type);
  if (!integration) {
    throw new AppError(`Integration type '${type}' not found`, 404, 'NotFound');
  }
  return integration;
}

/**
 * Handle route errors consistently
 */
function handleRouteError(
  error: unknown,
  reply: FastifyReply,
  context: { message: string; type?: string; id?: string }
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error(context.message, {
    ...context,
    error: err.message,
  });
  reply.status(500).send({
    success: false,
    message: context.message,
    error: err.message,
  });
}

interface IntegrationParams {
  type: string;
}

interface CreateIntegrationBody {
  type: string;
  name: string;
  description?: string;
  is_custom?: boolean;
  plugin_source?: PluginSource;
  config?: Record<string, unknown>;
  trust_level?: TrustLevel;

  // Option 1: Full plugin code (advanced mode)
  plugin_code?: string;

  // Option 2: Structured parts (guided mode - simpler UI)
  metadata_json?: string; // JSON string of plugin metadata
  auth_type?: 'basic' | 'bearer' | 'api_key' | 'custom';
  create_ticket_code?: string; // JavaScript function body for createTicket
  test_connection_code?: string; // Optional: JavaScript function body for testConnection
  validate_config_code?: string; // Optional: JavaScript function body for validateConfig

  allow_code_execution?: boolean;
}

interface IntegrationConfigBody {
  name?: string;
  description?: string;
  status?: IntegrationStatus;
  config?: Record<string, unknown>;
  field_mappings?: Record<string, unknown>;
  sync_rules?: Record<string, unknown>;
  oauth_tokens?: Record<string, unknown>;
  webhook_secret?: string;
}

interface TestConnectionBody {
  config?: Record<string, unknown>;
}

/**
 * Frontend integration config structure
 * Frontend sends nested authentication object that needs to be flattened for backend
 */
export interface FrontendIntegrationConfig {
  instanceUrl?: string;
  baseUrl?: string;
  host?: string;
  authentication?: {
    type?: 'basic' | 'oauth2' | 'pat';
    email?: string;
    apiToken?: string;
    password?: string; // Alias for apiToken
    username?: string; // Alias for email
  };
  auth?: {
    // Alias for authentication
    type?: 'basic' | 'oauth2' | 'pat';
    email?: string;
    apiToken?: string;
    password?: string; // Alias for apiToken
    username?: string; // Alias for email
  };
  email?: string;
  apiToken?: string;
  projectKey?: string;
  issueType?: string;
  enabled?: boolean;
}

/**
 * Backend integration config structure (Jira format)
 */
export interface BackendIntegrationConfig {
  host: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
  enabled: boolean;
}

/**
 * Map frontend field names to backend expectations
 * Handles multiple field name variations for compatibility
 */
export function mapFrontendConfigToBackend(
  frontendConfig: FrontendIntegrationConfig
): BackendIntegrationConfig {
  const authConfig = frontendConfig.auth || frontendConfig.authentication;
  return {
    host: frontendConfig.baseUrl || frontendConfig.instanceUrl || frontendConfig.host || '',
    email: authConfig?.email || authConfig?.username || frontendConfig.email || '',
    apiToken: authConfig?.apiToken || authConfig?.password || frontendConfig.apiToken || '',
    projectKey: frontendConfig.projectKey || '',
    issueType: frontendConfig.issueType || 'Bug',
    enabled: frontendConfig.enabled !== undefined ? frontendConfig.enabled : true,
  };
}

interface WebhookParams {
  type: string;
  id: string;
}

interface CreateWebhookBody {
  endpoint_url: string;
  events?: string[];
  active?: boolean;
}

interface UpdateWebhookBody {
  endpoint_url?: string;
  secret?: string;
  events?: string[];
  active?: boolean;
}

/**
 * Register admin integration management routes
 */
export async function registerAdminIntegrationRoutes(
  fastify: FastifyInstance,
  db: DatabaseClient,
  pluginRegistry: PluginRegistry
): Promise<void> {
  // ============================================================================
  // GENERAL ROUTES
  // ============================================================================

  /**
   * POST /api/v1/admin/integrations/analyze-code
   * Analyze plugin code for security violations
   */
  fastify.post<{ Body: { code: string } }>(
    '/api/v1/admin/integrations/analyze-code',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { code } = request.body;

      if (!code || typeof code !== 'string') {
        throw new AppError('Code is required', 400, 'BadRequest');
      }

      try {
        const analysis = await securityAnalyzer.analyze(code);
        const code_hash = securityAnalyzer.computeHash(code);

        return sendSuccess(reply, {
          ...analysis,
          code_hash,
        });
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, { message: 'Code analysis failed' });
        return;
      }
    }
  );

  /**
   * POST /api/v1/admin/integrations
   * Create new integration
   */
  fastify.post<{ Body: CreateIntegrationBody }>(
    '/api/v1/admin/integrations',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const body = request.body;
      const authUser = request.authUser;

      // Validate integration type format (type is the unique platform identifier)
      if (!/^[a-z0-9_-]+$/.test(body.type)) {
        throw new AppError(
          'Integration type must be lowercase alphanumeric with hyphens or underscores (e.g., my-crm, custom-helpdesk). This serves as the unique platform identifier.',
          400,
          'ValidationError'
        );
      }

      // Validate name
      if (!body.name || body.name.trim().length === 0) {
        throw new AppError('Integration name is required', 400, 'ValidationError');
      }

      try {
        // Check if integration already exists (type must be globally unique)
        const existing = await db.integrations.findByType(body.type);
        if (existing) {
          throw new AppError(
            `Integration type '${body.type}' already exists. Each integration must have a unique type that serves as its platform identifier (e.g., my-crm, custom-helpdesk).`,
            409,
            'Conflict'
          );
        }

        // Check maximum integrations limit
        const currentCount = await db.integrations.count();
        if (currentCount >= MAX_INTEGRATIONS) {
          throw new AppError(
            `Maximum number of integrations (${MAX_INTEGRATIONS}) reached`,
            400,
            'LimitExceeded'
          );
        }

        // Handle plugin code - either full code or structured parts
        let finalPluginCode: string | undefined;

        // Check if user provided structured parts (guided mode)
        if (body.metadata_json && body.create_ticket_code) {
          try {
            const metadata = JSON.parse(body.metadata_json);

            // Validate required metadata fields
            if (!metadata.name || !metadata.platform || !metadata.version) {
              throw new AppError(
                'Metadata must include name, platform, and version',
                400,
                'ValidationError'
              );
            }

            // Generate complete plugin code from parts
            finalPluginCode = generatePluginCode({
              metadata,
              authType: body.auth_type,
              createTicketBody: body.create_ticket_code,
              testConnectionBody: body.test_connection_code,
              validateConfigBody: body.validate_config_code,
            });

            logger.info('Generated plugin code from structured parts', {
              type: body.type,
              authType: body.auth_type,
              hasTestConnection: !!body.test_connection_code,
              hasValidateConfig: !!body.validate_config_code,
            });
          } catch (error) {
            if (error instanceof AppError) {
              throw error;
            }
            throw new AppError(
              'Invalid metadata JSON: ' + (error instanceof Error ? error.message : String(error)),
              400,
              'ValidationError'
            );
          }
        } else if (body.plugin_code && body.plugin_code.trim().length > 0) {
          // User provided full plugin code (advanced mode)
          finalPluginCode = body.plugin_code;
          logger.info('Using full plugin code from advanced mode', { type: body.type });
        }

        // Validate and analyze plugin code if provided
        let code_hash: string | undefined;
        let analyzed_code: string | undefined;

        if (finalPluginCode && finalPluginCode.trim().length > 0) {
          logger.info('Analyzing plugin code for security violations', {
            type: body.type,
            codeLength: finalPluginCode.length,
          });

          const analysis = await securityAnalyzer.analyze(finalPluginCode);

          if (!analysis.safe) {
            throw new AppError('Plugin code security validation failed', 400, 'SecurityViolation', {
              violations: analysis.violations,
              risk_level: analysis.risk_level,
            });
          }

          if (analysis.warnings.length > 0) {
            logger.warn('Plugin code analysis warnings', {
              type: body.type,
              warnings: analysis.warnings,
            });
          }

          // Compute hash for integrity
          code_hash = securityAnalyzer.computeHash(finalPluginCode);
          analyzed_code = finalPluginCode;

          logger.info('Plugin code validated successfully', {
            type: body.type,
            code_hash,
            warnings_count: analysis.warnings.length,
            generatedFromParts: !!(body.metadata_json && body.create_ticket_code),
          });
        }

        // Create integration
        // Set status to 'active' if config is provided during creation (consolidation complete)
        const hasConfig = Boolean(body.config);

        // Log INPUT data before creation
        logger.info('Creating integration with input', {
          type: body.type,
          name: body.name,
          statusInput: hasConfig ? 'active' : 'not_configured',
          hasConfig,
          hasBodyConfig: Boolean(body.config),
          bodyConfigKeys: body.config ? Object.keys(body.config) : [],
        });

        const integration = await db.integrations.create({
          type: body.type,
          name: body.name,
          description: body.description,
          status: hasConfig ? 'active' : 'not_configured',
          is_custom: body.is_custom ?? true,
          plugin_source: body.plugin_source ?? 'generic_http',
          trust_level: body.trust_level ?? 'custom',
          config: body.config,
          plugin_code: analyzed_code,
          code_hash,
          allow_code_execution: body.allow_code_execution ?? false,
        });

        // Log RETURNED data after creation
        logger.info('Created integration (returned from DB)', {
          type: body.type,
          name: body.name,
          is_custom: integration.is_custom,
          plugin_source: integration.plugin_source,
          statusReturned: integration.status,
          hasConfig,
          userId: authUser?.id,
        });

        return sendCreated(reply, integration);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, {
          message: 'Failed to create integration',
          type: body.type,
        });
        return;
      }
    }
  );

  /**
   * GET /api/v1/admin/integrations
   * List all integrations with stats
   */
  fastify.get(
    '/api/v1/admin/integrations',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { status, page = 1, limit = 20 } = request.query as ListIntegrationsQuery;

      try {
        const result = await db.integrations.list(
          { status },
          { page: Number(page), limit: Number(limit) }
        );

        // Log RAW data from repository
        logger.info('List integrations - raw data from DB', {
          count: result.data.length,
          integrations: result.data.map((i) => ({
            type: i.type,
            name: i.name,
            status: i.status,
            hasConfig: Boolean(i.config),
          })),
        });

        // Enrich with sync stats
        const enrichedData = await Promise.all(
          result.data.map(async (integration) => {
            const stats = await db.integrationSyncLogs.getStats(integration.type);
            return {
              ...integration,
              stats: {
                last_sync_at: integration.last_sync_at,
                total: stats.total,
                success: stats.success,
                failed: stats.failed,
                avg_duration_ms: stats.avg_duration_ms,
              },
            };
          })
        );

        // Log ENRICHED data being sent to frontend
        logger.info('List integrations - enriched data to frontend', {
          count: enrichedData.length,
          integrations: enrichedData.map((i) => ({
            type: i.type,
            name: i.name,
            status: i.status,
            hasConfig: Boolean(i.config),
          })),
        });

        return sendPaginated(reply, enrichedData, result.pagination);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, { message: 'Failed to retrieve integrations' });
        return;
      }
    }
  );

  /**
   * GET /api/v1/admin/integrations/:type/status
   * Get status of a specific integration
   */
  fastify.get<{ Params: IntegrationParams }>(
    '/api/v1/admin/integrations/:type/status',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { type } = request.params;

      try {
        const integration = await getIntegrationOrThrow(db, type);
        const stats = await db.integrationSyncLogs.getStats(type);

        return sendSuccess(reply, {
          type: integration.type,
          name: integration.name,
          status: integration.status,
          last_sync_at: integration.last_sync_at,
          stats,
        });
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, {
          message: 'Failed to retrieve integration status',
          type,
        });
        return;
      }
    }
  );

  // ============================================================================
  // CONFIGURATION ROUTES
  // ============================================================================

  /**
   * GET /api/v1/admin/integrations/:type/config
   * Get integration configuration
   */
  fastify.get<{ Params: IntegrationParams }>(
    '/api/v1/admin/integrations/:type/config',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { type } = request.params;

      try {
        const integration = await getIntegrationOrThrow(db, type);

        // Don't expose sensitive tokens in config endpoint
        const {
          oauth_tokens: _oauth_tokens,
          webhook_secret: _webhook_secret,
          ...safeConfig
        } = integration;

        return sendSuccess(reply, safeConfig);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, {
          message: 'Failed to retrieve configuration',
          type,
        });
        return;
      }
    }
  );

  /**
   * PUT /api/v1/admin/integrations/:type/config
   * Update integration configuration
   */
  fastify.put<{ Params: IntegrationParams; Body: IntegrationConfigBody }>(
    '/api/v1/admin/integrations/:type/config',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { type } = request.params;
      const updates = request.body;

      try {
        const integration = await getIntegrationOrThrow(db, type);
        const updated = await db.integrations.update(integration.id, updates);

        logger.info('Integration configuration updated', {
          type,
          status: updated?.status,
          user_id: request.authUser?.id,
        });

        return sendSuccess(reply, updated);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, {
          message: 'Failed to update configuration',
          type,
        });
        return;
      }
    }
  );

  /**
   * DELETE /api/v1/admin/integrations/:type/config
   * Delete integration configuration (reset to not_configured)
   */
  fastify.delete<{ Params: IntegrationParams }>(
    '/api/v1/admin/integrations/:type/config',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { type } = request.params;

      try {
        const integration = await getIntegrationOrThrow(db, type);

        // Reset to not_configured and clear sensitive data
        // IMPORTANT: Use null, not undefined - BaseRepository's serialize() skips undefined values
        await db.integrations.update(integration.id, {
          status: 'not_configured',
          config: null,
          field_mappings: null,
          sync_rules: null,
          oauth_tokens: null,
          webhook_secret: null,
        });

        // Delete OAuth tokens
        await db.oauthTokens.deleteByIntegrationType(type);

        logger.info('Integration configuration deleted', {
          type,
          user_id: request.authUser?.id,
        });

        return sendSuccess(reply, { message: 'Integration configuration deleted' });
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, {
          message: 'Failed to delete configuration',
          type,
        });
        return;
      }
    }
  );

  /**
   * GET /api/v1/admin/integrations/:type
   * Get integration details (including plugin_code for editing)
   */
  fastify.get<{ Params: IntegrationParams }>(
    '/api/v1/admin/integrations/:type',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { type } = request.params;

      try {
        const integration = await getIntegrationOrThrow(db, type);

        logger.info('Integration details retrieved', {
          type,
          user_id: request.authUser?.id,
        });

        return sendSuccess(reply, integration);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, {
          message: 'Failed to retrieve integration details',
          type,
        });
        return;
      }
    }
  );

  /**
   * GET /api/v1/admin/integrations/:type/parse
   * Parse plugin code into guided mode parts for editing
   * Returns null fields if code cannot be parsed (advanced/custom format)
   */
  fastify.get<{ Params: IntegrationParams }>(
    '/api/v1/admin/integrations/:type/parse',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { type } = request.params;

      try {
        const integration = await getIntegrationOrThrow(db, type);

        if (!integration.plugin_code) {
          return sendSuccess(reply, null);
        }

        const parsed = parsePluginCode(integration.plugin_code);

        logger.info('Plugin code parsed for editing', {
          type,
          success: !!parsed,
          user_id: request.authUser?.id,
        });

        return sendSuccess(reply, parsed);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, {
          message: 'Failed to parse plugin code',
          type,
        });
        return;
      }
    }
  );

  /**
   * PATCH /api/v1/admin/integrations/:type
   * Update integration (primarily for editing plugin_code)
   * Supports both Guided Mode (structured parts) and Advanced Mode (full code)
   */
  fastify.patch<{
    Params: IntegrationParams;
    Body: {
      plugin_code?: string;
      // Guided mode fields (same as create endpoint)
      metadata_json?: string;
      auth_type?: 'basic' | 'bearer' | 'api_key' | 'custom';
      create_ticket_code?: string;
      test_connection_code?: string;
      validate_config_code?: string;
    };
  }>(
    '/api/v1/admin/integrations/:type',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { type } = request.params;
      const body = request.body;

      try {
        const integration = await getIntegrationOrThrow(db, type);

        // Only allow editing plugin code for custom integrations
        if (!integration.is_custom) {
          throw new AppError(
            'Cannot modify plugin code for built-in integrations',
            403,
            'Forbidden'
          );
        }

        let finalPluginCode: string | undefined;

        // Determine mode: Guided (structured parts) or Advanced (full code)
        if (body.metadata_json && body.create_ticket_code) {
          // Guided mode: Generate code from parts
          try {
            const metadata = JSON.parse(body.metadata_json);

            // Validate metadata structure
            if (!metadata.name || !metadata.platform || !metadata.version) {
              throw new AppError(
                'metadata must include name, platform, and version fields',
                400,
                'ValidationError'
              );
            }

            // Generate complete plugin code from parts
            finalPluginCode = generatePluginCode({
              metadata,
              authType: body.auth_type,
              createTicketBody: body.create_ticket_code,
              testConnectionBody: body.test_connection_code,
              validateConfigBody: body.validate_config_code,
            });

            logger.info('Generated plugin code from structured parts for update', {
              type,
              authType: body.auth_type,
              hasTestConnection: !!body.test_connection_code,
              hasValidateConfig: !!body.validate_config_code,
            });
          } catch (error) {
            if (error instanceof AppError) {
              throw error;
            }
            throw new AppError(
              'Invalid metadata JSON: ' + (error instanceof Error ? error.message : String(error)),
              400,
              'ValidationError'
            );
          }
        } else if (body.plugin_code && body.plugin_code.trim().length > 0) {
          // Advanced mode: Use provided plugin code directly
          finalPluginCode = body.plugin_code;
          logger.info('Using full plugin code from advanced mode for update', { type });
        } else {
          throw new AppError(
            'Either plugin_code (advanced) or metadata_json + create_ticket_code (guided) is required',
            400,
            'BadRequest'
          );
        }

        // Validate code is not empty
        if (!finalPluginCode || finalPluginCode.trim().length === 0) {
          throw new AppError('Plugin code cannot be empty', 400, 'BadRequest');
        }

        // Validate maximum size
        if (finalPluginCode.length > MAX_PLUGIN_CODE_SIZE) {
          throw new AppError('Plugin code exceeds maximum size of 1MB', 400, 'BadRequest');
        }

        // Security analysis of plugin code
        const analysis = await securityAnalyzer.analyze(finalPluginCode);
        if (!analysis.safe) {
          throw new AppError('Plugin code security validation failed', 400, 'SecurityViolation', {
            violations: analysis.violations,
            risk_level: analysis.risk_level,
          });
        }

        if (analysis.warnings.length > 0) {
          logger.warn('Plugin code analysis warnings during update', {
            type,
            warnings: analysis.warnings,
          });
        }

        // Compute hash of the code
        const code_hash = securityAnalyzer.computeHash(finalPluginCode);

        // Update integration with new plugin code
        const updated = await db.integrations.update(integration.id, {
          plugin_code: finalPluginCode,
          code_hash,
        });

        logger.info('Integration plugin code updated', {
          type,
          user_id: request.authUser?.id,
          code_hash,
          generatedFromParts: !!(body.metadata_json && body.create_ticket_code),
        });

        return sendSuccess(reply, updated);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, {
          message: 'Failed to update integration plugin code',
          type,
        });
        return;
      }
    }
  );

  /**
   * DELETE /api/v1/admin/integrations/:type
   * Delete an integration completely (removes the integration record)
   */
  fastify.delete<{ Params: IntegrationParams }>(
    '/api/v1/admin/integrations/:type',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { type } = request.params;

      try {
        const integration = await getIntegrationOrThrow(db, type);

        // Prevent deletion of built-in integrations (seeded by migrations)
        const BUILT_IN_INTEGRATIONS = ['jira'];
        if (BUILT_IN_INTEGRATIONS.includes(type)) {
          throw new AppError(
            'Cannot delete built-in integration. Use DELETE /config endpoint to remove configuration instead.',
            403,
            'ForbiddenError'
          );
        }

        // Execute all deletions in a transaction to ensure atomicity
        const result = await db.transaction(async (tx) => {
          // Delete all project-specific integrations using this platform
          const deletedProjectIntegrations = await tx.projectIntegrations.deleteByPlatform(type);

          // Delete OAuth tokens (foreign key constraint)
          await tx.oauthTokens.deleteByIntegrationType(type);

          // Delete field mappings
          await tx.fieldMappings.deleteByIntegrationType(type);

          // Delete the global integration
          await tx.integrations.delete(integration.id);

          return { deletedProjectIntegrations };
        });

        logger.info('Integration and all project integrations deleted', {
          type,
          deleted_project_integrations: result.deletedProjectIntegrations,
          user_id: request.authUser?.id,
        });

        return sendSuccess(reply, {
          message: 'Integration deleted successfully',
          deleted_project_integrations: result.deletedProjectIntegrations,
        });
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, {
          message: 'Failed to delete integration',
          type,
        });
        return;
      }
    }
  );

  /**
   * POST /api/v1/admin/integrations/:type/toggle-code-execution
   * Enable/disable code execution for code-based plugins
   */
  fastify.post<{ Params: IntegrationParams; Body: { allow_code_execution: boolean } }>(
    '/api/v1/admin/integrations/:type/toggle-code-execution',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { type } = request.params;
      const { allow_code_execution } = request.body;
      const authUser = request.authUser;

      try {
        const integration = await getIntegrationOrThrow(db, type);

        // Only allow toggling for integrations with plugin_code
        if (!integration.plugin_code) {
          throw new AppError('Integration does not have plugin code', 400, 'ValidationError');
        }

        // Update allow_code_execution flag
        const updated = await db.integrations.update(integration.id, {
          allow_code_execution,
        });

        logger.info('Code execution toggled', {
          type,
          allow_code_execution,
          userId: authUser?.id,
        });

        return sendSuccess(reply, {
          type: updated?.type,
          allow_code_execution: updated?.allow_code_execution,
          message: `Code execution ${allow_code_execution ? 'enabled' : 'disabled'}`,
        });
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, {
          message: 'Failed to toggle code execution',
          type,
        });
        return;
      }
    }
  );

  /**
   * POST /api/v1/admin/integrations/:type/test
   * Test integration connection
   *
   * Configuration Priority:
   * 1. Uses provided config from request body if present
   * 2. Falls back to stored config from database if no config provided
   *
   * The 'type' parameter can be either a base plugin type (e.g., 'jira')
   * or a custom integration type (e.g., 'jira_e2e_12345'). Both use the
   * same configuration resolution logic.
   */
  fastify.post<{ Params: IntegrationParams; Body: TestConnectionBody }>(
    '/api/v1/admin/integrations/:type/test',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { type } = request.params;
      const { config } = request.body;

      try {
        // Try to find an integration with this type in the database
        // If not found, we'll still attempt to load the base plugin type
        const integration = await db.integrations.findByType(type);

        // Use provided config or existing config from integration
        const testConfig = config || integration?.config;

        if (!testConfig) {
          throw new AppError('No configuration provided for testing', 400, 'ValidationError');
        }

        // Log the test attempt
        const startTime = Date.now();

        // Test connection using dynamic plugin loader
        try {
          // Load the plugin using the provided plugin registry
          const service = (await pluginRegistry.loadDynamicPlugin(type)) as {
            validateConfig?: (config: unknown) => Promise<{ valid: boolean; error?: string }>;
          };

          // Map frontend field names to backend expectations
          const mappedConfig = mapFrontendConfigToBackend(testConfig as FrontendIntegrationConfig);

          // Use validateConfig to test the connection with mapped config
          if (typeof service.validateConfig === 'function') {
            const result = await service.validateConfig(mappedConfig);
            if (!result.valid) {
              throw new AppError(
                result.error || 'Configuration validation failed',
                400,
                'ValidationError'
              );
            }
          } else {
            throw new AppError(
              'Plugin does not support configuration validation',
              400,
              'ValidationError'
            );
          }

          const duration = Date.now() - startTime;

          await db.integrationSyncLogs.create({
            integration_type: type,
            action: 'test',
            status: 'success',
            duration_ms: duration,
          });

          return sendSuccess(reply, {
            message: 'Connection test successful',
            tested_at: new Date().toISOString(),
            duration_ms: duration,
          });
        } catch (testError) {
          // If test fails, log and return error
          const duration = Date.now() - startTime;

          await db.integrationSyncLogs.create({
            integration_type: type,
            action: 'test',
            status: 'failed',
            error: testError instanceof Error ? testError.message : String(testError),
            duration_ms: duration,
          });

          handleRouteError(testError, reply, {
            message: 'Connection test failed',
            type,
          });
          return;
        }
      } catch (error) {
        // Log the failure
        const err = error instanceof Error ? error : new Error(String(error));
        await db.integrationSyncLogs.create({
          integration_type: type,
          action: 'test',
          status: 'failed',
          error: err.message,
        });

        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, {
          message: 'Connection test failed',
          type,
        });
        return;
      }
    }
  );

  // ============================================================================
  // SYNC/ACTIVITY ROUTES
  // ============================================================================

  /**
   * GET /api/v1/admin/integrations/activity
   * Get integration sync activity log
   */
  fastify.get(
    '/api/v1/admin/integrations/activity',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        integration_type,
        bug_id,
        status,
        action,
        page = 1,
        limit = 50,
      } = request.query as ActivityLogQuery;

      try {
        const result = await db.integrationSyncLogs.list(
          { integration_type, bug_id, status, action },
          { page: Number(page), limit: Number(limit) }
        );

        return sendPaginated(reply, result.data, result.pagination);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, { message: 'Failed to retrieve activity log' });
        return;
      }
    }
  );

  // ============================================================================
  // WEBHOOK ROUTES
  // ============================================================================

  /**
   * GET /api/v1/admin/integrations/:type/webhooks
   * Get webhooks for integration
   */
  fastify.get<{ Params: IntegrationParams }>(
    '/api/v1/admin/integrations/:type/webhooks',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { type } = request.params;

      try {
        const webhooks = await db.webhooks.getByIntegrationType(type);

        return sendSuccess(reply, webhooks);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, {
          message: 'Failed to retrieve webhooks',
          type,
        });
        return;
      }
    }
  );

  /**
   * POST /api/v1/admin/integrations/:type/webhooks
   * Create new webhook
   */
  fastify.post<{ Params: IntegrationParams; Body: CreateWebhookBody }>(
    '/api/v1/admin/integrations/:type/webhooks',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { type } = request.params;
      const { endpoint_url, events = [], active = true } = request.body;

      try {
        // Generate cryptographically secure secret for webhook validation (256 bits)
        const secret = `whsec_${randomBytes(32).toString('base64url')}`;

        const webhook = await db.webhooks.create({
          integration_type: type,
          endpoint_url,
          secret,
          events,
          active,
        });

        return sendCreated(reply, webhook);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, {
          message: 'Failed to create webhook',
          type,
        });
        return;
      }
    }
  );

  /**
   * PUT /api/v1/admin/integrations/:type/webhooks/:id
   * Update webhook
   */
  fastify.put<{ Params: WebhookParams; Body: UpdateWebhookBody }>(
    '/api/v1/admin/integrations/:type/webhooks/:id',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { type, id } = request.params;
      const updates = request.body;

      try {
        const webhook = await db.webhooks.findById(id);

        if (!webhook || webhook.integration_type !== type) {
          throw new AppError('Webhook not found', 404, 'NotFound');
        }

        const updated = await db.webhooks.update(id, updates);

        return sendSuccess(reply, updated);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, {
          message: 'Failed to update webhook',
          type,
          id,
        });
        return;
      }
    }
  );

  /**
   * DELETE /api/v1/admin/integrations/:type/webhooks/:id
   * Delete webhook
   */
  fastify.delete<{ Params: WebhookParams }>(
    '/api/v1/admin/integrations/:type/webhooks/:id',
    {
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { type, id } = request.params;

      try {
        const webhook = await db.webhooks.findById(id);

        if (!webhook || webhook.integration_type !== type) {
          throw new AppError('Webhook not found', 404, 'NotFound');
        }

        await db.webhooks.delete(id);

        return sendSuccess(reply, { message: 'Webhook deleted successfully' });
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        handleRouteError(error, reply, {
          message: 'Failed to delete webhook',
          type,
          id,
        });
        return;
      }
    }
  );

  logger.info('Admin integration management routes registered');
}
