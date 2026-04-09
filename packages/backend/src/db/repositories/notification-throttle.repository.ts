/**
 * Notification Throttle Repository
 * Manages rate limiting for notifications
 */

import type { Pool, PoolClient } from 'pg';
import { getLogger } from '../../logger.js';

const logger = getLogger();

export interface ThrottleWindow {
  rule_id: string;
  group_key: string;
  count: number;
  window_start: Date;
  window_end: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * Repository for notification throttle operations
 */
export class NotificationThrottleRepository {
  constructor(private pool: Pool | PoolClient) {}

  /**
   * Get current count for a throttle window
   */
  async getWindowCount(
    ruleId: string,
    groupKey: string,
    windowStart: Date,
    windowEnd: Date
  ): Promise<number> {
    const result = await this.pool.query<{ count: number }>(
      `SELECT count FROM notification_throttle
       WHERE rule_id = $1 AND group_key = $2
       AND window_start = $3 AND window_end = $4`,
      [ruleId, groupKey, windowStart.toISOString(), windowEnd.toISOString()]
    );

    const count = result.rows[0]?.count;
    return typeof count === 'number' ? count : 0;
  }

  /**
   * Increment throttle count for a window (upsert)
   */
  async incrementWindowCount(
    ruleId: string,
    groupKey: string,
    windowStart: Date,
    windowEnd: Date
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO notification_throttle
       (rule_id, group_key, count, window_start, window_end)
       VALUES ($1, $2, 1, $3, $4)
       ON CONFLICT (rule_id, group_key, window_start)
       DO UPDATE SET count = notification_throttle.count + 1, updated_at = CURRENT_TIMESTAMP`,
      [ruleId, groupKey, windowStart.toISOString(), windowEnd.toISOString()]
    );
  }

  /**
   * Check if a notification is throttled within a time window
   */
  async isThrottled(
    ruleId: string,
    groupKey: string,
    maxNotifications: number,
    windowMinutes: number
  ): Promise<boolean> {
    // Calculate window boundaries
    const now = new Date();
    const windowDuration = windowMinutes * 60 * 1000;
    const windowStart = new Date(Math.floor(now.getTime() / windowDuration) * windowDuration);
    const windowEnd = new Date(windowStart.getTime() + windowDuration);

    // Get current count
    const currentCount = await this.getWindowCount(ruleId, groupKey, windowStart, windowEnd);

    // Check if we've exceeded the limit
    if (currentCount >= maxNotifications) {
      logger.warn('Notification throttled', {
        ruleId,
        groupKey,
        currentCount,
        maxNotifications,
        windowMinutes,
        windowStart,
        windowEnd,
      });
      return true;
    }

    // Increment count
    await this.incrementWindowCount(ruleId, groupKey, windowStart, windowEnd);

    logger.debug('Throttle check passed', {
      ruleId,
      groupKey,
      currentCount: currentCount + 1,
      maxNotifications,
      windowMinutes,
    });

    return false;
  }
}
