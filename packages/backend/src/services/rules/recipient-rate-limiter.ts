/**
 * Per-recipient throttle for `notify.email` actions.
 *
 * The dedup-rule engine already has a per-(rule, canonical) rate limit
 * via `ThrottleBackedRateLimiter` — that caps "this rule fires at most
 * N times per canonical per window." It does NOT cap fan-out to one
 * recipient across many canonicals or rules. An attacker fabricating
 * duplicates of N different canonicals against an unlimited rule could
 * still spam a single address up to N times per window.
 *
 * This limiter closes that gap. It hashes the recipient email and
 * reserves a slot in the same `notification_throttle` table, keyed by
 * `(organization_id, "recipient:<hash>", window_start)`. SHA-256 truncated
 * to 32 hex chars; no salt because the table isn't exposed and a
 * deterministic hash is what lets concurrent calls collide on the same
 * group_key (the whole point).
 *
 * Org scoping: rule_id is the organization_id in SaaS, a sentinel UUID
 * for selfhosted. Rule-level cleanup (migration 024's AFTER DELETE
 * trigger on `dedup_rules`) doesn't apply to these rows; cleanup is
 * by `window_end` via `cleanup_expired_throttle_windows()` once
 * scheduled.
 *
 * Limits are global defaults today. A follow-up can surface per-org
 * overrides via `organizations.settings`.
 */

import { createHash } from 'node:crypto';
import type { NotificationThrottleRepository } from '../../db/repositories/notification-throttle.repository.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

/**
 * Sentinel UUID used as the throttle's `rule_id` for selfhosted bugs
 * (which have no organization_id). All selfhosted recipient-throttle
 * rows share this owner; cleanup falls back on window_end expiry.
 * Exported so tests can assert against the same value the limiter uses.
 */
export const SELFHOSTED_THROTTLE_OWNER = '00000000-0000-0000-0000-000000000000';

/** Conservative default: at most 5 dedup emails to any one address per hour. */
export const RECIPIENT_THROTTLE_DEFAULTS = {
  maxPerWindow: 5,
  windowMinutes: 60,
} as const;

export interface RecipientRateLimiter {
  /**
   * Returns true if the send is allowed (slot reserved), false if the
   * recipient has already hit the per-window cap. Never throws — DB
   * errors are treated as "throttled" (fail-closed) to match the
   * existing notification-throttle behaviour.
   */
  check(recipient: string, organizationId: string | null): Promise<boolean>;
}

export class ThrottleBackedRecipientLimiter implements RecipientRateLimiter {
  constructor(
    private readonly throttle: NotificationThrottleRepository,
    private readonly maxPerWindow: number = RECIPIENT_THROTTLE_DEFAULTS.maxPerWindow,
    private readonly windowMinutes: number = RECIPIENT_THROTTLE_DEFAULTS.windowMinutes
  ) {}

  async check(recipient: string, organizationId: string | null): Promise<boolean> {
    const owner = organizationId ?? SELFHOSTED_THROTTLE_OWNER;
    // Normalize before hashing so casing/whitespace variants land in
    // the same bucket. Without this, `Alice@Example.com` and
    // ` alice@example.com ` would map to different group_keys and
    // collectively bypass the per-recipient cap. Matches the `LOWER()`
    // pattern the reporter verifier uses on the read side.
    const normalized = recipient.trim().toLowerCase();
    // Hash the recipient before it lands in a queryable table. SHA-256
    // truncated to 32 hex chars — 128 bits is more than enough to avoid
    // collisions across realistic recipient counts.
    const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 32);
    const groupKey = `recipient:${hash}`;
    try {
      return await this.throttle.tryReserveSlot(
        owner,
        groupKey,
        this.maxPerWindow,
        this.windowMinutes
      );
    } catch (error) {
      // Fail closed. A DB hiccup shouldn't open a spam window.
      logger.warn('RecipientRateLimiter: throttle check threw, treating as limited', {
        organizationId,
        groupKey,
        errorType: error instanceof Error ? error.name : 'NonErrorThrown',
      });
      return false;
    }
  }
}
