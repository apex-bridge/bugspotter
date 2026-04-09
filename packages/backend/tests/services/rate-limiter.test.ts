/**
 * Rate Limiter Tests
 * Tests for API key rate limiting functionality including burst window fix
 */

import { describe, it, expect, vi } from 'vitest';
import type { DatabaseClient } from '../../src/db/client.js';
import {
  checkRateLimit,
  calculateWindowStart,
  calculateResetTime,
  decrementRateLimit,
  WINDOW_DURATIONS,
} from '../../src/services/api-key/rate-limiter.js';
import { RATE_LIMIT_WINDOW } from '../../src/db/types.js';

describe('Rate Limiter', () => {
  // Note: Most tests are for pure utility functions (calculateWindowStart, calculateResetTime)
  // that don't need a database. Tests that need DB access use mocks.

  describe('calculateWindowStart', () => {
    it('should align minute window to start of minute', () => {
      const now = new Date('2025-10-28T10:15:37.456Z');
      vi.setSystemTime(now);

      const windowStart = calculateWindowStart(RATE_LIMIT_WINDOW.MINUTE);

      expect(windowStart.getUTCMinutes()).toBe(15);
      expect(windowStart.getUTCSeconds()).toBe(0);
      expect(windowStart.getUTCMilliseconds()).toBe(0);

      vi.useRealTimers();
    });

    it('should align hour window to start of hour', () => {
      const now = new Date('2025-10-28T10:15:37.456Z');
      vi.setSystemTime(now);

      const windowStart = calculateWindowStart(RATE_LIMIT_WINDOW.HOUR);

      expect(windowStart.getUTCHours()).toBe(10);
      expect(windowStart.getUTCMinutes()).toBe(0);
      expect(windowStart.getUTCSeconds()).toBe(0);
      expect(windowStart.getUTCMilliseconds()).toBe(0);

      vi.useRealTimers();
    });

    it('should align day window to start of day', () => {
      const now = new Date('2025-10-28T10:15:37.456Z');
      vi.setSystemTime(now);

      const windowStart = calculateWindowStart(RATE_LIMIT_WINDOW.DAY);

      expect(windowStart.getHours()).toBe(0);
      expect(windowStart.getMinutes()).toBe(0);
      expect(windowStart.getSeconds()).toBe(0);
      expect(windowStart.getMilliseconds()).toBe(0);

      vi.useRealTimers();
    });

    it('should align burst window to start of second (FIX: prevents race conditions)', () => {
      const now = new Date('2025-10-28T10:15:37.456Z');
      vi.setSystemTime(now);

      const windowStart = calculateWindowStart(RATE_LIMIT_WINDOW.BURST);

      expect(windowStart.getSeconds()).toBe(now.getSeconds());
      expect(windowStart.getMilliseconds()).toBe(0);

      vi.useRealTimers();
    });

    it('should return same burst window start for requests within same second', () => {
      const time1 = new Date('2025-10-28T10:15:37.100Z');
      const time2 = new Date('2025-10-28T10:15:37.900Z');

      vi.setSystemTime(time1);
      const windowStart1 = calculateWindowStart(RATE_LIMIT_WINDOW.BURST);

      vi.setSystemTime(time2);
      const windowStart2 = calculateWindowStart(RATE_LIMIT_WINDOW.BURST);

      expect(windowStart1.getTime()).toBe(windowStart2.getTime());

      vi.useRealTimers();
    });

    it('should return different burst window start for requests in different seconds', () => {
      const time1 = new Date('2025-10-28T10:15:37.900Z');
      const time2 = new Date('2025-10-28T10:15:38.100Z');

      vi.setSystemTime(time1);
      const windowStart1 = calculateWindowStart(RATE_LIMIT_WINDOW.BURST);

      vi.setSystemTime(time2);
      const windowStart2 = calculateWindowStart(RATE_LIMIT_WINDOW.BURST);

      expect(windowStart1.getTime()).not.toBe(windowStart2.getTime());
      expect(windowStart2.getTime() - windowStart1.getTime()).toBe(1000); // 1 second apart

      vi.useRealTimers();
    });

    it('should throw error for unknown window type', () => {
      expect(() => calculateWindowStart('invalid' as any)).toThrow(
        'Unknown rate limit window: invalid'
      );
    });
  });

  describe('calculateResetTime', () => {
    it('should calculate reset time for minute window', () => {
      const now = new Date('2025-10-28T10:15:37.456Z');
      vi.setSystemTime(now);

      const resetTime = calculateResetTime(RATE_LIMIT_WINDOW.MINUTE);

      expect(resetTime.getUTCMinutes()).toBe(16);
      expect(resetTime.getUTCSeconds()).toBe(0);
      expect(resetTime.getUTCMilliseconds()).toBe(0);

      vi.useRealTimers();
    });

    it('should calculate reset time for hour window', () => {
      const now = new Date('2025-10-28T10:15:37.456Z');
      vi.setSystemTime(now);

      const resetTime = calculateResetTime(RATE_LIMIT_WINDOW.HOUR);

      expect(resetTime.getUTCHours()).toBe(11);
      expect(resetTime.getUTCMinutes()).toBe(0);

      vi.useRealTimers();
    });

    it('should calculate reset time for day window', () => {
      const now = new Date('2025-10-28T10:15:37.456Z');
      vi.setSystemTime(now);

      const resetTime = calculateResetTime(RATE_LIMIT_WINDOW.DAY);

      // Should be midnight the next day in local time
      expect(resetTime.getHours()).toBe(0);
      expect(resetTime.getMinutes()).toBe(0);
      expect(resetTime.getSeconds()).toBe(0);
      expect(resetTime.getMilliseconds()).toBe(0);

      // Should be after current time
      expect(resetTime.getTime()).toBeGreaterThan(now.getTime());

      vi.useRealTimers();
    });

    it('should calculate reset time for burst window', () => {
      const now = new Date('2025-10-28T10:15:37.456Z');
      vi.setSystemTime(now);

      const resetTime = calculateResetTime(RATE_LIMIT_WINDOW.BURST);

      // Should reset at start of current second + 10 seconds
      expect(resetTime.getUTCSeconds()).toBe(47);
      expect(resetTime.getUTCMilliseconds()).toBe(0);

      vi.useRealTimers();
    });
  });

  describe('checkRateLimit', () => {
    it('should validate non-negative rate limit', async () => {
      // Use any mock since validation happens before DB access
      const mockDb = {} as any;
      await expect(
        checkRateLimit(mockDb, 'test-key-id', RATE_LIMIT_WINDOW.MINUTE, -1)
      ).rejects.toThrow('Rate limit must be non-negative, got: -1');
    });

    it('should validate keyId is not empty', async () => {
      // Use any mock since validation happens before DB access
      const mockDb = {} as any;
      await expect(checkRateLimit(mockDb, '', RATE_LIMIT_WINDOW.MINUTE, 100)).rejects.toThrow(
        'API key ID is required'
      );

      await expect(checkRateLimit(mockDb, '   ', RATE_LIMIT_WINDOW.MINUTE, 100)).rejects.toThrow(
        'API key ID is required'
      );
    });

    it('should allow rate limit of 0 (soft disable)', async () => {
      // Mock not needed - rate limit 0 returns early without DB access
      const mockDb = {} as any;
      const result = await checkRateLimit(
        mockDb,
        '123e4567-e89b-12d3-a456-426614174000',
        RATE_LIMIT_WINDOW.MINUTE,
        0
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.window).toBe(RATE_LIMIT_WINDOW.MINUTE);
    });

    it('should return fail-closed on database error', async () => {
      // Create a mock db that throws an error
      const mockDb = {
        apiKeys: {
          incrementRateLimit: vi.fn().mockRejectedValue(new Error('Database connection failed')),
        },
      } as any;

      const result = await checkRateLimit(
        mockDb,
        '123e4567-e89b-12d3-a456-426614174000',
        RATE_LIMIT_WINDOW.MINUTE,
        100
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe('decrementRateLimit', () => {
    it('should not throw on database error (best-effort rollback)', async () => {
      const mockDb = {
        query: vi.fn().mockRejectedValue(new Error('Database error')),
      } as any;

      await expect(
        decrementRateLimit(mockDb, 'test-key-id', RATE_LIMIT_WINDOW.MINUTE)
      ).resolves.toBeUndefined();
    });
  });

  describe('WINDOW_DURATIONS', () => {
    it('should have correct durations', () => {
      expect(WINDOW_DURATIONS.get(RATE_LIMIT_WINDOW.MINUTE)).toBe(60 * 1000);
      expect(WINDOW_DURATIONS.get(RATE_LIMIT_WINDOW.HOUR)).toBe(60 * 60 * 1000);
      expect(WINDOW_DURATIONS.get(RATE_LIMIT_WINDOW.DAY)).toBe(24 * 60 * 60 * 1000);
      expect(WINDOW_DURATIONS.get(RATE_LIMIT_WINDOW.BURST)).toBe(10 * 1000);
    });
  });

  describe('Burst Window Race Condition Fix', () => {
    it('should prevent bypass via rapid requests within same second', async () => {
      const now = new Date('2025-10-28T10:15:37.100Z');
      vi.setSystemTime(now);

      const start1 = calculateWindowStart(RATE_LIMIT_WINDOW.BURST);

      // Simulate request 500ms later
      vi.setSystemTime(new Date('2025-10-28T10:15:37.600Z'));
      const start2 = calculateWindowStart(RATE_LIMIT_WINDOW.BURST);

      // Both should return the same window start (start of second)
      expect(start1.getTime()).toBe(start2.getTime());
      expect(start1.toISOString()).toBe('2025-10-28T10:15:37.000Z');

      vi.useRealTimers();
    });

    it('should create new window for requests in different seconds', async () => {
      const time1 = new Date('2025-10-28T10:15:37.999Z');
      vi.setSystemTime(time1);

      const start1 = calculateWindowStart(RATE_LIMIT_WINDOW.BURST);

      // Move to next second
      vi.setSystemTime(new Date('2025-10-28T10:15:38.001Z'));
      const start2 = calculateWindowStart(RATE_LIMIT_WINDOW.BURST);

      expect(start1.toISOString()).toBe('2025-10-28T10:15:37.000Z');
      expect(start2.toISOString()).toBe('2025-10-28T10:15:38.000Z');
      expect(start2.getTime() - start1.getTime()).toBe(1000);

      vi.useRealTimers();
    });
  });
});
