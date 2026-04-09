/**
 * Security Sanitization Utilities
 * Provides functions to sanitize sensitive data from error messages and logs
 *
 * Used across the application to prevent leaking credentials, connection strings,
 * API keys, tokens, file paths, IP addresses, and other sensitive information.
 */

/**
 * Patterns that might contain sensitive data
 * Compiled once at module load for performance
 */
const SENSITIVE_PATTERNS = [
  // Database connection strings
  /postgres:\/\/[^@]+@[^/]+/gi, // PostgreSQL connection strings
  /mysql:\/\/[^@]+@[^/]+/gi, // MySQL connection strings
  /mongodb:\/\/[^@]+@[^/]+/gi, // MongoDB connection strings
  /redis:\/\/[^@]+@[^/]+/gi, // Redis connection strings

  // Credentials and secrets
  /password[=:]\s*[^\s&]+/gi, // Password parameters
  /api[-_]?key[=:]\s*[^\s&]+/gi, // API key parameters
  /token[=:]\s*[^\s&]+/gi, // Token parameters
  /secret[=:]\s*[^\s&]+/gi, // Secret parameters
  /client[-_]?secret[=:]\s*[^\s&]+/gi, // OAuth client secrets

  // Authorization headers (generic pattern)
  /Authorization:\s*[^\s]+\s+[^\s]+/gi, // Any Authorization header
  /Bearer\s+[^\s]+/gi, // Bearer tokens (more specific)
  /Basic\s+[^\s]+/gi, // Basic auth tokens

  // API keys with common prefixes
  /\b(sk|pk|api|key)_[a-zA-Z0-9_-]{20,}\b/gi, // Keys with prefixes (sk_, pk_, api_, key_)

  // File paths that might reveal system structure
  /[a-zA-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/gi, // Windows paths
  /\/(?:home|root|usr|var|opt|mnt)\/[^\s]*/gi, // Sensitive Unix paths

  // IP addresses (internal network info)
  /\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g, // Private IP ranges

  // Email addresses (PII)
  /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi, // Email addresses
] as const;

/**
 * Redaction placeholder for sanitized sensitive data
 */
const REDACTION_PLACEHOLDER = '[REDACTED]';

/**
 * Sanitize error messages to prevent leaking sensitive data
 *
 * Replaces sensitive patterns (credentials, tokens, paths, emails, IPs)
 * with a redaction placeholder to prevent information disclosure.
 *
 * @param errorMessage - The error message to sanitize
 * @returns Sanitized error message with sensitive data replaced by [REDACTED]
 *
 * @example
 * ```typescript
 * const error = new Error('Connection failed to postgres://user:pass@host/db');
 * const sanitized = sanitizeErrorMessage(error.message);
 * // Returns: 'Connection failed to [REDACTED]'
 * ```
 */
export function sanitizeErrorMessage(errorMessage: string): string {
  let sanitized = errorMessage;

  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTION_PLACEHOLDER);
  }

  return sanitized;
}

/**
 * Sanitize an Error object, creating a new Error with sanitized message
 *
 * Preserves the error stack trace but sanitizes the message property.
 * Useful for logging errors without exposing sensitive data.
 *
 * @param error - The error to sanitize
 * @returns New Error object with sanitized message
 *
 * @example
 * ```typescript
 * try {
 *   await connectToDatabase('postgres://user:pass@host/db');
 * } catch (error) {
 *   const sanitized = sanitizeError(error);
 *   logger.error('Database connection failed', { error: sanitized });
 * }
 * ```
 */
export function sanitizeError(error: Error): Error {
  const sanitized = new Error(sanitizeErrorMessage(error.message));
  sanitized.name = error.name;
  sanitized.stack = error.stack;
  return sanitized;
}

/**
 * Sanitize an unknown error value (handles Error objects, strings, and other types)
 *
 * Safely handles any error type thrown in catch blocks:
 * - Error objects: sanitizes message
 * - Strings: sanitizes directly
 * - Other types: converts to string then sanitizes
 *
 * @param error - The error value to sanitize (any type)
 * @returns Sanitized error message string
 *
 * @example
 * ```typescript
 * try {
 *   throw 'Connection string: postgres://user:pass@host/db';
 * } catch (error) {
 *   const sanitized = sanitizeUnknownError(error);
 *   logger.error('Error occurred', { message: sanitized });
 * }
 * ```
 */
export function sanitizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeErrorMessage(error.message);
  }

  if (typeof error === 'string') {
    return sanitizeErrorMessage(error);
  }

  return sanitizeErrorMessage(String(error));
}

/**
 * Sanitize a log context object, removing or redacting sensitive fields
 *
 * Recursively processes objects to sanitize string values and nested objects.
 * Arrays are processed element-by-element. Non-string primitives pass through.
 *
 * @param context - The log context object to sanitize
 * @returns Sanitized context object safe for logging
 *
 * @example
 * ```typescript
 * const logContext = {
 *   userId: '123',
 *   error: 'Failed with token=abc123',
 *   metadata: { apiKey: 'sk_live_abc123' }
 * };
 * const sanitized = sanitizeLogContext(logContext);
 * logger.info('Operation failed', sanitized);
 * // { userId: '123', error: 'Failed with [REDACTED]', metadata: { apiKey: '[REDACTED]' } }
 * ```
 */
export function sanitizeLogContext(context: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeErrorMessage(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeLogContext(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) => {
        if (typeof item === 'string') {
          return sanitizeErrorMessage(item);
        } else if (item && typeof item === 'object') {
          return sanitizeLogContext(item as Record<string, unknown>);
        }
        return item;
      });
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
