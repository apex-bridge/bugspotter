/**
 * Authentication handler functions
 * Processes different authentication methods (API keys, JWT)
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseClient } from '../../../db/client.js';
import { ApiKeyService } from '../../../services/api-key/index.js';
import type { ApiKey } from '../../../db/types.js';
import { sendUnauthorized, sendRateLimitExceeded } from './responses.js';
import { DEFAULT_RATE_LIMITS } from './constants.js';

// ============================================================================
// RATE LIMIT HELPERS
// ============================================================================

/**
 * Check rate limits for API key
 */
async function checkRateLimits(
  apiKeyService: ApiKeyService,
  apiKey: ApiKey,
  reply: FastifyReply
): Promise<boolean> {
  const checks = [
    {
      window: 'minute' as const,
      limit: apiKey.rate_limit_per_minute || DEFAULT_RATE_LIMITS.MINUTE,
    },
    { window: 'hour' as const, limit: apiKey.rate_limit_per_hour || DEFAULT_RATE_LIMITS.HOUR },
    { window: 'day' as const, limit: apiKey.rate_limit_per_day || DEFAULT_RATE_LIMITS.DAY },
  ];

  for (const { window, limit } of checks) {
    const result = await apiKeyService.checkRateLimit(apiKey.id, window, limit);
    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000);
      sendRateLimitExceeded(reply, window, retryAfter);
      return false;
    }
  }

  return true;
}

// ============================================================================
// AUTHENTICATION HANDLERS
// ============================================================================

/**
 * Handle API key authentication (bgs_ prefix)
 * Returns true if authenticated, false if authentication failed
 */
export async function handleNewApiKeyAuth(
  apiKeyHeader: string,
  apiKeyService: ApiKeyService,
  db: DatabaseClient,
  request: FastifyRequest,
  reply: FastifyReply,
  startTime: number
): Promise<boolean> {
  const result = await apiKeyService.verifyAndGetKey(apiKeyHeader);

  if (!result.key) {
    // Provide specific error messages based on failure reason
    if (result.failureReason === 'revoked') {
      sendUnauthorized(reply, 'API key has been revoked');
      return true; // Return true to indicate request was handled (error sent)
    } else if (result.failureReason === 'expired') {
      sendUnauthorized(reply, 'API key has expired');
      return true;
    } else if (result.failureReason === 'inactive' && result.existingKey) {
      sendUnauthorized(reply, `API key is ${result.existingKey.status}`);
      return true;
    }

    // Key not found - send generic error
    sendUnauthorized(reply, 'Invalid API key');
    return false;
  }

  const apiKey = result.key;

  // Check rate limits (this atomically increments counters)
  const rateLimitOk = await checkRateLimits(apiKeyService, apiKey, reply);
  if (!rateLimitOk) {
    return false;
  }

  // Set API key in request context
  request.apiKey = apiKey;

  // Load project ONLY if API key is scoped to single project
  // Multi-project API keys use checkProjectPermission instead
  if (apiKey.allowed_projects && apiKey.allowed_projects.length === 1) {
    const project = await db.projects.findById(apiKey.allowed_projects[0]);
    if (project) {
      request.authProject = project;
    }
  }

  // Track usage (async, don't block request)
  const responseTime = Date.now() - startTime;
  apiKeyService
    .trackUsage(
      apiKey.id,
      request.url,
      request.method,
      200,
      responseTime,
      request.headers['user-agent'] || 'unknown',
      request.ip
    )
    .catch((err) => {
      request.log.error({ error: err }, 'Failed to track API key usage');
    });

  request.log.debug(
    { api_key_id: apiKey.id, has_project: !!request.authProject },
    'New API key authentication successful'
  );
  return true;
}

/**
 * Handle share token authentication (for shared replay access)
 * Checks both query params (GET) and request body (POST) for share tokens
 *
 * SECURITY: For POST requests, passwords are ONLY accepted in request body,
 * never in query params (which can be logged). This prevents password leakage.
 */
export async function handleShareTokenAuth(
  request: FastifyRequest,
  db: DatabaseClient
): Promise<boolean> {
  const query = request.query as { shareToken?: string; shareTokenPassword?: string };
  const body = request.body as { shareToken?: string; shareTokenPassword?: string } | undefined;

  // Check query params first (backward compatibility), then body (for POST)
  const shareToken = query.shareToken || body?.shareToken;

  // CRITICAL SECURITY: For POST requests, ONLY accept password from body
  // For GET requests, accept password from query params
  const password = request.method === 'POST' ? body?.shareTokenPassword : query.shareTokenPassword;

  if (!shareToken || typeof shareToken !== 'string') {
    return false;
  }

  const tokenInfo = await db.shareTokens.verifyToken(shareToken, password);
  if (!tokenInfo) {
    return false;
  }

  // Valid share token - set auth context
  request.authShareToken = { bug_report_id: tokenInfo.bug_report_id };
  request.log.debug(
    { bug_report_id: tokenInfo.bug_report_id },
    'Share token authentication successful'
  );
  return true;
}

/**
 * Handle JWT Bearer token authentication
 */
export async function handleJwtAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  db: DatabaseClient
): Promise<boolean> {
  try {
    const decoded = await request.jwtVerify();

    // Fetch full user details to ensure fresh data
    const user = await db.users.findById(decoded.userId);
    if (!user) {
      sendUnauthorized(reply, 'User not found');
      return false;
    }

    request.authUser = user;
    request.log.debug({ user_id: user.id }, 'JWT authentication successful');
    return true;
  } catch (error) {
    request.log.debug({ error }, 'JWT authentication failed');
    sendUnauthorized(reply, 'Invalid or expired token');
    return false;
  }
}
