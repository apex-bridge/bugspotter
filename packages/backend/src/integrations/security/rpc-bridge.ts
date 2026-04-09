/**
 * RPC Bridge for Secure Plugin Execution
 * Provides controlled communication between isolated-vm sandbox and host context
 */

import type { DatabaseClient } from '../../db/client.js';
import type { IStorageService } from '../../storage/types.js';
import { BaseIntegrationHelpers } from '../base-integration-helpers.js';
import { getLogger } from '../../logger.js';
import { validateSSRFProtection } from './ssrf-validator.js';
import { sanitizeErrorMessage } from '../../utils/sanitizer.js';
import * as pluginUtils from '../plugin-utils/index.js';

const logger = getLogger();

/**
 * HTTP fetch timeout for plugin RPC calls (milliseconds)
 */
const HTTP_FETCH_TIMEOUT_MS = 10000; // 10 seconds

/**
 * Maximum response body size for plugin HTTP requests (bytes)
 * Prevents memory exhaustion from large responses
 */
const MAX_RESPONSE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Blocked HTTP headers that plugins cannot set (prevents impersonation)
 * All comparisons are case-insensitive per HTTP spec
 */
const BLOCKED_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
  'www-authenticate',
  'authentication-info',
  'sec-', // All Sec-* headers (Sec-Fetch-Site, etc.)
  'x-forwarded-for',
  'x-real-ip',
  'x-forwarded-host',
  'x-forwarded-proto',
]);

/**
 * Presigned URL expiration time (seconds)
 */
const PRESIGNED_URL_EXPIRY_SECONDS = 300; // 5 minutes

/**
 * Minimum string length for validation
 */
const MIN_STRING_LENGTH = 1;

/**
 * Minimum path components for storage keys (type/project/bug/filename)
 */
const MIN_STORAGE_PATH_PARTS = 4;

/**
 * RPC argument count constraints
 */
const ARG_COUNT = {
  NONE: 0,
  ONE: 1,
  TWO: 2,
  MIN_ONE: 1,
  MAX_TWO: 2,
} as const;

export interface RpcRequest {
  method: string;
  args: unknown[];
  requestId: string;
}

export interface RpcResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  requestId: string;
}

/**
 * Type-safe RPC handler with validation
 */
interface RpcHandler<TArgs extends unknown[], TResult> {
  validate: (args: unknown[]) => args is TArgs;
  handler: (this: RpcBridge, ...args: TArgs) => Promise<TResult>;
  expectedArgs: string; // Human-readable description of expected arguments
}

/**
 * RPC Bridge - Provides safe method calls from sandboxed plugin to host
 * Extends BaseIntegrationHelpers to reuse helper implementations
 */
export class RpcBridge extends BaseIntegrationHelpers {
  /**
   * Type-safe handler registry with runtime validation
   * Each handler validates arguments before casting
   */
  private readonly handlers: Map<string, RpcHandler<unknown[], unknown>>;

  constructor(db: DatabaseClient, storage: IStorageService, projectId: string, platform: string) {
    super(db, storage, projectId, platform);

    // Initialize handler registry
    this.handlers = this.createHandlerRegistry();
  }

