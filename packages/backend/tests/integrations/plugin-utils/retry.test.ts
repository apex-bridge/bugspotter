/**
 * Tests for retry utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '../../../src/integrations/plugin-utils/retry.js';

describe('Plugin Utils - Retry', () => {
  beforeEach(() => {
    vi.useRealTimers(); // Use real timers for retry logic
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await withRetry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      const result = await withRetry(operation, { maxAttempts: 5, baseDelay: 10 });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should throw after max attempts', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Always fails'));

      await expect(withRetry(operation, { maxAttempts: 3, baseDelay: 10 })).rejects.toThrow(
        'Always fails'
      );

      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff', async () => {
      const delays: number[] = [];
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockRejectedValueOnce(new Error('Fail 3'))
        .mockResolvedValue('success');

      // Mock setTimeout to capture delays - use vi.spyOn for better isolation
      const setTimeoutSpy = vi
        .spyOn(globalThis, 'setTimeout')
        .mockImplementation((callback: any, delay?: number) => {
          delays.push(delay ?? 0);
          // Execute immediately using queueMicrotask for test speed
          queueMicrotask(() => callback());
          return 0 as any;
        });

      try {
        const result = await withRetry(operation, { maxAttempts: 5, baseDelay: 100 });
        expect(result).toBe('success');
        expect(operation).toHaveBeenCalledTimes(4);

        // Verify exponential backoff (with 0-1000ms jitter added)
        expect(delays.length).toBe(3);

        // First retry: baseDelay * 2^0 + jitter = 100 + (0-1000)
        expect(delays[0]).toBeGreaterThanOrEqual(100);
        expect(delays[0]).toBeLessThanOrEqual(1100);

        // Second retry: baseDelay * 2^1 + jitter = 200 + (0-1000)
        expect(delays[1]).toBeGreaterThanOrEqual(200);
        expect(delays[1]).toBeLessThanOrEqual(1200);

        // Third retry: baseDelay * 2^2 + jitter = 400 + (0-1000)
        expect(delays[2]).toBeGreaterThanOrEqual(400);
        expect(delays[2]).toBeLessThanOrEqual(1400);
      } finally {
        setTimeoutSpy.mockRestore();
      }
    });

    it('should respect maxDelay cap', async () => {
      const delays: number[] = [];
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValue('success');

      const setTimeoutSpy = vi
        .spyOn(globalThis, 'setTimeout')
        .mockImplementation((callback: any, delay?: number) => {
          delays.push(delay ?? 0);
          queueMicrotask(() => callback());
          return 0 as any;
        });

      try {
        const result = await withRetry(operation, {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 500, // Cap at 500ms
        });

        expect(result).toBe('success');
        expect(operation).toHaveBeenCalledTimes(2);

        // Delay should be capped at maxDelay (500ms), not baseDelay * 2^1 (2000ms)
        expect(delays[0]).toBeLessThanOrEqual(750); // 500ms + jitter (max 1.5x)
      } finally {
        setTimeoutSpy.mockRestore();
      }
    });

    it('should use custom isRetryable predicate', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Retryable error'))
        .mockRejectedValueOnce(new Error('Non-retryable error'));

      const isRetryable = (error: Error) => error.message.includes('Retryable');

      await expect(
        withRetry(operation, {
          maxAttempts: 5,
          baseDelay: 10,
          isRetryable,
        })
      ).rejects.toThrow('Non-retryable error');

      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should not retry if isRetryable returns false', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Cannot retry'));

      const isRetryable = () => false;

      await expect(withRetry(operation, { maxAttempts: 5, isRetryable })).rejects.toThrow(
        'Cannot retry'
      );

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should handle synchronous errors', async () => {
      const operation = vi.fn().mockImplementation(() => {
        throw new Error('Sync error');
      });

      await expect(withRetry(operation, { maxAttempts: 3, baseDelay: 10 })).rejects.toThrow(
        'Sync error'
      );

      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should add jitter to delays', async () => {
      const delays: number[] = [];
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValue('success');

      const setTimeoutSpy = vi
        .spyOn(globalThis, 'setTimeout')
        .mockImplementation((callback: any, delay?: number) => {
          delays.push(delay ?? 0);
          queueMicrotask(() => callback());
          return 0 as any;
        });

      try {
        await withRetry(operation, { maxAttempts: 3, baseDelay: 100 });

        // Verify jitter is applied (0-1000ms added to baseDelay)
        // Should only have 1 delay since operation succeeds on second attempt
        expect(delays).toHaveLength(1);
        const firstDelay = delays[0];
        expect(firstDelay).toBeGreaterThanOrEqual(100); // baseDelay minimum
        expect(firstDelay).toBeLessThanOrEqual(1100); // baseDelay + max jitter (1000ms)
      } finally {
        setTimeoutSpy.mockRestore();
      }
    });

    it('should handle undefined error', async () => {
      const operation = vi.fn().mockRejectedValue(undefined);

      await expect(withRetry(operation, { maxAttempts: 2, baseDelay: 10 })).rejects.toBeUndefined();

      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should work with async operations', async () => {
      let attemptCount = 0;
      const operation = vi.fn().mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error(`Attempt ${attemptCount} failed`);
        }
        return 'final success';
      });

      const result = await withRetry(operation, { maxAttempts: 5, baseDelay: 10 });

      expect(result).toBe('final success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should use default options when not provided', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValue('success');

      const result = await withRetry(operation); // No options provided

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });
});
