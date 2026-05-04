/**
 * Audit Middleware
 * Automatically logs all administrative actions (POST, PUT, PATCH, DELETE)
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

// Routes to exclude from audit logging (health checks, public endpoints, etc.)
const EXCLUDED_ROUTES = new Set([
  '/health',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
  '/api/v1/setup/status',
]);

// Methods that trigger audit logging
const AUDIT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Extract resource ID from request path and body
 * Uses multiple strategies to find UUIDs without hardcoding field names
 */
function extractResourceId(request: FastifyRequest): string | null {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * Helper to check if a value is a UUID string
   */
  function isUuid(value: unknown): value is string {
    return typeof value === 'string' && uuidRegex.test(value);
  }

  /**
   * Recursively search for UUID values in an object (max depth 3)
   */
  function findUuidInObject(obj: unknown, depth = 0): string | null {
    if (depth > 3 || !obj || typeof obj !== 'object') {
      return null;
    }

    const record = obj as Record<string, unknown>;

    // Prioritize common ID field names
    const priorityFields = ['id', 'project_id', 'user_id', 'bug_id', 'report_id', 'session_id'];
    for (const field of priorityFields) {
      if (field in record && isUuid(record[field])) {
        return record[field];
      }
    }

    // Search all fields that end with 'id' or '_id'
    for (const [key, value] of Object.entries(record)) {
      if ((key === 'id' || key.endsWith('_id') || key.endsWith('Id')) && isUuid(value)) {
        return value;
      }
    }

    // Recursively search nested objects
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        const found = findUuidInObject(value, depth + 1);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  // 1. Try Fastify route params first (most reliable)
  const params = request.params;
  if (params && typeof params === 'object') {
    const paramId = findUuidInObject(params);
    if (paramId) {
      return paramId;
    }
  }

  // 2. Scan URL path for any UUID segment (handles IDs in middle of path)
  const path = request.url.split('?')[0];
  const pathParts = path.split('/');
  for (const part of pathParts) {
    if (isUuid(part)) {
      return part;
    }
  }

  // 3. Search request body for UUID values
  const body = request.body;
  if (body && typeof body === 'object') {
    const bodyId = findUuidInObject(body);
    if (bodyId) {
      return bodyId;
    }
  }

  return null;
}

/**
 * Sanitize request data for audit logging
 * Recursively remove sensitive fields like passwords, tokens, and keys
 */
function sanitizeData(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const sensitiveFields = [
    'password',
    'password_hash',
    'api_key',
    'apikey',
    'secret',
    'token',
    'access_token',
    'refresh_token',
    'reset_token',
    'auth_token',
    'session_token',
    'jwt',
    'bearer',
  ];

  /**
   * Recursively sanitize an object or array
   */
  function sanitizeRecursive(obj: unknown): unknown {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map((item) => sanitizeRecursive(item));
    }

    // Handle objects
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Check if field name is sensitive
      if (sensitiveFields.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else if (value && typeof value === 'object') {
        // Recursively sanitize nested objects/arrays
        sanitized[key] = sanitizeRecursive(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  return sanitizeRecursive(data) as Record<string, unknown>;
}

/**
 * Create audit middleware
 * This runs after the request handler completes
 */
export function createAuditMiddleware(db: DatabaseClient) {
  return async function auditMiddleware(request: FastifyRequest, reply: FastifyReply) {
    // Skip if not an auditable method
    if (!AUDIT_METHODS.has(request.method)) {
      return;
    }

    // Skip excluded routes
    const path = request.url.split('?')[0]; // Remove query params
    if (EXCLUDED_ROUTES.has(path)) {
      return;
    }

    // Skip public routes (routes without authentication)
    const routeConfig = request.routeOptions?.config as { public?: boolean } | undefined;
    if (routeConfig?.public) {
      return;
    }

    // Get user info from auth context. The honest scope of what this
    // middleware records:
    //
    //   - api-key-only requests: `user_id` null, `details.api_key_id`
    //     populated. Attribution captured.
    //   - JWT-only requests: `user_id` populated, `details.api_key_id`
    //     null. Attribution captured.
    //   - DUAL-HEADER (JWT + api-key): `user_id` STILL null,
    //     `details.api_key_id` populated. The auth middleware
    //     short-circuits on api-key (auth/middleware.ts:71) and never
    //     populates `request.authUser`, so the JWT user's id is
    //     unreachable from this hook. The audit trail therefore
    //     captures the machine identity but loses the human actor.
    //     Handler-level loggers (e.g. routes/integrations.ts,
    //     routes/integration-rules.ts) read the same
    //     `request.authUser?.id ?? null`, so they share this gap —
    //     they do NOT partially close it. Closing it here requires
    //     a deeper auth-middleware change that runs JWT parsing
    //     alongside api-key validation for identity purposes; out
    //     of scope for #97's Option B fix and warrants its own
    //     design pass.
    //
    // Schema-level `audit_logs.api_key_id` column is also still
    // deferred (GH-104) — until that lands, api-key attribution
    // queries scan the `details` JSONB.
    const authUser = request.authUser;
    const userId = authUser?.id ?? null;
    const apiKeyId = request.apiKey?.id ?? null;

    // Capture organization context (set by guard/org-access middleware on org/project routes)
    const organizationId = request.organizationId ?? null;

    // Extract request details
    const resourceId = extractResourceId(request);
    const ipAddress = request.ip;
    // Truncate user-agent to prevent database bloat from malicious headers
    const rawUserAgent = request.headers['user-agent'];
    const userAgent = rawUserAgent ? rawUserAgent.substring(0, 500) : null;

    // Determine success based on status code
    const success = reply.statusCode < 400;
    let errorMessage: string | null = null;

    if (!success) {
      errorMessage = `Request failed with status ${reply.statusCode}`;
    }

    // Create audit log entry asynchronously (don't block response)
    const auditData = {
      user_id: userId,
      organization_id: organizationId,
      action: request.method,
      resource: path,
      resource_id: resourceId,
      ip_address: ipAddress,
      user_agent: userAgent,
      details: {
        body: sanitizeData(request.body),
        query: sanitizeData(request.query),
        params: sanitizeData(request.params),
        // `api_key_id` lives in details (JSONB) because the audit_logs
        // table has no first-class api_key_id column today. Indexed
        // schema-level migration tracked separately so api-key-attributed
        // queries (e.g., "all actions from this leaked key") don't have
        // to scan JSONB.
        api_key_id: apiKeyId,
      },
      success,
      error_message: errorMessage,
    };

    // Log asynchronously without blocking
    db.auditLogs.create(auditData).catch((err) => {
      logger.error('Failed to create audit log', { error: err, auditData });
    });
  };
}

/**
 * Manually create an audit log entry. Use this for custom audit
 * events not captured by middleware.
 *
 * **`details` is always non-null in the persisted row** — even when
 * the caller passes no `details`, the helper writes
 * `{ api_key_id: <value | null> }` so every audit row has a uniform
 * JSONB shape. This is intentional for the GH-104 column-level
 * migration (api_key_id moves out of JSONB) and matches the global
 * middleware's behaviour. **Implication for callers / SIEM rules**:
 * `WHERE details IS NULL` will never match rows written by this
 * helper; filter on `details ? 'api_key_id'` or `details->>'api_key_id'`
 * instead if you want "no machine attribution" semantics.
 */
export async function createAuditLog(
  db: DatabaseClient,
  data: {
    userId?: string;
    /**
     * API-key id when the action was driven by a machine credential
     * (or by a user with an api-key in the same request — see GH-97
     * audit-identity gap). Required (`string | null`) so callers must
     * explicitly pass `null` for human-only actions; this prevents the
     * silent-omission bug where `apiKeyId` was optional and forgetting
     * to pass it dropped `api_key_id` from the audit row entirely,
     * hiding machine-attributed actions from queries that filter on
     * `details.api_key_id`.
     */
    apiKeyId: string | null;
    action: string;
    resource: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    success?: boolean;
    errorMessage?: string;
  }
) {
  try {
    await db.auditLogs.create({
      user_id: data.userId || null,
      action: data.action,
      resource: data.resource,
      resource_id: data.resourceId || null,
      // Always include `api_key_id` in details (matching the global
      // middleware) so the column-level migration in GH-104 can
      // backfill from a uniform JSONB shape.
      details: { ...(data.details ?? {}), api_key_id: data.apiKeyId },
      success: data.success ?? true,
      error_message: data.errorMessage || null,
    });
  } catch (error) {
    logger.error('Failed to create manual audit log', { error, data });
  }
}
