/**
 * Integration tests for NotificationThrottleRepository
 * Tests rate limiting, window management, and throttle logic
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from '../setup.integration.js';
import type { DatabaseClient } from '../../src/db/client.js';

describe('NotificationThrottleRepository', () => {
  let db: DatabaseClient;
  let testProjectId: string;
  let testRuleId1: string;
  let testRuleId2: string;
  let testChannelId: string;

  beforeEach(async () => {
    db = createTestDatabase();

    // Create test project
    const project = await db.projects.create({
      name: 'Test Throttle Project',
    });
    testProjectId = project.id;

    // Create test channel
    const channel = await db.notificationChannels.create({
      project_id: testProjectId,
      type: 'webhook',
      name: 'Test Webhook',
      config: {
        type: 'webhook',
        url: 'https://example.com/webhook',
        method: 'POST',
        auth_type: 'none',
      },
      active: true,
    });
    testChannelId = channel.id;

    // Create test notification rules
    const rule1 = await db.notificationRules.createWithChannels({
      project_id: testProjectId,
      name: 'Test Rule 1',
      enabled: true,
      triggers: [{ event: 'new_bug' }],
      throttle: { max_per_hour: 10 },
      channel_ids: [testChannelId],
    });
    testRuleId1 = rule1.id;

    const rule2 = await db.notificationRules.createWithChannels({
      project_id: testProjectId,
      name: 'Test Rule 2',
      enabled: true,
      triggers: [{ event: 'new_bug' }],
      throttle: { max_per_hour: 10 },
      channel_ids: [testChannelId],
    });
    testRuleId2 = rule2.id;
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe('getWindowCount', () => {
    it('should return 0 when no throttle exists', async () => {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + 60 * 60 * 1000);

      const count = await db.notificationThrottle.getWindowCount(
        testRuleId1,
        'global',
        now,
        windowEnd
      );

      expect(count).toBe(0);
    });

    it('should return current count after incrementing', async () => {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + 60 * 60 * 1000);

      await db.notificationThrottle.incrementWindowCount(testRuleId1, 'global', now, windowEnd);
      await db.notificationThrottle.incrementWindowCount(testRuleId1, 'global', now, windowEnd);

      const count = await db.notificationThrottle.getWindowCount(
        testRuleId1,
        'global',
        now,
        windowEnd
      );

      expect(count).toBe(2);
    });

    it('should return 0 for different rule', async () => {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + 60 * 60 * 1000);

      await db.notificationThrottle.incrementWindowCount(testRuleId1, 'global', now, windowEnd);

      const count = await db.notificationThrottle.getWindowCount(
        testRuleId2,
        'global',
        now,
        windowEnd
      );

      expect(count).toBe(0);
    });

    it('should return 0 for different group key', async () => {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + 60 * 60 * 1000);

      await db.notificationThrottle.incrementWindowCount(testRuleId1, 'global', now, windowEnd);

      const count = await db.notificationThrottle.getWindowCount(
        testRuleId1,
        'project:123',
        now,
        windowEnd
      );

      expect(count).toBe(0);
    });

    it('should return 0 for different window', async () => {
      const now = new Date();
      const windowEnd1 = new Date(now.getTime() + 60 * 60 * 1000);
      const windowEnd2 = new Date(now.getTime() + 1440 * 60 * 1000);

      await db.notificationThrottle.incrementWindowCount(testRuleId1, 'global', now, windowEnd1);

      const count = await db.notificationThrottle.getWindowCount(
        testRuleId1,
        'global',
        now,
        windowEnd2
      );

      expect(count).toBe(0);
    });
  });

  describe('incrementWindowCount', () => {
    it('should create new throttle entry with count 1', async () => {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + 60 * 60 * 1000);

      await db.notificationThrottle.incrementWindowCount(testRuleId1, 'global', now, windowEnd);

      const count = await db.notificationThrottle.getWindowCount(
        testRuleId1,
        'global',
        now,
        windowEnd
      );

      expect(count).toBe(1);
    });

    it('should increment existing throttle entry', async () => {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + 60 * 60 * 1000);

      await db.notificationThrottle.incrementWindowCount(testRuleId1, 'global', now, windowEnd);
      await db.notificationThrottle.incrementWindowCount(testRuleId1, 'global', now, windowEnd);
      await db.notificationThrottle.incrementWindowCount(testRuleId1, 'global', now, windowEnd);

      const count = await db.notificationThrottle.getWindowCount(
        testRuleId1,
        'global',
        now,
        windowEnd
      );

      expect(count).toBe(3);
    });

    it('should handle upsert correctly (create or update)', async () => {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + 60 * 60 * 1000);

      // First call: create
      await db.notificationThrottle.incrementWindowCount(testRuleId1, 'global', now, windowEnd);
      let count = await db.notificationThrottle.getWindowCount(
        testRuleId1,
        'global',
        now,
        windowEnd
      );
      expect(count).toBe(1);

      // Second call: update
      await db.notificationThrottle.incrementWindowCount(testRuleId1, 'global', now, windowEnd);
      count = await db.notificationThrottle.getWindowCount(testRuleId1, 'global', now, windowEnd);
      expect(count).toBe(2);
    });
  });

  describe('isThrottled', () => {
    it('should return false when no throttle exists', async () => {
      const isThrottled = await db.notificationThrottle.isThrottled(testRuleId1, 'global', 10, 60);

      expect(isThrottled).toBe(false);
    });

    it('should return false when count is below limit', async () => {
      // First call increments to 1
      await db.notificationThrottle.isThrottled(testRuleId1, 'global', 10, 60);

      // Second call increments to 2 (still below 10)
      const isThrottled = await db.notificationThrottle.isThrottled(testRuleId1, 'global', 10, 60);

      expect(isThrottled).toBe(false);
    });

    it('should return true when count reaches limit', async () => {
      // Call 10 times to reach limit
      for (let i = 0; i < 10; i++) {
        await db.notificationThrottle.isThrottled(testRuleId1, 'global', 10, 60);
      }

      // 11th call should be throttled
      const isThrottled = await db.notificationThrottle.isThrottled(testRuleId1, 'global', 10, 60);

      expect(isThrottled).toBe(true);
    });

    it('should track different rules separately', async () => {
      // Rule 1: hit limit
      for (let i = 0; i < 10; i++) {
        await db.notificationThrottle.isThrottled(testRuleId1, 'global', 10, 60);
      }

      // Rule 2: first call
      const isThrottled = await db.notificationThrottle.isThrottled(testRuleId2, 'global', 10, 60);

      expect(isThrottled).toBe(false);
    });

    it('should track different group keys separately', async () => {
      // Global group: hit limit
      for (let i = 0; i < 10; i++) {
        await db.notificationThrottle.isThrottled(testRuleId1, 'global', 10, 60);
      }

      // Project group: first call
      const isThrottled = await db.notificationThrottle.isThrottled(
        testRuleId1,
        'project:123',
        10,
        60
      );

      expect(isThrottled).toBe(false);
    });

    it('should handle limit of 1', async () => {
      await db.notificationThrottle.isThrottled(testRuleId1, 'global', 1, 60);

      const isThrottled = await db.notificationThrottle.isThrottled(testRuleId1, 'global', 1, 60);

      expect(isThrottled).toBe(true);
    });

    it('should handle sequential calls correctly', async () => {
      // Run calls sequentially to avoid race conditions
      const results: boolean[] = [];
      for (let i = 0; i < 12; i++) {
        const result = await db.notificationThrottle.isThrottled(testRuleId1, 'global', 10, 60);
        results.push(result);
      }

      // First 10 should be false (not throttled), last 2 should be true (throttled)
      const notThrottled = results.filter((r: boolean) => !r).length;
      const throttled = results.filter((r: boolean) => r).length;

      expect(notThrottled).toBe(10);
      expect(throttled).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle group_key with special characters', async () => {
      const groupKey = 'project:abc-123-!@#';

      const isThrottled = await db.notificationThrottle.isThrottled(testRuleId1, groupKey, 10, 60);

      expect(isThrottled).toBe(false);
    });

    it('should handle very large window size', async () => {
      const isThrottled = await db.notificationThrottle.isThrottled(
        testRuleId1,
        'global',
        10,
        43200
      ); // 30 days

      expect(isThrottled).toBe(false);
    });

    it('should handle very large limit', async () => {
      const isThrottled = await db.notificationThrottle.isThrottled(
        testRuleId1,
        'global',
        1000000,
        60
      );

      expect(isThrottled).toBe(false);
    });
  });

  describe('tryReserveSlot (atomic check-and-reserve)', () => {
    // Migration 023 dropped the FK from `notification_throttle.rule_id`
    // -> `notification_rules.id` so the dedup-rule engine can share
    // this table without its rule ids being rejected by Postgres. The
    // unit tests for ThrottleBackedRateLimiter mock the repository and
    // never exercise the real SQL path, so these tests are the actual
    // guard against the FK reappearing (or `tryReserveSlot`'s
    // ON CONFLICT clause regressing).

    it('accepts a rule_id UUID that does not exist in notification_rules (FK is dropped)', async () => {
      // This is the regression test for the production bug Claude
      // flagged: before migration 023, this insert would fail with
      // `violates foreign key constraint
      //  notification_throttle_rule_id_fkey`. After the migration the
      // column is polymorphic — any UUID is accepted.
      const dedupRuleId = randomUUID();
      const reserved = await db.notificationThrottle.tryReserveSlot(
        dedupRuleId,
        'canonical-bug-uuid',
        3,
        60
      );
      expect(reserved).toBe(true);
    });

    it('returns true up to the limit, then false', async () => {
      const ruleId = randomUUID();
      const groupKey = 'canonical-A';

      const r1 = await db.notificationThrottle.tryReserveSlot(ruleId, groupKey, 2, 60);
      const r2 = await db.notificationThrottle.tryReserveSlot(ruleId, groupKey, 2, 60);
      const r3 = await db.notificationThrottle.tryReserveSlot(ruleId, groupKey, 2, 60);
      const r4 = await db.notificationThrottle.tryReserveSlot(ruleId, groupKey, 2, 60);

      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(r3).toBe(false);
      expect(r4).toBe(false);
    });

    it('separates limits across different group_keys', async () => {
      const ruleId = randomUUID();

      // groupKey A exhausts the limit
      await db.notificationThrottle.tryReserveSlot(ruleId, 'A', 1, 60);
      const aSecond = await db.notificationThrottle.tryReserveSlot(ruleId, 'A', 1, 60);
      // groupKey B is still fresh
      const bFirst = await db.notificationThrottle.tryReserveSlot(ruleId, 'B', 1, 60);

      expect(aSecond).toBe(false);
      expect(bFirst).toBe(true);
    });

    it('enforces max-count atomically under concurrent callers (TOCTOU resistant)', async () => {
      // This is the property that motivated tryReserveSlot in the
      // first place: two outbox workers racing on the same canonical
      // must not both win. With the old read-then-increment path
      // both could see currentCount < max and both increment. With
      // INSERT ... ON CONFLICT DO UPDATE WHERE count < $max
      // RETURNING, exactly `max` callers come back with `true`.
      const ruleId = randomUUID();
      const groupKey = 'race-canonical';
      const max = 3;
      const concurrent = 12;

      const results = await Promise.all(
        Array.from({ length: concurrent }, () =>
          db.notificationThrottle.tryReserveSlot(ruleId, groupKey, max, 60)
        )
      );

      const reserved = results.filter((r) => r === true).length;
      const refused = results.filter((r) => r === false).length;

      expect(reserved).toBe(max);
      expect(refused).toBe(concurrent - max);
    });

    it('does not interfere with the legacy isThrottled path on a different rule', async () => {
      // Sanity check that the new atomic path and the old read-then-
      // increment path don't tread on each other's rows when keyed
      // by different rule_ids — i.e. the unique constraint
      // (rule_id, group_key, window_start) keeps them isolated.
      const dedupRuleId = randomUUID();

      await db.notificationThrottle.tryReserveSlot(dedupRuleId, 'g', 5, 60);
      await db.notificationThrottle.tryReserveSlot(dedupRuleId, 'g', 5, 60);

      // testRuleId1 is a real notification_rule from beforeEach.
      // Its counter for the same group_key should still be 0.
      const isThrottled = await db.notificationThrottle.isThrottled(testRuleId1, 'g', 5, 60);
      expect(isThrottled).toBe(false);
    });
  });
});
