/**
 * Database-specific retry utilities
 * Re-exports from unified retry utilities with database-specific defaults
 */

import {
  executeWithRetry as genericExecuteWithRetry,
  withRetry as genericWithRetry,
  RetryPredicates,
  DEFAULT_RETRY_CONFIG as GENERIC_DEFAULT_RETRY_CONFIG,
  type RetryConfig as GenericRetryConfig,
  type RetryStrategy,
  ExponentialBackoffStrategy,
  LinearBackoffStrategy,
  FixedDelayStrategy,
} from '../utils/retry.js';

// Re-export types and strategies
export type { RetryStrategy };
export { ExponentialBackoffStrategy, LinearBackoffStrategy, FixedDelayStrategy };

/**
 * Database-specific retry configuration
 */
export interface RetryConfig {
  maxAttempts?: number;
  baseDelay?: number;
  strategy?: RetryStrategy;
}

/**
 * Default retry configuration for database operations
 * Re-exported from generic retry utilities (same values)
 */
export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = GENERIC_DEFAULT_RETRY_CONFIG;

/**
 * Check if error is retryable for database operations
 * Delegates to unified retry predicate
 */
export function isRetryableError(error: unknown): boolean {
  return RetryPredicates.isDatabaseError(error);
}

/**
 * Execute function with automatic retry on database connection errors
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  // Convert database retry config to generic retry config
  const genericConfig: GenericRetryConfig = {
    ...config,
    shouldRetry: RetryPredicates.isDatabaseError,
  };

  // The unified retry utility handles attempt tracking internally
  return genericExecuteWithRetry(fn, genericConfig);
}

/**
 * Wrap a function with database retry logic
 */
export function withRetry<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  config: RetryConfig = {}
): (...args: TArgs) => Promise<TReturn> {
  const genericConfig: GenericRetryConfig = {
    ...config,
    shouldRetry: RetryPredicates.isDatabaseError,
  };

  return genericWithRetry(fn, genericConfig);
}
