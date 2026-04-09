/**
 * Redis Utilities
 * Helper functions for Redis connection management and logging
 */

/**
 * Sanitize Redis URL by hiding password
 * Replaces password in connection string with *** for safe logging
 *
 * @param redisUrl - Redis connection URL (can be undefined)
 * @returns Sanitized URL with password hidden, or 'not set' if undefined
 *
 * @example
 * sanitizeRedisUrl('redis://:password123@localhost:6379')
 * // Returns: 'redis://:***@localhost:6379'
 */
export function sanitizeRedisUrl(redisUrl: string | undefined): string {
  if (!redisUrl) {
    return 'not set';
  }
  return redisUrl.replace(/:[^:@]*@/, ':***@');
}

/**
 * Create critical error log object with common fields
 * Standardizes error logging format across Redis connection errors
 *
 * @param error - Error message
 * @param action - Recommended action to resolve the error
 * @param redisUrl - Redis connection URL (will be sanitized)
 * @param additionalFields - Optional additional fields to include
 * @returns Object ready for console.error logging
 */
export function createCriticalRedisError(
  error: string,
  action: string,
  redisUrl: string | undefined,
  additionalFields?: Record<string, unknown>
): Record<string, unknown> {
  return {
    error,
    timestamp: new Date().toISOString(),
    action,
    redisUrl: sanitizeRedisUrl(redisUrl),
    ...additionalFields,
  };
}

/**
 * Error pattern mappings for Redis errors
 * Maps error patterns to their corresponding log messages and actions
 */
const ERROR_PATTERNS = new Map<
  string,
  { message: string; action: string; shouldLog: (context?: string) => boolean }
>([
  [
    'suspended',
    {
      message: 'Redis database suspended',
      action: 'Contact your Redis provider support to reactivate the database',
      shouldLog: () => true,
    },
  ],
  [
    'ECONNREFUSED',
    {
      message: 'Redis connection refused',
      action: 'Verify Redis service is running and REDIS_URL is correctly configured',
      shouldLog: () => true,
    },
  ],
  [
    'default',
    {
      message: 'Redis connection failed',
      action: 'Check Redis configuration and connectivity',
      shouldLog: (context) => context === 'startup',
    },
  ],
]);

/**
 * Log critical Redis connection errors with consistent formatting
 * Detects common error patterns and provides appropriate guidance
 *
 * @param error - Error object or message
 * @param redisUrl - Redis connection URL (will be sanitized)
 * @param context - Optional context (e.g., 'startup', 'runtime')
 */
export function logCriticalRedisError(
  error: Error | string,
  redisUrl: string | undefined,
  context?: string
): void {
  const errorMessage = typeof error === 'string' ? error : error.message;
  const prefix = context ? `[${context}] ` : '';

  // Find matching error pattern
  let errorConfig = ERROR_PATTERNS.get('default')!;
  for (const [pattern, config] of ERROR_PATTERNS) {
    if (pattern !== 'default' && errorMessage.includes(pattern)) {
      errorConfig = config;
      break;
    }
  }

  // Only log if the pattern's shouldLog condition is met
  if (errorConfig.shouldLog(context)) {
    console.error(
      `[CRITICAL] ${prefix}${errorConfig.message}:`,
      createCriticalRedisError(errorMessage, errorConfig.action, redisUrl)
    );
  }
}
