/**
 * API Key Rate Limiter
 * Handles rate limit checking and tracking
 */

import type { DatabaseClient } from '../../db/client.js';
import { getLogger } from '../../logger.js';
import type { RateLimitWindow } from '../../db/types.js';
import { RATE_LIMIT_WINDOW } from '../../db/types.js';

const logger = getLogger();

/**
 * Time window durations (milliseconds)
 */
export const WINDOW_DURATIONS = new Map<RateLimitWindow, number>([
  [RATE_LIMIT_WINDOW.MINUTE, 60 * 1000],
  [RATE_LIMIT_WINDOW.HOUR, 60 * 60 * 1000],
  [RATE_LIMIT_WINDOW.DAY, 24 * 60 * 60 * 1000],
  [RATE_LIMIT_WINDOW.BURST, 10 * 1000],
]);

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  window: RateLimitWindow;
}

/**
 * Calculate start of current time window
 * @param window - Rate limit window type
 * @returns Start of window as Date
 */
export function calculateWindowStart(window: RateLimitWindow): Date {
  const now = Date.now();
  const duration = WINDOW_DURATIONS.get(window);

  if (!duration) {
    throw new Error(`Unknown rate limit window: ${window}`);
  }

  // For minute/hour/day windows, align to window boundaries
  if (window === RATE_LIMIT_WINDOW.MINUTE) {
    const startOfMinute = new Date(now);
    startOfMinute.setSeconds(0, 0);
    return startOfMinute;
  }

  if (window === RATE_LIMIT_WINDOW.HOUR) {
    const startOfHour = new Date(now);
    startOfHour.setMinutes(0, 0, 0);
    return startOfHour;
  }

  if (window === RATE_LIMIT_WINDOW.DAY) {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    return startOfDay;
  }

  // For burst window, align to current second for consistent grouping
  // This prevents race conditions where requests 1ms apart create separate counters
  if (window === RATE_LIMIT_WINDOW.BURST) {
    const startOfSecond = new Date(now);
    startOfSecond.setMilliseconds(0);
    return startOfSecond;
  }

  throw new Error(`Unhandled rate limit window: ${window}`);
}

/**
 * Calculate when rate limit resets
 * @param window - Rate limit window type
 * @returns Reset time as Date
 */
export function calculateResetTime(window: RateLimitWindow): Date {
  const now = new Date();

  if (window === RATE_LIMIT_WINDOW.MINUTE) {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes() + 1,
      0,
      0
    );
  }

  if (window === RATE_LIMIT_WINDOW.HOUR) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
  }

  if (window === RATE_LIMIT_WINDOW.DAY) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  }

  // For burst, reset at start of next second + 10 seconds
  if (window === RATE_LIMIT_WINDOW.BURST) {
    const resetTime = new Date(now);
    resetTime.setMilliseconds(0);
    resetTime.setSeconds(resetTime.getSeconds() + 10);
    return resetTime;
  }

  throw new Error(`Unhandled rate limit window: ${window}`);
}

/**
 * Check if API key is within rate limit
 * Uses atomic increment-and-check to prevent race conditions
 * @param db - Database client
 * @param keyId - API key ID
 * @param window - Rate limit window to check
 * @param limit - Maximum requests allowed in window (0 = deny all requests)
 * @returns Rate limit check result
 */
export async function checkRateLimit(
  db: DatabaseClient,
  keyId: string,
  window: RateLimitWindow,
  limit: number
): Promise<RateLimitResult> {
  // Input validation
  if (limit < 0) {
    throw new Error(`Rate limit must be non-negative, got: ${limit}`);
  }

  if (!keyId || keyId.trim() === '') {
    throw new Error('API key ID is required');
  }

  // Special case: limit of 0 means deny all requests (soft disable)
  if (limit === 0) {
    const resetAt = calculateResetTime(window);
    logger.info('Rate limit set to 0 - denying all requests', {
      keyId,
      window,
      resetAt: resetAt.toISOString(),
    });
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      window,
    };
  }

  try {
    const windowStart = calculateWindowStart(window);

    // Atomic increment-and-check to prevent race conditions
    const currentCount = await db.apiKeys.incrementRateLimit(keyId, window, windowStart);

    const allowed = currentCount <= limit;
    const remaining = Math.max(0, limit - currentCount);
    const resetAt = calculateResetTime(window);

    if (!allowed) {
      logger.warn('Rate limit exceeded', {
        keyId,
        window,
        limit,
        currentCount,
        resetAt: resetAt.toISOString(),
      });
    }

    return {
      allowed,
      remaining,
      resetAt,
      window,
    };
  } catch (error) {
    logger.error('Rate limit check failed - DENYING request for security', {
      keyId,
      window,
      limit,
      error: error instanceof Error ? error.message : String(error),
    });

    // Fail closed: deny request on error to prevent rate limit bypass
    return {
      allowed: false,
      remaining: 0,
      resetAt: calculateResetTime(window),
      window,
    };
  }
}

/**
 * Decrement rate limit counter (rollback)
 * Used when a request fails after incrementing the counter
 * @param db - Database client
 * @param keyId - API key ID
 * @param window - Rate limit window to decrement
 */
export async function decrementRateLimit(
  db: DatabaseClient,
  keyId: string,
  window: RateLimitWindow
): Promise<void> {
  try {
    const windowStart = calculateWindowStart(window);
    const query = `
      UPDATE api_key_rate_limits
      SET request_count = GREATEST(0, request_count - 1)
      WHERE api_key_id = $1 AND window_type = $2 AND window_start = $3
    `;
    await db.query(query, [keyId, window, windowStart]);
  } catch (error) {
    logger.error('Failed to decrement rate limit', {
      keyId,
      window,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - rollback is best-effort
  }
}
