/**
 * API Key route helper functions
 * Extracted to reduce duplication and improve maintainability
 */

import type { ApiKeyUpdate, PermissionScope, ApiKey } from '../../db/types.js';
import type { ApiKeyService } from '../../services/api-key/index.js';
import { RATE_LIMITS } from './constants.js';

/**
 * Update request body interface
 */
interface ApiKeyUpdateBody {
  name?: string;
  permission_scope?: PermissionScope;
  permissions?: string[];
  allowed_projects?: string[];
  allowed_origins?: string[];
  rate_limit_per_minute?: number | null;
  rate_limit_per_hour?: number | null;
  rate_limit_per_day?: number | null;
  expires_at?: string | null;
}

/**
 * Rate limit status response interface
 */
interface RateLimitStatus {
  minute: {
    limit: number;
    remaining: number;
    reset_at: string;
  };
  hour: {
    limit: number;
    remaining: number;
    reset_at: string;
  };
  day: {
    limit: number;
    remaining: number;
    reset_at: string;
  };
}

/**
 * Maps request body to update object, handling null to undefined conversion
 * @param body - Request body from PATCH /api/v1/api-keys/:id
 * @returns Mapped update object for service layer
 */
export function mapUpdateFields(body: ApiKeyUpdateBody): Partial<ApiKeyUpdate> {
  const updates: Partial<ApiKeyUpdate> = {};

  // Simple field mapping - type-safe approach
  if (body.name !== undefined) {
    updates.name = body.name;
  }
  // Permission resolution and consistency (scope ↔ permissions sync)
  // is handled in ApiKeyService.updateKey, not here.
  if (body.permission_scope !== undefined) {
    updates.permission_scope = body.permission_scope;
  }
  if (body.permissions !== undefined) {
    updates.permissions = body.permissions;
  }
  if (body.allowed_projects !== undefined) {
    updates.allowed_projects = body.allowed_projects;
  }
  if (body.allowed_origins !== undefined) {
    updates.allowed_origins = body.allowed_origins;
  }

  // Handle rate limits (null → undefined conversion)
  const rateLimitFields = [
    'rate_limit_per_minute',
    'rate_limit_per_hour',
    'rate_limit_per_day',
  ] as const;

  for (const field of rateLimitFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field] ?? undefined;
    }
  }

  // Handle expires_at date conversion
  if (body.expires_at !== undefined) {
    updates.expires_at = body.expires_at ? new Date(body.expires_at) : null;
  }

  return updates;
}

/**
 * Gets rate limit status for all windows
 * @param apiKeyService - API key service instance
 * @param keyId - API key ID
 * @param apiKey - API key object with rate limits
 * @returns Rate limit status for all windows
 */
export async function getRateLimitStatus(
  apiKeyService: ApiKeyService,
  keyId: string,
  apiKey: ApiKey
): Promise<RateLimitStatus> {
  // Get current rate limit status for all windows
  const [minuteStatus, hourStatus, dayStatus] = await Promise.all([
    apiKeyService.checkRateLimit(
      keyId,
      'minute',
      apiKey.rate_limit_per_minute || RATE_LIMITS.DEFAULT_PER_MINUTE
    ),
    apiKeyService.checkRateLimit(
      keyId,
      'hour',
      apiKey.rate_limit_per_hour || RATE_LIMITS.DEFAULT_PER_HOUR
    ),
    apiKeyService.checkRateLimit(
      keyId,
      'day',
      apiKey.rate_limit_per_day || RATE_LIMITS.DEFAULT_PER_DAY
    ),
  ]);

  return {
    minute: {
      limit: apiKey.rate_limit_per_minute || RATE_LIMITS.DEFAULT_PER_MINUTE,
      remaining: minuteStatus.allowed ? minuteStatus.remaining : 0,
      reset_at: minuteStatus.resetAt.toISOString(),
    },
    hour: {
      limit: apiKey.rate_limit_per_hour || RATE_LIMITS.DEFAULT_PER_HOUR,
      remaining: hourStatus.allowed ? hourStatus.remaining : 0,
      reset_at: hourStatus.resetAt.toISOString(),
    },
    day: {
      limit: apiKey.rate_limit_per_day || RATE_LIMITS.DEFAULT_PER_DAY,
      remaining: dayStatus.allowed ? dayStatus.remaining : 0,
      reset_at: dayStatus.resetAt.toISOString(),
    },
  };
}
