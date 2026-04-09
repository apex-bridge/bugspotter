/**
 * Automatic Ticket Creation Integration Tests (Transactional Outbox Pattern)
 *
 * Tests complete E2E flow: Bug Report Creation → Rule Evaluation → Outbox Entry → Worker Processing → Ticket Creation
 *
 * Flow (Transactional Outbox Pattern):
 * 1. Bug report created
 * 2. AutoTicketService evaluates rules
 * 3. Matching rule creates outbox entry (atomic)
 * 4. Background worker processes outbox entry asynchronously
 * 5. External ticket created and database updated
 *
 * Tests verify:
 * - Outbox entry creation (immediate result of tryCreateTicket)
 * - Worker processing (simulated via TicketCreationOutboxProcessor)
 * - Final state (ticket exists, outbox marked completed)
 *
 * Uses real database (Testcontainers) and mocked external APIs (Jira, GitHub)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestDatabase } from '../setup.integration.js';
import { createTestProject, TestCleanupTracker } from '../utils/test-utils.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { AutoTicketService } from '../../src/services/integrations/auto-ticket-service.js';
import { PluginRegistry } from '../../src/integrations/plugin-registry.js';
import { TicketCreationOutboxProcessor } from '../../src/queue/workers/outbox/ticket-creation-outbox.worker.js';
import { getEncryptionService } from '../../src/utils/encryption.js';
import type { IStorageService } from '../../src/storage/types.js';
import type { JiraConfig } from '../../src/integrations/jira/types.js';

// Mock Jira client to avoid real API calls
// Generate unique ticket IDs using timestamp + random to avoid constraint violations
vi.mock('../../src/integrations/jira/client.js', () => ({
  JiraClient: vi.fn().mockImplementation(() => {
    // Create the mock function that generates unique IDs on EACH call
    const createIssueMock = vi.fn(async () => {
      // Generate unique ID on every invocation (not at mock definition time)
      const uniqueId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      return {
        id: `mock-issue-id-${uniqueId}`,
        key: `AUTO-${uniqueId}`,
        self: `https://jira.example.com/rest/api/3/issue/${uniqueId}`,
      };
    });

    return {
      createIssue: createIssueMock,
      getIssueUrl: vi.fn((key: string) => `https://example.atlassian.net/browse/${key}`),
      uploadAttachment: vi.fn().mockResolvedValue({
        id: 'attach-1',
        filename: 'screenshot.png',
        size: 1024,
        mimeType: 'image/png',
        content: 'https://jira.example.com/attachment/1',
      }),
    };
  }),
}));

// Mock storage service
const mockStorage: IStorageService = {
  uploadScreenshot: vi.fn().mockResolvedValue({ key: 'mock-key', size: 1234 }),
  uploadThumbnail: vi.fn().mockResolvedValue({ key: 'mock-key', size: 1234 }),
  uploadAttachment: vi.fn().mockResolvedValue({ key: 'mock-key', size: 1234 }),
  uploadStream: vi.fn().mockResolvedValue({ key: 'mock-key', size: 1234 }),
  getObject: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  getSignedUrl: vi.fn().mockResolvedValue('mock-url'),
  getPresignedUploadUrl: vi.fn().mockResolvedValue('mock-url'),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  deleteFolder: vi.fn().mockResolvedValue(undefined),
  listObjects: vi.fn().mockResolvedValue({ objects: [], isTruncated: false }),
  headObject: vi.fn().mockResolvedValue(null),
  healthCheck: vi.fn().mockResolvedValue(true),
} as any;

describe('Automatic Ticket Creation - E2E Flow (Transactional Outbox)', () => {
  let db: DatabaseClient;
  let pluginRegistry: PluginRegistry;
  let autoTicketService: AutoTicketService;
  let outboxProcessor: TicketCreationOutboxProcessor;
  const cleanup = new TestCleanupTracker();
  const encryptionService = getEncryptionService();
  let jiraGlobalIntegrationId: string;

  const mockJiraConfig: JiraConfig = {
    host: 'https://example.atlassian.net',
    email: 'test@example.com',
    apiToken: 'mock-api-token',
    projectKey: 'AUTO',
    issueType: 'Bug',
    enabled: true,
  };

  // Config as stored in database (instanceUrl instead of host)
  const mockJiraDatabaseConfig = {
    instanceUrl: 'https://example.atlassian.net',
    projectKey: 'AUTO',
    issueType: 'Bug',
    autoCreate: true,
    syncStatus: false,
    syncComments: false,
  };

  beforeAll(async () => {
    db = createTestDatabase();
    pluginRegistry = new PluginRegistry(db, mockStorage);

    // Load integration plugins (Jira, GitHub, etc.)
    const { loadIntegrationPlugins } = await import('../../src/integrations/plugin-loader.js');
    await loadIntegrationPlugins(pluginRegistry);

    autoTicketService = new AutoTicketService(db);
    outboxProcessor = new TicketCreationOutboxProcessor(db, pluginRegistry);

    // Use existing Jira integration from migration
    const globalIntegration = await db.integrations.findByType('jira');
    if (!globalIntegration) {
      throw new Error('Jira integration not found - migration may have failed');
    }
    jiraGlobalIntegrationId = globalIntegration.id;
  });

  beforeEach(async () => {
    await cleanup.cleanup(db);
    // Each test uses transactional outbox pattern:
    // 1. tryCreateTicket creates outbox entry
    // 2. Worker processes outbox entry (simulated via processor.process)
    // 3. Final state is verified (ticket + completed outbox entry)
  });

  afterAll(async () => {
    await cleanup.cleanup(db);
  });

  describe('Basic Automatic Ticket Creation', () => {
    it('should automatically create ticket when rule matches bug report', async () => {
      // Given: Project with Jira integration
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const encryptedCreds = encryptionService.encrypt(
        JSON.stringify({ email: 'test@example.com', apiToken: 'test-token' })
      );

      const integration = await db.projectIntegrations.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraDatabaseConfig as unknown as Record<string, unknown>,
        encrypted_credentials: encryptedCreds,
        enabled: true,
      });

      // And: Auto-create rule for critical bugs
      const rule = await db.integrationRules.createWithValidation({
        project_id: project.id,
        integration_id: integration.id,
        name: 'Auto-create for critical bugs',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'critical',
          },
        ],
      });

      // And: Critical bug report
      const bugReport = await db.bugReports.create({
        project_id: project.id,
        title: 'Critical production crash',
        description: 'Application crashes on login',
        priority: 'critical',
        status: 'open',
        metadata: {
          environment: 'production',
          userAgent: 'Mozilla/5.0',
        },
      });
      cleanup.trackBugReport(bugReport.id);

      // When: Step 1 - Automatic ticket creation triggered (creates outbox entry)
      const result = await autoTicketService.tryCreateTicket(
        bugReport,
        project.id,
        integration.id,
        'jira'
      );

      // Then: Step 2 - Outbox entry created successfully
      expect(result.success).toBe(true);
      expect(result.platform).toBe('jira');
      expect(result.ruleId).toBe(rule.id);
      expect(result.ruleName).toBe('Auto-create for critical bugs');
      expect(result.throttled).toBeUndefined();

      // Note: externalId not yet available (async processing)
      expect(result.externalId).toBeUndefined();
      expect(result.externalUrl).toBeUndefined();

      // And: Verify outbox entry created
      const outboxEntries = await db.query(
        'SELECT * FROM ticket_creation_outbox WHERE bug_report_id = $1',
        [bugReport.id]
      );
      expect(outboxEntries.rows).toHaveLength(1);
      expect(outboxEntries.rows[0].platform).toBe('jira');
      expect(outboxEntries.rows[0].rule_id).toBe(rule.id);
      expect(outboxEntries.rows[0].status).toBe('pending');

      // When: Step 3 - Worker processes outbox entry
      const outboxEntryId = outboxEntries.rows[0].id;
      await outboxProcessor.process({
        id: 'test-job-id',
        data: { outboxEntryId },
      } as any);

      // Then: Step 4 - Ticket created in database with metadata
      const tickets = await db.tickets.findByBugReport(bugReport.id);
      expect(tickets).toHaveLength(1);
      expect(tickets[0].external_id).toMatch(/^AUTO-\d+-\d+$/);
      expect(tickets[0].platform).toBe('jira');
      expect(tickets[0].integration_id).toBe(integration.id);
      expect(tickets[0].rule_id).toBe(rule.id);
      expect(tickets[0].created_automatically).toBe(true);
      // Note: Metadata is now properly saved from outbox entry → integration service → database

      // And: Outbox entry marked as completed
      const completedOutbox = await db.ticketOutbox.findById(outboxEntryId);
      expect(completedOutbox?.status).toBe('completed');
      expect(completedOutbox?.external_ticket_id).toMatch(/^AUTO-\d+-\d+$/);
      expect(completedOutbox?.external_ticket_url).toMatch(/^https:\/\//);
    });

    it('should not create ticket when no rules match', async () => {
      // Given: Project with Jira integration
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const encryptedCreds = encryptionService.encrypt(
        JSON.stringify({ email: 'test@example.com', apiToken: 'test-token' })
      );

      const integration = await db.projectIntegrations.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraConfig as unknown as Record<string, unknown>,
        encrypted_credentials: encryptedCreds,
        enabled: true,
      });

      // And: Rule for critical bugs only
      await db.integrationRules.createWithValidation({
        project_id: project.id,
        integration_id: integration.id,
        name: 'Auto-create for critical bugs',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'critical',
          },
        ],
      });

      // And: Low priority bug report (won't match)
      const bugReport = await db.bugReports.create({
        project_id: project.id,
        title: 'Minor UI issue',
        description: 'Button color slightly off',
        priority: 'low',
        status: 'open',
        metadata: {},
      });
      cleanup.trackBugReport(bugReport.id);

      // When: Automatic ticket creation attempted
      const result = await autoTicketService.tryCreateTicket(
        bugReport,
        project.id,
        integration.id,
        'jira'
      );

      // Then: No ticket created
      expect(result.success).toBe(false);
      expect(result.externalId).toBeUndefined();
      expect(result.throttled).toBeUndefined();

      // And: No outbox entry created
      const outboxEntries = await db.query(
        'SELECT * FROM ticket_creation_outbox WHERE bug_report_id = $1',
        [bugReport.id]
      );
      expect(outboxEntries.rows).toHaveLength(0);

      // And: No ticket records in database
      const tickets = await db.tickets.findByBugReport(bugReport.id);
      expect(tickets).toHaveLength(0);
    });

    it('should not create ticket when rule is disabled', async () => {
      // Given: Project with Jira integration
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const encryptedCreds = encryptionService.encrypt(
        JSON.stringify({ email: 'test@example.com', apiToken: 'test-token' })
      );

      const integration = await db.projectIntegrations.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraConfig as unknown as Record<string, unknown>,
        encrypted_credentials: encryptedCreds,
        enabled: true,
      });

      // And: Disabled auto-create rule
      await db.integrationRules.createWithValidation({
        project_id: project.id,
        integration_id: integration.id,
        name: 'Disabled rule',
        enabled: false, // Disabled
        priority: 100,
        auto_create: true,
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'critical',
          },
        ],
      });

      // And: Critical bug report
      const bugReport = await db.bugReports.create({
        project_id: project.id,
        title: 'Critical crash',
        description: 'App crashes',
        priority: 'critical',
        status: 'open',
        metadata: {},
      });
      cleanup.trackBugReport(bugReport.id);

      // When: Automatic ticket creation attempted
      const result = await autoTicketService.tryCreateTicket(
        bugReport,
        project.id,
        integration.id,
        'jira'
      );

      // Then: No ticket created (disabled rules not fetched)
      expect(result.success).toBe(false);
    });
  });

  describe('Throttling', () => {
    it('should throttle when hourly limit reached', async () => {
      // Given: Project with Jira integration
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const encryptedCreds = encryptionService.encrypt(
        JSON.stringify({ email: 'test@example.com', apiToken: 'test-token' })
      );

      const integration = await db.projectIntegrations.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraConfig as unknown as Record<string, unknown>,
        encrypted_credentials: encryptedCreds,
        enabled: true,
      });

      // And: Rule with hourly throttle limit of 2
      const rule = await db.integrationRules.createWithValidation({
        project_id: project.id,
        integration_id: integration.id,
        name: 'Throttled rule',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'critical',
          },
        ],
        throttle: {
          max_per_hour: 2,
        },
      });

      // And: Create 2 tickets already (at limit)
      const existingBug1 = await db.bugReports.create({
        project_id: project.id,
        title: 'Bug 1',
        description: 'First bug',
        priority: 'critical',
        status: 'open',
        metadata: {},
      });
      cleanup.trackBugReport(existingBug1.id);

      await db.tickets.create({
        bug_report_id: existingBug1.id,
        external_id: 'AUTO-001',
        platform: 'jira',
        integration_id: integration.id,
        rule_id: rule.id,
        created_automatically: true,
        sync_status: 'pending',
        status: null,
      });

      const existingBug2 = await db.bugReports.create({
        project_id: project.id,
        title: 'Bug 2',
        description: 'Second bug',
        priority: 'critical',
        status: 'open',
        metadata: {},
      });
      cleanup.trackBugReport(existingBug2.id);

      await db.tickets.create({
        bug_report_id: existingBug2.id,
        external_id: 'AUTO-002',
        platform: 'jira',
        integration_id: integration.id,
        rule_id: rule.id,
        created_automatically: true,
        sync_status: 'pending',
        status: null,
      });

      // When: Third bug report created (exceeds limit)
      const newBug = await db.bugReports.create({
        project_id: project.id,
        title: 'Bug 3',
        description: 'Third bug',
        priority: 'critical',
        status: 'open',
        metadata: {},
      });
      cleanup.trackBugReport(newBug.id);

      const result = await autoTicketService.tryCreateTicket(
        newBug,
        project.id,
        integration.id,
        'jira'
      );

      // Then: Ticket creation throttled (no outbox entry created)
      expect(result.success).toBe(false);
      expect(result.throttled).toBe(true);
      expect(result.throttleReason).toBe('hourly_limit');
      expect(result.ruleId).toBe(rule.id);

      // And: No outbox entry created
      const outboxEntries = await db.query(
        'SELECT * FROM ticket_creation_outbox WHERE bug_report_id = $1',
        [newBug.id]
      );
      expect(outboxEntries.rows).toHaveLength(0);

      // And: No new ticket created
      const tickets = await db.tickets.findByBugReport(newBug.id);
      expect(tickets).toHaveLength(0);
    });

    it('should allow creation when under hourly limit', async () => {
      // Given: Project with Jira integration
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const encryptedCreds = encryptionService.encrypt(
        JSON.stringify({ email: 'test@example.com', apiToken: 'test-token' })
      );

      const integration = await db.projectIntegrations.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraConfig as unknown as Record<string, unknown>,
        encrypted_credentials: encryptedCreds,
        enabled: true,
      });

      // And: Rule with hourly throttle limit of 5
      await db.integrationRules.createWithValidation({
        project_id: project.id,
        integration_id: integration.id,
        name: 'Throttled rule',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'critical',
          },
        ],
        throttle: {
          max_per_hour: 5,
        },
      });

      // And: Only 2 tickets created (under limit)
      const existingBug = await db.bugReports.create({
        project_id: project.id,
        title: 'Existing bug',
        description: 'Existing',
        priority: 'critical',
        status: 'open',
        metadata: {},
      });
      cleanup.trackBugReport(existingBug.id);

      await db.tickets.create({
        bug_report_id: existingBug.id,
        external_id: 'AUTO-001',
        platform: 'jira',
        integration_id: integration.id,
        rule_id: null,
        created_automatically: true,
        sync_status: 'pending',
        status: null,
      });

      // When: New bug report created
      const newBug = await db.bugReports.create({
        project_id: project.id,
        title: 'New critical bug',
        description: 'New issue',
        priority: 'critical',
        status: 'open',
        metadata: {},
      });
      cleanup.trackBugReport(newBug.id);

      const result = await autoTicketService.tryCreateTicket(
        newBug,
        project.id,
        integration.id,
        'jira'
      );

      // Then: Outbox entry created (under limit)
      expect(result.success).toBe(true);
      expect(result.throttled).toBeUndefined();

      // And: Outbox entry exists
      const outboxEntries = await db.query(
        'SELECT * FROM ticket_creation_outbox WHERE bug_report_id = $1',
        [newBug.id]
      );
      expect(outboxEntries.rows).toHaveLength(1);
    });
  });

  describe('Priority Ordering', () => {
    it('should use highest priority matching rule', async () => {
      // Given: Project with Jira integration
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const encryptedCreds = encryptionService.encrypt(
        JSON.stringify({ email: 'test@example.com', apiToken: 'test-token' })
      );

      const integration = await db.projectIntegrations.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraConfig as unknown as Record<string, unknown>,
        encrypted_credentials: encryptedCreds,
        enabled: true,
      });

      // And: Low priority rule (will be skipped due to lower priority)
      await db.integrationRules.createWithValidation({
        project_id: project.id,
        integration_id: integration.id,
        name: 'Low priority rule',
        enabled: true,
        priority: 50,
        auto_create: true,
        filters: [
          {
            field: 'status',
            operator: 'equals',
            value: 'open',
          },
        ],
      });

      // And: High priority rule
      const highRule = await db.integrationRules.createWithValidation({
        project_id: project.id,
        integration_id: integration.id,
        name: 'High priority rule',
        enabled: true,
        priority: 200,
        auto_create: true,
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'critical',
          },
        ],
      });

      // And: Bug matching both rules
      const bugReport = await db.bugReports.create({
        project_id: project.id,
        title: 'Critical bug',
        description: 'Critical issue',
        priority: 'critical',
        status: 'open',
        metadata: {},
      });
      cleanup.trackBugReport(bugReport.id);

      // When: Automatic ticket creation triggered
      const result = await autoTicketService.tryCreateTicket(
        bugReport,
        project.id,
        integration.id,
        'jira'
      );

      // Then: High priority rule used
      expect(result.success).toBe(true);
      expect(result.ruleId).toBe(highRule.id);
      expect(result.ruleName).toBe('High priority rule');

      // And: Outbox entry has correct rule reference
      const outboxEntries = await db.query(
        'SELECT * FROM ticket_creation_outbox WHERE bug_report_id = $1',
        [bugReport.id]
      );
      expect(outboxEntries.rows[0].rule_id).toBe(highRule.id);
    });
  });

  describe('Multiple Filters', () => {
    it('should match rule with multiple AND filters', async () => {
      // Given: Project with Jira integration
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const encryptedCreds = encryptionService.encrypt(
        JSON.stringify({ email: 'test@example.com', apiToken: 'test-token' })
      );

      const integration = await db.projectIntegrations.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraConfig as unknown as Record<string, unknown>,
        encrypted_credentials: encryptedCreds,
        enabled: true,
      });

      // And: Rule with multiple filters (AND logic)
      await db.integrationRules.createWithValidation({
        project_id: project.id,
        integration_id: integration.id,
        name: 'Critical open bugs',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'critical',
          },
          {
            field: 'status',
            operator: 'equals',
            value: 'open',
          },
        ],
      });

      // And: Bug matching all filters
      const matchingBug = await db.bugReports.create({
        project_id: project.id,
        title: 'Critical open bug',
        description: 'Matches both filters',
        priority: 'critical',
        status: 'open',
        metadata: {},
      });
      cleanup.trackBugReport(matchingBug.id);

      // When: Automatic ticket creation triggered
      const result = await autoTicketService.tryCreateTicket(
        matchingBug,
        project.id,
        integration.id,
        'jira'
      );

      // Then: Outbox entry created
      expect(result.success).toBe(true);

      // And: Outbox entry exists
      const outboxEntries = await db.query(
        'SELECT * FROM ticket_creation_outbox WHERE bug_report_id = $1',
        [matchingBug.id]
      );
      expect(outboxEntries.rows).toHaveLength(1);
    });

    it('should not match rule when one filter fails (AND logic)', async () => {
      // Given: Project with Jira integration
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const encryptedCreds = encryptionService.encrypt(
        JSON.stringify({ email: 'test@example.com', apiToken: 'test-token' })
      );

      const integration = await db.projectIntegrations.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraConfig as unknown as Record<string, unknown>,
        encrypted_credentials: encryptedCreds,
        enabled: true,
      });

      // And: Rule with multiple filters
      await db.integrationRules.createWithValidation({
        project_id: project.id,
        integration_id: integration.id,
        name: 'Critical open bugs',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'critical',
          },
          {
            field: 'status',
            operator: 'equals',
            value: 'open',
          },
        ],
      });

      // And: Bug matching only one filter (critical but resolved)
      const nonMatchingBug = await db.bugReports.create({
        project_id: project.id,
        title: 'Critical resolved bug',
        description: 'Only matches priority, not status',
        priority: 'critical',
        status: 'resolved', // Doesn't match
        metadata: {},
      });
      cleanup.trackBugReport(nonMatchingBug.id);

      // When: Automatic ticket creation attempted
      const result = await autoTicketService.tryCreateTicket(
        nonMatchingBug,
        project.id,
        integration.id,
        'jira'
      );

      // Then: No ticket created
      expect(result.success).toBe(false);
    });
  });

  describe('Database Consistency', () => {
    it('should handle database transaction failure gracefully', async () => {
      // Given: Project with Jira integration
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      const encryptedCreds = encryptionService.encrypt(
        JSON.stringify({ email: 'test@example.com', apiToken: 'test-token' })
      );

      const integration = await db.projectIntegrations.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraConfig as unknown as Record<string, unknown>,
        encrypted_credentials: encryptedCreds,
        enabled: true,
      });

      await db.integrationRules.createWithValidation({
        project_id: project.id,
        integration_id: integration.id,
        name: 'Auto rule',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'critical',
          },
        ],
      });

      const bugReport = await db.bugReports.create({
        project_id: project.id,
        title: 'Critical bug',
        description: 'Test',
        priority: 'critical',
        status: 'open',
        metadata: {},
      });
      cleanup.trackBugReport(bugReport.id);

      // Mock outbox repository to simulate transaction failure
      const originalCreate = db.ticketOutbox.create;
      db.ticketOutbox.create = vi.fn().mockRejectedValue(new Error('Database transaction failed'));

      // When: Automatic ticket creation attempted
      const result = await autoTicketService.tryCreateTicket(
        bugReport,
        project.id,
        integration.id,
        'jira'
      );

      // Then: Operation failed gracefully
      expect(result.success).toBe(false);
      expect(result.error).toBe('Database transaction failed');

      // And: No outbox entries created (rollback)
      const outboxEntries = await db.query(
        'SELECT * FROM ticket_creation_outbox WHERE bug_report_id = $1',
        [bugReport.id]
      );
      expect(outboxEntries.rows).toHaveLength(0);

      // And: No tickets created
      const tickets = await db.tickets.findByBugReport(bugReport.id);
      expect(tickets).toHaveLength(0);

      // Restore original method
      db.ticketOutbox.create = originalCreate;
    });
  });

  describe('Multiple Integrations Per Platform', () => {
    it('should use correct integration config with integrationId parameter', async () => {
      // Given: Project with Jira integration (single integration test due to DB constraint)
      // Note: Current DB schema has UNIQUE constraint on (project_id, platform)
      // This test verifies integrationId is properly passed through the call chain
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      // Create Jira integration with specific config
      const jiraConfig = {
        ...mockJiraConfig,
        projectKey: 'SPEC',
        host: 'https://specific-team.atlassian.net',
      };

      const encryptedCreds = encryptionService.encrypt(
        JSON.stringify({ email: 'specific@example.com', apiToken: 'specific-token' })
      );

      const integration = await db.projectIntegrations.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: jiraConfig as unknown as Record<string, unknown>,
        encrypted_credentials: encryptedCreds,
        enabled: true,
      });

      // And: Auto-create rule for this integration
      const rule = await db.integrationRules.createWithValidation({
        project_id: project.id,
        integration_id: integration.id,
        name: 'Auto-create critical bugs',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'critical',
          },
        ],
      });

      // And: Critical bug report
      const bugReport = await db.bugReports.create({
        project_id: project.id,
        title: 'Critical bug requiring specific config',
        description: 'Bug that needs specific Jira project',
        priority: 'critical',
        status: 'open',
        metadata: { component: 'backend' },
      });
      cleanup.trackBugReport(bugReport.id);

      // When: Automatic ticket creation triggered with explicit integrationId
      const result = await autoTicketService.tryCreateTicket(
        bugReport,
        project.id,
        integration.id, // Explicitly passing integrationId
        'jira'
      );

      // Then: Outbox entry created successfully
      expect(result.success).toBe(true);
      expect(result.ruleId).toBe(rule.id);
      expect(result.platform).toBe('jira');

      // And: Outbox entry has correct integration_id
      const outboxEntries = await db.query(
        'SELECT * FROM ticket_creation_outbox WHERE bug_report_id = $1',
        [bugReport.id]
      );
      expect(outboxEntries.rows).toHaveLength(1);
      expect(outboxEntries.rows[0].integration_id).toBe(integration.id);
      expect(outboxEntries.rows[0].platform).toBe('jira');

      // Verify: The critical part is that integration_id is stored in outbox entry
      // This ensures when DB constraint is removed and multiple integrations are allowed,
      // the correct integration's config will be used when worker processes the entry
    });
  });
});
