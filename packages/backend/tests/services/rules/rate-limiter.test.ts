/**
 * Unit tests for the rate-limiter helper.
 *
 * Covers:
 *  - `windowStringToMinutes` pure conversion (CodeRabbit pinned the
 *    Math.ceil rounding behaviour after `Math.floor` was found to make
 *    sub-minute windows like "61s" *less* restrictive than configured)
 *  - `ThrottleBackedRateLimiter.shouldFire` routes through the
 *    repository's atomic `tryReserveSlot` and respects the `rate_limit`
 *    being absent (always allow)
 *  - `recordFire` is a no-op (kept on the interface for future
 *    swap-in limiters that separate check from record)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ThrottleBackedRateLimiter,
  windowStringToMinutes,
} from '../../../src/services/rules/rate-limiter.js';
import type { NotificationThrottleRepository } from '../../../src/db/repositories/notification-throttle.repository.js';
import type { DedupRule } from '../../../src/integrations/dedup-rule.schema.js';

function makeRule(rate_limit: DedupRule['rate_limit']): DedupRule {
  return {
    name: 'test',
    when: { type: 'duplicate_detected' },
    conditions: [],
    then: [{ type: 'notify.email', to: 'reporter', template: 'ack' }],
    rate_limit,
    enabled: true,
  } as DedupRule;
}

describe('windowStringToMinutes', () => {
  it.each([
    ['1m', 1],
    ['5m', 5],
    ['1h', 60],
    ['24h', 60 * 24],
    ['7d', 60 * 24 * 7],
    ['1w', 60 * 24 * 7],
    ['2w', 60 * 24 * 14],
  ])('converts %s → %d minutes', (input, expected) => {
    expect(windowStringToMinutes(input)).toBe(expected);
  });

  it('rounds sub-minute windows UP (Math.ceil), never down', () => {
    // Regression: Math.floor used to make "61s" collapse to 1 minute,
    // which is LESS restrictive than the rule author asked for. With
    // Math.ceil it rounds up to 2 minutes — strictly more conservative.
    expect(windowStringToMinutes('60s')).toBe(1);
    expect(windowStringToMinutes('61s')).toBe(2);
    expect(windowStringToMinutes('90s')).toBe(2);
    expect(windowStringToMinutes('120s')).toBe(2);
    expect(windowStringToMinutes('121s')).toBe(3);
  });

  it('clamps below-1-minute windows to 1', () => {
    // The throttle infra has minute granularity, so anything under
    // a minute rounds to 1 — but never to 0 (which would disable
    // the limit entirely).
    expect(windowStringToMinutes('30s')).toBe(1);
    expect(windowStringToMinutes('1s')).toBe(1);
  });

  it('falls back to 60 minutes on malformed input rather than disabling the limit', () => {
    // Schema validation should make this unreachable, but a manually-
    // edited row must not silently turn the limit off.
    expect(windowStringToMinutes('garbage')).toBe(60);
    expect(windowStringToMinutes('')).toBe(60);
  });
});

describe('ThrottleBackedRateLimiter', () => {
  function buildLimiter() {
    const tryReserveSlot = vi.fn().mockResolvedValue(true);
    const throttle = { tryReserveSlot } as unknown as NotificationThrottleRepository;
    return { limiter: new ThrottleBackedRateLimiter(throttle), tryReserveSlot };
  }

  describe('shouldFire', () => {
    it('returns true without touching the throttle when rule has no rate_limit', async () => {
      const { limiter, tryReserveSlot } = buildLimiter();
      const rule = makeRule(undefined);
      const allowed = await limiter.shouldFire('rule-1', 'canonical-1', rule);
      expect(allowed).toBe(true);
      expect(tryReserveSlot).not.toHaveBeenCalled();
    });

    it('delegates to throttle.tryReserveSlot with converted window minutes', async () => {
      const { limiter, tryReserveSlot } = buildLimiter();
      const rule = makeRule({ count: 1, window: '24h' });
      await limiter.shouldFire('rule-1', 'canonical-1', rule);
      expect(tryReserveSlot).toHaveBeenCalledWith(
        'rule-1',
        'canonical-1',
        1,
        60 * 24 // 24h converted
      );
    });

    it('returns whatever tryReserveSlot returns (false = throttled, no extra logic)', async () => {
      const { limiter, tryReserveSlot } = buildLimiter();
      tryReserveSlot.mockResolvedValueOnce(false);
      const rule = makeRule({ count: 1, window: '1h' });
      const allowed = await limiter.shouldFire('rule-1', 'canonical-1', rule);
      expect(allowed).toBe(false);
    });

    it('does NOT use the racy isThrottled path — atomic tryReserveSlot only', async () => {
      // Defense-in-depth check: if a future refactor accidentally
      // reintroduces the read-then-increment `isThrottled` path, the
      // limiter's max-count contract silently breaks under concurrent
      // workers. Lock the contract by asserting tryReserveSlot is the
      // ONLY repository method touched.
      const tryReserveSlot = vi.fn().mockResolvedValue(true);
      const isThrottled = vi.fn();
      const throttle = {
        tryReserveSlot,
        isThrottled,
      } as unknown as NotificationThrottleRepository;
      const limiter = new ThrottleBackedRateLimiter(throttle);
      await limiter.shouldFire('rule-1', 'canonical-1', makeRule({ count: 1, window: '1h' }));
      expect(tryReserveSlot).toHaveBeenCalledOnce();
      expect(isThrottled).not.toHaveBeenCalled();
    });
  });

  describe('recordFire', () => {
    it('is a no-op — increment already happened inside shouldFire', async () => {
      const { limiter, tryReserveSlot } = buildLimiter();
      await limiter.recordFire('rule-1', 'canonical-1', makeRule({ count: 1, window: '1h' }));
      // No DB calls at all.
      expect(tryReserveSlot).not.toHaveBeenCalled();
    });
  });
});
