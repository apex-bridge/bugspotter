/**
 * Unit tests for AutoTicketService (Transactional Outbox Pattern)
 * Tests automatic ticket creation flow with rule evaluation, throttling, and outbox entry creation
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { AutoTicketService } from '../../src/services/integrations/auto-ticket-service.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { BugReport } from '../../src/db/types.js';

// Mock cache service
vi.mock('../../src/cache/index.js', () => ({
  getCacheService: () => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    getAutoCreateRules: vi.fn().mockImplementation(async (_projectId, _integrationId, fallback) => {
      return await fallback();
    }),
  }),
}));

describe('AutoTicketService', () => {
  let service: AutoTicketService;
  let mockDb: DatabaseClient;
  let mockBugReport: BugReport;

  beforeEach(() => {
    // Mock bug report
    mockBugReport = {
      id: 'bug-123',
      project_id: 'project-456',
      title: 'Critical Bug',
      description: 'App crashes on login',
      screenshot_url: 'https://storage.example.com/screenshot.png',
      replay_url: 'https://storage.example.com/replay.json',
      metadata: {
        url: 'https://example.com/login',
        userAgent: 'Mozilla/5.0',
        priority: 'critical',
      },
      status: 'open',
      priority: 'critical',
      legal_hold: false,
      deleted_at: null,
      deleted_by: null,
      screenshot_key: 'screenshots/project-456/bug-123/screenshot.png',
      thumbnail_key: null,
      replay_key: 'replays/project-456/bug-123/replay.json',
      upload_status: 'completed',
      replay_upload_status: 'completed',
      created_at: new Date('2024-01-15T10:30:00Z'),
      updated_at: new Date('2024-01-15T10:30:00Z'),
    } as BugReport;

    // Mock database client
    mockDb = {
      integrationRules: {
        findAutoCreateRules: vi.fn(),
      },
      tickets: {
        countByRuleSince: vi.fn(),
      },
      ticketOutbox: {
        create: vi.fn().mockResolvedValue({
          id: 'outbox-123',
          bug_report_id: 'bug-123',
          project_id: 'project-456',
          integration_id: 'integration-789',
          platform: 'jira',
          rule_id: 'rule-1',
          payload: {},
          status: 'pending',
          retry_count: 0,
          max_retries: 3,
          scheduled_at: new Date(),
          next_retry_at: null,
          external_ticket_id: null,
          external_ticket_url: null,
          error_message: null,
          created_at: new Date(),
          updated_at: new Date(),
          processed_at: null,
          idempotency_key: 'bug-123:rule-1:123456',
        }),
      },
    } as unknown as DatabaseClient;

    // Create service instance
    service = new AutoTicketService(mockDb);
  });

  describe('tryCreateTicket', () => {
    it('should return success=false when no auto-create rules exist', async () => {
      (mockDb.integrationRules.findAutoCreateRules as Mock).mockResolvedValue([]);

      const result = await service.tryCreateTicket(
        mockBugReport,
        'project-456',
        'integration-789',
        'jira'
      );

      expect(result.success).toBe(false);
      expect(result.externalId).toBeUndefined();
      expect(result.throttled).toBeUndefined();
    });

    it('should return success=false when no rules match bug report', async () => {
      const mockRule = {
        id: 'rule-1',
        project_id: 'project-456',
        integration_id: 'integration-789',
        name: 'Auto Create Critical',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [
          {
            field: 'status',
            operator: 'equals',
            value: 'resolved', // Won't match open status
          },
        ],
        throttle: null,
        field_mappings: null,
        description_template: null,
        attachment_config: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockDb.integrationRules.findAutoCreateRules as Mock).mockResolvedValue([mockRule]);
      (mockDb.tickets.countByRuleSince as Mock).mockResolvedValue(0);

      const result = await service.tryCreateTicket(
        mockBugReport,
        'project-456',
        'integration-789',
        'jira'
      );

      expect(result.success).toBe(false);
      expect(result.throttled).toBeUndefined();
    });

    it('should return throttled=true when hourly limit exceeded', async () => {
      const mockRule = {
        id: 'rule-1',
        project_id: 'project-456',
        integration_id: 'integration-789',
        name: 'Auto Create Critical',
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
        field_mappings: null,
        description_template: null,
        attachment_config: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockDb.integrationRules.findAutoCreateRules as Mock).mockResolvedValue([mockRule]);
      (mockDb.tickets.countByRuleSince as Mock).mockResolvedValue(5); // At limit

      const result = await service.tryCreateTicket(
        mockBugReport,
        'project-456',
        'integration-789',
        'jira'
      );

      expect(result.success).toBe(false);
      expect(result.throttled).toBe(true);
      expect(result.throttleReason).toBe('hourly_limit');
      expect(result.ruleId).toBe('rule-1');
      expect(result.ruleName).toBe('Auto Create Critical');
    });

    it('should return throttled=true when daily limit exceeded', async () => {
      const mockRule = {
        id: 'rule-1',
        project_id: 'project-456',
        integration_id: 'integration-789',
        name: 'Auto Create Critical',
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
          max_per_day: 50,
        },
        field_mappings: null,
        description_template: null,
        attachment_config: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockDb.integrationRules.findAutoCreateRules as Mock).mockResolvedValue([mockRule]);
      (mockDb.tickets.countByRuleSince as Mock).mockResolvedValue(50); // At daily limit

      const result = await service.tryCreateTicket(
        mockBugReport,
        'project-456',
        'integration-789',
        'jira'
      );

      expect(result.success).toBe(false);
      expect(result.throttled).toBe(true);
      expect(result.throttleReason).toBe('daily_limit');
      expect(result.ruleId).toBe('rule-1');
    });

    it('should create outbox entry successfully when rule matches and not throttled', async () => {
      const mockRule = {
        id: 'rule-1',
        project_id: 'project-456',
        integration_id: 'integration-789',
        name: 'Auto Create Critical',
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
          max_per_hour: 10,
        },
        field_mappings: null,
        description_template: null,
        attachment_config: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockDb.integrationRules.findAutoCreateRules as Mock).mockResolvedValue([mockRule]);
      (mockDb.tickets.countByRuleSince as Mock).mockResolvedValue(3); // Under limit

      const result = await service.tryCreateTicket(
        mockBugReport,
        'project-456',
        'integration-789',
        'jira'
      );

      expect(result.success).toBe(true);
      expect(result.platform).toBe('jira');
      expect(result.ruleId).toBe('rule-1');
      expect(result.ruleName).toBe('Auto Create Critical');
      expect(result.throttled).toBeUndefined();

      // Note: externalId and externalUrl are not available yet (async processing)
      expect(result.externalId).toBeUndefined();
      expect(result.externalUrl).toBeUndefined();

      // Verify outbox entry was created
      expect(mockDb.ticketOutbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          bug_report_id: 'bug-123',
          project_id: 'project-456',
          integration_id: 'integration-789',
          platform: 'jira',
          rule_id: 'rule-1',
          payload: expect.objectContaining({
            title: 'Critical Bug',
            description: 'App crashes on login',
          }),
        })
      );
    });

    it('should handle outbox creation errors gracefully', async () => {
      const mockRule = {
        id: 'rule-1',
        project_id: 'project-456',
        integration_id: 'integration-789',
        name: 'Auto Create Critical',
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
        throttle: null,
        field_mappings: null,
        description_template: null,
        attachment_config: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockDb.integrationRules.findAutoCreateRules as Mock).mockResolvedValue([mockRule]);
      (mockDb.tickets.countByRuleSince as Mock).mockResolvedValue(0);
      (mockDb.ticketOutbox.create as Mock).mockRejectedValue(new Error('Database connection lost'));

      const result = await service.tryCreateTicket(
        mockBugReport,
        'project-456',
        'integration-789',
        'jira'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection lost');
    });
  });
});
