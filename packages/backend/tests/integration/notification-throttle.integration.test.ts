/**
 * Integration tests for NotificationThrottleRepository
 * Tests rate limiting, window management, and throttle logic
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
});
