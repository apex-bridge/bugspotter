/**
 * Unit tests for `ThrottleBackedRecipientLimiter`.
 *
 * The integration story (real Postgres, concurrent reservation, FK
 * polymorphism) is covered by the existing `notification_throttle`
 * integration tests. This file pins the dedup-engine adapter's own
 * contract: recipient hashing, org-id passthrough vs selfhosted
 * sentinel, default limit application, fail-closed on throttle errors.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import { createHash } from 'node:crypto';
import {
  RECIPIENT_THROTTLE_DEFAULTS,
  SELFHOSTED_THROTTLE_OWNER,
  ThrottleBackedRecipientLimiter,
} from '../../../src/services/rules/recipient-rate-limiter.js';
import type { NotificationThrottleRepository } from '../../../src/db/repositories/notification-throttle.repository.js';

function hash(recipient: string): string {
  // Mirrors the limiter's normalize-then-hash shape.
  const normalized = recipient.trim().toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

function buildMockRepo(reserve: Mock): NotificationThrottleRepository {
  return { tryReserveSlot: reserve } as unknown as NotificationThrottleRepository;
}

describe('ThrottleBackedRecipientLimiter', () => {
  it('passes the org_id through as the throttle rule_id and hashes the recipient', async () => {
    const reserve = vi.fn().mockResolvedValue(true);
    const limiter = new ThrottleBackedRecipientLimiter(buildMockRepo(reserve));

    const ok = await limiter.check('alice@example.com', 'org-1');

    expect(ok).toBe(true);
    expect(reserve).toHaveBeenCalledWith(
      'org-1',
      `recipient:${hash('alice@example.com')}`,
      RECIPIENT_THROTTLE_DEFAULTS.maxPerWindow,
      RECIPIENT_THROTTLE_DEFAULTS.windowMinutes
    );
  });

  it('uses the selfhosted sentinel UUID when organization_id is null', async () => {
    const reserve = vi.fn().mockResolvedValue(true);
    const limiter = new ThrottleBackedRecipientLimiter(buildMockRepo(reserve));

    await limiter.check('alice@example.com', null);

    expect(reserve.mock.calls[0][0]).toBe(SELFHOSTED_THROTTLE_OWNER);
  });

  it('returns false when the throttle reports the slot is taken', async () => {
    const reserve = vi.fn().mockResolvedValue(false);
    const limiter = new ThrottleBackedRecipientLimiter(buildMockRepo(reserve));

    const ok = await limiter.check('alice@example.com', 'org-1');

    expect(ok).toBe(false);
  });

  it('fails closed when the throttle layer throws', async () => {
    const reserve = vi.fn().mockRejectedValue(new Error('db gone'));
    const limiter = new ThrottleBackedRecipientLimiter(buildMockRepo(reserve));

    const ok = await limiter.check('alice@example.com', 'org-1');

    expect(ok).toBe(false);
  });

  it('honours the constructor overrides for count and window', async () => {
    const reserve = vi.fn().mockResolvedValue(true);
    const limiter = new ThrottleBackedRecipientLimiter(buildMockRepo(reserve), 2, 15);

    await limiter.check('alice@example.com', 'org-1');

    expect(reserve.mock.calls[0][2]).toBe(2);
    expect(reserve.mock.calls[0][3]).toBe(15);
  });

  it('hashes deterministically so concurrent calls collide on the same group_key', async () => {
    const reserve = vi.fn().mockResolvedValue(true);
    const limiter = new ThrottleBackedRecipientLimiter(buildMockRepo(reserve));

    await limiter.check('alice@example.com', 'org-1');
    await limiter.check('alice@example.com', 'org-1');

    expect(reserve.mock.calls[0][1]).toBe(reserve.mock.calls[1][1]);
  });

  it('normalizes casing and whitespace before hashing (bypass guard)', async () => {
    const reserve = vi.fn().mockResolvedValue(true);
    const limiter = new ThrottleBackedRecipientLimiter(buildMockRepo(reserve));

    await limiter.check('Alice@Example.com', 'org-1');
    await limiter.check(' alice@example.com ', 'org-1');
    await limiter.check('alice@example.com', 'org-1');

    const groupKeys = reserve.mock.calls.map((c) => c[1]);
    expect(new Set(groupKeys).size).toBe(1);
  });
});