  /**
   * Create handler registry with type-safe validators
   * Extracted to improve readability and maintainability
   * @private
   */
  private createHandlerRegistry(): Map<string, RpcHandler<unknown[], unknown>> {
    return new Map([
      [
        'db.bugReports.findById',
        {
          validate: (args): args is [string] =>
            args.length === ARG_COUNT.ONE &&
            typeof args[0] === 'string' &&
            args[0].length >= MIN_STRING_LENGTH,
          handler: async (bugReportId: unknown) => this.handleGetBugReport(bugReportId as string),
          expectedArgs: 'string (bug report ID)',
        },
      ],
      [
        'db.bugReports.update',
        {
          validate: (args): args is [string, Record<string, unknown>] =>
            args.length === ARG_COUNT.TWO &&
            typeof args[0] === 'string' &&
            args[0].length >= MIN_STRING_LENGTH &&
            typeof args[1] === 'object' &&
            args[1] !== null &&
            !Array.isArray(args[1]),
          handler: async (bugReportId: unknown, updates: unknown) =>
            this.handleUpdateBugReport(bugReportId as string, updates as Record<string, unknown>),
          expectedArgs: 'string (bug report ID), object (updates)',
        },
      ],
      [
        'db.projectIntegrations.findByProject',
        {
          validate: (args): args is [] => args.length === ARG_COUNT.NONE,
          handler: async () => this.handleGetIntegrations(),
          expectedArgs: 'none',
        },
      ],
      [
        'storage.getPresignedUrl',
        {
          validate: (args): args is [string] =>
            args.length === ARG_COUNT.ONE &&
            typeof args[0] === 'string' &&
            args[0].length >= MIN_STRING_LENGTH,
          handler: async (fileKey: unknown) => this.handleGetStorageUrl(fileKey as string),
          expectedArgs: 'string (file key)',
        },
      ],
      ['log', this.createLogHandler('info')],
      ['logError', this.createLogHandler('error')],
      ['logWarn', this.createLogHandler('warn')],
      [
        'http.fetch',
        {
          validate: (args): args is [string] | [string, RequestInit] =>
            args.length >= ARG_COUNT.MIN_ONE &&
            args.length <= ARG_COUNT.MAX_TWO &&
            typeof args[0] === 'string' &&
            args[0].length >= MIN_STRING_LENGTH &&
            (args.length === ARG_COUNT.ONE ||
              (typeof args[1] === 'object' && args[1] !== null && !Array.isArray(args[1]))),
          handler: async (url: unknown, options?: unknown) =>
            this.handleHttpFetch(url as string, options as RequestInit | undefined),
          expectedArgs: 'string (URL), optional object (fetch options)',
        },
      ],
      // Context helper methods (delegate to base class)
      [
        'context.getIntegrationConfig',
        {
          validate: (args): args is [] => args.length === ARG_COUNT.NONE,
          handler: async () => this.getIntegrationConfig(),
          expectedArgs: 'none',
        },
      ],
      [
        'context.getBugReport',
        {
          validate: (args): args is [string] =>
            args.length === ARG_COUNT.ONE &&
            typeof args[0] === 'string' &&
            args[0].length >= MIN_STRING_LENGTH,
          handler: async (bugReportId: unknown) => this.getBugReport(bugReportId as string),
          expectedArgs: 'string (bug report ID)',
        },
      ],
      [
        'context.createTicket',
        {
          validate: (args): args is [Record<string, unknown>] =>
            args.length === ARG_COUNT.ONE &&
            typeof args[0] === 'object' &&
            args[0] !== null &&
            !Array.isArray(args[0]),
          handler: async (data: unknown) => {
            const ticketData = data as Record<string, unknown>;
            // Extract required fields (accept both camelCase and snake_case for compatibility)
            const bugReportId = (ticketData.bug_report_id || ticketData.bugReportId) as string;
            const externalId = (ticketData.external_id || ticketData.externalId) as string;
            const externalUrl = (ticketData.external_url || ticketData.externalUrl) as string;

            if (!bugReportId || typeof bugReportId !== 'string') {
              throw new Error('bug_report_id is required and must be a string');
            }
            if (!externalId || typeof externalId !== 'string') {
              throw new Error('external_id is required and must be a string');
            }

            // Delegate to base class (returns Ticket)
            const ticket = await this.createTicket({
              bug_report_id: bugReportId,
              external_id: externalId,
              external_url: externalUrl || '',
            });

            // Return IntegrationResult format (camelCase)
            return {
              externalId: ticket.external_id,
              externalUrl: ticket.external_url || '',
              platform: ticket.platform,
              metadata: {
                ticketId: ticket.id,
                status: ticket.status,
                createdAt: ticket.created_at.toISOString(),
              },
            };
          },
          expectedArgs: 'object (ticket data)',
        },
      ],
      [
        'context.logSyncEvent',
        {
          validate: (args): args is [string, string] | [string, string, Record<string, unknown>] =>
            args.length >= ARG_COUNT.TWO &&
            args.length <= 3 &&
            typeof args[0] === 'string' &&
            typeof args[1] === 'string' &&
            (args.length === ARG_COUNT.TWO ||
              (typeof args[2] === 'object' && args[2] !== null && !Array.isArray(args[2]))),
          handler: async (action: unknown, status: unknown, metadata?: unknown) => {
            const actionStr = action as string;
            let statusStr = status as string;

            // Validate action type
            const validActions = ['create', 'update', 'sync', 'error', 'test'];
            if (!validActions.includes(actionStr)) {
              throw new Error(
                `Invalid action type: ${actionStr}. Must be one of: ${validActions.join(', ')}`
              );
            }

            // Normalize status ('failure' -> 'failed' for backward compatibility)
            if (statusStr === 'failure') {
              statusStr = 'failed';
            }

            const validStatuses = ['pending', 'success', 'failed', 'skipped'];
            if (!validStatuses.includes(statusStr)) {
              throw new Error(
                `Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`
              );
            }

            // Delegate to base class
            return this.logSyncEvent(
              actionStr as 'test' | 'create' | 'update' | 'sync',
              statusStr as 'success' | 'failed',
              metadata as Record<string, unknown> | undefined
            );
          },
          expectedArgs: 'string (action), string (status), optional object (metadata)',
        },
      ],
      // Plugin utils - Authentication
      [
        'utils.buildAuthHeader',
        {
          validate: (args): args is [Record<string, unknown>] =>
            args.length === ARG_COUNT.ONE &&
            typeof args[0] === 'object' &&
            args[0] !== null &&
            !Array.isArray(args[0]),
          handler: async (authConfig: unknown) => {
            return pluginUtils.buildAuthHeader(authConfig as pluginUtils.AuthConfig);
          },
          expectedArgs: 'object (auth config)',
        },
      ],
      // Plugin utils - HTTP utilities
      [
        'utils.buildUrl',
        {
          validate: (args): args is [string, string] | [string, string, Record<string, unknown>] =>
            args.length >= ARG_COUNT.TWO &&
            args.length <= 3 &&
            typeof args[0] === 'string' &&
            typeof args[1] === 'string' &&
            (args.length === ARG_COUNT.TWO ||
              (typeof args[2] === 'object' && args[2] !== null && !Array.isArray(args[2]))),
          handler: async (baseUrl: unknown, endpoint: unknown, queryParams?: unknown) => {
            return pluginUtils.buildUrl(
              baseUrl as string,
              endpoint as string,
              (queryParams as Record<string, any>) || {}
            );
          },
          expectedArgs: 'string (base URL), string (endpoint), optional object (query params)',
        },
      ],
      [
        'utils.makeApiRequest',
        {
          validate: (args): args is [Record<string, unknown>] =>
            args.length === ARG_COUNT.ONE &&
            typeof args[0] === 'object' &&
            args[0] !== null &&
            !Array.isArray(args[0]),
          handler: async (config: unknown) => {
            // Create HTTP context from RPC bridge
            const httpContext: pluginUtils.HttpContext = {
              fetch: async (url: string, options: any) => {
                // Use existing handleHttpFetch method which returns the expected format
                const response = await this.handleHttpFetch(url, options);
                return {
                  status: response.status,
                  headers: {
                    get: (name: string) => response.headers[name.toLowerCase()] || null,
                  },
                  json: async () => JSON.parse(response.body),
                  text: async () => response.body,
                };
              },
            };
            return await pluginUtils.makeApiRequest(
              httpContext,
              config as pluginUtils.ApiRequestConfig
            );
          },
          expectedArgs: 'object (API request config)',
        },
      ],
      // Plugin utils - Storage
      [
        'utils.getResourceUrls',
        {
          validate: (args): args is [Record<string, unknown>] =>
            args.length === ARG_COUNT.ONE &&
            typeof args[0] === 'object' &&
            args[0] !== null &&
            !Array.isArray(args[0]),
          handler: async (bugReport: unknown) => {
            const storageContext: pluginUtils.StorageContext = {
              getPresignedUrl: async (resourcePath: string, projectId: string) => {
                // Validate projectId matches context for security
                if (projectId !== this.projectId) {
                  throw new Error('Access denied: projectId does not match context');
                }
                return await this.handleGetStorageUrl(resourcePath);
              },
            };
            return await pluginUtils.getResourceUrls(
              storageContext,
              bugReport as pluginUtils.BugReportWithResources
            );
          },
          expectedArgs: 'object (bug report with resources)',
        },
      ],
      // Plugin utils - Metadata extraction
      [
        'utils.extractEnvironment',
        {
          validate: (args): args is [] | [Record<string, unknown> | null] =>
            args.length <= ARG_COUNT.ONE &&
            (args.length === ARG_COUNT.NONE ||
              args[0] === null ||
              (typeof args[0] === 'object' && !Array.isArray(args[0]))),
          handler: async (metadata?: unknown) => {
            return pluginUtils.extractEnvironment(metadata as pluginUtils.BugReportMetadata | null);
          },
          expectedArgs: 'optional object (metadata)',
        },
      ],
      [
        'utils.extractConsoleLogs',
        {
          validate: (
            args
          ): args is
            | []
            | [Record<string, unknown> | null]
            | [Record<string, unknown> | null, number] =>
            args.length <= ARG_COUNT.TWO &&
            (args.length === ARG_COUNT.NONE ||
              args[0] === null ||
              (typeof args[0] === 'object' && !Array.isArray(args[0]))) &&
            (args.length <= ARG_COUNT.ONE || typeof args[1] === 'number'),
          handler: async (metadata?: unknown, limit?: unknown) => {
            return pluginUtils.extractConsoleLogs(
              metadata as pluginUtils.BugReportMetadata | null,
              limit as number | undefined
            );
          },
          expectedArgs: 'optional object (metadata), optional number (limit)',
        },
      ],
      [
        'utils.extractNetworkErrors',
        {
          validate: (args): args is [] | [Record<string, unknown> | null] =>
            args.length <= ARG_COUNT.ONE &&
            (args.length === ARG_COUNT.NONE ||
              args[0] === null ||
              (typeof args[0] === 'object' && !Array.isArray(args[0]))),
          handler: async (metadata?: unknown) => {
            return pluginUtils.extractNetworkErrors(
              metadata as pluginUtils.BugReportMetadata | null
            );
          },
          expectedArgs: 'optional object (metadata)',
        },
      ],
      // Plugin utils - Validation
      [
        'utils.validateFields',
        {
          validate: (args): args is [Array<Record<string, unknown>>] =>
            args.length === ARG_COUNT.ONE && Array.isArray(args[0]),
          handler: async (fields: unknown) => {
            // Convert validators from string names to actual functions
            const fieldValidations = (fields as any[]).map((field) => {
              let validator = field.validator;

              // If validator is a string, look it up in validators object
              if (typeof validator === 'string' && validator in pluginUtils.validators) {
                validator = (pluginUtils.validators as any)[validator];
              }

              return {
                name: field.name,
                value: field.value,
                validator: validator,
              };
            });

            return pluginUtils.validateFields(fieldValidations as pluginUtils.FieldValidation[]);
          },
          expectedArgs: 'array (field validations)',
        },
      ],
      [
        'utils.createValidationResult',
        {
          validate: (args): args is [boolean] | [boolean, string[]] =>
            args.length >= ARG_COUNT.ONE &&
            args.length <= ARG_COUNT.TWO &&
            typeof args[0] === 'boolean' &&
            (args.length === ARG_COUNT.ONE || Array.isArray(args[1])),
          handler: async (isValid: unknown, errors?: unknown) => {
            return pluginUtils.createValidationResult(
              isValid as boolean,
              (errors as string[]) || []
            );
          },
          expectedArgs: 'boolean (is valid), optional array (errors)',
        },
      ],
      // Plugin utils - Error handling
      [
        'utils.createPluginError',
        {
          validate: (args): args is [string, string] | [string, string, Record<string, unknown>] =>
            args.length >= ARG_COUNT.TWO &&
            args.length <= 3 &&
            typeof args[0] === 'string' &&
            typeof args[1] === 'string' &&
            (args.length === ARG_COUNT.TWO ||
              (typeof args[2] === 'object' && args[2] !== null && !Array.isArray(args[2]))),
          handler: async (code: unknown, message: unknown, details?: unknown) => {
            const error = pluginUtils.createPluginError(
              code as pluginUtils.ErrorCode,
              message as string,
              (details as Record<string, unknown>) || {}
            );
            // Return error as plain object (can't serialize Error instances across VM boundary)
            return {
              name: error.name,
              message: error.message,
              code: error.code,
              details: error.details,
            };
          },
          expectedArgs: 'string (error code), string (message), optional object (details)',
        },
      ],
    ]);
  }

