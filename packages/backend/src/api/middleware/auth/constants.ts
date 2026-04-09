/**
 * Authentication constants
 */

export const HTTP_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export const DEFAULT_RATE_LIMITS = {
  MINUTE: 60,
  HOUR: 1000,
  DAY: 10000,
} as const;
