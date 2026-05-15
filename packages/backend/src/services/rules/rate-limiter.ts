/**
 * Rate-limit adapter for the dedup-rule engine.
 *
 * Routes through the existing `notification_throttle` table /
 * `NotificationThrottleRepository.isThrottled` so we don't introduce a
 * second store. The group key is `<canonicalId>` — rate limits in
 * DedupRule are per-canonical-bug, mirroring the persona-driven design
 * ("at most one auto-reopen comment per cluster per day").
 *
 * `isThrottled` performs check-and-increment atomically; we surface
 * the inverse via `shouldFire` for caller-side readability and treat
 * `recordFire` as a no-op (the increment already happened inside
 * `shouldFire`). If a rule's actions all fail after `shouldFire` returns
 * true, the slot is still burned for the window — acceptable for the
 * MVP, matches the existing notification-throttle behaviour.
 */

import type { NotificationThrottleRepository } from '../../db/repositories/notification-throttle.repository.js';
import type { DedupRule } from '../../integrations/dedup-rule.schema.js';
import { getLogger } from '../../logger.js';
import type { RuleRateLimiter } from './types.js';

const logger = getLogger();

/**
 * Convert a `<digits><s|m|h|d|w>` window string into whole minutes.
 * The notification_throttle infra has minute granularity; sub-minute
 * windows would otherwise round to zero and disable the limit
 * entirely. Clamp to a minimum of 1 — a rule author writing "30s" gets
 * 1 minute, which is the conservative direction (more limiting, not
 * less). Anything that the schema rejected (zero / malformed) won't
 * reach this code path.
 */
export function windowStringToMinutes(window: string): number {
  const match = /^(\d+)([smhdw])$/.exec(window);
  if (!match) {
    // Schema-level validation should make this unreachable, but if a
    // hand-edited row sneaks in we don't want to silently disable the
    // limit. Default to 1 hour — a safe-ish conservative bound.
    logger.warn('Malformed window string in rate limiter, defaulting to 60 minutes', {
      window,
    });
    return 60;
  }
  const n = Number.parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1 / 60,
    m: 1,
    h: 60,
    d: 60 * 24,
    w: 60 * 24 * 7,
  };
  return Math.max(1, Math.floor(n * (multipliers[unit] ?? 60)));
}

export class ThrottleBackedRateLimiter implements RuleRateLimiter {
  constructor(private readonly throttle: NotificationThrottleRepository) {}

  async shouldFire(ruleId: string, canonicalId: string, rule: DedupRule): Promise<boolean> {
    if (!rule.rate_limit) {
      // No rate limit configured -> always allow.
      return true;
    }
    const minutes = windowStringToMinutes(rule.rate_limit.window);
    const throttled = await this.throttle.isThrottled(
      ruleId,
      canonicalId,
      rule.rate_limit.count,
      minutes
    );
    return !throttled;
  }

  /**
   * No-op: `isThrottled` already incremented the counter on the
   * allow path. Kept on the interface so a future limiter
   * implementation (one that separates check from record) can be
   * swapped in without touching the executor.
   */
  async recordFire(_ruleId: string, _canonicalId: string, _rule: DedupRule): Promise<void> {
    return;
  }
}
