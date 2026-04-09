/**
 * API Key Rate Limiter Tests
 * Tests for rate limit checking and time window calculations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WINDOW_DURATIONS,
  calculateWindowStart,
  calculateResetTime,
  checkRateLimit,
  decrementRateLimit,
} from '../../../src/services/api-key/rate-limiter.js';
import { RATE_LIMIT_WINDOW } from '../../../src/db/types.js';
import type { DatabaseClient } from '../../../src/db/client.js';

// Mock logger
vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('rate-limiter', () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      apiKeys: {
        incrementRateLimit: vi.fn(),
      },
      query: vi.fn(),
    } as unknown as DatabaseClient;
  });

  // ============================================================================
  // CONSTANTS
  // ============================================================================

  describe('WINDOW_DURATIONS', () => {
    it('should have correct minute duration', () => {
      expect(WINDOW_DURATIONS.get(RATE_LIMIT_WINDOW.MINUTE)).toBe(60 * 1000);
    });

    it('should have correct hour duration', () => {
      expect(WINDOW_DURATIONS.get(RATE_LIMIT_WINDOW.HOUR)).toBe(60 * 60 * 1000);
    });

    it('should have correct day duration', () => {
      expect(WINDOW_DURATIONS.get(RATE_LIMIT_WINDOW.DAY)).toBe(24 * 60 * 60 * 1000);
    });

    it('should have correct burst duration', () => {
      expect(WINDOW_DURATIONS.get(RATE_LIMIT_WINDOW.BURST)).toBe(10 * 1000);
    });
  });

  // ============================================================================
  // WINDOW START CALCULATION
  // ============================================================================

  describe('calculateWindowStart', () => {
    it('should calculate minute window start at second 0', () => {
      const start = calculateWindowStart(RATE_LIMIT_WINDOW.MINUTE);
      expect(start.getSeconds()).toBe(0);
      expect(start.getMilliseconds()).toBe(0);
    });

    it('should calculate hour window start at minute 0', () => {
      const start = calculateWindowStart(RATE_LIMIT_WINDOW.HOUR);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
      expect(start.getMilliseconds()).toBe(0);
    });

    it('should calculate day window start at midnight', () => {
      const start = calculateWindowStart(RATE_LIMIT_WINDOW.DAY);
      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
      expect(start.getMilliseconds()).toBe(0);
    });

    it('should throw error for unknown window type', () => {
      expect(() => calculateWindowStart('invalid' as any)).toThrow('Unknown rate limit window');
    });

    it('should align minute window regardless of current second', () => {
      const start = calculateWindowStart(RATE_LIMIT_WINDOW.MINUTE);
      const now = new Date();
      expect(start.getFullYear()).toBe(now.getFullYear());
      expect(start.getMonth()).toBe(now.getMonth());
      expect(start.getDate()).toBe(now.getDate());
      expect(start.getHours()).toBe(now.getHours());
      expect(start.getMinutes()).toBe(now.getMinutes());
      expect(start.getSeconds()).toBe(0);
    });

    it('should align hour window regardless of current minute', () => {
      const start = calculateWindowStart(RATE_LIMIT_WINDOW.HOUR);
      const now = new Date();
      expect(start.getFullYear()).toBe(now.getFullYear());
      expect(start.getMonth()).toBe(now.getMonth());
      expect(start.getDate()).toBe(now.getDate());
      expect(start.getHours()).toBe(now.getHours());
      expect(start.getMinutes()).toBe(0);
    });

    it('should align day window regardless of current hour', () => {
      const start = calculateWindowStart(RATE_LIMIT_WINDOW.DAY);
      const now = new Date();
      expect(start.getFullYear()).toBe(now.getFullYear());
      expect(start.getMonth()).toBe(now.getMonth());
      expect(start.getDate()).toBe(now.getDate());
      expect(start.getHours()).toBe(0);
    });
  });

  // ============================================================================
  // RESET TIME CALCULATION
  // ============================================================================

  describe('calculateResetTime', () => {
    it('should calculate minute reset at next minute boundary', () => {
      const reset = calculateResetTime(RATE_LIMIT_WINDOW.MINUTE);
      const now = new Date();

      expect(reset.getSeconds()).toBe(0);
      expect(reset.getMilliseconds()).toBe(0);

      // Should be within 1 minute from now
      const diff = reset.getTime() - now.getTime();
      expect(diff).toBeGreaterThan(0);
      expect(diff).toBeLessThanOrEqual(60 * 1000);
    });

    it('should calculate hour reset at next hour boundary', () => {
      const reset = calculateResetTime(RATE_LIMIT_WINDOW.HOUR);
      const now = new Date();

      expect(reset.getMinutes()).toBe(0);
      expect(reset.getSeconds()).toBe(0);
      expect(reset.getMilliseconds()).toBe(0);

      // Should be within 1 hour from now
      const diff = reset.getTime() - now.getTime();
      expect(diff).toBeGreaterThan(0);
      expect(diff).toBeLessThanOrEqual(60 * 60 * 1000);
    });

    it('should calculate day reset at next day boundary', () => {
      const reset = calculateResetTime(RATE_LIMIT_WINDOW.DAY);
      const now = new Date();

      expect(reset.getHours()).toBe(0);
      expect(reset.getMinutes()).toBe(0);
      expect(reset.getSeconds()).toBe(0);
      expect(reset.getMilliseconds()).toBe(0);

      // Should be within 24 hours from now
      const diff = reset.getTime() - now.getTime();
      expect(diff).toBeGreaterThan(0);
      expect(diff).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    });
  });

  // ============================================================================
  // RATE LIMIT CHECKING
  // ============================================================================

  describe('checkRateLimit', () => {
    it('should allow request under limit', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(5);

      const result = await checkRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.MINUTE, 10);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5); // 10 - 5
      expect(result.window).toBe(RATE_LIMIT_WINDOW.MINUTE);
      expect(result.resetAt).toBeInstanceOf(Date);
    });

    it('should deny request exceeding limit', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(11);

      const result = await checkRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.MINUTE, 10);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should allow request at exact limit', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(10);

      const result = await checkRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.MINUTE, 10);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it('should deny request over limit', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(15);

      const result = await checkRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.MINUTE, 10);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0); // Max at 0
    });

    it('should calculate remaining correctly', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(3);

      const result = await checkRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.HOUR, 100);

      expect(result.remaining).toBe(97); // 100 - 3
    });

    it('should pass correct window start to database', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(0);

      await checkRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.MINUTE, 10);

      expect(mockDb.apiKeys.incrementRateLimit).toHaveBeenCalledWith(
        'key-1',
        RATE_LIMIT_WINDOW.MINUTE,
        expect.any(Date)
      );

      const windowStart = mockDb.apiKeys.incrementRateLimit.mock.calls[0][2];
      expect(windowStart.getSeconds()).toBe(0); // Aligned to minute boundary
    });

    it('should fail closed on database error (SECURITY)', async () => {
      mockDb.apiKeys.incrementRateLimit.mockRejectedValue(new Error('DB connection failed'));

      const result = await checkRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.MINUTE, 10);

      expect(result.allowed).toBe(false); // Fail closed for security
      expect(result.remaining).toBe(0);
      expect(result.window).toBe(RATE_LIMIT_WINDOW.MINUTE);
    });

    it('should return correct reset time', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(5);

      const result = await checkRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.MINUTE, 10);

      const now = new Date();
      expect(result.resetAt).toBeInstanceOf(Date);
      expect(result.resetAt.getTime()).toBeGreaterThan(now.getTime());
      expect(result.resetAt.getSeconds()).toBe(0); // Minute boundary
    });

    it('should handle first request (count = 1)', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(1);

      const result = await checkRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.HOUR, 50);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(49); // 50 - 1 = 49
    });

    it('should handle different window types', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(5);

      const minuteResult = await checkRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.MINUTE, 10);
      expect(minuteResult.window).toBe(RATE_LIMIT_WINDOW.MINUTE);

      const hourResult = await checkRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.HOUR, 100);
      expect(hourResult.window).toBe(RATE_LIMIT_WINDOW.HOUR);

      const dayResult = await checkRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.DAY, 1000);
      expect(dayResult.window).toBe(RATE_LIMIT_WINDOW.DAY);
    });
  });

  // ============================================================================
  // RATE LIMIT DECREMENT (ROLLBACK)
  // ============================================================================

  describe('decrementRateLimit', () => {
    it('should decrement rate limit counter for rollback', async () => {
      mockDb.query.mockResolvedValue(undefined);

      await decrementRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.MINUTE);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE api_key_rate_limits'),
        ['key-1', RATE_LIMIT_WINDOW.MINUTE, expect.any(Date)]
      );
    });

    it('should pass correct window start', async () => {
      mockDb.query.mockResolvedValue(undefined);

      await decrementRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.HOUR);

      const windowStart = mockDb.query.mock.calls[0][1][2];
      expect(windowStart.getMinutes()).toBe(0); // Aligned to hour boundary
    });

    it('should not throw on database error (best-effort)', async () => {
      mockDb.query.mockRejectedValue(new Error('DB error'));

      await expect(
        decrementRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.MINUTE)
      ).resolves.toBeUndefined();
    });

    it('should handle different window types', async () => {
      mockDb.query.mockResolvedValue(undefined);

      await decrementRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.MINUTE);
      await decrementRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.HOUR);
      await decrementRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.DAY);
      await decrementRateLimit(mockDb, 'key-1', RATE_LIMIT_WINDOW.BURST);

      expect(mockDb.query).toHaveBeenCalledTimes(4);
    });
  });

  // ============================================================================
  // WINDOW BOUNDARY EDGE CASES
  // ============================================================================

  describe('Window Boundary Edge Cases', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should handle minute boundary transition', () => {
      // Mock time at 59.999 seconds
      const mockTime = new Date();
      mockTime.setSeconds(59, 999);
      vi.setSystemTime(mockTime);

      const start = calculateWindowStart(RATE_LIMIT_WINDOW.MINUTE);
      expect(start.getSeconds()).toBe(0);
    });

    it('should handle hour boundary transition', () => {
      // Mock time at 59 minutes 59.999 seconds
      const mockTime = new Date();
      mockTime.setMinutes(59, 59, 999);
      vi.setSystemTime(mockTime);

      const start = calculateWindowStart(RATE_LIMIT_WINDOW.HOUR);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
    });

    it('should handle day boundary transition (23:59:59)', () => {
      // Mock time at 23:59:59.999
      const mockTime = new Date();
      mockTime.setHours(23, 59, 59, 999);
      vi.setSystemTime(mockTime);

      const start = calculateWindowStart(RATE_LIMIT_WINDOW.DAY);
      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
    });
  });
});
