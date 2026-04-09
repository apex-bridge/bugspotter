/**
 * Tests for AuditLogRepository.getStatistics()
 * Validates statistics queries, date filtering, and parallel execution
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';

// Test database configuration - use DATABASE_URL set by testcontainers
const TEST_DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/bugspotter_test';

describe('AuditLogRepository - getStatistics', () => {
  let db: DatabaseClient;
  let testUserId1: string;
  let testUserId2: string;

  beforeAll(async () => {
    db = DatabaseClient.create({
      connectionString: TEST_DATABASE_URL,
    });

    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    // Clean up
    await db.query('TRUNCATE audit_logs, projects, users RESTART IDENTITY CASCADE');

    // Create test project

    // Create test users
    const user1 = await db.users.create({
      email: 'user1@stats.test',
      password_hash: 'hash1',
      name: 'Stats User 1',
    });
    testUserId1 = user1.id;

    const user2 = await db.users.create({
      email: 'user2@stats.test',
      password_hash: 'hash2',
      name: 'Stats User 2',
    });
    testUserId2 = user2.id;
  });

  describe('Basic Statistics', () => {
    it('should return empty statistics when no audit logs exist', async () => {
      const stats = await db.auditLogs.getStatistics();

      expect(stats.total).toBe(0);
      expect(stats.success).toBe(0);
      expect(stats.failures).toBe(0);
      expect(stats.by_action).toEqual([]);
      expect(stats.by_user).toEqual([]);
    });

    it('should count total audit logs correctly', async () => {
      // Create 5 audit logs
      for (let i = 0; i < 5; i++) {
        await db.auditLogs.create({
          user_id: testUserId1,
          action: 'CREATE',
          resource: `/api/bugs/${i}`,
          success: true,
        });
      }

      const stats = await db.auditLogs.getStatistics();

      expect(stats.total).toBe(5);
      expect(stats.success).toBe(5);
      expect(stats.failures).toBe(0);
    });

    it('should count success and failures separately', async () => {
      // 3 successful
      await db.auditLogs.create({
        user_id: testUserId1,
        action: 'CREATE',
        resource: '/api/bugs',
        success: true,
      });
      await db.auditLogs.create({
        user_id: testUserId1,
        action: 'UPDATE',
        resource: '/api/bugs',
        success: true,
      });
      await db.auditLogs.create({
        user_id: testUserId1,
        action: 'DELETE',
        resource: '/api/bugs',
        success: true,
      });

      // 2 failures
      await db.auditLogs.create({
        user_id: testUserId1,
        action: 'CREATE',
        resource: '/api/bugs',
        success: false,
        error_message: 'Validation failed',
      });
      await db.auditLogs.create({
        user_id: testUserId1,
        action: 'UPDATE',
        resource: '/api/bugs',
        success: false,
        error_message: 'Not found',
      });

      const stats = await db.auditLogs.getStatistics();

      expect(stats.total).toBe(5);
      expect(stats.success).toBe(3);
      expect(stats.failures).toBe(2);
    });
  });

  describe('Action Breakdown', () => {
    it('should group by action and count correctly', async () => {
      // 3 CREATE
      for (let i = 0; i < 3; i++) {
        await db.auditLogs.create({
          user_id: testUserId1,
          action: 'CREATE',
          resource: '/api/bugs',
          success: true,
        });
      }

      // 2 UPDATE
      for (let i = 0; i < 2; i++) {
        await db.auditLogs.create({
          user_id: testUserId1,
          action: 'UPDATE',
          resource: '/api/bugs',
          success: true,
        });
      }

      // 1 DELETE
      await db.auditLogs.create({
        user_id: testUserId1,
        action: 'DELETE',
        resource: '/api/bugs',
        success: true,
      });

      const stats = await db.auditLogs.getStatistics();

      expect(stats.by_action).toHaveLength(3);

      // Should be ordered by count DESC
      expect(stats.by_action[0]).toEqual({ action: 'CREATE', count: 3 });
      expect(stats.by_action[1]).toEqual({ action: 'UPDATE', count: 2 });
      expect(stats.by_action[2]).toEqual({ action: 'DELETE', count: 1 });
    });

    it('should limit action breakdown to top 10', async () => {
      // Create 15 different actions
      for (let i = 0; i < 15; i++) {
        await db.auditLogs.create({
          user_id: testUserId1,
          action: `ACTION_${i.toString().padStart(2, '0')}`,
          resource: '/api/test',
          success: true,
        });
      }

      const stats = await db.auditLogs.getStatistics();

      expect(stats.by_action).toHaveLength(10);
    });

    it('should order actions by count descending', async () => {
      // Create actions with different counts
      for (let i = 0; i < 5; i++) {
        await db.auditLogs.create({
          user_id: testUserId1,
          action: 'FREQUENT',
          resource: '/api/test',
          success: true,
        });
      }

      for (let i = 0; i < 3; i++) {
        await db.auditLogs.create({
          user_id: testUserId1,
          action: 'MEDIUM',
          resource: '/api/test',
          success: true,
        });
      }

      await db.auditLogs.create({
        user_id: testUserId1,
        action: 'RARE',
        resource: '/api/test',
        success: true,
      });

      const stats = await db.auditLogs.getStatistics();

      expect(stats.by_action[0].action).toBe('FREQUENT');
      expect(stats.by_action[0].count).toBe(5);
      expect(stats.by_action[1].action).toBe('MEDIUM');
      expect(stats.by_action[1].count).toBe(3);
      expect(stats.by_action[2].action).toBe('RARE');
      expect(stats.by_action[2].count).toBe(1);
    });
  });

  describe('User Breakdown', () => {
    it('should group by user_id and count correctly', async () => {
      // User 1: 5 actions
      for (let i = 0; i < 5; i++) {
        await db.auditLogs.create({
          user_id: testUserId1,
          action: 'CREATE',
          resource: '/api/bugs',
          success: true,
        });
      }

      // User 2: 3 actions
      for (let i = 0; i < 3; i++) {
        await db.auditLogs.create({
          user_id: testUserId2,
          action: 'UPDATE',
          resource: '/api/bugs',
          success: true,
        });
      }

      const stats = await db.auditLogs.getStatistics();

      expect(stats.by_user).toHaveLength(2);
      expect(stats.by_user[0]).toEqual({ user_id: testUserId1, count: 5 });
      expect(stats.by_user[1]).toEqual({ user_id: testUserId2, count: 3 });
    });

    it('should exclude logs with null user_id', async () => {
      // 3 with user_id
      for (let i = 0; i < 3; i++) {
        await db.auditLogs.create({
          user_id: testUserId1,
          action: 'CREATE',
          resource: '/api/bugs',
          success: true,
        });
      }

      // 2 without user_id (system actions)
      for (let i = 0; i < 2; i++) {
        await db.auditLogs.create({
          user_id: null,
          action: 'SYSTEM',
          resource: '/api/system',
          success: true,
        });
      }

      const stats = await db.auditLogs.getStatistics();

      // Total includes all logs
      expect(stats.total).toBe(5);

      // User breakdown excludes null user_id
      expect(stats.by_user).toHaveLength(1);
      expect(stats.by_user[0]).toEqual({ user_id: testUserId1, count: 3 });
    });

    it('should limit user breakdown to top 10', async () => {
      // Create 15 different users with actions
      for (let i = 0; i < 15; i++) {
        const user = await db.users.create({
          email: `user${i}@breakdown.test`,
          password_hash: `hash${i}`,
          name: `Breakdown User ${i}`,
        });

        await db.auditLogs.create({
          user_id: user.id,
          action: 'CREATE',
          resource: '/api/test',
          success: true,
        });
      }

      const stats = await db.auditLogs.getStatistics();

      expect(stats.by_user).toHaveLength(10);
    });
  });

  describe('Date Filtering', () => {
    it('should filter by start date', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      // Create logs at different times (manually set timestamp)
      await db.query(
        `INSERT INTO audit_logs (user_id, action, resource, success, timestamp) VALUES ($1, $2, $3, $4, $5)`,
        [testUserId1, 'OLD', '/api/old', true, twoDaysAgo]
      );
      await db.query(
        `INSERT INTO audit_logs (user_id, action, resource, success, timestamp) VALUES ($1, $2, $3, $4, $5)`,
        [testUserId1, 'RECENT', '/api/recent', true, now]
      );

      const stats = await db.auditLogs.getStatistics(yesterday);

      // Should only count the recent one
      expect(stats.total).toBe(1);
      expect(stats.by_action).toHaveLength(1);
      expect(stats.by_action[0].action).toBe('RECENT');
    });

    it('should filter by end date', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      await db.query(
        `INSERT INTO audit_logs (user_id, action, resource, success, timestamp) VALUES ($1, $2, $3, $4, $5)`,
        [testUserId1, 'OLD', '/api/old', true, twoDaysAgo]
      );
      await db.query(
        `INSERT INTO audit_logs (user_id, action, resource, success, timestamp) VALUES ($1, $2, $3, $4, $5)`,
        [testUserId1, 'RECENT', '/api/recent', true, now]
      );

      const stats = await db.auditLogs.getStatistics(undefined, yesterday);

      // Should only count the old one
      expect(stats.total).toBe(1);
      expect(stats.by_action).toHaveLength(1);
      expect(stats.by_action[0].action).toBe('OLD');
    });

    it('should filter by date range', async () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

      // Old (5 days ago)
      await db.query(
        `INSERT INTO audit_logs (user_id, action, resource, success, timestamp) VALUES ($1, $2, $3, $4, $5)`,
        [testUserId1, 'TOO_OLD', '/api/old', true, fiveDaysAgo]
      );

      // In range (3 days ago)
      await db.query(
        `INSERT INTO audit_logs (user_id, action, resource, success, timestamp) VALUES ($1, $2, $3, $4, $5)`,
        [testUserId1, 'IN_RANGE', '/api/middle', true, threeDaysAgo]
      );

      // Too recent (now)
      await db.query(
        `INSERT INTO audit_logs (user_id, action, resource, success, timestamp) VALUES ($1, $2, $3, $4, $5)`,
        [testUserId1, 'TOO_RECENT', '/api/recent', true, now]
      );

      // Query for range: 4 days ago to 2 days ago
      const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      const stats = await db.auditLogs.getStatistics(fourDaysAgo, twoDaysAgo);

      expect(stats.total).toBe(1);
      expect(stats.by_action).toHaveLength(1);
      expect(stats.by_action[0].action).toBe('IN_RANGE');
    });

    it('should apply date filter to all breakdown queries', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Old log
      await db.query(
        `INSERT INTO audit_logs (user_id, action, resource, success, timestamp) VALUES ($1, $2, $3, $4, $5)`,
        [testUserId1, 'OLD_ACTION', '/api/old', true, yesterday]
      );

      // Recent logs
      await db.auditLogs.create({
        user_id: testUserId1,
        action: 'NEW_ACTION',
        resource: '/api/new',
        success: true,
      });
      await db.auditLogs.create({
        user_id: testUserId2,
        action: 'NEW_ACTION',
        resource: '/api/new',
        success: true,
      });

      // Filter to only recent (last hour)
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const stats = await db.auditLogs.getStatistics(oneHourAgo);

      // Should only see recent logs
      expect(stats.total).toBe(2);
      expect(stats.by_action).toHaveLength(1);
      expect(stats.by_action[0].action).toBe('NEW_ACTION');
      expect(stats.by_user).toHaveLength(2);
    });
  });

  describe('Type Safety', () => {
    it('should return numbers not strings for counts', async () => {
      await db.auditLogs.create({
        user_id: testUserId1,
        action: 'TEST',
        resource: '/api/test',
        success: true,
      });

      const stats = await db.auditLogs.getStatistics();

      // Verify types are numbers
      expect(typeof stats.total).toBe('number');
      expect(typeof stats.success).toBe('number');
      expect(typeof stats.failures).toBe('number');
      expect(typeof stats.by_action[0].count).toBe('number');
      expect(typeof stats.by_user[0].count).toBe('number');

      // Verify no NaN
      expect(stats.total).not.toBeNaN();
      expect(stats.success).not.toBeNaN();
      expect(stats.failures).not.toBeNaN();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero successes', async () => {
      await db.auditLogs.create({
        user_id: testUserId1,
        action: 'FAIL',
        resource: '/api/test',
        success: false,
        error_message: 'Error',
      });

      const stats = await db.auditLogs.getStatistics();

      expect(stats.total).toBe(1);
      expect(stats.success).toBe(0);
      expect(stats.failures).toBe(1);
    });

    it('should handle zero failures', async () => {
      await db.auditLogs.create({
        user_id: testUserId1,
        action: 'SUCCESS',
        resource: '/api/test',
        success: true,
      });

      const stats = await db.auditLogs.getStatistics();

      expect(stats.total).toBe(1);
      expect(stats.success).toBe(1);
      expect(stats.failures).toBe(0);
    });

    it('should handle all logs having null user_id', async () => {
      // Create 5 system logs
      for (let i = 0; i < 5; i++) {
        await db.auditLogs.create({
          user_id: null,
          action: 'SYSTEM',
          resource: '/api/system',
          success: true,
        });
      }

      const stats = await db.auditLogs.getStatistics();

      expect(stats.total).toBe(5);
      expect(stats.by_action).toHaveLength(1);
      expect(stats.by_user).toHaveLength(0); // All excluded
    });

    it('should handle date range with no results', async () => {
      await db.auditLogs.create({
        user_id: testUserId1,
        action: 'TEST',
        resource: '/api/test',
        success: true,
      });

      // Query for future dates
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const stats = await db.auditLogs.getStatistics(tomorrow, nextWeek);

      expect(stats.total).toBe(0);
      expect(stats.success).toBe(0);
      expect(stats.failures).toBe(0);
      expect(stats.by_action).toEqual([]);
      expect(stats.by_user).toEqual([]);
    });
  });

  describe('Date Filter Consistency', () => {
    it('should apply date filters consistently to user breakdown', async () => {
      // Create logs in different time periods
      const oldLog = await db.auditLogs.create({
        action: 'old_action',
        resource: 'test',
        success: true,
        user_id: testUserId1,
      });

      // Manually set old timestamp
      await db.query('UPDATE audit_logs SET timestamp = $1 WHERE id = $2', [
        new Date('2020-01-01'),
        oldLog.id,
      ]);

      // Create recent log
      await db.auditLogs.create({
        action: 'recent_action',
        resource: 'test',
        success: true,
        user_id: testUserId1,
      });

      // Filter for recent logs only (2021 onwards)
      const stats = await db.auditLogs.getStatistics(new Date('2021-01-01'));

      // Should only count recent log in total
      expect(stats.total).toBe(1);

      // User breakdown should also only count recent log
      expect(stats.by_user).toHaveLength(1);
      expect(stats.by_user[0].user_id).toBe(testUserId1);
      expect(stats.by_user[0].count).toBe(1); // Only 1, not 2
    });

    it('should apply both start and end date filters to user breakdown', async () => {
      // Create logs at different times
      const log1 = await db.auditLogs.create({
        action: 'action1',
        resource: 'test',
        success: true,
        user_id: testUserId1,
      });

      const log2 = await db.auditLogs.create({
        action: 'action2',
        resource: 'test',
        success: true,
        user_id: testUserId1,
      });

      const log3 = await db.auditLogs.create({
        action: 'action3',
        resource: 'test',
        success: true,
        user_id: testUserId1,
      });

      // Set specific timestamps
      await db.query('UPDATE audit_logs SET timestamp = $1 WHERE id = $2', [
        new Date('2020-01-01'),
        log1.id,
      ]);
      await db.query('UPDATE audit_logs SET timestamp = $1 WHERE id = $2', [
        new Date('2021-06-15'),
        log2.id,
      ]);
      await db.query('UPDATE audit_logs SET timestamp = $1 WHERE id = $2', [
        new Date('2023-01-01'),
        log3.id,
      ]);

      // Filter for 2021 only
      const stats = await db.auditLogs.getStatistics(
        new Date('2021-01-01'),
        new Date('2021-12-31')
      );

      // Should only count middle log
      expect(stats.total).toBe(1);
      expect(stats.by_user).toHaveLength(1);
      expect(stats.by_user[0].count).toBe(1); // Only the 2021 log
    });

    it('should exclude null user_id logs even when date filtered', async () => {
      // Create system log (null user_id) in date range
      await db.auditLogs.create({
        action: 'system_action',
        resource: 'system',
        success: true,
        user_id: null,
      });

      // Create user log in date range
      await db.auditLogs.create({
        action: 'user_action',
        resource: 'test',
        success: true,
        user_id: testUserId1,
      });

      const stats = await db.auditLogs.getStatistics(
        new Date('2020-01-01'),
        new Date('2099-12-31')
      );

      // Total should include both logs
      expect(stats.total).toBe(2);

      // User breakdown should only include the user log
      expect(stats.by_user).toHaveLength(1);
      expect(stats.by_user[0].user_id).toBe(testUserId1);
      expect(stats.by_user[0].count).toBe(1);
    });

    it('should return empty user breakdown when date range excludes all user logs', async () => {
      const log = await db.auditLogs.create({
        action: 'action',
        resource: 'test',
        success: true,
        user_id: testUserId1,
      });

      // Set timestamp in the past
      await db.query('UPDATE audit_logs SET timestamp = $1 WHERE id = $2', [
        new Date('2020-01-01'),
        log.id,
      ]);

      // Filter for future date range (excludes all logs)
      const stats = await db.auditLogs.getStatistics(
        new Date('2099-01-01'),
        new Date('2099-12-31')
      );

      expect(stats.total).toBe(0);
      expect(stats.by_user).toHaveLength(0);
    });
  });
});
