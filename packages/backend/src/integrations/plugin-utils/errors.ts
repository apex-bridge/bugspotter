/**
 * Error handling utilities for custom plugins
 * Provides standardized error codes and error creation
 */

/**
 * Standard error codes for plugin operations
 */
export const ERROR_CODES = {
  AUTH_FAILED: 'AUTH_FAILED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  INVALID_CONFIG: 'INVALID_CONFIG',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RATE_LIMIT: 'RATE_LIMIT',
  TIMEOUT: 'TIMEOUT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface PluginErrorDetails {
  [key: string]: any;
}

/**
 * Extended Error with code and details
 */
export class PluginError extends Error {
  public readonly code: ErrorCode;
  public readonly details: PluginErrorDetails;

  constructor(code: ErrorCode, message: string, details: PluginErrorDetails = {}) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Create a standardized plugin error
 * @param code - Error code from ERROR_CODES
 * @param message - Human-readable error message
 * @param details - Additional error context
 * @returns PluginError instance
 * @example
 * throw createPluginError(
 *   ERROR_CODES.AUTH_FAILED,
 *   'Invalid API credentials',
 *   { statusCode: 401, endpoint: '/api/issues' }
 * );
 */
export function createPluginError(
  code: ErrorCode,
  message: string,
  details: PluginErrorDetails = {}
): PluginError {
  return new PluginError(code, message, details);
}
