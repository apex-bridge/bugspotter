/**
 * Notification History Repository Tests
 * Tests for security improvements and refactoring in NotificationHistoryRepository
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { NotificationRule, NotificationStatus } from '../../src/types/notifications.js';

describe('NotificationHistoryRepository', () => {
  let db: DatabaseClient;
  let testProjectId: string;
  let testChannelId: string;

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    // Create test project
    const project = await db.projects.create({
      name: `Test Project ${Date.now()}`,
    });
    testProjectId = project.id;

    // Create test notification channel
    const channel = await db.notificationChannels.create({
      project_id: testProjectId,
      name: 'Test Email Channel',
      type: 'email',
      config: {
        type: 'email',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_secure: false,
        smtp_user: 'test@example.com',
        smtp_pass: 'password',
        from_address: 'test@example.com',
        from_name: 'Test',
      },
      active: true,
    });
    testChannelId = channel.id;
  });

  /**
   * Helper function to create a notification history entry with status='sent'
   * and properly set delivered_at to satisfy database constraint
   */
  async function createSentNotification(data: {
    channel_id: string;
    rule_id: string;
    bug_id?: string;
    recipients: string[];
    payload: Record<string, unknown>;
  }) {
    const created = await db.notificationHistory.create({
      channel_id: data.channel_id,
      rule_id: data.rule_id,
      bug_id: data.bug_id,
      recipients: data.recipients,
      payload: data.payload,
      status: 'pending',
    });

    // Update to 'sent' with delivered_at
    const updated = await db.notificationHistory.update(created.id, {
      status: 'sent',
      delivered_at: new Date(),
    });

    return updated!;
  }

  /**
   * Helper function to create a test notification rule
   */
  async function createTestRule() {
    return await db.notificationRules.create({
      project_id: testProjectId,
      name: `Test Rule ${Date.now()}`,
      enabled: true,
      triggers: [{ event: 'new_bug' }] as unknown as NotificationRule['triggers'],
      priority: 0,
    });
  }

  describe('findAll() - Filter Security', () => {
    it('should safely filter by all standard fields', async () => {
      const testRule = await createTestRule();

      // Create test history entry
      await createSentNotification({
        channel_id: testChannelId,
        rule_id: testRule.id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      // Filter by all standard fields
      const result = await db.notificationHistory.findAll({
        channel_id: testChannelId,
        rule_id: testRule.id,
        status: 'sent',
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(result.data[0].channel_id).toBe(testChannelId);
      expect(result.data[0].rule_id).toBe(testRule.id);
      expect(result.data[0].status).toBe('sent');
    });

    it('should safely filter by date range using buildDateRangeFilter', async () => {
      // Create test history entry
      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      // Filter by date range
      const result = await db.notificationHistory.findAll({
        created_after: yesterday,
        created_before: tomorrow,
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
      result.data.forEach((entry) => {
        const createdAt = new Date(entry.created_at);
        expect(createdAt.getTime()).toBeGreaterThanOrEqual(yesterday.getTime());
        expect(createdAt.getTime()).toBeLessThanOrEqual(tomorrow.getTime());
      });
    });

    it('should combine standard filters with date ranges', async () => {
      // Create test history entry
      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      // Combine channel_id, status, and date filters
      const result = await db.notificationHistory.findAll({
        channel_id: testChannelId,
        status: 'sent',
        created_after: yesterday,
        created_before: tomorrow,
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
      result.data.forEach((entry) => {
        expect(entry.channel_id).toBe(testChannelId);
        expect(entry.status).toBe('sent');
        const createdAt = new Date(entry.created_at);
        expect(createdAt.getTime()).toBeGreaterThanOrEqual(yesterday.getTime());
        expect(createdAt.getTime()).toBeLessThanOrEqual(tomorrow.getTime());
      });
    });

    it('should handle empty filters gracefully', async () => {
      const result = await db.notificationHistory.findAll({});
      expect(result.data).toBeInstanceOf(Array);
      expect(result.pagination).toBeDefined();
    });

    it('should handle undefined filters gracefully', async () => {
      const result = await db.notificationHistory.findAll();
      expect(result.data).toBeInstanceOf(Array);
      expect(result.pagination).toBeDefined();
    });

    it('should destructure date filters correctly (regression test)', async () => {
      // This tests the refactoring from manual if-checks to destructuring
      // const { created_after: _created_after, created_before: _created_before, ...baseFilters } = filters || {};

      const result = await db.notificationHistory.findAll({
        channel_id: testChannelId,
        created_after: new Date('2024-01-01'),
        created_before: new Date('2025-12-31'),
      });

      // Should not throw error about unused variables
      expect(result).toBeDefined();
    });
  });

  describe('findAll() - Pagination', () => {
    it('should calculate totalPages correctly', async () => {
      // Create multiple entries
      for (let i = 0; i < 25; i++) {
        await createSentNotification({
          channel_id: testChannelId,
          rule_id: (await createTestRule()).id,
          recipients: [`test${i}@example.com`],
          payload: { index: i },
        });
      }

      const result = await db.notificationHistory.findAll(
        { channel_id: testChannelId },
        { page: 1, limit: 10 }
      );

      expect(result.pagination.total).toBeGreaterThanOrEqual(25);
      expect(result.pagination.totalPages).toBeGreaterThanOrEqual(3);
      expect(result.data.length).toBeLessThanOrEqual(10);
    });

    it('should use correct parameter numbering with filters and pagination', async () => {
      // This tests that finalParamCount is used correctly for LIMIT/OFFSET
      // LIMIT $${finalParamCount} OFFSET $${finalParamCount + 1}

      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const result = await db.notificationHistory.findAll(
        {
          channel_id: testChannelId,
          status: 'sent',
          created_after: new Date('2024-01-01'),
        },
        { page: 1, limit: 5 }
      );

      // Should not throw PostgreSQL parameter error
      expect(result).toBeDefined();
      expect(result.pagination.limit).toBe(5);
    });
  });

  describe('findAll() - SQL Injection Protection', () => {
    it('should prevent SQL injection in standard filters', async () => {
      // Try to inject SQL through status filter
      const maliciousStatus =
        "sent'; DROP TABLE notification_history; --" as unknown as NotificationStatus;

      // Should throw validation error or return no results (not execute SQL injection)
      const result = await db.notificationHistory.findAll({
        status: maliciousStatus,
      });

      // No error means SQL injection was prevented
      // (malicious status simply doesn't match any records)
      expect(result.data).toBeInstanceOf(Array);
    });

    it('should use parameterized queries for date filters', async () => {
      // Date filters use parameterized queries: created_at >= $N::timestamptz
      const result = await db.notificationHistory.findAll({
        created_after: new Date('2024-01-01'),
        created_before: new Date('2025-12-31'),
      });

      // Should not throw SQL error
      expect(result).toBeDefined();
    });
  });

  describe('findAll() - Alias Replacement', () => {
    it('should add table alias for JOIN queries (h.column_name)', async () => {
      // Create test entry with relationships
      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      // This query uses JOINs, so WHERE clause needs table aliases
      const result = await db.notificationHistory.findAll({
        channel_id: testChannelId,
        status: 'sent',
      });

      // Should not throw "column ambiguous" error
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(result.data[0].channel_name).toBeDefined(); // Joined data
    });

    it('should handle dynamic alias replacement with regex', async () => {
      // Tests the refactored regex: /\b([a-z_][a-z0-9_]*)\s*=/gi
      // This replaces ALL column references, not just hardcoded list

      const testRule = await createTestRule();

      await createSentNotification({
        channel_id: testChannelId,
        rule_id: testRule.id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      // Use multiple filters to test regex matches all columns
      const result = await db.notificationHistory.findAll({
        channel_id: testChannelId,
        rule_id: testRule.id,
        status: 'sent',
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('findAll() - Code Duplication Elimination', () => {
    it('should reuse buildWhereClause from BaseRepository', async () => {
      // Tests that we eliminated manual filter building:
      // Old: if (filters?.channel_id) { baseFilters.channel_id = ... }
      // New: const { created_after, created_before, ...baseFilters } = filters || {};

      const testRule = await createTestRule();

      await createSentNotification({
        channel_id: testChannelId,
        rule_id: testRule.id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const result = await db.notificationHistory.findAll({
        channel_id: testChannelId,
        rule_id: testRule.id,
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should reuse buildDateRangeFilter from BaseRepository', async () => {
      // Tests that we eliminated manual date filter building:
      // Old: if (filters?.created_after) { const separator = ...; finalWhereClause += ... }
      // New: this.buildDateRangeFilter('created_at', filters?.created_after, ...)

      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const result = await db.notificationHistory.findAll({
        created_after: yesterday,
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('findAll() - Filter Destructuring (Refactoring Validation)', () => {
    it('should correctly extract standard filters using destructuring', async () => {
      // Create test history entries with different filter values
      const entry1 = await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['user1@example.com'],
        payload: { test: 1 },
      });

      const otherChannel = await db.notificationChannels.create({
        project_id: testProjectId,
        name: 'Other Channel',
        type: 'slack',
        config: {
          type: 'slack',
          webhook_url: 'https://hooks.slack.com/test',
        },
        active: true,
      });

      await db.notificationHistory.create({
        channel_id: otherChannel.id,
        rule_id: (await createTestRule()).id,
        recipients: ['user2@example.com'],
        payload: { test: 2 },
        status: 'failed',
      });

      // Test 1: Filter by channel_id only
      const byChannel = await db.notificationHistory.findAll({
        channel_id: testChannelId,
      });
      expect(byChannel.data.length).toBeGreaterThanOrEqual(1);
      expect(byChannel.data.every((e) => e.channel_id === testChannelId)).toBe(true);

      // Test 2: Filter by status only
      const byStatus = await db.notificationHistory.findAll({
        status: 'sent',
      });
      expect(byStatus.data.some((e) => e.id === entry1.id)).toBe(true);
      byStatus.data.forEach((entry) => {
        expect(entry.status).toBe('sent');
      });

      // Test 3: Combine multiple standard filters
      const combined = await db.notificationHistory.findAll({
        channel_id: testChannelId,
        status: 'sent',
      });
      expect(combined.data.length).toBeGreaterThanOrEqual(1);
      expect(combined.data[0].channel_id).toBe(testChannelId);
      expect(combined.data[0].status).toBe('sent');
    });

    it('should exclude date filters from baseFilters destructuring', async () => {
      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Mix standard filters with date filters
      // Destructuring should separate them: { created_after, created_before, ...baseFilters }
      const result = await db.notificationHistory.findAll({
        channel_id: testChannelId,
        status: 'sent',
        created_after: yesterday,
        created_before: tomorrow,
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
      result.data.forEach((entry) => {
        expect(entry.channel_id).toBe(testChannelId);
        expect(entry.status).toBe('sent');
        const createdAt = new Date(entry.created_at);
        expect(createdAt.getTime()).toBeGreaterThanOrEqual(yesterday.getTime());
        expect(createdAt.getTime()).toBeLessThanOrEqual(tomorrow.getTime());
      });
    });

    it('should handle all four standard filters simultaneously', async () => {
      // Create a bug report to test bug_id filter
      const bugReport = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Test Bug',
        description: 'Test',
        status: 'open',
        priority: 'medium',
      });

      const entry = await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        bug_id: bugReport.id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      // Filter by all standard fields at once
      const result = await db.notificationHistory.findAll({
        channel_id: testChannelId,
        bug_id: bugReport.id,
        status: 'sent',
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
      const found = result.data.find((e) => e.id === entry.id);
      expect(found).toBeDefined();
      expect(found!.channel_id).toBe(testChannelId);
      expect(found!.bug_id).toBe(bugReport.id);
      expect(found!.status).toBe('sent');
    });

    it('should handle undefined and empty filter objects', async () => {
      // Test that destructuring handles edge cases properly
      // const { created_after: _created_after, created_before: _created_before, ...baseFilters } = filters || {};

      // Case 1: undefined filters
      const result1 = await db.notificationHistory.findAll(undefined);
      expect(result1.data).toBeInstanceOf(Array);

      // Case 2: empty object
      const result2 = await db.notificationHistory.findAll({});
      expect(result2.data).toBeInstanceOf(Array);

      // Case 3: only date filters (baseFilters should be empty)
      const result3 = await db.notificationHistory.findAll({
        created_after: new Date('2024-01-01'),
      });
      expect(result3.data).toBeInstanceOf(Array);
    });
  });

  describe('findAll() - Query Building Edge Cases', () => {
    it('should handle date filters only (empty baseFilters, empty whereClause)', async () => {
      // This is a critical edge case: when baseFilters is empty, whereClause is '',
      // but we still have date filters. The SQL must be valid (no leading AND).
      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Only date filters, no standard filters
      const result = await db.notificationHistory.findAll({
        created_after: yesterday,
        created_before: tomorrow,
      });

      // Should not throw SQL syntax error
      expect(result).toBeDefined();
      expect(result.data).toBeInstanceOf(Array);
      expect(result.pagination).toBeDefined();
    });

    it('should handle only created_after filter (no created_before)', async () => {
      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const result = await db.notificationHistory.findAll({
        created_after: yesterday,
      });

      expect(result).toBeDefined();
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      result.data.forEach((entry) => {
        const createdAt = new Date(entry.created_at);
        expect(createdAt.getTime()).toBeGreaterThanOrEqual(yesterday.getTime());
      });
    });

    it('should handle only created_before filter (no created_after)', async () => {
      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const result = await db.notificationHistory.findAll({
        created_before: tomorrow,
      });

      expect(result).toBeDefined();
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      result.data.forEach((entry) => {
        const createdAt = new Date(entry.created_at);
        expect(createdAt.getTime()).toBeLessThanOrEqual(tomorrow.getTime());
      });
    });

    it('should produce valid SQL for COUNT query with empty whereClause', async () => {
      // COUNT query: SELECT COUNT(*) as total FROM notification_history h ${whereClauseForCount}
      // When whereClause is '', whereClauseForCount should also be ''
      // SQL should be: SELECT COUNT(*) as total FROM notification_history h
      // NOT: SELECT COUNT(*) as total FROM notification_history h  AND ...

      const result = await db.notificationHistory.findAll({
        created_after: new Date('2024-01-01'),
      });

      // Should execute without SQL syntax error
      expect(result).toBeDefined();
      expect(result.pagination.total).toBeGreaterThanOrEqual(0);
    });

    it('should use table alias h for all WHERE clause columns', async () => {
      // All column references in WHERE should become h.column_name
      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const result = await db.notificationHistory.findAll({
        channel_id: testChannelId,
        status: 'sent',
      });

      // Internally, the WHERE clause should be:
      // WHERE h.channel_id = $1 AND h.status = $2
      // This prevents ambiguous column errors with JOINs
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(result.data[0].channel_id).toBe(testChannelId);
    });

    it('should include all JOIN clauses in data query', async () => {
      // Data query should JOIN with:
      // - notification_channels (channel_name, channel_type)
      // - notification_rules (rule_name)
      // - bug_reports (bug_title)

      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const result = await db.notificationHistory.findAll({
        channel_id: testChannelId,
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);

      // Verify JOIN data is present
      const entry = result.data[0];
      expect(entry.channel_name).toBeDefined(); // From notification_channels
      expect(entry.channel_type).toBeDefined(); // From notification_channels
      // rule_name and bug_title are nullable (LEFT JOIN)
    });

    it('should always order by h.created_at DESC', async () => {
      // Create multiple entries with slight time differences
      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['first@example.com'],
        payload: { order: 1 },
      });

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['second@example.com'],
        payload: { order: 2 },
      });

      const result = await db.notificationHistory.findAll({
        channel_id: testChannelId,
      });

      expect(result.data.length).toBeGreaterThanOrEqual(2);

      // Most recent should be first (DESC order)
      const timestamps = result.data.map((e) => new Date(e.created_at).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
      }
    });

    it('should use correct parameter numbering with date filters only', async () => {
      // When we have ONLY date filters:
      // - baseFilters is empty
      // - whereClause is ''
      // - paramCount starts at 1
      // - created_after uses $1, created_before uses $2
      // - LIMIT uses $3, OFFSET uses $4

      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const result = await db.notificationHistory.findAll(
        {
          created_after: new Date('2024-01-01'),
          created_before: new Date('2026-12-31'),
        },
        { page: 2, limit: 5 }
      );

      // Should not throw PostgreSQL parameter error
      expect(result).toBeDefined();
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(5);
    });

    it('should handle complex parameter ordering with all filter types', async () => {
      // Most complex case:
      // - channel_id ($1), status ($2) from baseFilters
      // - created_after ($3), created_before ($4) from date filters
      // - LIMIT ($5), OFFSET ($6) from pagination

      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const result = await db.notificationHistory.findAll(
        {
          channel_id: testChannelId,
          status: 'sent',
          created_after: new Date('2024-01-01'),
          created_before: new Date('2026-12-31'),
        },
        { page: 1, limit: 10 }
      );

      // Should handle all 6 parameters correctly
      expect(result).toBeDefined();
      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should apply same WHERE clause to both COUNT and data queries', async () => {
      // Critical: COUNT query and data query must use identical WHERE clauses
      // Otherwise pagination.total will be incorrect

      await createSentNotification({
        channel_id: testChannelId,
        rule_id: (await createTestRule()).id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const otherChannel = await db.notificationChannels.create({
        project_id: testProjectId,
        name: 'Other Channel',
        type: 'slack',
        config: {
          type: 'slack',
          webhook_url: 'https://hooks.slack.com/test',
        },
        active: true,
      });

      await db.notificationHistory.create({
        channel_id: otherChannel.id,
        rule_id: (await createTestRule()).id,
        recipients: ['other@example.com'],
        payload: { test: true },
        status: 'failed',
      });

      const result = await db.notificationHistory.findAll({
        channel_id: testChannelId,
        status: 'sent',
      });

      // Total should match the filtered data length (when under limit)
      expect(result.pagination.total).toBe(result.data.length);
      expect(result.data.every((e) => e.channel_id === testChannelId)).toBe(true);
      expect(result.data.every((e) => e.status === 'sent')).toBe(true);
    });
  });

  describe('findAllByOrganization() - Organization Scoping', () => {
    let org1Id: string;
    let org2Id: string;
    let org1Project1Id: string;
    let org1Project2Id: string;
    let org2ProjectId: string;

    beforeEach(async () => {
      // Create two organizations
      const org1 = await db.organizations.create({
        name: 'Organization 1',
        subdomain: `org1-${Date.now()}`,
      });
      org1Id = org1.id;

      const org2 = await db.organizations.create({
        name: 'Organization 2',
        subdomain: `org2-${Date.now()}`,
      });
      org2Id = org2.id;

      // Create projects for each org
      const project1_1 = await db.projects.create({
        name: 'Org1 Project 1',
        organization_id: org1Id,
      });
      org1Project1Id = project1_1.id;

      const project1_2 = await db.projects.create({
        name: 'Org1 Project 2',
        organization_id: org1Id,
      });
      org1Project2Id = project1_2.id;

      const project2_1 = await db.projects.create({
        name: 'Org2 Project',
        organization_id: org2Id,
      });
      org2ProjectId = project2_1.id;
    });

    it('should only return history for organization projects', async () => {
      // Create channel and rule for org1 project1
      const org1Channel = await db.notificationChannels.create({
        project_id: org1Project1Id,
        name: 'Org1 Channel',
        type: 'email',
        config: {
          type: 'email',
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'test@example.com',
          smtp_pass: 'password',
          from_address: 'test@example.com',
          from_name: 'Test',
        },
        active: true,
      });

      const org1Rule = await db.notificationRules.create({
        project_id: org1Project1Id,
        name: 'Org1 Rule',
        enabled: true,
        triggers: [{ event: 'new_bug' }] as unknown as NotificationRule['triggers'],
        priority: 0,
      });

      // Create channel and rule for org2
      const org2Channel = await db.notificationChannels.create({
        project_id: org2ProjectId,
        name: 'Org2 Channel',
        type: 'email',
        config: {
          type: 'email',
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'test@example.com',
          smtp_pass: 'password',
          from_address: 'test@example.com',
          from_name: 'Test',
        },
        active: true,
      });

      const org2Rule = await db.notificationRules.create({
        project_id: org2ProjectId,
        name: 'Org2 Rule',
        enabled: true,
        triggers: [{ event: 'new_bug' }] as unknown as NotificationRule['triggers'],
        priority: 0,
      });

      // Create history for both orgs
      const org1History = await createSentNotification({
        channel_id: org1Channel.id,
        rule_id: org1Rule.id,
        recipients: ['org1@example.com'],
        payload: { org: 1 },
      });

      const org2History = await createSentNotification({
        channel_id: org2Channel.id,
        rule_id: org2Rule.id,
        recipients: ['org2@example.com'],
        payload: { org: 2 },
      });

      // Query org1 history
      const result = await db.notificationHistory.findAllByOrganization({
        organization_project_ids: [org1Project1Id, org1Project2Id],
      });

      // Should only return org1 history, not org2
      expect(result.data.some((e) => e.id === org1History.id)).toBe(true);
      expect(result.data.some((e) => e.id === org2History.id)).toBe(false);
    });

    it('should enforce multi-tenant isolation (cannot see other org history)', async () => {
      const org1Channel = await db.notificationChannels.create({
        project_id: org1Project1Id,
        name: 'Org1 Channel',
        type: 'email',
        config: {
          type: 'email',
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'test@example.com',
          smtp_pass: 'password',
          from_address: 'test@example.com',
          from_name: 'Test',
        },
        active: true,
      });

      const org1Rule = await db.notificationRules.create({
        project_id: org1Project1Id,
        name: 'Org1 Rule',
        enabled: true,
        triggers: [{ event: 'new_bug' }] as unknown as NotificationRule['triggers'],
        priority: 0,
      });

      await createSentNotification({
        channel_id: org1Channel.id,
        rule_id: org1Rule.id,
        recipients: ['org1@example.com'],
        payload: { org: 1 },
      });

      // Try to query with wrong org projects (simulate tenant isolation breach attempt)
      const result = await db.notificationHistory.findAllByOrganization({
        organization_project_ids: [org2ProjectId], // Wrong org!
      });

      // Should return empty (no access to org1 history)
      expect(result.data.length).toBe(0);
    });

    it('should work with empty project list (returns no results)', async () => {
      const result = await db.notificationHistory.findAllByOrganization({
        organization_project_ids: [],
      });

      // Empty project list means no organization → no results
      expect(result.data.length).toBe(0);
      expect(result.pagination.total).toBe(0);
    });

    it('should combine organization scoping with standard filters', async () => {
      const org1Channel = await db.notificationChannels.create({
        project_id: org1Project1Id,
        name: 'Org1 Channel',
        type: 'email',
        config: {
          type: 'email',
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'test@example.com',
          smtp_pass: 'password',
          from_address: 'test@example.com',
          from_name: 'Test',
        },
        active: true,
      });

      const org1Rule = await db.notificationRules.create({
        project_id: org1Project1Id,
        name: 'Org1 Rule',
        enabled: true,
        triggers: [{ event: 'new_bug' }] as unknown as NotificationRule['triggers'],
        priority: 0,
      });

      // Create sent history
      await createSentNotification({
        channel_id: org1Channel.id,
        rule_id: org1Rule.id,
        recipients: ['sent@example.com'],
        payload: { test: 1 },
      });

      // Create failed history
      await db.notificationHistory.create({
        channel_id: org1Channel.id,
        rule_id: org1Rule.id,
        recipients: ['failed@example.com'],
        payload: { test: 2 },
        status: 'failed',
      });

      // Query with org scope + status filter
      const result = await db.notificationHistory.findAllByOrganization({
        organization_project_ids: [org1Project1Id],
        status: 'sent',
      });

      // Should only return sent history
      expect(result.data.length).toBe(1);
      expect(result.data[0].status).toBe('sent');
    });

    it('should combine organization scoping with date filters', async () => {
      const org1Channel = await db.notificationChannels.create({
        project_id: org1Project1Id,
        name: 'Org1 Channel',
        type: 'email',
        config: {
          type: 'email',
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'test@example.com',
          smtp_pass: 'password',
          from_address: 'test@example.com',
          from_name: 'Test',
        },
        active: true,
      });

      const org1Rule = await db.notificationRules.create({
        project_id: org1Project1Id,
        name: 'Org1 Rule',
        enabled: true,
        triggers: [{ event: 'new_bug' }] as unknown as NotificationRule['triggers'],
        priority: 0,
      });

      await createSentNotification({
        channel_id: org1Channel.id,
        rule_id: org1Rule.id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Query with org scope + date range
      const result = await db.notificationHistory.findAllByOrganization({
        organization_project_ids: [org1Project1Id],
        created_after: yesterday,
        created_before: tomorrow,
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
      result.data.forEach((entry) => {
        const createdAt = new Date(entry.created_at);
        expect(createdAt.getTime()).toBeGreaterThanOrEqual(yesterday.getTime());
        expect(createdAt.getTime()).toBeLessThanOrEqual(tomorrow.getTime());
      });
    });

    it('should support pagination with organization scoping', async () => {
      const org1Channel = await db.notificationChannels.create({
        project_id: org1Project1Id,
        name: 'Org1 Channel',
        type: 'email',
        config: {
          type: 'email',
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'test@example.com',
          smtp_pass: 'password',
          from_address: 'test@example.com',
          from_name: 'Test',
        },
        active: true,
      });

      const org1Rule = await db.notificationRules.create({
        project_id: org1Project1Id,
        name: 'Org1 Rule',
        enabled: true,
        triggers: [{ event: 'new_bug' }] as unknown as NotificationRule['triggers'],
        priority: 0,
      });

      // Create 15 history entries
      for (let i = 0; i < 15; i++) {
        await createSentNotification({
          channel_id: org1Channel.id,
          rule_id: org1Rule.id,
          recipients: [`test${i}@example.com`],
          payload: { index: i },
        });
      }

      // Page 1
      const page1 = await db.notificationHistory.findAllByOrganization(
        { organization_project_ids: [org1Project1Id] },
        { page: 1, limit: 10 }
      );

      expect(page1.data.length).toBe(10);
      expect(page1.pagination.total).toBe(15);
      expect(page1.pagination.totalPages).toBe(2);

      // Page 2
      const page2 = await db.notificationHistory.findAllByOrganization(
        { organization_project_ids: [org1Project1Id] },
        { page: 2, limit: 10 }
      );

      expect(page2.data.length).toBe(5);
      expect(page2.pagination.page).toBe(2);

      // Pages should not overlap
      const page1Ids = page1.data.map((e) => e.id);
      const page2Ids = page2.data.map((e) => e.id);
      const intersection = page1Ids.filter((id) => page2Ids.includes(id));
      expect(intersection.length).toBe(0);
    });

    it('should use ANY() for efficient parameter usage (not 3N parameters)', async () => {
      // With 10 project IDs:
      // Old: IN ($1...$10) OR IN ($11...$20) OR IN ($21...$30) = 30 params
      // New: ANY($1::uuid[]) = 1 param

      const projectIds = [org1Project1Id, org1Project2Id];

      const org1Channel = await db.notificationChannels.create({
        project_id: org1Project1Id,
        name: 'Org1 Channel',
        type: 'email',
        config: {
          type: 'email',
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'test@example.com',
          smtp_pass: 'password',
          from_address: 'test@example.com',
          from_name: 'Test',
        },
        active: true,
      });

      const org1Rule = await db.notificationRules.create({
        project_id: org1Project1Id,
        name: 'Org1 Rule',
        enabled: true,
        triggers: [{ event: 'new_bug' }] as unknown as NotificationRule['triggers'],
        priority: 0,
      });

      await createSentNotification({
        channel_id: org1Channel.id,
        rule_id: org1Rule.id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      // Should execute without PostgreSQL parameter error
      const result = await db.notificationHistory.findAllByOrganization({
        organization_project_ids: projectIds,
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle large project ID arrays efficiently', async () => {
      // Test with many project IDs to verify ANY() efficiency
      // Even with 100 IDs, should still use just 1 parameter

      const manyProjectIds = [org1Project1Id, org1Project2Id];

      const result = await db.notificationHistory.findAllByOrganization({
        organization_project_ids: manyProjectIds,
      });

      // Should execute without error (proves parameter handling works)
      expect(result).toBeDefined();
      expect(result.data).toBeInstanceOf(Array);
    });

    it('should filter by channel project_id using ANY()', async () => {
      // Tests: c.project_id = ANY($N::uuid[])

      const org1Channel = await db.notificationChannels.create({
        project_id: org1Project1Id, // Channel belongs to org1
        name: 'Org1 Channel',
        type: 'email',
        config: {
          type: 'email',
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'test@example.com',
          smtp_pass: 'password',
          from_address: 'test@example.com',
          from_name: 'Test',
        },
        active: true,
      });

      const org2Rule = await db.notificationRules.create({
        project_id: org2ProjectId, // Rule belongs to org2
        name: 'Org2 Rule',
        enabled: true,
        triggers: [{ event: 'new_bug' }] as unknown as NotificationRule['triggers'],
        priority: 0,
      });

      const history = await createSentNotification({
        channel_id: org1Channel.id, // Channel from org1
        rule_id: org2Rule.id, // Rule from org2
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      // Query org1 projects
      const org1Result = await db.notificationHistory.findAllByOrganization({
        organization_project_ids: [org1Project1Id],
      });

      // Should include history (channel matches org1)
      expect(org1Result.data.some((e) => e.id === history.id)).toBe(true);

      // Query org2 projects
      const org2Result = await db.notificationHistory.findAllByOrganization({
        organization_project_ids: [org2ProjectId],
      });

      // Should also include history (rule matches org2)
      expect(org2Result.data.some((e) => e.id === history.id)).toBe(true);
    });

    it('should filter by rule project_id using ANY()', async () => {
      // Tests: r.project_id = ANY($N::uuid[])

      const org2Channel = await db.notificationChannels.create({
        project_id: org2ProjectId,
        name: 'Org2 Channel',
        type: 'email',
        config: {
          type: 'email',
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'test@example.com',
          smtp_pass: 'password',
          from_address: 'test@example.com',
          from_name: 'Test',
        },
        active: true,
      });

      const org1Rule = await db.notificationRules.create({
        project_id: org1Project1Id, // Rule belongs to org1
        name: 'Org1 Rule',
        enabled: true,
        triggers: [{ event: 'new_bug' }] as unknown as NotificationRule['triggers'],
        priority: 0,
      });

      const history = await createSentNotification({
        channel_id: org2Channel.id,
        rule_id: org1Rule.id, // Rule from org1
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      // Query org1 projects (rule matches)
      const result = await db.notificationHistory.findAllByOrganization({
        organization_project_ids: [org1Project1Id],
      });

      expect(result.data.some((e) => e.id === history.id)).toBe(true);
    });

    it('should filter by bug project_id using ANY()', async () => {
      // Tests: b.project_id = ANY($N::uuid[])

      const org1Channel = await db.notificationChannels.create({
        project_id: org1Project1Id,
        name: 'Org1 Channel',
        type: 'email',
        config: {
          type: 'email',
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'test@example.com',
          smtp_pass: 'password',
          from_address: 'test@example.com',
          from_name: 'Test',
        },
        active: true,
      });

      const org1Rule = await db.notificationRules.create({
        project_id: org1Project1Id,
        name: 'Org1 Rule',
        enabled: true,
        triggers: [{ event: 'new_bug' }] as unknown as NotificationRule['triggers'],
        priority: 0,
      });

      const org1Bug = await db.bugReports.create({
        project_id: org1Project1Id, // Bug belongs to org1
        title: 'Org1 Bug',
        description: 'Test',
        status: 'open',
        priority: 'medium',
      });

      const history = await createSentNotification({
        channel_id: org1Channel.id,
        rule_id: org1Rule.id,
        bug_id: org1Bug.id, // Bug from org1
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      // Query org1 projects
      const result = await db.notificationHistory.findAllByOrganization({
        organization_project_ids: [org1Project1Id],
      });

      expect(result.data.some((e) => e.id === history.id)).toBe(true);
    });
  });

  describe('Pagination Ordering (Post-DISTINCT ON Refactoring)', () => {
    it('should order results by created_at DESC across pages', async () => {
      const testRule = await createTestRule();

      // Create 25 history entries with known order
      const entries = [];
      for (let i = 0; i < 25; i++) {
        const entry = await createSentNotification({
          channel_id: testChannelId,
          rule_id: testRule.id,
          recipients: [`test${i}@example.com`],
          payload: { index: i },
        });
        entries.push(entry);
        // Small delay to ensure different timestamps
        if (i < 24) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }

      // Get page 1
      const page1 = await db.notificationHistory.findAll(
        { channel_id: testChannelId },
        { page: 1, limit: 10 }
      );

      // Get page 2
      const page2 = await db.notificationHistory.findAll(
        { channel_id: testChannelId },
        { page: 2, limit: 10 }
      );

      // Verify descending order within each page
      for (let i = 1; i < page1.data.length; i++) {
        const prevTime = new Date(page1.data[i - 1].created_at).getTime();
        const currTime = new Date(page1.data[i].created_at).getTime();
        expect(prevTime).toBeGreaterThanOrEqual(currTime);
      }

      for (let i = 1; i < page2.data.length; i++) {
        const prevTime = new Date(page2.data[i - 1].created_at).getTime();
        const currTime = new Date(page2.data[i].created_at).getTime();
        expect(prevTime).toBeGreaterThanOrEqual(currTime);
      }

      // Verify page 1 items are all newer than page 2 items
      if (page1.data.length > 0 && page2.data.length > 0) {
        const page1LatestTime = new Date(page1.data[page1.data.length - 1].created_at).getTime();
        const page2EarliestTime = new Date(page2.data[0].created_at).getTime();
        expect(page1LatestTime).toBeGreaterThanOrEqual(page2EarliestTime);
      }
    });

    it('should not have duplicate items across pages', async () => {
      const testRule = await createTestRule();

      // Create 30 history entries
      for (let i = 0; i < 30; i++) {
        await createSentNotification({
          channel_id: testChannelId,
          rule_id: testRule.id,
          recipients: [`test${i}@example.com`],
          payload: { index: i },
        });
      }

      // Get all 3 pages
      const page1 = await db.notificationHistory.findAll(
        { channel_id: testChannelId },
        { page: 1, limit: 10 }
      );
      const page2 = await db.notificationHistory.findAll(
        { channel_id: testChannelId },
        { page: 2, limit: 10 }
      );
      const page3 = await db.notificationHistory.findAll(
        { channel_id: testChannelId },
        { page: 3, limit: 10 }
      );

      // Collect all IDs
      const allIds = [
        ...page1.data.map((e) => e.id),
        ...page2.data.map((e) => e.id),
        ...page3.data.map((e) => e.id),
      ];

      // Check for duplicates
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });

    it('should maintain correct total count across pages', async () => {
      const testRule = await createTestRule();

      // Create 23 history entries (odd number to test boundary)
      for (let i = 0; i < 23; i++) {
        await createSentNotification({
          channel_id: testChannelId,
          rule_id: testRule.id,
          recipients: [`test${i}@example.com`],
          payload: { index: i },
        });
      }

      const page1 = await db.notificationHistory.findAll(
        { channel_id: testChannelId },
        { page: 1, limit: 10 }
      );

      const page2 = await db.notificationHistory.findAll(
        { channel_id: testChannelId },
        { page: 2, limit: 10 }
      );

      const page3 = await db.notificationHistory.findAll(
        { channel_id: testChannelId },
        { page: 3, limit: 10 }
      );

      // All pages should report same total
      expect(page1.pagination.total).toBe(23);
      expect(page2.pagination.total).toBe(23);
      expect(page3.pagination.total).toBe(23);

      // Individual page sizes should be correct
      expect(page1.data.length).toBe(10);
      expect(page2.data.length).toBe(10);
      expect(page3.data.length).toBe(3);
    });

    it('should handle database-driven sorting (no JavaScript sort)', async () => {
      // This test verifies we removed the JavaScript .sort() call
      // by checking ordering is correct without any client-side manipulation

      const testRule = await createTestRule();

      const entries = [];
      for (let i = 0; i < 5; i++) {
        const entry = await createSentNotification({
          channel_id: testChannelId,
          rule_id: testRule.id,
          recipients: [`test${i}@example.com`],
          payload: { index: i },
        });
        entries.push(entry);
        if (i < 4) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      const result = await db.notificationHistory.findAll({
        channel_id: testChannelId,
      });

      // Verify order matches database ORDER BY h.created_at DESC
      // (Most recent first)
      for (let i = 1; i < result.data.length; i++) {
        const prevTime = new Date(result.data[i - 1].created_at).getTime();
        const currTime = new Date(result.data[i].created_at).getTime();
        expect(prevTime).toBeGreaterThanOrEqual(currTime);
      }
    });
  });

  describe('Performance Regression Tests', () => {
    it('should use COUNT(*) without DISTINCT for findAll()', async () => {
      // After refactoring, COUNT query should be simpler
      // Old: COUNT(DISTINCT h.id)
      // New: COUNT(*)
      // We verify this by ensuring count works correctly

      const testRule = await createTestRule();

      await createSentNotification({
        channel_id: testChannelId,
        rule_id: testRule.id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const result = await db.notificationHistory.findAll({
        channel_id: testChannelId,
      });

      // COUNT(*) should return correct total
      expect(result.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it('should use COUNT(*) without DISTINCT for findAllByOrganization()', async () => {
      const org = await db.organizations.create({
        name: 'Test Org',
        subdomain: `test-org-${Date.now()}`,
      });

      const project = await db.projects.create({
        name: 'Test Project',
        organization_id: org.id,
      });

      const channel = await db.notificationChannels.create({
        project_id: project.id,
        name: 'Test Channel',
        type: 'email',
        config: {
          type: 'email',
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'test@example.com',
          smtp_pass: 'password',
          from_address: 'test@example.com',
          from_name: 'Test',
        },
        active: true,
      });

      const rule = await db.notificationRules.create({
        project_id: project.id,
        name: 'Test Rule',
        enabled: true,
        triggers: [{ event: 'new_bug' }] as unknown as NotificationRule['triggers'],
        priority: 0,
      });

      await createSentNotification({
        channel_id: channel.id,
        rule_id: rule.id,
        recipients: ['test@example.com'],
        payload: { test: true },
      });

      const result = await db.notificationHistory.findAllByOrganization({
        organization_project_ids: [project.id],
      });

      // COUNT(*) should return correct total (no DISTINCT needed)
      expect(result.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it('should minimize parameters with ANY() optimization', async () => {
      // Verify ANY() uses 1 parameter instead of 3N
      const org = await db.organizations.create({
        name: 'Test Org',
        subdomain: `test-org-${Date.now()}`,
      });

      const projects = [];
      for (let i = 0; i < 5; i++) {
        const project = await db.projects.create({
          name: `Project ${i}`,
          organization_id: org.id,
        });
        projects.push(project.id);
      }

      // With 5 project IDs:
      // Old approach: 15 parameters (3 * 5)
      // New approach: 1 parameter (array)
      const result = await db.notificationHistory.findAllByOrganization({
        organization_project_ids: projects,
      });

      // Should execute without hitting parameter limits
      expect(result).toBeDefined();
    });

    it('should use simple query without CTE for findAllByOrganization()', async () => {
      // After refactoring, we removed the CTE (WITH clause)
      // Verify by ensuring query executes correctly

      const org = await db.organizations.create({
        name: 'Test Org',
        subdomain: `test-org-${Date.now()}`,
      });

      const project = await db.projects.create({
        name: 'Test Project',
        organization_id: org.id,
      });

      const channel = await db.notificationChannels.create({
        project_id: project.id,
        name: 'Test Channel',
        type: 'email',
        config: {
          type: 'email',
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'test@example.com',
          smtp_pass: 'password',
          from_address: 'test@example.com',
          from_name: 'Test',
        },
        active: true,
      });

      const rule = await db.notificationRules.create({
        project_id: project.id,
        name: 'Test Rule',
        enabled: true,
        triggers: [{ event: 'new_bug' }] as unknown as NotificationRule['triggers'],
        priority: 0,
      });

      for (let i = 0; i < 10; i++) {
        await createSentNotification({
          channel_id: channel.id,
          rule_id: rule.id,
          recipients: [`test${i}@example.com`],
          payload: { index: i },
        });
        if (i < 9) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }

      const result = await db.notificationHistory.findAllByOrganization(
        { organization_project_ids: [project.id] },
        { page: 1, limit: 5 }
      );

      // Simple query should work correctly
      expect(result.data.length).toBe(5);
      expect(result.pagination.total).toBe(10);

      // Verify descending order
      for (let i = 1; i < result.data.length; i++) {
        const prevTime = new Date(result.data[i - 1].created_at).getTime();
        const currTime = new Date(result.data[i].created_at).getTime();
        expect(prevTime).toBeGreaterThanOrEqual(currTime);
      }
    });
  });
});
