/**
 * API constants
 * Centralized constants for the API layer
 */

/**
 * Password hashing configuration
 */
export const PASSWORD = {
  SALT_ROUNDS: 10,
} as const;

/**
 * Time unit multipliers for converting to seconds
 */
export const TIME_MULTIPLIERS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
} as const;

/**
 * Default expiry time in seconds (24 hours)
 */
export const DEFAULT_TOKEN_EXPIRY_SECONDS = 86400;

/**
 * API key prefix
 */
export const API_KEY_PREFIX = 'bgs_';

/**
 * API key random bytes length
 */
export const API_KEY_BYTES = 32;

/**
 * Default pagination values
 */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
} as const;

/**
 * Default sorting configuration
 */
export const SORTING = {
  DEFAULT_SORT_BY: 'created_at',
  DEFAULT_ORDER: 'desc',
} as const;

/**
 * Default rate limit values
 */
export const RATE_LIMITS = {
  DEFAULT_PER_MINUTE: 60,
  DEFAULT_PER_HOUR: 1000,
  DEFAULT_PER_DAY: 10000,
} as const;

/**
 * Request body size limit (1MB)
 * Protects against DoS attacks via large JSON payloads
 * Multipart uploads use separate limit from server config
 */
export const REQUEST_BODY_LIMIT = 1048576; // 1MB in bytes

/**
 * Parse time string (e.g., "24h", "7d") to seconds
 * @param timeString - Time string with format: number + unit (s/m/h/d)
 * @param defaultSeconds - Default value if parsing fails (defaults to 1 hour)
 * @returns Time in seconds
 */
export function parseTimeString(timeString: string, defaultSeconds = 3600): number {
  const match = timeString.match(/^(\d+)([smhd])$/);
  if (!match) {
    return defaultSeconds;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  return value * (TIME_MULTIPLIERS[unit] || 1);
}
