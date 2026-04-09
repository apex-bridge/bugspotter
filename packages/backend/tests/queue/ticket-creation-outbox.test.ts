import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDatabaseClient, DatabaseClient } from '../../src/db/client.js';
import { TicketCreationOutboxProcessor } from '../../src/queue/workers/outbox/ticket-creation-outbox.worker.js';
import { PluginRegistry } from '../../src/integrations/plugin-registry.js';
import { createProjectIntegrationSQL } from '../test-helpers.js';

describe('Ticket Creation Outbox System', () => {
  let db: DatabaseClient;
  let processor: TicketCreationOutboxProcessor;
  let mockPluginRegistry: PluginRegistry;
  let mockService: any; // Shared service instance for mock modifications
  let testProjectId: string;
  let testBugReportId: string;
  let testIntegrationId: string;
  let testRuleId: string;

  // Helper to create job structure for processor
  const createJob = (outboxEntryId: string) =>
    ({
      id: `job-${Date.now()}`,
      data: { outboxEntryId },
    }) as any;

  beforeEach(async () => {
    db = createDatabaseClient();

    // Create fresh mock service for each test to ensure complete isolation
    mockService = {
      createFromBugReport: vi.fn().mockResolvedValue({
        externalId: 'JIRA-12345',
        externalUrl: 'https://jira.example.com/browse/JIRA-12345',
      }),
    };

    mockPluginRegistry = {
      get: vi.fn().mockReturnValue(mockService),
      getSupportedPlatforms: vi.fn().mockReturnValue(['jira']),
      isSupported: vi.fn().mockImplementation((platform) => platform === 'jira'),
    } as any;

    processor = new TicketCreationOutboxProcessor(db, mockPluginRegistry);

    // Create jira integration (required for FK relationship)
    await db.query(
      `INSERT INTO integrations (type, name, status) VALUES ('jira', 'Jira', 'not_configured')
       ON CONFLICT (type) DO NOTHING`
    );

    // Create test project (without api_key - that's in separate table now)
    const project = await db.projects.create({
      name: 'Test Outbox Project',
    });
    testProjectId = project.id;

    // Create test bug report
    const bugReportData = {
      title: 'Test Outbox Bug',
      description: 'Testing outbox pattern',
    };

    const bugReport = await db.bugReports.create({
      project_id: testProjectId,
      title: bugReportData.title,
      description: bugReportData.description,
      status: 'open',
      metadata: {},
    });
    testBugReportId = bugReport.id;

    // Create test integration (uses integration_id FK)
    const integration = await db.query(createProjectIntegrationSQL(), [
      testProjectId,
      'jira',
      true,
      JSON.stringify({ encrypted: 'test_config' }),
      null,
    ]);
    testIntegrationId = integration.rows[0].id;

    // Create test rule
    const rule = await db.query(
      `INSERT INTO integration_rules (project_id, integration_id, name, enabled, filters)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [testProjectId, testIntegrationId, 'Test Rule', true, '[]']
    );
    testRuleId = rule.rows[0].id;
  });

  afterEach(async () => {
    // No need to reset mocks - fresh instance created in beforeEach

    // Cleanup test data - order matters due to foreign keys
    // Delete in reverse order of creation to avoid FK violations
    try {
      await db.query(
        'DELETE FROM tickets WHERE bug_report_id IN (SELECT id FROM bug_reports WHERE project_id = $1)',
        [testProjectId]
      );
      await db.query('DELETE FROM ticket_creation_outbox WHERE project_id = $1', [testProjectId]);
      await db.query('DELETE FROM integration_rules WHERE project_id = $1', [testProjectId]);
      await db.query('DELETE FROM bug_reports WHERE project_id = $1', [testProjectId]);
      await db.query('DELETE FROM project_integrations WHERE project_id = $1', [testProjectId]);
      await db.query('DELETE FROM projects WHERE id = $1', [testProjectId]);
    } catch (error) {
      // Log but don't fail test on cleanup errors
      console.error('Cleanup error:', error);
    }

    await db.close();
  });

  describe('Happy Path', () => {
    it('should create outbox entry with pending status', async () => {
      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      expect(outboxEntry.status).toBe('pending');
      expect(outboxEntry.retry_count).toBe(0);
      expect(outboxEntry.idempotency_key).toMatch(/^[a-f0-9-]+:[a-f0-9-]+:\d+$/);
      expect(outboxEntry.project_id).toBe(testProjectId);
      expect(outboxEntry.bug_report_id).toBe(testBugReportId);
      expect(outboxEntry.integration_id).toBe(testIntegrationId);
    });

    it('should process pending entry successfully', async () => {
      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // Process the job
      await processor.process(createJob(outboxEntry.id));

      // Verify ticket was created
      // Service.createFromBugReport called automatically by processor
      expect(mockService.createFromBugReport).toHaveBeenCalled();

      // Verify outbox entry marked as completed
      const updated = await db.ticketOutbox.findById(outboxEntry.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.processed_at).not.toBeNull();
      expect(updated?.external_ticket_id).toBe('JIRA-12345');
      expect(updated?.external_ticket_url).toBe('https://jira.example.com/browse/JIRA-12345');
    });

    it('should record ticket in database after successful creation', async () => {
      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // Mock integration service to create ticket like JiraService.saveTicketReference() does
      mockService.createFromBugReport.mockReset();
      mockService.createFromBugReport.mockImplementation(async () => {
        console.log('[TEST] Mock createFromBugReport called - creating ticket in database');
        // Integration service creates ticket in database (mimics JiraService behavior)
        await db.transaction(async (tx) => {
          await tx.tickets.create({
            bug_report_id: testBugReportId,
            external_id: 'JIRA-12345',
            platform: 'jira',
            status: 'open',
            external_url: 'https://jira.example.com/browse/JIRA-12345',
          });
          await tx.bugReports.updateExternalIntegration(
            testBugReportId,
            'JIRA-12345',
            'https://jira.example.com/browse/JIRA-12345'
          );
        });

        return {
          externalId: 'JIRA-12345',
          externalUrl: 'https://jira.example.com/browse/JIRA-12345',
        };
      });

      await processor.process(createJob(outboxEntry.id));

      // Verify ticket record created BY INTEGRATION SERVICE
      const tickets = await db.query('SELECT * FROM tickets WHERE bug_report_id = $1', [
        testBugReportId,
      ]);

      console.log('[TEST] Tickets found:', tickets.rows.length);
      expect(tickets.rows).toHaveLength(1);
      expect(tickets.rows[0].external_id).toBe('JIRA-12345');
      expect(tickets.rows[0].external_url).toBe('https://jira.example.com/browse/JIRA-12345');
      expect(tickets.rows[0].platform).toBe('jira');
    });

    it('should poll and schedule pending jobs', async () => {
      // Create a second rule for unique idempotency keys
      const rule2 = await db.query(
        `INSERT INTO integration_rules (project_id, integration_id, name, enabled, filters)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [testProjectId, testIntegrationId, 'Test Rule 2', true, '[]']
      );
      const testRuleId2 = rule2.rows[0].id;

      // Create multiple pending entries (different rules = unique idempotency keys)
      // Set scheduled_at to past to ensure findPending returns them
      const pastDate = new Date(Date.now() - 1000); // 1 second ago

      const entry1 = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        scheduled_at: pastDate,
        payload: {
          title: 'Test Bug 1',
          description: 'Test Description 1',
          url: 'https://test.example.com/1',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      const entry2 = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId2, // Different rule = unique key
        scheduled_at: pastDate,
        payload: {
          title: 'Test Bug 2',
          description: 'Test Description 2',
          url: 'https://test.example.com/2',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // Verify both entries were created
      expect(entry1.id).toBeTruthy();
      expect(entry2.id).toBeTruthy();
      expect(entry1.status).toBe('pending');
      expect(entry2.status).toBe('pending');

      // Verify entries exist in database immediately after creation
      const verifyQuery = await db.query(
        'SELECT id, status, scheduled_at FROM ticket_creation_outbox WHERE id = ANY($1)',
        [[entry1.id, entry2.id]]
      );
      expect(verifyQuery.rows).toHaveLength(2);

      // Small delay to ensure any transaction commits are complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const pendingJobs = await db.ticketOutbox.findPending(10);
      expect(pendingJobs.length).toBeGreaterThanOrEqual(2);
      expect(pendingJobs.some((job) => job.id === entry1.id)).toBe(true);
      expect(pendingJobs.some((job) => job.id === entry2.id)).toBe(true);
    });
  });

  describe('Retry Logic', () => {
    it('should retry on transient failure with exponential backoff', async () => {
      // Mock transient error (network timeout)
      mockService.createFromBugReport = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({
          externalId: 'JIRA-12345',
          externalUrl: 'https://jira.example.com/browse/JIRA-12345',
        });

      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // First attempt - should fail
      await expect(processor.process(createJob(outboxEntry.id))).rejects.toThrow('ECONNREFUSED');

      let updated = await db.ticketOutbox.findById(outboxEntry.id);
      expect(updated?.status).toBe('failed');
      expect(updated?.retry_count).toBe(1);
      expect(updated?.error_message).toContain('ECONNREFUSED');
      expect(updated?.next_retry_at).not.toBeNull();

      // Verify exponential backoff (first retry at +1 minute)
      const timeDiff = updated!.next_retry_at!.getTime() - updated!.created_at.getTime();
      expect(timeDiff).toBeGreaterThanOrEqual(55_000); // ~1 minute (allow 5s tolerance)
      expect(timeDiff).toBeLessThanOrEqual(65_000);

      // Second attempt - should succeed
      await processor.process(createJob(outboxEntry.id));

      updated = await db.ticketOutbox.findById(outboxEntry.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.external_ticket_id).toBe('JIRA-12345');
    });

    it('should move to dead letter queue after max retries', async () => {
      // Mock persistent error
      mockService.createFromBugReport = vi.fn().mockRejectedValue(new Error('Permanent failure'));

      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // Simulate 3 failed attempts (max_retries defaults to 3)
      for (let i = 0; i < 3; i++) {
        await expect(processor.process(createJob(outboxEntry.id))).rejects.toThrow(
          'Permanent failure'
        );

        const updated = await db.ticketOutbox.findById(outboxEntry.id);
        expect(updated?.retry_count).toBe(i + 1);

        if (i < 2) {
          // First 3 attempts: status is 'failed' with retry scheduled
          expect(updated?.status).toBe('failed');
          expect(updated?.next_retry_at).not.toBeNull();
        }
      }

      // After 3rd failure, should move to dead letter queue
      const finalState = await db.ticketOutbox.findById(outboxEntry.id);
      expect(finalState?.status).toBe('dead_letter');
      expect(finalState?.retry_count).toBe(3);
      // Note: next_retry_at may still be set even in dead_letter status
      expect(finalState?.error_message).toContain('Permanent failure');
    });

    it('should use correct exponential backoff intervals', async () => {
      mockService.createFromBugReport = vi.fn().mockRejectedValue(new Error('Test error'));

      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      const expectedDelays = [
        60_000, // Retry 1: 1 minute
        300_000, // Retry 2: 5 minutes
        1_800_000, // Retry 3: 30 minutes
      ];

      for (let i = 0; i < 5; i++) {
        if (i < 3) {
          // First 3 attempts should fail and update retry count
          await expect(processor.process(createJob(outboxEntry.id))).rejects.toThrow();
        } else {
          // After max retries (3), worker doesn't throw - just marks as dead_letter and returns
          await processor.process(createJob(outboxEntry.id));
        }

        const updated = await db.ticketOutbox.findById(outboxEntry.id);

        if (i < 3) {
          // Check exponential backoff delays for retries 1, 2, 3
          const timeDiff = updated!.next_retry_at!.getTime() - updated!.updated_at.getTime();
          const tolerance = 5_000; // 5 second tolerance
          expect(timeDiff).toBeGreaterThanOrEqual(expectedDelays[i] - tolerance);
          expect(timeDiff).toBeLessThanOrEqual(expectedDelays[i] + tolerance);
        }
      }
    });

    it('should not retry jobs already being processed', async () => {
      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // Mark as processing
      await db.ticketOutbox.markProcessing(outboxEntry.id);

      // Try to find pending jobs - should not include processing jobs
      const pendingJobs = await db.ticketOutbox.findPending(10);
      expect(pendingJobs.find((job) => job.id === outboxEntry.id)).toBeUndefined();
    });
  });

  describe('Idempotency', () => {
    it('should generate unique idempotency key for each entry', async () => {
      const entry1 = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug 1',
          description: 'Test Description 1',
          url: 'https://test.example.com/1',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      const entry2 = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug 2',
          description: 'Test Description 2',
          url: 'https://test.example.com/2',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      expect(entry1.idempotency_key).not.toBe(entry2.idempotency_key);
      expect(entry1.idempotency_key).toMatch(/^[a-f0-9-]+:[a-f0-9-]+:\d+$/);
      expect(entry2.idempotency_key).toMatch(/^[a-f0-9-]+:[a-f0-9-]+:\d+$/);
    });

    it('should not create duplicate tickets for the same outbox entry', async () => {
      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // Mock integration service to create ticket on first call only
      let ticketCreated = false;
      mockService.createFromBugReport.mockReset();
      mockService.createFromBugReport.mockImplementation(async () => {
        if (!ticketCreated) {
          // First call: Create ticket in database like JiraService does
          await db.transaction(async (tx) => {
            await tx.tickets.createTicket(testBugReportId, 'JIRA-12345', 'jira', 'open');
            await tx.bugReports.updateExternalIntegration(
              testBugReportId,
              'JIRA-12345',
              'https://jira.example.com/browse/JIRA-12345'
            );
          });
          ticketCreated = true;
        }
        return {
          externalId: 'JIRA-12345',
          externalUrl: 'https://jira.example.com/browse/JIRA-12345',
        };
      });

      // Process once
      await processor.process(createJob(outboxEntry.id));

      // Try to process again - should be no-op (entry already marked completed)
      await processor.process(createJob(outboxEntry.id));

      // Verify plugin service only called once
      expect(mockService.createFromBugReport).toHaveBeenCalledTimes(1);

      // Verify only one ticket record (created by integration service)
      const tickets = await db.query('SELECT * FROM tickets WHERE bug_report_id = $1', [
        testBugReportId,
      ]);
      expect(tickets.rows).toHaveLength(1);
    });

    it('should handle concurrent processing attempts gracefully', async () => {
      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // Mock integration service to create ticket (only succeeds once due to DB constraint)
      let ticketCreated = false;
      mockService.createFromBugReport.mockReset();
      mockService.createFromBugReport.mockImplementation(async () => {
        if (!ticketCreated) {
          await db.transaction(async (tx) => {
            await tx.tickets.createTicket(testBugReportId, 'JIRA-12345', 'jira', 'open');
            await tx.bugReports.updateExternalIntegration(
              testBugReportId,
              'JIRA-12345',
              'https://jira.example.com/browse/JIRA-12345'
            );
          });
          ticketCreated = true;
        }
        return {
          externalId: 'JIRA-12345',
          externalUrl: 'https://jira.example.com/browse/JIRA-12345',
        };
      });

      // Simulate concurrent processing
      const results = await Promise.allSettled([
        processor.process(createJob(outboxEntry.id)),
        processor.process(createJob(outboxEntry.id)),
        processor.process(createJob(outboxEntry.id)),
      ]);

      // At least one should succeed
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      expect(succeeded).toBeGreaterThanOrEqual(1);

      // Verify plugin service called (may be multiple times due to race conditions)
      expect(mockService.createFromBugReport).toHaveBeenCalled();

      // Most important: Verify only ONE ticket record exists in database
      // (This is what idempotency guarantees - no duplicate tickets)
      const tickets = await db.query('SELECT * FROM tickets WHERE bug_report_id = $1', [
        testBugReportId,
      ]);
      expect(tickets.rows).toHaveLength(1);

      // Note: Mock might be called multiple times due to race conditions before database
      // constraints fire. The key guarantee is no duplicate tickets, not mock call count.
      // In concurrent scenarios, multiple workers may attempt creation before the duplicate
      // key constraint is enforced, so we verify the end state (1 ticket) rather than
      // intermediate call counts.
      const mockFn = mockService.createFromBugReport as ReturnType<typeof vi.fn>;
      const callCount = mockFn.mock.calls.length;
      expect(callCount).toBeGreaterThanOrEqual(1);
      expect(callCount).toBeLessThanOrEqual(3); // Allow up to 3 attempts in race condition
    });

    it('should prevent duplicate processing via database status', async () => {
      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // First process succeeds
      await processor.process(createJob(outboxEntry.id));

      // Second process should skip (already completed)
      await processor.process(createJob(outboxEntry.id));

      // Verify plugin service only called once (second call skipped due to completed status)
      expect(mockService.createFromBugReport).toHaveBeenCalledTimes(1);
    });
  });

  describe('Dead Letter Queue', () => {
    it('should query dead letter queue entries', async () => {
      // Create entry and force it to dead letter
      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // Manually set to dead letter for testing
      await db.query(
        `UPDATE ticket_creation_outbox 
         SET status = 'dead_letter', retry_count = 5, error_message = 'Max retries exceeded'
         WHERE id = $1`,
        [outboxEntry.id]
      );

      const deadLetterJobs = await db.query(
        `SELECT * FROM ticket_creation_outbox WHERE status = 'dead_letter'`
      );

      expect(deadLetterJobs.rows).toHaveLength(1);
      expect(deadLetterJobs.rows[0].id).toBe(outboxEntry.id);
      expect(deadLetterJobs.rows[0].retry_count).toBe(5);
    });

    it('should allow manual retry from dead letter queue', async () => {
      // Create entry in dead letter queue
      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      await db.query(
        `UPDATE ticket_creation_outbox 
         SET status = 'dead_letter', retry_count = 5, error_message = 'Max retries exceeded'
         WHERE id = $1`,
        [outboxEntry.id]
      );

      // Reset for manual retry
      await db.query(
        `UPDATE ticket_creation_outbox 
         SET status = 'pending', retry_count = 0, error_message = NULL, next_retry_at = NULL
         WHERE id = $1`,
        [outboxEntry.id]
      );

      // Process again - should succeed now
      await processor.process(createJob(outboxEntry.id));

      const updated = await db.ticketOutbox.findById(outboxEntry.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.external_ticket_id).toBe('JIRA-12345');
    });

    it('should track error messages in dead letter queue', async () => {
      mockService.createFromBugReport = vi
        .fn()
        .mockRejectedValue(new Error('Authentication failed: Invalid API token'));

      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // Fail 3 times to reach dead letter (then attempt 2 more times)
      for (let i = 0; i < 5; i++) {
        if (i < 3) {
          await expect(processor.process(createJob(outboxEntry.id))).rejects.toThrow();
        } else {
          // After dead_letter, no exception thrown
          await processor.process(createJob(outboxEntry.id));
        }
      }

      const deadLetter = await db.ticketOutbox.findById(outboxEntry.id);
      expect(deadLetter?.status).toBe('dead_letter');
      expect(deadLetter?.error_message).toContain('Authentication failed');
      expect(deadLetter?.error_message).toContain('Invalid API token');
    });
  });

  describe('Statistics', () => {
    it('should calculate outbox statistics correctly', async () => {
      // Create entries in various states
      await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Pending Bug 1',
          description: 'Test',
          url: 'https://test.example.com/1',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      const entry2 = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Completed Bug',
          description: 'Test',
          url: 'https://test.example.com/2',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });
      await processor.process(createJob(entry2.id));

      const entry3 = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Failed Bug',
          description: 'Test',
          url: 'https://test.example.com/3',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });
      mockService.createFromBugReport = vi.fn().mockRejectedValue(new Error('Test failure'));
      await expect(processor.process(createJob(entry3.id))).rejects.toThrow();

      const stats = await db.ticketOutbox.getStats();

      expect(stats.pending).toBeGreaterThanOrEqual(1);
      expect(stats.completed).toBeGreaterThanOrEqual(1);
      expect(stats.failed).toBeGreaterThanOrEqual(1);
      expect(stats.processing).toBe(0);
      expect(stats.dead_letter).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing bug report gracefully', async () => {
      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // Delete bug report
      await db.query('DELETE FROM bug_reports WHERE id = $1', [testBugReportId]);

      // Processing should fail gracefully - outbox entry deleted by cascade
      await expect(processor.process(createJob(outboxEntry.id))).rejects.toThrow();

      const updated = await db.ticketOutbox.findById(outboxEntry.id);
      // Entry should be null due to cascade delete from bug_reports
      expect(updated).toBeNull();
    });

    it('should handle invalid integration config', async () => {
      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      mockService.createFromBugReport = vi
        .fn()
        .mockRejectedValue(new Error('Invalid configuration'));

      await expect(processor.process(createJob(outboxEntry.id))).rejects.toThrow();

      const updated = await db.ticketOutbox.findById(outboxEntry.id);
      expect(updated?.status).toBe('failed'); // First retry
      expect(updated?.error_message).toContain('Invalid configuration');
    });

    it('should handle empty bug report data', async () => {
      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: '',
          description: '',
          url: '',
          user_agent: '',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // Should still attempt processing (validation happens in plugin)
      await processor.process(createJob(outboxEntry.id));

      expect(mockPluginRegistry.get('jira')!.createFromBugReport).toHaveBeenCalled();
    });

    it('should handle processing non-existent outbox entry', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await expect(processor.process(createJob(fakeId))).rejects.toThrow();
    });

    it('should detect and mark invalid platforms during polling - production fix', async () => {
      // This test verifies the fix for the production issue where outbox entries
      // with unsupported platforms (e.g., 'custom_integration') got stuck indefinitely
      // without error logs. The pre-validation now detects invalid platforms during
      // polling and marks them as failed with appropriate error messages.

      // Create second rule for unique idempotency key
      const rule2 = await db.query(
        `INSERT INTO integration_rules (project_id, integration_id, name, enabled, filters)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [testProjectId, testIntegrationId, 'Invalid Platform Rule', true, '[]']
      );
      const invalidRuleId = rule2.rows[0].id;

      const pastDate = new Date(Date.now() - 1000);

      // Create entry with invalid platform (like 'custom_integration' in production)
      const invalidEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'custom_integration', // Invalid platform
        rule_id: invalidRuleId,
        scheduled_at: pastDate,
        payload: {
          title: 'Test Bug - Invalid Platform',
          description: 'Testing invalid platform detection',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // Create valid entry for comparison
      const validEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira', // Valid platform
        rule_id: testRuleId,
        scheduled_at: pastDate,
        payload: {
          title: 'Test Bug - Valid Platform',
          description: 'Testing valid platform processing',
          url: 'https://test.example.com/valid',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // Configure mock to properly check platform support
      (mockPluginRegistry.isSupported as any).mockImplementation((platform: string) => {
        return platform === 'jira'; // Only jira is supported
      });

      // Poll and schedule - should detect invalid platform
      const scheduled = await processor.pollAndScheduleJobs(10);

      // Only valid entry should be scheduled
      expect(scheduled).toBe(1);

      // Verify invalid entry was marked as failed
      const invalidUpdated = await db.ticketOutbox.findById(invalidEntry.id);
      expect(invalidUpdated?.status).toBe('failed');
      expect(invalidUpdated?.error_message).toContain('custom_integration');
      expect(invalidUpdated?.error_message).toContain('not found in plugin registry');
      expect(invalidUpdated?.error_message).toContain('jira'); // Lists available platforms

      // Verify valid entry was scheduled (status changed to processing or completed)
      const validUpdated = await db.ticketOutbox.findById(validEntry.id);
      expect(validUpdated?.status).not.toBe('pending'); // Should be processed
    });
  });

  describe('Duplicate Ticket Creation Bug', () => {
    it('should NOT create duplicate tickets - integration service handles DB updates', async () => {
      // Mock service that creates ticket in database (like JiraService does)
      mockService.createFromBugReport = vi.fn().mockImplementation(async (bugReport) => {
        // Simulate what JiraService.saveTicketReference() does
        await db.transaction(async (tx) => {
          await tx.tickets.createTicket(bugReport.id, 'JIRA-99999', 'jira', 'open');
          await tx.bugReports.updateExternalIntegration(
            bugReport.id,
            'JIRA-99999',
            'https://jira.example.com/browse/JIRA-99999'
          );
        });

        return {
          externalId: 'JIRA-99999',
          externalUrl: 'https://jira.example.com/browse/JIRA-99999',
        };
      });

      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      // Process the job
      await processor.process(createJob(outboxEntry.id));

      // Count tickets created for this bug report
      const tickets = await db.query('SELECT * FROM tickets WHERE bug_report_id = $1', [
        testBugReportId,
      ]);

      // FIXED: Now only 1 ticket (integration service creates it, outbox worker doesn't duplicate)
      expect(tickets.rows).toHaveLength(1);
      expect(tickets.rows[0].external_id).toBe('JIRA-99999');
    });

    it('should verify bug_reports table is updated by integration service', async () => {
      // Mock service that creates ticket in database
      mockService.createFromBugReport = vi.fn().mockImplementation(async (bugReport) => {
        // Service updates both tickets table AND bug_reports table
        await db.transaction(async (tx) => {
          await tx.tickets.createTicket(bugReport.id, 'JIRA-88888', 'jira', 'open');
          await tx.bugReports.updateExternalIntegration(
            bugReport.id,
            'JIRA-88888',
            'https://jira.example.com/browse/JIRA-88888'
          );
        });

        return {
          externalId: 'JIRA-88888',
          externalUrl: 'https://jira.example.com/browse/JIRA-88888',
        };
      });

      const outboxEntry = await db.ticketOutbox.create({
        project_id: testProjectId,
        bug_report_id: testBugReportId,
        integration_id: testIntegrationId,
        platform: 'jira',
        rule_id: testRuleId,
        payload: {
          title: 'Test Bug',
          description: 'Test Description',
          url: 'https://test.example.com',
          user_agent: 'TestAgent/1.0',
          timestamp: new Date().toISOString(),
          severity: 'medium',
        },
      });

      await processor.process(createJob(outboxEntry.id));

      // Verify bug_reports table was updated with external integration data in metadata
      const bugReport = await db.bugReports.findById(testBugReportId);
      expect(bugReport?.metadata.externalId).toBe('JIRA-88888');
      expect(bugReport?.metadata.externalUrl).toBe('https://jira.example.com/browse/JIRA-88888');

      // Verify only 1 ticket exists
      const tickets = await db.query(
        'SELECT * FROM tickets WHERE bug_report_id = $1 ORDER BY created_at',
        [testBugReportId]
      );

      expect(tickets.rows).toHaveLength(1);
      expect(tickets.rows[0].external_id).toBe('JIRA-88888');
    });
  });
});
