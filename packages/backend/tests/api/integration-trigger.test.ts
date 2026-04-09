/**
 * Integration Trigger Tests
 * Tests for automatic integration job queueing when bug reports are created
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { triggerBugReportIntegrations } from '../../src/api/utils/integration-trigger.js';
import type { BugReport } from '../../src/db/types.js';
import type { QueueManager } from '../../src/queue/queue-manager.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { ProjectIntegrationRepository } from '../../src/db/project-integration.repository.js';
import { QUEUE_NAMES } from '../../src/queue/types.js';
import { INTEGRATION_JOB_NAME } from '../../src/queue/jobs/integration-job.js';

// Mock encryption service
vi.mock('../../src/utils/encryption.js', () => ({
  getEncryptionService: () => ({
    decrypt: (encrypted: string) => {
      // Simple mock: return based on platform
      if (encrypted.includes('jira')) {
        return JSON.stringify({ email: 'test@example.com', apiToken: 'jira-token' });
      }
      if (encrypted.includes('github')) {
        return JSON.stringify({ token: 'github-token' });
      }
      if (encrypted.includes('invalid')) {
        throw new Error('Decryption failed');
      }
      return JSON.stringify({});
    },
  }),
}));

// Mock AutoTicketService with controllable behavior
const mockTryCreateTicket = vi.fn();
vi.mock('../../src/services/integrations/auto-ticket-service.js', () => ({
  AutoTicketService: vi.fn().mockImplementation(() => ({
    tryCreateTicket: mockTryCreateTicket,
  })),
}));

describe('Integration Trigger', () => {
  let mockQueueManager: QueueManager;
  let mockDb: DatabaseClient;
  let mockIntegrationRepo: ProjectIntegrationRepository;
  let mockBugReport: BugReport;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    mockTryCreateTicket.mockReset();

    mockQueueManager = {
      addJob: vi.fn().mockResolvedValue({ id: 'job-123' }),
    } as unknown as QueueManager;

    mockIntegrationRepo = {
      findEnabledByProjectWithType: vi.fn().mockResolvedValue([]),
    } as unknown as ProjectIntegrationRepository;

    mockDb = {
      projectIntegrations: mockIntegrationRepo,
      integrationRules: {
        // No rules by default (backward compatibility: all bugs trigger)
        findEnabledByProjectAndPlatform: vi.fn().mockResolvedValue([]),
        // For AutoTicketService - returns no auto-create rules by default
        findAutoCreateRules: vi.fn().mockResolvedValue([]),
      },
    } as unknown as DatabaseClient;

    mockBugReport = {
      id: 'bug-123',
      project_id: 'project-123',
      title: 'Test Bug',
      status: 'open',
      priority: 'high',
      created_at: new Date(),
      updated_at: new Date(),
    } as BugReport;
  });

  describe('No Queue Manager', () => {
    it('should return early when queue manager is not provided', async () => {
      await triggerBugReportIntegrations(mockBugReport, 'project-123', undefined, mockDb);

      expect(mockIntegrationRepo.findEnabledByProjectWithType).not.toHaveBeenCalled();
    });
  });

  describe('No Enabled Integrations', () => {
    it('should return early when no integrations are enabled', async () => {
      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([]);

      await triggerBugReportIntegrations(mockBugReport, 'project-123', mockQueueManager, mockDb);

      expect(mockIntegrationRepo.findEnabledByProjectWithType).toHaveBeenCalledWith('project-123');
      expect(mockQueueManager.addJob).not.toHaveBeenCalled();
    });
  });

  describe('Single Integration', () => {
    it('should queue job for single enabled Jira integration', async () => {
      const jiraIntegration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        enabled: true,
        config: { projectKey: 'PROJ', issueType: 'Bug' },
        encrypted_credentials: 'encrypted-jira-creds',
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([
        jiraIntegration,
      ]);

      await triggerBugReportIntegrations(mockBugReport, 'project-123', mockQueueManager, mockDb);

      expect(mockQueueManager.addJob).toHaveBeenCalledWith(
        QUEUE_NAMES.INTEGRATIONS,
        INTEGRATION_JOB_NAME,
        {
          bugReportId: 'bug-123',
          projectId: 'project-123',
          platform: 'jira',
          integrationId: 'integration-1',
          credentials: { email: 'test@example.com', apiToken: 'jira-token' },
          config: { projectKey: 'PROJ', issueType: 'Bug' },
        },
        expect.objectContaining({
          priority: 5,
          attempts: 3,
          backoff: expect.objectContaining({
            type: 'exponential',
            delay: 2000,
          }),
        })
      );
    });

    it('should handle integration with no encrypted credentials', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-slack-id',
        integration_type: 'slack',
        enabled: true,
        config: { webhook_url: 'https://hooks.slack.com/services/xxx' },
        encrypted_credentials: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);

      await triggerBugReportIntegrations(mockBugReport, 'project-123', mockQueueManager, mockDb);

      expect(mockQueueManager.addJob).toHaveBeenCalledWith(
        QUEUE_NAMES.INTEGRATIONS,
        INTEGRATION_JOB_NAME,
        {
          bugReportId: 'bug-123',
          projectId: 'project-123',
          platform: 'slack',
          integrationId: 'integration-1',
          credentials: {},
          config: { webhook_url: 'https://hooks.slack.com/services/xxx' },
        },
        expect.any(Object)
      );
    });

    it('should skip integration with unsupported platform', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-unsupported-id',
        integration_type: 'unsupported-platform',
        enabled: true,
        config: {},
        encrypted_credentials: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);

      await triggerBugReportIntegrations(mockBugReport, 'project-123', mockQueueManager, mockDb);

      // Should not queue job for unsupported platform
      expect(mockQueueManager.addJob).not.toHaveBeenCalled();
    });
  });

  describe('Multiple Integrations', () => {
    it('should queue jobs for multiple enabled integrations', async () => {
      const integrations = [
        {
          id: 'integration-1',
          project_id: 'project-123',
          integration_id: 'int-jira-id',
          integration_type: 'jira',
          enabled: true,
          config: { projectKey: 'PROJ' },
          encrypted_credentials: 'encrypted-jira-creds',
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'integration-2',
          project_id: 'project-123',
          integration_id: 'int-github-id',
          integration_type: 'github',
          enabled: true,
          config: { repository: 'owner/repo' },
          encrypted_credentials: 'encrypted-github-creds',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue(integrations);

      await triggerBugReportIntegrations(mockBugReport, 'project-123', mockQueueManager, mockDb);

      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(2);

      // Check Jira job
      expect(mockQueueManager.addJob).toHaveBeenCalledWith(
        QUEUE_NAMES.INTEGRATIONS,
        INTEGRATION_JOB_NAME,
        expect.objectContaining({
          bugReportId: 'bug-123',
          platform: 'jira',
          integrationId: 'integration-1',
          credentials: { email: 'test@example.com', apiToken: 'jira-token' },
        }),
        expect.any(Object)
      );

      // Check GitHub job
      expect(mockQueueManager.addJob).toHaveBeenCalledWith(
        QUEUE_NAMES.INTEGRATIONS,
        INTEGRATION_JOB_NAME,
        expect.objectContaining({
          bugReportId: 'bug-123',
          platform: 'github',
          integrationId: 'integration-2',
          credentials: { token: 'github-token' },
        }),
        expect.any(Object)
      );
    });

    it('should continue queueing jobs even if one fails', async () => {
      const integrations = [
        {
          id: 'integration-1',
          project_id: 'project-123',
          integration_id: 'int-jira-id',
          integration_type: 'jira',
          enabled: true,
          config: {},
          encrypted_credentials: 'encrypted-invalid-creds', // Will fail decryption
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'integration-2',
          project_id: 'project-123',
          integration_id: 'int-github-id',
          integration_type: 'github',
          enabled: true,
          config: {},
          encrypted_credentials: 'encrypted-github-creds',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue(integrations);

      await triggerBugReportIntegrations(mockBugReport, 'project-123', mockQueueManager, mockDb);

      // Only GitHub job should be queued (Jira failed decryption)
      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
      expect(mockQueueManager.addJob).toHaveBeenCalledWith(
        QUEUE_NAMES.INTEGRATIONS,
        INTEGRATION_JOB_NAME,
        expect.objectContaining({
          platform: 'github',
          integrationId: 'integration-2',
        }),
        expect.any(Object)
      );
    });
  });

  describe('Error Handling', () => {
    it('should not throw when database query fails', async () => {
      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockRejectedValue(
        new Error('Database error')
      );

      await expect(
        triggerBugReportIntegrations(mockBugReport, 'project-123', mockQueueManager, mockDb)
      ).resolves.not.toThrow();

      expect(mockQueueManager.addJob).not.toHaveBeenCalled();
    });

    it('should not throw when addJob fails', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        enabled: true,
        config: {},
        encrypted_credentials: 'encrypted-jira-creds',
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);
      (mockQueueManager.addJob as Mock).mockRejectedValue(new Error('Queue error'));

      await expect(
        triggerBugReportIntegrations(mockBugReport, 'project-123', mockQueueManager, mockDb)
      ).resolves.not.toThrow();
    });

    it('should skip integration with decryption failure', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        enabled: true,
        config: {},
        encrypted_credentials: 'encrypted-invalid-creds', // Will fail
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);

      await triggerBugReportIntegrations(mockBugReport, 'project-123', mockQueueManager, mockDb);

      expect(mockQueueManager.addJob).not.toHaveBeenCalled();
    });
  });

  describe('Job Options', () => {
    it('should include correct job options', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        enabled: true,
        config: {},
        encrypted_credentials: 'encrypted-jira-creds',
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);

      await triggerBugReportIntegrations(mockBugReport, 'project-123', mockQueueManager, mockDb);

      const jobOptions = (mockQueueManager.addJob as Mock).mock.calls[0][3];

      expect(jobOptions).toMatchObject({
        priority: 5,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      });

      expect(jobOptions.jobId).toMatch(/^jira-bug-123-\d+$/);
    });
  });

  describe('Integration Rules', () => {
    it('should trigger integration when no rules exist (backward compatibility)', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        enabled: true,
        config: {},
        encrypted_credentials: 'encrypted-jira-creds',
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);
      // No rules returned (default mock behavior)

      await triggerBugReportIntegrations(mockBugReport, 'project-123', mockQueueManager, mockDb);

      expect(mockDb.integrationRules.findEnabledByProjectAndPlatform).toHaveBeenCalledWith(
        'project-123',
        'integration-1'
      );
      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
    });

    it('should trigger integration when bug matches rule filters', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        enabled: true,
        config: {},
        encrypted_credentials: 'encrypted-jira-creds',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const rule = {
        id: 'rule-1',
        project_id: 'project-123',
        integration_id: 'integration-1',
        name: 'High Priority Bugs',
        enabled: true,
        priority: 0,
        filters: [{ field: 'priority', operator: 'equals', value: 'high' }],
        throttle: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);
      (mockDb.integrationRules.findEnabledByProjectAndPlatform as Mock).mockResolvedValue([rule]);

      mockBugReport.priority = 'high';

      await triggerBugReportIntegrations(mockBugReport, 'project-123', mockQueueManager, mockDb);

      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
    });

    it('should NOT trigger integration when bug does not match rule filters', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        enabled: true,
        config: {},
        encrypted_credentials: 'encrypted-jira-creds',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const rule = {
        id: 'rule-1',
        project_id: 'project-123',
        integration_id: 'integration-1',
        name: 'High Priority Only',
        enabled: true,
        priority: 0,
        filters: [{ field: 'priority', operator: 'equals', value: 'critical' }],
        throttle: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);
      (mockDb.integrationRules.findEnabledByProjectAndPlatform as Mock).mockResolvedValue([rule]);

      mockBugReport.priority = 'low';

      await triggerBugReportIntegrations(mockBugReport, 'project-123', mockQueueManager, mockDb);

      expect(mockQueueManager.addJob).not.toHaveBeenCalled();
    });

    it('should trigger when ANY rule matches (OR logic)', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        enabled: true,
        config: {},
        encrypted_credentials: 'encrypted-jira-creds',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const rules = [
        {
          id: 'rule-1',
          project_id: 'project-123',
          integration_id: 'integration-1',
          name: 'Critical Bugs',
          enabled: true,
          priority: 0,
          filters: [{ field: 'priority', operator: 'equals', value: 'critical' }],
          throttle: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'rule-2',
          project_id: 'project-123',
          integration_id: 'integration-1',
          name: 'High Priority Bugs',
          enabled: true,
          priority: 0,
          filters: [{ field: 'priority', operator: 'equals', value: 'high' }],
          throttle: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);
      (mockDb.integrationRules.findEnabledByProjectAndPlatform as Mock).mockResolvedValue(rules);

      mockBugReport.priority = 'high'; // Matches second rule

      await triggerBugReportIntegrations(mockBugReport, 'project-123', mockQueueManager, mockDb);

      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
    });

    it('should handle metadata filters (browser, os, etc.)', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        enabled: true,
        config: {},
        encrypted_credentials: 'encrypted-jira-creds',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const rule = {
        id: 'rule-1',
        project_id: 'project-123',
        integration_id: 'integration-1',
        name: 'Chrome Bugs',
        enabled: true,
        priority: 0,
        filters: [{ field: 'browser', operator: 'contains', value: 'Chrome' }],
        throttle: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);
      (mockDb.integrationRules.findEnabledByProjectAndPlatform as Mock).mockResolvedValue([rule]);

      mockBugReport.metadata = { browser: 'Chrome 120.0' };

      await triggerBugReportIntegrations(mockBugReport, 'project-123', mockQueueManager, mockDb);

      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
    });
  });

  describe('Auto-Create Rules vs Manual Rules', () => {
    it('should NOT queue manual job when auto-create rule matches and succeeds', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        enabled: true,
        config: {},
        encrypted_credentials: 'encrypted-jira-creds',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const autoCreateRule = {
        id: 'rule-1',
        project_id: 'project-123',
        integration_id: 'integration-1',
        name: 'Auto-create High Priority',
        enabled: true,
        auto_create: true,
        priority: 0,
        filters: [{ field: 'priority', operator: 'equals', value: 'high' }],
        throttle: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);
      (mockDb.integrationRules.findAutoCreateRules as Mock).mockResolvedValue([autoCreateRule]);
      (mockDb.integrationRules.findEnabledByProjectAndPlatform as Mock).mockResolvedValue([
        autoCreateRule,
      ]);

      // Configure mock to return success
      mockTryCreateTicket.mockResolvedValue({
        success: true,
        outboxEntryId: 'outbox-123',
      });

      const mockPluginRegistry = {
        get: vi.fn().mockReturnValue({}),
      };

      mockBugReport.priority = 'high';

      await triggerBugReportIntegrations(
        mockBugReport,
        'project-123',
        mockQueueManager,
        mockDb,
        mockPluginRegistry as any
      );

      // Should NOT queue manual integration job since auto-create succeeded
      expect(mockQueueManager.addJob).not.toHaveBeenCalled();
    });

    it('should NOT queue manual job when auto-create is throttled', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        enabled: true,
        config: {},
        encrypted_credentials: 'encrypted-jira-creds',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const autoCreateRule = {
        id: 'rule-1',
        project_id: 'project-123',
        integration_id: 'integration-1',
        name: 'Auto-create High Priority',
        enabled: true,
        auto_create: true,
        priority: 0,
        filters: [{ field: 'priority', operator: 'equals', value: 'high' }],
        throttle: { max_per_hour: 5, max_per_day: 20 },
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);
      (mockDb.integrationRules.findAutoCreateRules as Mock).mockResolvedValue([autoCreateRule]);

      // Configure mock to return throttled
      mockTryCreateTicket.mockResolvedValue({
        success: false,
        throttled: true,
        throttleReason: 'Rate limit exceeded',
        ruleId: 'rule-1',
      });

      const mockPluginRegistry = {
        get: vi.fn().mockReturnValue({}),
      };

      mockBugReport.priority = 'high';

      await triggerBugReportIntegrations(
        mockBugReport,
        'project-123',
        mockQueueManager,
        mockDb,
        mockPluginRegistry as any
      );

      // Should NOT queue manual job since auto-create was throttled
      expect(mockQueueManager.addJob).not.toHaveBeenCalled();
    });

    it('should ONLY queue manual job when auto-create rule exists but does not match', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        enabled: true,
        config: {},
        encrypted_credentials: 'encrypted-jira-creds',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const autoCreateRule = {
        id: 'rule-auto',
        project_id: 'project-123',
        integration_id: 'integration-1',
        name: 'Auto-create Critical Only',
        enabled: true,
        auto_create: true,
        priority: 0,
        filters: [{ field: 'priority', operator: 'equals', value: 'critical' }],
        throttle: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const manualRule = {
        id: 'rule-manual',
        project_id: 'project-123',
        integration_id: 'integration-1',
        name: 'Manual High Priority',
        enabled: true,
        auto_create: false,
        priority: 0,
        filters: [{ field: 'priority', operator: 'equals', value: 'high' }],
        throttle: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);
      (mockDb.integrationRules.findAutoCreateRules as Mock).mockResolvedValue([autoCreateRule]);
      (mockDb.integrationRules.findEnabledByProjectAndPlatform as Mock).mockResolvedValue([
        autoCreateRule,
        manualRule,
      ]);

      // Configure mock to return no match
      mockTryCreateTicket.mockResolvedValue({
        success: false,
        throttled: false,
        error: 'No matching auto-create rule',
      });

      const mockPluginRegistry = {
        get: vi.fn().mockReturnValue({}),
      };

      mockBugReport.priority = 'high'; // Matches manual rule, not auto-create rule

      await triggerBugReportIntegrations(
        mockBugReport,
        'project-123',
        mockQueueManager,
        mockDb,
        mockPluginRegistry as any
      );

      // SHOULD queue manual job since manual rule matches
      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
    });

    it('should NOT queue manual job when auto-create rule matches but manual rule does not', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        enabled: true,
        config: {},
        encrypted_credentials: 'encrypted-jira-creds',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const autoCreateRule = {
        id: 'rule-auto',
        project_id: 'project-123',
        integration_id: 'integration-1',
        name: 'Auto-create High Priority',
        enabled: true,
        auto_create: true,
        priority: 0,
        filters: [{ field: 'priority', operator: 'equals', value: 'high' }],
        throttle: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const manualRule = {
        id: 'rule-manual',
        project_id: 'project-123',
        integration_id: 'integration-1',
        name: 'Manual Critical Only',
        enabled: true,
        auto_create: false,
        priority: 0,
        filters: [{ field: 'priority', operator: 'equals', value: 'critical' }],
        throttle: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);
      (mockDb.integrationRules.findAutoCreateRules as Mock).mockResolvedValue([autoCreateRule]);
      (mockDb.integrationRules.findEnabledByProjectAndPlatform as Mock).mockResolvedValue([
        autoCreateRule,
        manualRule,
      ]);

      // Configure mock to fail (simulating auto-create attempt failure)
      mockTryCreateTicket.mockResolvedValue({
        success: false,
        throttled: false,
        error: 'API error',
      });

      const mockPluginRegistry = {
        get: vi.fn().mockReturnValue({}),
      };

      mockBugReport.priority = 'high'; // Matches auto-create, NOT manual

      await triggerBugReportIntegrations(
        mockBugReport,
        'project-123',
        mockQueueManager,
        mockDb,
        mockPluginRegistry as any
      );

      // Should NOT queue manual job since manual rule doesn't match
      // (even though auto-create rule matched but failed)
      expect(mockQueueManager.addJob).not.toHaveBeenCalled();
    });

    it('should queue manual job when auto-create fails and manual rule matches', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        enabled: true,
        config: {},
        encrypted_credentials: 'encrypted-jira-creds',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const autoCreateRule = {
        id: 'rule-auto',
        project_id: 'project-123',
        integration_id: 'integration-1',
        name: 'Auto-create High Priority',
        enabled: true,
        auto_create: true,
        priority: 0,
        filters: [{ field: 'priority', operator: 'equals', value: 'high' }],
        throttle: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const manualRule = {
        id: 'rule-manual',
        project_id: 'project-123',
        integration_id: 'integration-1',
        name: 'Manual High Priority Fallback',
        enabled: true,
        auto_create: false,
        priority: 0,
        filters: [{ field: 'priority', operator: 'equals', value: 'high' }],
        throttle: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);
      (mockDb.integrationRules.findAutoCreateRules as Mock).mockResolvedValue([autoCreateRule]);
      (mockDb.integrationRules.findEnabledByProjectAndPlatform as Mock).mockResolvedValue([
        autoCreateRule,
        manualRule,
      ]);

      // Configure mock to fail
      mockTryCreateTicket.mockResolvedValue({
        success: false,
        throttled: false,
        error: 'Jira API error',
      });

      const mockPluginRegistry = {
        get: vi.fn().mockReturnValue({}),
      };

      mockBugReport.priority = 'high'; // Matches both rules

      await triggerBugReportIntegrations(
        mockBugReport,
        'project-123',
        mockQueueManager,
        mockDb,
        mockPluginRegistry as any
      );

      // SHOULD queue manual job as fallback since auto-create failed
      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
    });

    it('should handle mixed auto-create and manual rules correctly', async () => {
      const integration = {
        id: 'integration-1',
        project_id: 'project-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        enabled: true,
        config: {},
        encrypted_credentials: 'encrypted-jira-creds',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const rules = [
        {
          id: 'rule-auto-1',
          project_id: 'project-123',
          integration_id: 'integration-1',
          name: 'Auto-create Critical',
          enabled: true,
          auto_create: true,
          priority: 0,
          filters: [{ field: 'priority', operator: 'equals', value: 'critical' }],
          throttle: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'rule-auto-2',
          project_id: 'project-123',
          integration_id: 'integration-1',
          name: 'Auto-create High',
          enabled: true,
          auto_create: true,
          priority: 0,
          filters: [{ field: 'priority', operator: 'equals', value: 'high' }],
          throttle: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'rule-manual-1',
          project_id: 'project-123',
          integration_id: 'integration-1',
          name: 'Manual Medium',
          enabled: true,
          auto_create: false,
          priority: 0,
          filters: [{ field: 'priority', operator: 'equals', value: 'medium' }],
          throttle: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'rule-manual-2',
          project_id: 'project-123',
          integration_id: 'integration-1',
          name: 'Manual Low',
          enabled: true,
          auto_create: false,
          priority: 0,
          filters: [{ field: 'priority', operator: 'equals', value: 'low' }],
          throttle: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      (mockIntegrationRepo.findEnabledByProjectWithType as Mock).mockResolvedValue([integration]);
      (mockDb.integrationRules.findAutoCreateRules as Mock).mockResolvedValue(
        rules.filter((r) => r.auto_create)
      );
      (mockDb.integrationRules.findEnabledByProjectAndPlatform as Mock).mockResolvedValue(rules);

      // Configure mock to fail
      mockTryCreateTicket.mockResolvedValue({
        success: false,
        throttled: false,
        error: 'No matching rule',
      });

      const mockPluginRegistry = {
        get: vi.fn().mockReturnValue({}),
      };

      mockBugReport.priority = 'medium'; // Matches only manual rule

      await triggerBugReportIntegrations(
        mockBugReport,
        'project-123',
        mockQueueManager,
        mockDb,
        mockPluginRegistry as any
      );

      // Should queue manual job since medium priority matches manual rule
      // (auto-create rules for critical/high should be excluded from manual check)
      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
    });
  });
});
