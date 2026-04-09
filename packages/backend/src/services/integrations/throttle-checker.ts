/**
 * Integration Rule Throttle Checker
 * Checks if a rule has exceeded its rate limits for auto-ticket creation
 */

import { getLogger } from '../../logger.js';
import type { TicketRepository } from '../../db/repositories/ticket.repository.js';

const logger = getLogger();

/**
 * Throttle configuration for integration rules
 */
export interface ThrottleConfig {
  max_per_hour?: number;
  max_per_day?: number;
}

/**
 * Result of throttle check with counts and limits
 */
export interface ThrottleCheckResult {
  allowed: boolean;
  reason?: 'hourly_limit' | 'daily_limit';
  currentHourly: number;
  currentDaily: number;
  limits: {
    hourly: number | null;
    daily: number | null;
  };
}

/**
 * Service for checking integration rule throttle limits
 *
 * Prevents excessive auto-ticket creation by enforcing hourly and daily limits.
 * Uses TicketRepository to count tickets created by the rule within time windows.
 */
export class ThrottleChecker {
  constructor(private ticketRepository: TicketRepository) {}

  /**
   * Check if a rule is allowed to create more tickets based on throttle config
   *
   * @param ruleId - Integration rule ID
   * @param throttle - Throttle configuration with hourly and daily limits
   * @returns Check result with allowed status, counts, and block reason if applicable
   *
   * @example
   * ```typescript
   * const result = await checker.check(ruleId, { max_per_hour: 10, max_per_day: 50 });
   * if (!result.allowed) {
   *   logger.warn('Rule throttled', { reason: result.reason, counts: result.currentHourly });
   * }
   * ```
   */
  async check(ruleId: string, throttle: ThrottleConfig | null): Promise<ThrottleCheckResult> {
    try {
      // If no throttle config, always allow
      const hasHourlyLimit =
        throttle?.max_per_hour !== null && throttle?.max_per_hour !== undefined;
      const hasDailyLimit = throttle?.max_per_day !== null && throttle?.max_per_day !== undefined;

      if (!throttle || (!hasHourlyLimit && !hasDailyLimit)) {
        return {
          allowed: true,
          currentHourly: 0,
          currentDaily: 0,
          limits: {
            hourly: null,
            daily: null,
          },
        };
      }

      const now = new Date();

      // Calculate time windows
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Count tickets in last hour
      const currentHourly = await this.ticketRepository.countByRuleSince(ruleId, oneHourAgo);

      // Count tickets in last 24 hours
      const currentDaily = await this.ticketRepository.countByRuleSince(ruleId, oneDayAgo);

      // Check hourly limit first (more restrictive)
      // Note: 0 is a valid limit meaning "block all tickets"
      if (hasHourlyLimit && currentHourly >= throttle.max_per_hour!) {
        logger.warn('Rule throttled by hourly limit', {
          ruleId,
          currentHourly,
          maxPerHour: throttle.max_per_hour,
        });

        return {
          allowed: false,
          reason: 'hourly_limit',
          currentHourly,
          currentDaily,
          limits: {
            hourly: throttle.max_per_hour ?? null,
            daily: throttle.max_per_day ?? null,
          },
        };
      }

      // Check daily limit
      // Note: 0 is a valid limit meaning "block all tickets"
      if (hasDailyLimit && currentDaily >= throttle.max_per_day!) {
        logger.warn('Rule throttled by daily limit', {
          ruleId,
          currentDaily,
          maxPerDay: throttle.max_per_day,
        });

        return {
          allowed: false,
          reason: 'daily_limit',
          currentHourly,
          currentDaily,
          limits: {
            hourly: throttle.max_per_hour ?? null,
            daily: throttle.max_per_day ?? null,
          },
        };
      }

      // Not throttled - allow
      logger.debug('Throttle check passed', {
        ruleId,
        currentHourly,
        currentDaily,
        limits: {
          hourly: throttle.max_per_hour ?? null,
          daily: throttle.max_per_day ?? null,
        },
      });

      return {
        allowed: true,
        currentHourly,
        currentDaily,
        limits: {
          hourly: throttle.max_per_hour ?? null,
          daily: throttle.max_per_day ?? null,
        },
      };
    } catch (error) {
      // Log error but don't block ticket creation on throttle check failure
      logger.error('Throttle check failed', {
        ruleId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fail open - allow the ticket creation to proceed
      return {
        allowed: true,
        currentHourly: 0,
        currentDaily: 0,
        limits: {
          hourly: throttle?.max_per_hour ?? null,
          daily: throttle?.max_per_day ?? null,
        },
      };
    }
  }
}
