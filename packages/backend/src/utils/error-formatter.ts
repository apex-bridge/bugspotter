/**
 * Error Formatting Utilities
 * Standardized error message extraction for logging
 */

/**
 * Extracts error message from unknown error type for logging
 * Handles Error objects, strings, and unknown types safely
 *
 * @param error - Error of unknown type
 * @returns Formatted error message string
 *
 * @example
 * formatErrorForLog(new Error('failed')) // 'failed'
 * formatErrorForLog('string error')      // 'string error'
 * formatErrorForLog({ code: 500 })       // '[object Object]'
 * formatErrorForLog(null)                 // 'null'
 */
export function formatErrorForLog(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

/**
 * Extracts full error details including stack trace for debugging
 * Use this for detailed error logging in development/debug scenarios
 *
 * @param error - Error of unknown type
 * @returns Object with message and stack trace (if available)
 */
export function formatErrorDetails(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    message: formatErrorForLog(error),
  };
}
