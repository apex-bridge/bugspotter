/**
 * Unit tests for unified retry utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  executeWithRetry,
  withRetry,
  ExponentialBackoffStrategy,
  LinearBackoffStrategy,
  FixedDelayStrategy,
  RetryPredicates,
} from '../../src/utils/retry.js';

describe('Retry Utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('ExponentialBackoffStrategy', () => {
    it('should calculate exponential delays with jitter', () => {
      const strategy = new ExponentialBackoffStrategy(30000, 0.5);
      const baseDelay = 1000;

      // First attempt: 1000 * 2^0 = 1000 (+ jitter)
      const delay1 = strategy.calculateDelay(1, baseDelay);
      expect(delay1).toBeGreaterThanOrEqual(1000);
      expect(delay1).toBeLessThanOrEqual(1500); // 1000 + 50% jitter

      // Second attempt: 1000 * 2^1 = 2000 (+ jitter)
      const delay2 = strategy.calculateDelay(2, baseDelay);
      expect(delay2).toBeGreaterThanOrEqual(2000);
      expect(delay2).toBeLessThanOrEqual(3000);

      // Third attempt: 1000 * 2^2 = 4000 (+ jitter)
      const delay3 = strategy.calculateDelay(3, baseDelay);
      expect(delay3).toBeGreaterThanOrEqual(4000);
      expect(delay3).toBeLessThanOrEqual(6000);
    });

    it('should respect max delay', () => {
      const strategy = new ExponentialBackoffStrategy(5000, 0);
      const delay = strategy.calculateDelay(10, 1000);
      expect(delay).toBeLessThanOrEqual(5000);
    });
  });

  describe('LinearBackoffStrategy', () => {
    it('should calculate linear delays', () => {
      const strategy = new LinearBackoffStrategy(30000);
      const baseDelay = 1000;

      expect(strategy.calculateDelay(1, baseDelay)).toBe(1000);
      expect(strategy.calculateDelay(2, baseDelay)).toBe(2000);
      expect(strategy.calculateDelay(3, baseDelay)).toBe(3000);
      expect(strategy.calculateDelay(10, baseDelay)).toBe(10000);
    });

    it('should respect max delay', () => {
      const strategy = new LinearBackoffStrategy(5000);
      const delay = strategy.calculateDelay(10, 1000);
      expect(delay).toBe(5000);
    });
  });

  describe('FixedDelayStrategy', () => {
    it('should return constant delay', () => {
      const strategy = new FixedDelayStrategy();
      const baseDelay = 1000;

      expect(strategy.calculateDelay(1, baseDelay)).toBe(1000);
      expect(strategy.calculateDelay(2, baseDelay)).toBe(1000);
      expect(strategy.calculateDelay(10, baseDelay)).toBe(1000);
    });
  });

  describe('executeWithRetry', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await executeWithRetry(fn, { maxAttempts: 3 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      vi.useRealTimers(); // Use real timers for actual async delays

      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const result = await executeWithRetry(fn, {
        maxAttempts: 3,
        baseDelay: 10, // Use small delay for test speed
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max attempts', async () => {
      vi.useRealTimers(); // Use real timers to avoid unhandled rejections

      const error = new Error('persistent failure');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(
        executeWithRetry(fn, {
          maxAttempts: 3,
          baseDelay: 10,
        })
      ).rejects.toThrow('persistent failure');

      expect(fn).toHaveBeenCalledTimes(3);

      vi.useFakeTimers(); // Restore fake timers for subsequent tests
    });

    it('should respect shouldRetry predicate', async () => {
      const retryableError = new Error('Retryable');
      const nonRetryableError = new Error('Non-retryable');
      const fn = vi.fn().mockRejectedValue(nonRetryableError);

      const shouldRetry = vi.fn((error: unknown) => {
        return (error as Error).message === 'Retryable';
      });

      await expect(
        executeWithRetry(fn, {
          maxAttempts: 3,
          shouldRetry,
        })
      ).rejects.toThrow('Non-retryable');

      expect(fn).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledWith(nonRetryableError);
    });

    it('should call onRetry callback', async () => {
      vi.useRealTimers(); // Use real timers for actual async delays

      const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('success');

      const onRetry = vi.fn();

      await executeWithRetry(fn, {
        maxAttempts: 2,
        baseDelay: 10, // Use small delay for test speed
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, expect.any(Number));
    });

    it('should use custom strategy', async () => {
      vi.useRealTimers(); // Use real timers to avoid infinite loop with async promises

      const customStrategy = {
        calculateDelay: vi.fn().mockReturnValue(10), // Small delay for test speed
      };

      const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('success');

      await executeWithRetry(fn, {
        maxAttempts: 2,
        baseDelay: 1000,
        strategy: customStrategy,
      });

      expect(customStrategy.calculateDelay).toHaveBeenCalledWith(1, 1000);

      vi.useFakeTimers(); // Restore fake timers for subsequent tests
    });
  });

  describe('withRetry', () => {
    it('should wrap function with retry logic', async () => {
      vi.useRealTimers(); // Use real timers for actual async delays

      const originalFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const wrappedFn = withRetry(originalFn, { maxAttempts: 2, baseDelay: 10 });

      const result = await wrappedFn();

      expect(result).toBe('success');
      expect(originalFn).toHaveBeenCalledTimes(2);
    });

    it('should preserve function arguments', async () => {
      const originalFn = vi.fn().mockResolvedValue('success');
      const wrappedFn = withRetry(originalFn);

      await wrappedFn('arg1', 'arg2', 123);

      expect(originalFn).toHaveBeenCalledWith('arg1', 'arg2', 123);
    });
  });

  describe('RetryPredicates', () => {
    describe('isDatabaseError', () => {
      it('should identify Node.js network errors', () => {
        const errors = [
          { code: 'ECONNREFUSED' },
          { code: 'ECONNRESET' },
          { code: 'ETIMEDOUT' },
          { code: 'EPIPE' },
          { code: 'ENOTFOUND' },
        ];

        errors.forEach((error) => {
          const err = new Error('Network error') as Error & { code?: string };
          err.code = error.code;
          expect(RetryPredicates.isDatabaseError(err)).toBe(true);
        });
      });

      it('should identify PostgreSQL connection errors', () => {
        const pgErrors = ['08000', '08003', '08006', '57P01', '57P02', '57P03'];

        pgErrors.forEach((code) => {
          const err = new Error('PG error') as Error & { code?: string };
          err.code = code;
          expect(RetryPredicates.isDatabaseError(err)).toBe(true);
        });
      });

      it('should identify connection errors by message', () => {
        const messages = [
          'connection terminated unexpectedly',
          'server closed the connection',
          'connection reset by peer',
          'socket hang up',
        ];

        messages.forEach((message) => {
          const err = new Error(message);
          expect(RetryPredicates.isDatabaseError(err)).toBe(true);
        });
      });

      it('should not identify non-retryable errors', () => {
        const syntaxError = new Error('Syntax error');

        const permissionError = new Error('Permission denied') as Error & { code?: string };
        permissionError.code = '42501';

        const tableError = new Error('Table does not exist') as Error & { code?: string };
        tableError.code = '42P01';

        const errors = [syntaxError, permissionError, tableError];

        errors.forEach((error) => {
          expect(RetryPredicates.isDatabaseError(error)).toBe(false);
        });
      });

      it('should return false for non-Error objects', () => {
        expect(RetryPredicates.isDatabaseError('string error')).toBe(false);
        expect(RetryPredicates.isDatabaseError(123)).toBe(false);
        expect(RetryPredicates.isDatabaseError(null)).toBe(false);
        expect(RetryPredicates.isDatabaseError(undefined)).toBe(false);
      });
    });

    describe('isStorageError', () => {
      it('should identify network errors', () => {
        const errors = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'];

        errors.forEach((code) => {
          const err = new Error('Network error') as Error & { code?: string };
          err.code = code;
          expect(RetryPredicates.isStorageError(err)).toBe(true);
        });
      });

      it('should identify AWS SDK 5xx errors', () => {
        const statusCodes = [500, 502, 503, 504];

        statusCodes.forEach((statusCode) => {
          const err = new Error('Server error') as Error & {
            $metadata?: { httpStatusCode?: number };
          };
          err.$metadata = { httpStatusCode: statusCode };
          expect(RetryPredicates.isStorageError(err)).toBe(true);
        });
      });

      it('should identify rate limit errors (429)', () => {
        const err = new Error('Too many requests') as Error & {
          $metadata?: { httpStatusCode?: number };
        };
        err.$metadata = { httpStatusCode: 429 };
        expect(RetryPredicates.isStorageError(err)).toBe(true);
      });

      it('should not retry on 4xx client errors (except 429)', () => {
        const statusCodes = [400, 401, 403, 404];

        statusCodes.forEach((statusCode) => {
          const err = new Error('Client error') as Error & {
            $metadata?: { httpStatusCode?: number };
          };
          err.$metadata = { httpStatusCode: statusCode };
          expect(RetryPredicates.isStorageError(err)).toBe(false);
        });
      });
    });

    describe('always', () => {
      it('should always return true', () => {
        expect(RetryPredicates.always()).toBe(true);
      });
    });

    describe('never', () => {
      it('should always return false', () => {
        expect(RetryPredicates.never()).toBe(false);
      });
    });
  });
});
