/**
 * Retry utilities for custom plugins
 * Provides exponential backoff retry logic for resilient API calls
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  isRetryable?: (error: any) => boolean;
}

/**
 * Execute a function with retry logic and exponential backoff
 * @param fn - Async function to execute
 * @param options - Retry configuration
 * @returns Result of successful function execution
 * @throws Last error if all attempts fail
 * @example
 * const result = await withRetry(
 *   () => context.http.fetch(url, options),
 *   {
 *     maxAttempts: 3,
 *     baseDelay: 1000,
 *     isRetryable: (error) => error.code !== 'AUTH_FAILED'
 *   }
 * );
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts || 3;
  const baseDelay = options.baseDelay || 1000;
  const maxDelay = options.maxDelay || 10000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // If this is the last attempt, throw the error
      if (attempt === maxAttempts) {
        throw error;
      }

      // Check if error is retryable
      if (options.isRetryable && !options.isRetryable(error)) {
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 1000; // 0-1000ms random jitter
      const delay = Math.min(exponentialDelay + jitter, maxDelay);

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new Error('Retry loop completed unexpectedly');
}