  /**
   * Create logging handler with specified level (DRY helper)
   * Eliminates duplication across log/logError/logWarn handlers
   * @private
   */
  private createLogHandler(level: 'info' | 'error' | 'warn'): RpcHandler<unknown[], unknown> {
    return {
      validate: (args): args is unknown[] => Array.isArray(args),
      handler: async (...args: unknown[]) => {
        const message = args.map((arg) => String(arg)).join(' ');
        logger[level]('[Plugin RPC]', { message, project_id: this.projectId });
        return null;
      },
      expectedArgs: '...any (log messages)',
    };
  }

  /**
   * Handle RPC call from sandboxed plugin
   * Only allows whitelisted methods with validated arguments
   */
  async handleCall(request: RpcRequest): Promise<RpcResponse> {
    const { method, args, requestId } = request;

    try {
      // Look up handler in registry
      const handler = this.handlers.get(method);

      if (!handler) {
        throw new Error(`RPC method not allowed: ${method}`);
      }

      // Validate arguments before casting (runtime type guard)
      if (!handler.validate(args)) {
        throw new Error(`Invalid arguments for ${method}: expected ${handler.expectedArgs}`);
      }

      // Execute handler with validated arguments (safe to cast now)
      const result = await handler.handler.call(this, ...args);

      return {
        success: true,
        data: result,
        requestId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('RPC call failed', {
        method,
        error: errorMessage,
        project_id: this.projectId,
      });

      // Sanitize error message to prevent leaking sensitive data (using shared utility)
      const sanitizedError = sanitizeErrorMessage(errorMessage);

      return {
        success: false,
        error: sanitizedError,
        requestId,
      };
    }
  }

  /**
   * Get bug report (read-only)
   */
  private async handleGetBugReport(bugReportId: string): Promise<{
    id: string;
    title: string;
    description: string | null;
    priority: string;
    status: string;
    metadata: Record<string, unknown>;
    created_at: string; // ISO 8601 string
    updated_at: string; // ISO 8601 string
  }> {
    const report = await this.db.bugReports.findById(bugReportId);

    if (!report) {
      throw new Error(`Bug report not found: ${bugReportId}`);
    }

    // Verify bug report belongs to the project
    if (report.project_id !== this.projectId) {
      throw new Error('Access denied: Bug report does not belong to this project');
    }

    // Return sanitized subset (no sensitive fields)
    // Note: Date objects converted to ISO 8601 strings for serialization
    return {
      id: report.id,
      title: report.title,
      description: report.description,
      priority: report.priority,
      status: report.status,
      metadata: report.metadata,
      created_at: report.created_at.toISOString(),
      updated_at: report.updated_at.toISOString(),
      // Omit: project_id, deleted_at, deleted_by, legal_hold, internal fields
    };
  }

  /**
   * Update bug report metadata (safe field only)
   * Note: Argument validation is now handled by the handler registry
   */
  private async handleUpdateBugReport(
    bugReportId: string,
    updates: Record<string, unknown>
  ): Promise<{ success: boolean }> {
    // Verify bug report belongs to the project
    const report = await this.db.bugReports.findById(bugReportId);
    if (!report || report.project_id !== this.projectId) {
      throw new Error('Access denied: Bug report not found or does not belong to this project');
    }

    // Validate that only metadata field is being updated
    const allowedFields = ['metadata'];
    const attemptedFields = Object.keys(updates);
    const disallowedFields = attemptedFields.filter((field) => !allowedFields.includes(field));

    if (disallowedFields.length > 0) {
      throw new Error(
        `Plugins can only update 'metadata' field. Attempted to update: ${disallowedFields.join(', ')}`
      );
    }

    // Plugins can only update metadata field (merge with existing)
    if (
      'metadata' in updates &&
      typeof updates.metadata === 'object' &&
      updates.metadata !== null
    ) {
      const newMetadata = {
        ...report.metadata,
        ...(updates.metadata as Record<string, unknown>),
      };

      await this.db.bugReports.update(bugReportId, { metadata: newMetadata });
      return { success: true };
    }

    // No valid updates provided
    throw new Error('No valid updates provided. Only metadata field can be updated.');
  }

  /**
   * Get project integrations (read-only)
   */
  private async handleGetIntegrations(): Promise<
    Array<{ type: string; config: Record<string, unknown> }>
  > {
    const integrations = await this.db.projectIntegrations.findAllByProjectWithType(this.projectId);

    // Return sanitized list (credentials stored separately in encrypted_credentials)
    // Config contains only non-sensitive settings (URLs, project keys, field mappings)
    return integrations.map((integration) => ({
      type: integration.integration_type,
      config: integration.config,
    }));
  }

  /**
   * Get storage presigned URL (read-only)
   */
  private async handleGetStorageUrl(fileKey: string): Promise<string> {
    // 1. Check for URL-encoded path traversal in original input (case-insensitive)
    // Must check before decoding to catch encoding-based bypass attempts
    const lowerFileKey = fileKey.toLowerCase();
    if (
      lowerFileKey.includes('%2e%2e') ||
      lowerFileKey.includes('%2f%2e%2e') ||
      lowerFileKey.includes('%5c')
    ) {
      throw new Error('URL-encoded path traversal detected in file key');
    }

    // 2. Decode URL encoding iteratively to detect multi-encoded path traversal attempts
    // Decode multiple times to catch double/triple encoding (e.g., %252e%252e → %2e%2e → ..)
    let decodedKey = fileKey;
    let previousKey = '';
    let decodeIterations = 0;
    const MAX_DECODE_ITERATIONS = 5; // Prevent infinite loops on malformed input

    while (decodedKey !== previousKey && decodeIterations < MAX_DECODE_ITERATIONS) {
      previousKey = decodedKey;
      try {
        decodedKey = decodeURIComponent(decodedKey);
      } catch {
        // Invalid encoding - treat as potentially malicious
        throw new Error('Invalid URL encoding in file key');
      }
      decodeIterations++;
    }

    // 3. Validate no path traversal sequences (after full decoding)
    if (decodedKey.includes('../') || decodedKey.includes('..\\')) {
      throw new Error('Path traversal detected in file key');
    }

    // 4. Normalize path separators and remove redundant slashes
    const normalizedKey = decodedKey.replace(/\\/g, '/').replace(/\/+/g, '/');

    // 5. Split into components and validate each part
    const parts = normalizedKey.split('/');
    if (parts.some((part) => part === '..' || part === '.')) {
      throw new Error('Invalid path component in file key');
    }

    // 6. Validate fileKey has reasonable structure (type/project/bug/filename)
    if (parts.length < MIN_STORAGE_PATH_PARTS) {
      throw new Error('Invalid file key structure');
    }

    // 7. Validate fileKey belongs to this project
    if (
      !normalizedKey.startsWith(`screenshots/${this.projectId}/`) &&
      !normalizedKey.startsWith(`replays/${this.projectId}/`)
    ) {
      throw new Error('Access denied: File does not belong to this project');
    }

    // 8. Generate presigned URL (read-only, short expiration)
    const url = await this.storage.getSignedUrl(normalizedKey, {
      expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
    });

    return url;
  }

  /**
   * Handle HTTP fetch request from plugin with security controls
   * @private
   */
  private async handleHttpFetch(
    url: string,
    options?: RequestInit
  ): Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
  }> {
    // 1. Validate URL and check SSRF protection (throws on blocked URLs)
    validateSSRFProtection(url);

    // 2. Sanitize fetch options to prevent header-based attacks
    const sanitizedOptions = this.sanitizeFetchOptions(options);

    // 3. Enforce timeout (10 seconds max)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HTTP_FETCH_TIMEOUT_MS);

    try {
      // 4. Log outbound request
      logger.info('Plugin HTTP request', {
        project_id: this.projectId,
        url,
        method: sanitizedOptions?.method || 'GET',
      });

      // 5. Execute fetch with sanitized options and timeout
      const response = await fetch(url, {
        ...sanitizedOptions,
        signal: controller.signal,
        // Override redirect to prevent open redirect attacks
        redirect: 'manual',
      });

      // 6. Check response size to prevent memory exhaustion
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (!isNaN(size) && size > MAX_RESPONSE_SIZE_BYTES) {
          throw new Error(
            `Response too large: ${(size / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_RESPONSE_SIZE_BYTES / 1024 / 1024}MB limit`
          );
        }
      }

      // 7. Stream response body with size validation (enforce limit during read, not after)
      // Critical: We must check size WHILE reading, not after loading entire response into memory
      // Otherwise, a malicious server could send multi-GB response before we detect it
      if (!response.body) {
        throw new Error('Response body stream not available');
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // Enforce size limit DURING streaming (not after)
          totalBytes += value.length;
          if (totalBytes > MAX_RESPONSE_SIZE_BYTES) {
            reader.cancel(); // Abort stream immediately
            throw new Error(
              `Response body too large: exceeded ${MAX_RESPONSE_SIZE_BYTES / 1024 / 1024}MB limit during streaming`
            );
          }

          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      // 8. Convert accumulated chunks to string using Node.js Buffer
      const body = Buffer.concat(chunks).toString('utf-8');

      // 9. Convert headers to plain object
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // 10. Log response status
      logger.info('Plugin HTTP response', {
        project_id: this.projectId,
        url,
        status: response.status,
        size: body.length,
      });

      return {
        status: response.status,
        statusText: response.statusText,
        headers,
        body,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`HTTP request timeout (${HTTP_FETCH_TIMEOUT_MS / 1000}s limit)`);
      }
      throw new Error(
        `HTTP request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Sanitize fetch options to prevent privilege escalation attacks
   * Removes dangerous headers and validates HTTP methods
   * @private
   */
  private sanitizeFetchOptions(options?: RequestInit): RequestInit | undefined {
    if (!options) {
      return undefined;
    }

    const sanitized: RequestInit = { ...options };

    // Remove or sanitize headers to prevent impersonation attacks
    if (options.headers) {
      const sanitizedHeaders = new Headers();
      const inputHeaders = new Headers(options.headers);

      inputHeaders.forEach((value, key) => {
        const lowerKey = key.toLowerCase();

        // Block sensitive authentication/authorization headers
        if (BLOCKED_HEADERS.has(lowerKey)) {
          logger.warn('Plugin attempted to set blocked header', {
            project_id: this.projectId,
            header: key,
          });
          return; // Skip this header
        }

        // Block Sec-* headers (Sec-Fetch-Site, Sec-WebSocket-Key, etc.)
        if (lowerKey.startsWith('sec-')) {
          logger.warn('Plugin attempted to set blocked Sec-* header', {
            project_id: this.projectId,
            header: key,
          });
          return; // Skip this header
        }

        // Allow safe headers
        sanitizedHeaders.set(key, value);
      });

      sanitized.headers = sanitizedHeaders;
    }

    // Validate HTTP method (only allow safe methods)
    const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
    if (options.method) {
      const upperMethod = options.method.toUpperCase();
      if (!allowedMethods.includes(upperMethod)) {
        throw new Error(`HTTP method not allowed: ${options.method}`);
      }
      sanitized.method = upperMethod;
    }

    return sanitized;
  }
}
