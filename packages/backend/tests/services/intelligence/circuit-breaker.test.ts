/**
 * Circuit Breaker Tests
 * Unit tests for circuit breaker state transitions, half-open probe limiting,
 * and selective tripping based on error type.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  CircuitBreaker,
  CircuitOpenError,
} from '../../../src/services/intelligence/circuit-breaker.js';

const defaultConfig = {
  failureThreshold: 3,
  resetTimeout: 1000,
  halfOpenSuccessThreshold: 2,
};

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    breaker = new CircuitBreaker(defaultConfig);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('closed state', () => {
    it('should execute successfully in closed state', async () => {
      const result = await breaker.execute(() => Promise.resolve('ok'));
      expect(result).toBe('ok');
      expect(breaker.getState()).toBe('closed');
    });

    it('should reset failure count on success', async () => {
      // Cause some failures (below threshold)
      for (let i = 0; i < 2; i++) {
        await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      }
      expect(breaker.getFailureCount()).toBe(2);

      // Success resets
      await breaker.execute(() => Promise.resolve('ok'));
      expect(breaker.getFailureCount()).toBe(0);
    });

    it('should transition to open after reaching failure threshold', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      }

      expect(breaker.getState()).toBe('open');
      expect(breaker.getFailureCount()).toBe(3);
    });
  });

  describe('open state', () => {
    beforeEach(async () => {
      // Trip the breaker
      for (let i = 0; i < 3; i++) {
        await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      }
    });

    it('should throw CircuitOpenError when open', async () => {
      await expect(breaker.execute(() => Promise.resolve('ok'))).rejects.toThrow(CircuitOpenError);
    });

    it('should transition to half-open after reset timeout', async () => {
      expect(breaker.getState()).toBe('open');

      // Advance past the reset timeout
      vi.advanceTimersByTime(defaultConfig.resetTimeout + 1);
      expect(breaker.getState()).toBe('half-open');
    });
  });

  describe('half-open state', () => {
    async function tripAndWait(cb: CircuitBreaker, config = defaultConfig): Promise<void> {
      for (let i = 0; i < config.failureThreshold; i++) {
        await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      }
      vi.advanceTimersByTime(config.resetTimeout + 1);
    }

    it('should allow only one probe at a time in half-open', async () => {
      await tripAndWait(breaker);

      // First call should go through (probe) — use a deferred promise
      let resolveProbe!: (value: string) => void;
      const probePromise = breaker.execute(
        () =>
          new Promise<string>((resolve) => {
            resolveProbe = resolve;
          })
      );

      // Second call should be blocked (half-open, probe in flight)
      await expect(breaker.execute(() => Promise.resolve('second'))).rejects.toThrow(
        CircuitOpenError
      );

      // Complete the probe
      resolveProbe('probe');
      await probePromise;
    });

    it('should close after enough successes in half-open', async () => {
      const cb = new CircuitBreaker({
        ...defaultConfig,
        halfOpenSuccessThreshold: 2,
      });

      await tripAndWait(cb);

      // Two successes should close the breaker
      await cb.execute(() => Promise.resolve('ok'));
      await cb.execute(() => Promise.resolve('ok'));

      expect(cb.getState()).toBe('closed');
      expect(cb.getFailureCount()).toBe(0);
    });

    it('should not get stuck when shouldTrip returns false in half-open', async () => {
      await tripAndWait(breaker);

      // Non-tripping error in half-open should count as success (service responded)
      await breaker
        .execute(
          () => Promise.reject(new Error('client error')),
          () => false
        )
        .catch(() => {});

      // Should still be half-open (or closed if threshold reached), NOT stuck
      // A second call should be allowed through (not blocked by stale halfOpenInFlight)
      await breaker
        .execute(
          () => Promise.reject(new Error('client error 2')),
          () => false
        )
        .catch(() => {});

      // Should not be open — non-tripping errors don't count as failures
      expect(breaker.getState()).not.toBe('open');
    });

    it('should reopen on failure in half-open', async () => {
      await tripAndWait(breaker);

      // Fail the probe
      await breaker.execute(() => Promise.reject(new Error('still broken'))).catch(() => {});

      expect(breaker.getState()).toBe('open');
    });
  });

  describe('getState consistency', () => {
    it('should report half-open without mutating internal state', async () => {
      // Trip the breaker
      for (let i = 0; i < 3; i++) {
        await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      }
      expect(breaker.getState()).toBe('open');

      // Advance past reset timeout
      vi.advanceTimersByTime(defaultConfig.resetTimeout + 1);

      // getState() should report half-open without mutating internal state
      expect(breaker.getState()).toBe('half-open');

      // Calling getState() again should still be half-open (not re-evaluate from open)
      expect(breaker.getState()).toBe('half-open');
    });
  });

  describe('shouldTrip predicate', () => {
    it('should reset failure count on non-tripping error in closed state', async () => {
      // Accumulate some failures (below threshold)
      for (let i = 0; i < 2; i++) {
        await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      }
      expect(breaker.getFailureCount()).toBe(2);

      // Non-tripping error should reset failure count (service is healthy)
      await breaker
        .execute(
          () => Promise.reject(new Error('client error')),
          () => false
        )
        .catch(() => {});

      expect(breaker.getFailureCount()).toBe(0);
      expect(breaker.getState()).toBe('closed');
    });

    it('should not trip breaker when shouldTrip returns false', async () => {
      for (let i = 0; i < 5; i++) {
        await breaker
          .execute(
            () => Promise.reject(new Error('client error')),
            () => false // don't trip
          )
          .catch(() => {});
      }

      // Should still be closed — errors weren't counted
      expect(breaker.getState()).toBe('closed');
      expect(breaker.getFailureCount()).toBe(0);
    });

    it('should trip breaker when shouldTrip returns true', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker
          .execute(
            () => Promise.reject(new Error('server error')),
            () => true // trip
          )
          .catch(() => {});
      }

      expect(breaker.getState()).toBe('open');
    });

    it('should selectively trip based on error type', async () => {
      const shouldTrip = (error: unknown) => {
        return error instanceof Error && error.message.includes('500');
      };

      // 4xx errors — should not trip
      for (let i = 0; i < 5; i++) {
        await breaker
          .execute(() => Promise.reject(new Error('400 bad request')), shouldTrip)
          .catch(() => {});
      }
      expect(breaker.getState()).toBe('closed');

      // 5xx errors — should trip
      for (let i = 0; i < 3; i++) {
        await breaker
          .execute(() => Promise.reject(new Error('500 internal')), shouldTrip)
          .catch(() => {});
      }
      expect(breaker.getState()).toBe('open');
    });
  });
});
