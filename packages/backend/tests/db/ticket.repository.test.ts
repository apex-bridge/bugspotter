/**
 * TicketRepository Tests
 * Tests for ticket CRUD operations and auto-ticket creation functionality
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { AttachmentResult } from '../../src/db/types.js';
import { createProjectIntegrationSQL } from '../test-helpers.js';

describe('TicketRepository', () => {
  let db: DatabaseClient;
  let testProjectId: string;
  let testIntegrationId: string;
  let testRuleId: string;
  let testBugReportId: string;

  beforeAll(async () => {
    db = await createDatabaseClient();

    // Create test project
    const project = await db.projects.create({
      name: 'Test Project',
      settings: {},
    });
    testProjectId = project.id;

    // Create test integration
    const integration = await db.query(createProjectIntegrationSQL(), [
      testProjectId,
      'jira',
      true,
      '{"api_token":"test","server_url":"https://test.atlassian.net"}',
      null,
    ]);
    testIntegrationId = integration.rows[0].id;

    // Create test integration rule
    const rule = await db.integrationRules.createWithValidation({
      project_id: testProjectId,
      integration_id: testIntegrationId,
      name: 'Auto-create Critical Bugs',
      enabled: true,
      auto_create: true,
      filters: [],
    });
    testRuleId = rule.id;

    // Create test bug report
    const bugReport = await db.bugReports.createBatch([
      {
        project_id: testProjectId,
        title: 'Test Bug',
        description: 'Test Description',
        priority: 'high',
        status: 'open',
        metadata: {
          browser: 'Chrome',
          os: 'Windows',
          url: 'https://example.com',
          user_agent: 'Mozilla/5.0',
          device_type: 'desktop',
          screen_resolution: '1920x1080',
          reported_by: null,
        },
      },
    ]);
    testBugReportId = bugReport[0].id;
  });

  afterAll(async () => {
    if (db) {
      await db.query('DELETE FROM project_integrations WHERE project_id = $1', [testProjectId]);
      await db.query('DELETE FROM projects WHERE id = $1', [testProjectId]);
      await db.close();
    }
  });

  beforeEach(async () => {
    // Clean up tickets before each test
    await db.query('DELETE FROM tickets WHERE bug_report_id = $1', [testBugReportId]);
  });

  describe('countByRuleSince', () => {
    it('should return 0 when no tickets exist', async () => {
      const count = await db.tickets.countByRuleSince(testRuleId, new Date('2000-01-01'));
      expect(count).toBe(0);
    });

    it('should count tickets created by rule', async () => {
      // Create tickets with rule_id
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-1', 'jira', $2, $3, true, 'pending')`,
        [testBugReportId, testIntegrationId, testRuleId]
      );

      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-2', 'jira', $2, $3, true, 'pending')`,
        [testBugReportId, testIntegrationId, testRuleId]
      );

      const count = await db.tickets.countByRuleSince(testRuleId, new Date('2000-01-01'));
      expect(count).toBe(2);
    });

    it('should only count tickets after since date', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      // Create old ticket
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, created_at)
         VALUES ($1, 'JIRA-OLD', 'jira', $2, $3, true, 'pending', $4)`,
        [testBugReportId, testIntegrationId, testRuleId, twoDaysAgo]
      );

      // Create recent ticket
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, created_at)
         VALUES ($1, 'JIRA-NEW', 'jira', $2, $3, true, 'pending', $4)`,
        [testBugReportId, testIntegrationId, testRuleId, now]
      );

      const count = await db.tickets.countByRuleSince(testRuleId, yesterday);
      expect(count).toBe(1);
    });

    it('should not count tickets from other rules', async () => {
      // Create another rule
      const rule2 = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Another Rule',
        enabled: true,
        auto_create: true,
        filters: [],
      });

      // Create ticket for testRule
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-1', 'jira', $2, $3, true, 'pending')`,
        [testBugReportId, testIntegrationId, testRuleId]
      );

      // Create ticket for rule2
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-2', 'jira', $2, $3, true, 'pending')`,
        [testBugReportId, testIntegrationId, rule2.id]
      );

      const count = await db.tickets.countByRuleSince(testRuleId, new Date('2000-01-01'));
      expect(count).toBe(1);

      // Cleanup
      await db.integrationRules.delete(rule2.id);
    });

    it('should not count manually created tickets', async () => {
      // Create auto-created ticket
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-AUTO', 'jira', $2, $3, true, 'pending')`,
        [testBugReportId, testIntegrationId, testRuleId]
      );

      // Create manually created ticket (rule_id is NULL)
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-MANUAL', 'jira', $2, false, 'pending')`,
        [testBugReportId, testIntegrationId]
      );

      const count = await db.tickets.countByRuleSince(testRuleId, new Date('2000-01-01'));
      expect(count).toBe(1);
    });
  });

  describe('updateSyncStatus', () => {
    it('should update status to synced', async () => {
      // Create ticket
      const result = await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-1', 'jira', $2, $3, true, 'pending')
         RETURNING id`,
        [testBugReportId, testIntegrationId, testRuleId]
      );
      const ticketId = result.rows[0].id;

      await db.tickets.updateSyncStatus(ticketId, 'synced');

      // Verify update
      const ticket = await db.tickets.findById(ticketId);
      expect(ticket?.sync_status).toBe('synced');
      expect(ticket?.last_sync_error).toBeNull();
    });

    it('should update status to failed with error', async () => {
      // Create ticket
      const result = await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-1', 'jira', $2, $3, true, 'pending')
         RETURNING id`,
        [testBugReportId, testIntegrationId, testRuleId]
      );
      const ticketId = result.rows[0].id;

      const errorMessage = 'Failed to sync: Network timeout';
      await db.tickets.updateSyncStatus(ticketId, 'failed', errorMessage);

      // Verify update
      const ticket = await db.tickets.findById(ticketId);
      expect(ticket?.sync_status).toBe('failed');
      expect(ticket?.last_sync_error).toBe(errorMessage);
    });

    it('should clear error when status is synced', async () => {
      // Create ticket with existing error
      const result = await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, last_sync_error)
         VALUES ($1, 'JIRA-1', 'jira', $2, $3, true, 'failed', 'Previous error')
         RETURNING id`,
        [testBugReportId, testIntegrationId, testRuleId]
      );
      const ticketId = result.rows[0].id;

      // Update to synced without providing error
      await db.tickets.updateSyncStatus(ticketId, 'synced');

      // Verify error is cleared
      const ticket = await db.tickets.findById(ticketId);
      expect(ticket?.sync_status).toBe('synced');
      expect(ticket?.last_sync_error).toBeNull();
    });

    it('should throw for non-existent ticket', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      // updateSyncStatus doesn't throw, it just updates 0 rows
      // But we can verify no error is thrown
      await expect(db.tickets.updateSyncStatus(nonExistentId, 'synced')).resolves.not.toThrow();
    });
  });

  describe('updateAttachmentResults', () => {
    it('should save attachment results', async () => {
      // Create ticket
      const result = await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-1', 'jira', $2, $3, true, 'pending')
         RETURNING id`,
        [testBugReportId, testIntegrationId, testRuleId]
      );
      const ticketId = result.rows[0].id;

      const attachmentResults: AttachmentResult[] = [
        { type: 'screenshot', success: true, filename: 'screenshot.png', size: 12345 },
        { type: 'replay', success: true, filename: 'replay.json', size: 54321 },
      ];

      await db.tickets.updateAttachmentResults(ticketId, attachmentResults);

      // Verify update
      const ticket = await db.tickets.findById(ticketId);
      expect(ticket?.attachment_results).toEqual(attachmentResults);
    });

    it('should overwrite existing results', async () => {
      // Create ticket with existing results
      const existingResults: AttachmentResult[] = [
        { type: 'screenshot', success: false, error: 'Upload failed' },
      ];

      const result = await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, attachment_results)
         VALUES ($1, 'JIRA-1', 'jira', $2, $3, true, 'pending', $4::jsonb)
         RETURNING id`,
        [testBugReportId, testIntegrationId, testRuleId, JSON.stringify(existingResults)]
      );
      const ticketId = result.rows[0].id;

      // Update with new results
      const newResults: AttachmentResult[] = [
        { type: 'screenshot', success: true, filename: 'screenshot.png', size: 10000 },
        { type: 'replay', success: true, filename: 'replay.json', size: 20000 },
      ];

      await db.tickets.updateAttachmentResults(ticketId, newResults);

      // Verify results were overwritten
      const ticket = await db.tickets.findById(ticketId);
      expect(ticket?.attachment_results).toEqual(newResults);
      expect(ticket?.attachment_results).toHaveLength(2);
    });

    it('should handle empty results array', async () => {
      // Create ticket
      const result = await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-1', 'jira', $2, $3, true, 'pending')
         RETURNING id`,
        [testBugReportId, testIntegrationId, testRuleId]
      );
      const ticketId = result.rows[0].id;

      await db.tickets.updateAttachmentResults(ticketId, []);

      // Verify empty array is stored
      const ticket = await db.tickets.findById(ticketId);
      expect(ticket?.attachment_results).toEqual([]);
    });

    it('should store all result properties', async () => {
      // Create ticket
      const result = await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-1', 'jira', $2, $3, true, 'pending')
         RETURNING id`,
        [testBugReportId, testIntegrationId, testRuleId]
      );
      const ticketId = result.rows[0].id;

      const attachmentResults: AttachmentResult[] = [
        {
          type: 'screenshot',
          success: true,
          filename: 'bug-screenshot.png',
          size: 123456,
        },
        {
          type: 'consoleLogs',
          success: false,
          error: 'No logs available',
        },
        {
          type: 'networkLogs',
          success: true,
          filename: 'network-logs.json',
          size: 789,
        },
        {
          type: 'replay',
          success: true,
          filename: 'session-replay.json',
          size: 999999,
        },
      ];

      await db.tickets.updateAttachmentResults(ticketId, attachmentResults);

      // Verify all properties are preserved
      const ticket = await db.tickets.findById(ticketId);
      expect(ticket?.attachment_results).toHaveLength(4);
      expect(ticket?.attachment_results).toEqual(attachmentResults);

      // Verify specific properties
      const screenshot = ticket?.attachment_results?.[0];
      expect(screenshot?.type).toBe('screenshot');
      expect(screenshot?.success).toBe(true);
      expect(screenshot?.filename).toBe('bug-screenshot.png');
      expect(screenshot?.size).toBe(123456);

      const consoleLogs = ticket?.attachment_results?.[1];
      expect(consoleLogs?.success).toBe(false);
      expect(consoleLogs?.error).toBe('No logs available');
    });
  });

  describe('findByIntegrationId', () => {
    it('should return tickets for integration', async () => {
      // Create tickets
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-1', 'jira', $2, $3, true, 'pending')`,
        [testBugReportId, testIntegrationId, testRuleId]
      );

      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-2', 'jira', $2, $3, true, 'synced')`,
        [testBugReportId, testIntegrationId, testRuleId]
      );

      const tickets = await db.tickets.findByIntegrationId(testIntegrationId);

      expect(tickets).toHaveLength(2);
      expect(tickets.every((t) => t.integration_id === testIntegrationId)).toBe(true);
    });

    it('should respect limit option', async () => {
      // Create 5 tickets
      for (let i = 1; i <= 5; i++) {
        await db.query(
          `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
           VALUES ($1, $2, 'jira', $3, $4, true, 'pending')`,
          [testBugReportId, `JIRA-${i}`, testIntegrationId, testRuleId]
        );
      }

      const tickets = await db.tickets.findByIntegrationId(testIntegrationId, { limit: 3 });

      expect(tickets).toHaveLength(3);
    });

    it('should respect offset option', async () => {
      // Create 3 tickets with different timestamps
      const now = new Date();
      for (let i = 0; i < 3; i++) {
        const timestamp = new Date(now.getTime() - i * 1000);
        await db.query(
          `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, created_at)
           VALUES ($1, $2, 'jira', $3, $4, true, 'pending', $5)`,
          [testBugReportId, `JIRA-${i}`, testIntegrationId, testRuleId, timestamp]
        );
      }

      // Get all tickets
      const allTickets = await db.tickets.findByIntegrationId(testIntegrationId);
      expect(allTickets).toHaveLength(3);

      // Get with offset=1 (skip first ticket)
      const offsetTickets = await db.tickets.findByIntegrationId(testIntegrationId, {
        offset: 1,
      });

      expect(offsetTickets).toHaveLength(2);
      expect(offsetTickets[0].external_id).toBe(allTickets[1].external_id);
    });

    it('should filter by status', async () => {
      // Create tickets with different statuses
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, status)
         VALUES ($1, 'JIRA-OPEN', 'jira', $2, $3, true, 'pending', 'open')`,
        [testBugReportId, testIntegrationId, testRuleId]
      );

      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, status)
         VALUES ($1, 'JIRA-RESOLVED', 'jira', $2, $3, true, 'synced', 'resolved')`,
        [testBugReportId, testIntegrationId, testRuleId]
      );

      const openTickets = await db.tickets.findByIntegrationId(testIntegrationId, {
        status: 'open',
      });

      expect(openTickets).toHaveLength(1);
      expect(openTickets[0].status).toBe('open');
    });

    it('should order by created_at desc', async () => {
      const now = new Date();
      const timestamps = [
        new Date(now.getTime() - 3000), // oldest
        new Date(now.getTime() - 2000),
        new Date(now.getTime() - 1000), // newest
      ];

      // Insert in random order
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, created_at)
         VALUES ($1, 'JIRA-2', 'jira', $2, $3, true, 'pending', $4)`,
        [testBugReportId, testIntegrationId, testRuleId, timestamps[1]]
      );

      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, created_at)
         VALUES ($1, 'JIRA-1', 'jira', $2, $3, true, 'pending', $4)`,
        [testBugReportId, testIntegrationId, testRuleId, timestamps[0]]
      );

      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, created_at)
         VALUES ($1, 'JIRA-3', 'jira', $2, $3, true, 'pending', $4)`,
        [testBugReportId, testIntegrationId, testRuleId, timestamps[2]]
      );

      const tickets = await db.tickets.findByIntegrationId(testIntegrationId);

      // Should be ordered newest first
      expect(tickets[0].external_id).toBe('JIRA-3');
      expect(tickets[1].external_id).toBe('JIRA-2');
      expect(tickets[2].external_id).toBe('JIRA-1');
    });

    it('should return empty array when no matches', async () => {
      const nonExistentIntegrationId = '00000000-0000-0000-0000-000000000000';
      const tickets = await db.tickets.findByIntegrationId(nonExistentIntegrationId);

      expect(tickets).toEqual([]);
    });
  });

  describe('countByIntegration', () => {
    it('should count all tickets', async () => {
      // Create tickets
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-1', 'jira', $2, $3, true, 'pending')`,
        [testBugReportId, testIntegrationId, testRuleId]
      );

      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-2', 'jira', $2, $3, true, 'synced')`,
        [testBugReportId, testIntegrationId, testRuleId]
      );

      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-MANUAL', 'jira', $2, false, 'pending')`,
        [testBugReportId, testIntegrationId]
      );

      const count = await db.tickets.countByIntegration(testIntegrationId);
      expect(count).toBe(3);
    });

    it('should filter by since date', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      // Create old ticket
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, created_at)
         VALUES ($1, 'JIRA-OLD', 'jira', $2, $3, true, 'pending', $4)`,
        [testBugReportId, testIntegrationId, testRuleId, twoDaysAgo]
      );

      // Create recent ticket
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, created_at)
         VALUES ($1, 'JIRA-NEW', 'jira', $2, $3, true, 'pending', $4)`,
        [testBugReportId, testIntegrationId, testRuleId, now]
      );

      const count = await db.tickets.countByIntegration(testIntegrationId, { since: yesterday });
      expect(count).toBe(1);
    });

    it('should filter by status', async () => {
      // Create tickets with different statuses
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, status)
         VALUES ($1, 'JIRA-OPEN', 'jira', $2, $3, true, 'pending', 'open')`,
        [testBugReportId, testIntegrationId, testRuleId]
      );

      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, status)
         VALUES ($1, 'JIRA-RESOLVED', 'jira', $2, $3, true, 'synced', 'resolved')`,
        [testBugReportId, testIntegrationId, testRuleId]
      );

      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, status)
         VALUES ($1, 'JIRA-RESOLVED-2', 'jira', $2, $3, true, 'synced', 'resolved')`,
        [testBugReportId, testIntegrationId, testRuleId]
      );

      const count = await db.tickets.countByIntegration(testIntegrationId, {
        status: 'resolved',
      });
      expect(count).toBe(2);
    });

    it('should filter by created_automatically', async () => {
      // Create auto-created tickets
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-AUTO-1', 'jira', $2, $3, true, 'pending')`,
        [testBugReportId, testIntegrationId, testRuleId]
      );

      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-AUTO-2', 'jira', $2, $3, true, 'synced')`,
        [testBugReportId, testIntegrationId, testRuleId]
      );

      // Create manual ticket
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, created_automatically, sync_status)
         VALUES ($1, 'JIRA-MANUAL', 'jira', $2, false, 'pending')`,
        [testBugReportId, testIntegrationId]
      );

      const autoCount = await db.tickets.countByIntegration(testIntegrationId, {
        createdAutomatically: true,
      });
      expect(autoCount).toBe(2);

      const manualCount = await db.tickets.countByIntegration(testIntegrationId, {
        createdAutomatically: false,
      });
      expect(manualCount).toBe(1);
    });

    it('should combine multiple filters', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      // Old auto-created open ticket
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, status, created_at)
         VALUES ($1, 'JIRA-1', 'jira', $2, $3, true, 'pending', 'open', $4)`,
        [testBugReportId, testIntegrationId, testRuleId, twoDaysAgo]
      );

      // Recent auto-created open ticket (matches all filters)
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, status, created_at)
         VALUES ($1, 'JIRA-2', 'jira', $2, $3, true, 'synced', 'open', $4)`,
        [testBugReportId, testIntegrationId, testRuleId, now]
      );

      // Recent auto-created resolved ticket
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, status, created_at)
         VALUES ($1, 'JIRA-3', 'jira', $2, $3, true, 'synced', 'resolved', $4)`,
        [testBugReportId, testIntegrationId, testRuleId, now]
      );

      // Recent manual open ticket
      await db.query(
        `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, created_automatically, sync_status, status, created_at)
         VALUES ($1, 'JIRA-4', 'jira', $2, false, 'pending', 'open', $3)`,
        [testBugReportId, testIntegrationId, now]
      );

      // Query: recent + open + auto-created
      const count = await db.tickets.countByIntegration(testIntegrationId, {
        since: yesterday,
        status: 'open',
        createdAutomatically: true,
      });

      expect(count).toBe(1); // Only JIRA-2 matches all filters
    });
  });
});
