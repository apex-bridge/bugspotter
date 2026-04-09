/**
 * Generic retry utilities with configurable backoff strategies
 * Can be used across database, storage, and API layers
 */

import { setTimeout as setTimeoutPromise } from 'timers/promises';
import { getLogger } from '../logger.js';

const logger = getLogger();

/**
 * Retry strategy interface for calculating delays
 */
export interface RetryStrategy {
  calculateDelay(attempt: number, baseDelay: number): number;
}

/**
 * Exponential backoff: delay = baseDelay * 2^(attempt-1) + jitter
 * Includes jitter to prevent thundering herd
 */
export class ExponentialBackoffStrategy implements RetryStrategy {
  constructor(
    private maxDelay: number = 30000,
    private jitterFactor: number = 0.5
  ) {}

  calculateDelay(attempt: number, baseDelay: number): number {
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * exponentialDelay * this.jitterFactor;
    return Math.min(exponentialDelay + jitter, this.maxDelay);
  }
}

/**
 * Linear backoff: delay = baseDelay * attempt
 */
export class LinearBackoffStrategy implements RetryStrategy {
  constructor(private maxDelay: number = 30000) {}

  calculateDelay(attempt: number, baseDelay: number): number {
    return Math.min(baseDelay * attempt, this.maxDelay);
  }
}

/**
 * Fixed delay strategy - constant delay between retries
 */
export class FixedDelayStrategy implements RetryStrategy {
  calculateDelay(_attempt: number, baseDelay: number): number {
    return baseDelay;
  }
}

/**
 * Retry configuration options
 */
export interface RetryConfig {
  maxAttempts?: number;
  baseDelay?: number;
  strategy?: RetryStrategy;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: Required<Omit<RetryConfig, 'shouldRetry' | 'onRetry'>> = {
  maxAttempts: 3,
  baseDelay: 1000,
  strategy: new ExponentialBackoffStrategy(),
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return setTimeoutPromise(ms);
}

/**
 * Execute a function with automatic retry logic
 * Uses exponential backoff by default
 *
 * @param fn - Function to execute
 * @param config - Retry configuration
 * @returns Promise resolving to function result
 * @throws Last error if all retries fail
 *
 * @example
 * const result = await executeWithRetry(
 *   async () => await uploadFile(data),
 *   { maxAttempts: 5, baseDelay: 2000 }
 * );
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const {
    maxAttempts = DEFAULT_RETRY_CONFIG.maxAttempts,
    baseDelay = DEFAULT_RETRY_CONFIG.baseDelay,
    strategy = DEFAULT_RETRY_CONFIG.strategy,
    shouldRetry,
    onRetry,
  } = config;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      const canRetry = attempt < maxAttempts;
      const wantRetry = !shouldRetry || shouldRetry(error);

      if (!canRetry || !wantRetry) {
        throw error;
      }

      // Calculate delay
      const delay = strategy.calculateDelay(attempt, baseDelay);

      // Notify retry callback
      if (onRetry) {
        onRetry(error, attempt, delay);
      } else {
        logger.warn('Operation failed, retrying', {
          attempt,
          maxAttempts,
          delay: Math.round(delay),
          error: lastError.message,
        });
      }

      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError ?? new Error('Retry failed with unknown error');
}

/**
 * Wrap a function with retry logic
 * Returns a new function that automatically retries on failure
 *
 * @param fn - Function to wrap
 * @param config - Retry configuration
 * @returns Wrapped function with retry logic
 *
 * @example
 * const uploadWithRetry = withRetry(uploadFile, { maxAttempts: 5 });
 * await uploadWithRetry(data);
 */
export function withRetry<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  config: RetryConfig = {}
): (...args: TArgs) => Promise<TReturn> {
  return (...args: TArgs) => executeWithRetry(() => fn(...args), config);
}

/**
 * Common retry predicates for different error types
 */
export const RetryPredicates = {
  /**
   * Retry on database connection errors
   */
  isDatabaseError: (error: unknown): boolean => {
    if (!(error instanceof Error)) {
      return false;
    }

    const err = error as Error & { code?: string };

    // Node.js network error codes
    const nodeErrorCodes = [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'EPIPE',
      'ENOTFOUND',
      'ENETUNREACH',
      'EAI_AGAIN',
    ];

    if (err.code && nodeErrorCodes.includes(err.code)) {
      return true;
    }

    // PostgreSQL connection-related error codes
    const pgConnectionErrors = [
      '08000', // connection_exception
      '08003', // connection_does_not_exist
      '08006', // connection_failure
      '57P01', // admin_shutdown
      '57P02', // crash_shutdown
      '57P03', // cannot_connect_now
    ];

    if (err.code && pgConnectionErrors.includes(err.code)) {
      return true;
    }

    // Fallback to message checking
    const errorMessage = error.message.toLowerCase();
    return (
      errorMessage.includes('connection terminated') ||
      errorMessage.includes('server closed the connection') ||
      errorMessage.includes('connection reset') ||
      errorMessage.includes('socket hang up')
    );
  },

  /**
   * Retry on storage/network errors
   */
  isStorageError: (error: unknown): boolean => {
    if (!(error instanceof Error)) {
      return false;
    }

    const err = error as Error & { code?: string; $metadata?: { httpStatusCode?: number } };

    // Network errors
    if (err.code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(err.code)) {
      return true;
    }

    // AWS SDK errors - retry on 5xx and certain 4xx
    if (err.$metadata?.httpStatusCode) {
      const statusCode = err.$metadata.httpStatusCode;
      // 5xx server errors and 429 (too many requests)
      return statusCode >= 500 || statusCode === 429;
    }

    return false;
  },

  /**
   * Retry on any error (use cautiously)
   */
  always: (): boolean => true,

  /**
   * Never retry
   */
  never: (): boolean => false,
};
