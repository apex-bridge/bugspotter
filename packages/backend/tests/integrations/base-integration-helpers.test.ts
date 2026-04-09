import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BaseIntegrationHelpers } from '../../src/integrations/base-integration-helpers.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { IStorageService } from '../../src/storage/types.js';
import type { BugReport, Ticket } from '../../src/db/types.js';

/**
 * Test suite for BaseIntegrationHelpers
 * Tests the Template Method Pattern base class used by both native and sandboxed plugins
 *
 * Critical Security Tests:
 * - Cross-project access prevention in getBugReport()
 * - Cross-project access prevention in createTicket()
 * - Integration config validation
 */

// Concrete implementation for testing the abstract base class
class TestIntegrationHelpers extends BaseIntegrationHelpers {
  // Expose protected methods for testing
  public async testGetIntegrationConfig() {
    return this.getIntegrationConfig();
  }

  public async testGetBugReport(bugReportId: string) {
    return this.getBugReport(bugReportId);
  }

  public async testCreateTicket(data: {
    bug_report_id: string;
    external_id: string;
    external_url: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.createTicket(data);
  }

  public async testLogSyncEvent(
    action: 'test' | 'create' | 'update' | 'sync',
    status: 'success' | 'failed',
    metadata?: { duration_ms?: number; error?: string }
  ) {
    return this.logSyncEvent(action, status, metadata);
  }
}

describe('BaseIntegrationHelpers', () => {
  let helpers: TestIntegrationHelpers;
  let mockDb: DatabaseClient;
  let mockStorage: IStorageService;
  const testProjectId = 'project-123';
  const testPlatform = 'jira';

  beforeEach(() => {
    // Mock database client with all required repositories
    mockDb = {
      projectIntegrations: {
        findByProjectAndPlatform: vi.fn(),
      },
      bugReports: {
        findById: vi.fn(),
      },
      tickets: {
        create: vi.fn(),
      },
      integrationSyncLogs: {
        create: vi.fn(),
      },
    } as unknown as DatabaseClient;

    // Mock storage service
    mockStorage = {} as IStorageService;

    // Create test instance
    helpers = new TestIntegrationHelpers(mockDb, mockStorage, testProjectId, testPlatform);
  });

  describe('getIntegrationConfig', () => {
    it('should return config when integration exists', async () => {
      const mockIntegration = {
        id: 'integration-1',
        project_id: testProjectId,
        integration_type: testPlatform,
        config: {
          serverUrl: 'https://jira.example.com',
          apiKey: 'test-key',
          projectKey: 'PROJ',
        },
        status: 'active',
      };

      vi.mocked(mockDb.projectIntegrations.findByProjectAndPlatform).mockResolvedValue(
        mockIntegration as any
      );

      const config = await helpers.testGetIntegrationConfig();

      expect(config).toEqual({
        serverUrl: 'https://jira.example.com',
        apiKey: 'test-key',
        projectKey: 'PROJ',
      });
      expect(mockDb.projectIntegrations.findByProjectAndPlatform).toHaveBeenCalledWith(
        testProjectId,
        testPlatform
      );
    });

    it('should throw error when projectId is not set', async () => {
      // Create instance without projectId
      const helpersNoProject = new TestIntegrationHelpers(
        mockDb,
        mockStorage,
        '', // Empty projectId
        testPlatform
      );

      await expect(helpersNoProject.testGetIntegrationConfig()).rejects.toThrow(
        'Cannot get integration config: projectId not set in context'
      );

      expect(mockDb.projectIntegrations.findByProjectAndPlatform).not.toHaveBeenCalled();
    });

    it('should throw error when integration not found', async () => {
      vi.mocked(mockDb.projectIntegrations.findByProjectAndPlatform).mockResolvedValue(null);

      await expect(helpers.testGetIntegrationConfig()).rejects.toThrow(
        `Integration ${testPlatform} not configured for project ${testProjectId}`
      );
    });

    it('should throw error when integration has no config', async () => {
      const mockIntegration = {
        id: 'integration-1',
        project_id: testProjectId,
        integration_type: testPlatform,
        config: null, // No config
        status: 'active',
      };

      vi.mocked(mockDb.projectIntegrations.findByProjectAndPlatform).mockResolvedValue(
        mockIntegration as any
      );

      await expect(helpers.testGetIntegrationConfig()).rejects.toThrow(
        `Integration ${testPlatform} has no configuration`
      );
    });

    it('should return config with custom fields', async () => {
      const mockIntegration = {
        id: 'integration-1',
        project_id: testProjectId,
        integration_type: testPlatform,
        config: {
          serverUrl: 'https://jira.example.com',
          customField1: 'value1',
          customField2: { nested: 'object' },
          customField3: [1, 2, 3],
        },
        status: 'active',
      };

      vi.mocked(mockDb.projectIntegrations.findByProjectAndPlatform).mockResolvedValue(
        mockIntegration as any
      );

      const config = await helpers.testGetIntegrationConfig();

      expect(config).toEqual({
        serverUrl: 'https://jira.example.com',
        customField1: 'value1',
        customField2: { nested: 'object' },
        customField3: [1, 2, 3],
      });
    });
  });

  describe('getBugReport', () => {
    const bugReportId = 'bug-456';

    it('should return bug report when it exists and belongs to project', async () => {
      const mockBugReport: Partial<BugReport> = {
        id: bugReportId,
        project_id: testProjectId,
        title: 'Test Bug',
        description: 'Bug description',
        status: 'open',
        priority: 'high',
      };

      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(mockBugReport as BugReport);

      const result = await helpers.testGetBugReport(bugReportId);

      expect(result).toEqual(mockBugReport);
      expect(mockDb.bugReports.findById).toHaveBeenCalledWith(bugReportId);
    });

    it('should throw error when bug report not found', async () => {
      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(null);

      await expect(helpers.testGetBugReport(bugReportId)).rejects.toThrow(
        `Bug report ${bugReportId} not found`
      );
    });

    it('should throw error when bug belongs to different project (SECURITY)', async () => {
      const differentProjectId = 'project-999';
      const mockBugReport: Partial<BugReport> = {
        id: bugReportId,
        project_id: differentProjectId, // Different project!
        title: 'Test Bug',
        status: 'open',
      };

      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(mockBugReport as BugReport);

      await expect(helpers.testGetBugReport(bugReportId)).rejects.toThrow(
        'Access denied: Bug report belongs to different project'
      );
    });

    it('should allow access when projectId is empty (system context)', async () => {
      // System context without project restriction
      const helpersNoProject = new TestIntegrationHelpers(
        mockDb,
        mockStorage,
        '', // No projectId restriction
        testPlatform
      );

      const mockBugReport: Partial<BugReport> = {
        id: bugReportId,
        project_id: 'any-project-id',
        title: 'Test Bug',
        status: 'open',
      };

      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(mockBugReport as BugReport);

      const result = await helpersNoProject.testGetBugReport(bugReportId);

      expect(result).toEqual(mockBugReport);
    });
  });

  describe('createTicket', () => {
    const bugReportId = 'bug-789';
    const externalId = 'JIRA-123';
    const externalUrl = 'https://jira.example.com/browse/JIRA-123';

    it('should create ticket when bug belongs to project', async () => {
      const mockBugReport: Partial<BugReport> = {
        id: bugReportId,
        project_id: testProjectId,
        title: 'Test Bug',
        status: 'open',
      };

      const mockTicket: Ticket = {
        id: 'ticket-1',
        bug_report_id: bugReportId,
        platform: testPlatform,
        external_id: externalId,
        external_url: externalUrl,
        status: 'open',
        created_at: new Date(),
        integration_id: null,
        rule_id: null,
        created_automatically: false,
        sync_status: 'pending',
        last_sync_error: null,
        attachment_results: null,
      };

      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(mockBugReport as BugReport);
      vi.mocked(mockDb.tickets.create).mockResolvedValue({
        ...mockTicket,
        integration_id: null,
        rule_id: null,
        created_automatically: false,
        sync_status: 'pending',
        last_sync_error: null,
        attachment_results: null,
      });

      const result = await helpers.testCreateTicket({
        bug_report_id: bugReportId,
        external_id: externalId,
        external_url: externalUrl,
      });

      expect(result).toEqual(mockTicket);
      expect(mockDb.bugReports.findById).toHaveBeenCalledWith(bugReportId);
      expect(mockDb.tickets.create).toHaveBeenCalledWith({
        bug_report_id: bugReportId,
        platform: testPlatform,
        external_id: externalId,
        external_url: externalUrl,
        status: 'open',
      });
    });

    it('should throw error when bug report not found', async () => {
      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(null);

      await expect(
        helpers.testCreateTicket({
          bug_report_id: bugReportId,
          external_id: externalId,
          external_url: externalUrl,
        })
      ).rejects.toThrow(`Bug report ${bugReportId} not found`);

      expect(mockDb.tickets.create).not.toHaveBeenCalled();
    });

    it('should throw error when bug belongs to different project (SECURITY)', async () => {
      const differentProjectId = 'project-999';
      const mockBugReport: Partial<BugReport> = {
        id: bugReportId,
        project_id: differentProjectId, // Different project!
        title: 'Test Bug',
        status: 'open',
      };

      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(mockBugReport as BugReport);

      await expect(
        helpers.testCreateTicket({
          bug_report_id: bugReportId,
          external_id: externalId,
          external_url: externalUrl,
        })
      ).rejects.toThrow('Access denied: Bug report belongs to different project');

      expect(mockDb.tickets.create).not.toHaveBeenCalled();
    });

    it('should create ticket with metadata', async () => {
      const mockBugReport: Partial<BugReport> = {
        id: bugReportId,
        project_id: testProjectId,
        title: 'Test Bug',
        status: 'open',
      };

      const mockTicket: Ticket = {
        id: 'ticket-1',
        bug_report_id: bugReportId,
        platform: testPlatform,
        external_id: externalId,
        external_url: externalUrl,
        status: 'open',
        created_at: new Date(),
        integration_id: null,
        rule_id: null,
        created_automatically: false,
        sync_status: 'pending',
        last_sync_error: null,
        attachment_results: null,
      };

      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(mockBugReport as BugReport);
      vi.mocked(mockDb.tickets.create).mockResolvedValue({
        ...mockTicket,
        integration_id: null,
        rule_id: null,
        created_automatically: false,
        sync_status: 'pending',
        last_sync_error: null,
        attachment_results: null,
      });

      const metadata = { custom_field: 'value', priority: 'high' };

      const result = await helpers.testCreateTicket({
        bug_report_id: bugReportId,
        external_id: externalId,
        external_url: externalUrl,
        metadata,
      });

      expect(result).toEqual(mockTicket);
    });

    it('should allow ticket creation when projectId is empty (system context)', async () => {
      const helpersNoProject = new TestIntegrationHelpers(
        mockDb,
        mockStorage,
        '', // No projectId restriction
        testPlatform
      );

      const mockTicket: Ticket = {
        id: 'ticket-1',
        bug_report_id: bugReportId,
        platform: testPlatform,
        external_id: externalId,
        external_url: externalUrl,
        status: 'open',
        created_at: new Date(),
        integration_id: null,
        rule_id: null,
        created_automatically: false,
        sync_status: 'pending',
        last_sync_error: null,
        attachment_results: null,
      };

      vi.mocked(mockDb.tickets.create).mockResolvedValue({
        ...mockTicket,
        integration_id: null,
        rule_id: null,
        created_automatically: false,
        sync_status: 'pending',
        last_sync_error: null,
        attachment_results: null,
      });

      const result = await helpersNoProject.testCreateTicket({
        bug_report_id: bugReportId,
        external_id: externalId,
        external_url: externalUrl,
      });

      expect(result).toEqual(mockTicket);
      // Should not check bug report project when projectId is empty
      expect(mockDb.bugReports.findById).not.toHaveBeenCalled();
    });
  });

  describe('logSyncEvent', () => {
    it('should log successful sync event with duration', async () => {
      vi.mocked(mockDb.integrationSyncLogs.create).mockResolvedValue({
        id: 'log-1',
        integration_type: testPlatform,
        action: 'create',
        status: 'success',
        duration_ms: 150,
        created_at: new Date(),
      } as any);

      await helpers.testLogSyncEvent('create', 'success', { duration_ms: 150 });

      expect(mockDb.integrationSyncLogs.create).toHaveBeenCalledWith({
        integration_type: testPlatform,
        action: 'create',
        status: 'success',
        duration_ms: 150,
        error: undefined,
      });
    });

    it('should log failed sync event with error message', async () => {
      vi.mocked(mockDb.integrationSyncLogs.create).mockResolvedValue({
        id: 'log-2',
        integration_type: testPlatform,
        action: 'sync',
        status: 'failed',
        error: 'Connection timeout',
        created_at: new Date(),
      } as any);

      await helpers.testLogSyncEvent('sync', 'failed', { error: 'Connection timeout' });

      expect(mockDb.integrationSyncLogs.create).toHaveBeenCalledWith({
        integration_type: testPlatform,
        action: 'sync',
        status: 'failed',
        duration_ms: undefined,
        error: 'Connection timeout',
      });
    });

    it('should log all action types', async () => {
      const actions: Array<'test' | 'create' | 'update' | 'sync'> = [
        'test',
        'create',
        'update',
        'sync',
      ];

      for (const action of actions) {
        vi.mocked(mockDb.integrationSyncLogs.create).mockResolvedValue({
          id: `log-${action}`,
          integration_type: testPlatform,
          action,
          status: 'success',
          created_at: new Date(),
        } as any);

        await helpers.testLogSyncEvent(action, 'success');

        expect(mockDb.integrationSyncLogs.create).toHaveBeenCalledWith({
          integration_type: testPlatform,
          action,
          status: 'success',
          duration_ms: undefined,
          error: undefined,
        });
      }
    });

    it('should not throw error when logging fails (graceful degradation)', async () => {
      vi.mocked(mockDb.integrationSyncLogs.create).mockRejectedValue(
        new Error('Database connection failed')
      );

      // Should not throw despite database error
      await expect(helpers.testLogSyncEvent('create', 'success')).resolves.not.toThrow();
    });

    it('should handle non-Error exceptions in logging', async () => {
      vi.mocked(mockDb.integrationSyncLogs.create).mockRejectedValue('String error');

      // Should not throw despite non-Error exception
      await expect(helpers.testLogSyncEvent('update', 'failed')).resolves.not.toThrow();
    });

    it('should log event with both duration and error (for failed operations)', async () => {
      vi.mocked(mockDb.integrationSyncLogs.create).mockResolvedValue({
        id: 'log-3',
        integration_type: testPlatform,
        action: 'create',
        status: 'failed',
        duration_ms: 5000,
        error: 'Timeout after 5 seconds',
        created_at: new Date(),
      } as any);

      await helpers.testLogSyncEvent('create', 'failed', {
        duration_ms: 5000,
        error: 'Timeout after 5 seconds',
      });

      expect(mockDb.integrationSyncLogs.create).toHaveBeenCalledWith({
        integration_type: testPlatform,
        action: 'create',
        status: 'failed',
        duration_ms: 5000,
        error: 'Timeout after 5 seconds',
      });
    });
  });

  describe('Security - Cross-Project Access Prevention', () => {
    const bugReportId = 'bug-security-test';
    const maliciousProjectId = 'malicious-project';

    it('should prevent getBugReport cross-project access', async () => {
      const mockBugReport: Partial<BugReport> = {
        id: bugReportId,
        project_id: maliciousProjectId, // Attacker's project
        title: 'Sensitive Bug',
        status: 'open',
      };

      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(mockBugReport as BugReport);

      // Attacker tries to access bug from different project
      await expect(helpers.testGetBugReport(bugReportId)).rejects.toThrow(
        'Access denied: Bug report belongs to different project'
      );
    });

    it('should prevent createTicket cross-project access', async () => {
      const mockBugReport: Partial<BugReport> = {
        id: bugReportId,
        project_id: maliciousProjectId, // Attacker's project
        title: 'Sensitive Bug',
        status: 'open',
      };

      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(mockBugReport as BugReport);

      // Attacker tries to create ticket for bug from different project
      await expect(
        helpers.testCreateTicket({
          bug_report_id: bugReportId,
          external_id: 'EVIL-123',
          external_url: 'https://evil.com/ticket',
        })
      ).rejects.toThrow('Access denied: Bug report belongs to different project');

      // Ensure ticket was not created
      expect(mockDb.tickets.create).not.toHaveBeenCalled();
    });

    it('should allow same-project access for all operations', async () => {
      const mockBugReport: Partial<BugReport> = {
        id: bugReportId,
        project_id: testProjectId, // Same project
        title: 'Legitimate Bug',
        status: 'open',
      };

      const mockTicket: Ticket = {
        id: 'ticket-1',
        bug_report_id: bugReportId,
        platform: testPlatform,
        external_id: 'JIRA-100',
        external_url: 'https://jira.example.com/browse/JIRA-100',
        status: 'open',
        created_at: new Date(),
        integration_id: null,
        rule_id: null,
        created_automatically: false,
        sync_status: 'pending',
        last_sync_error: null,
        attachment_results: null,
      };

      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(mockBugReport as BugReport);
      vi.mocked(mockDb.tickets.create).mockResolvedValue(mockTicket);

      // getBugReport should succeed
      const bug = await helpers.testGetBugReport(bugReportId);
      expect(bug.project_id).toBe(testProjectId);

      // createTicket should succeed
      const ticket = await helpers.testCreateTicket({
        bug_report_id: bugReportId,
        external_id: 'JIRA-100',
        external_url: 'https://jira.example.com/browse/JIRA-100',
      });
      expect(ticket.bug_report_id).toBe(bugReportId);
    });
  });

  describe('Integration with RpcBridge and IntegrationHelpers', () => {
    it('should provide consistent behavior across implementations', async () => {
      // This test documents that the base class is used by both:
      // 1. RpcBridge (sandboxed plugins via IPC)
      // 2. IntegrationHelpers (native TypeScript plugins)
      //
      // Both implementations extend BaseIntegrationHelpers and inherit
      // the same security checks and helper logic tested above.

      expect(helpers).toBeInstanceOf(BaseIntegrationHelpers);
      expect(typeof helpers.testGetIntegrationConfig).toBe('function');
      expect(typeof helpers.testGetBugReport).toBe('function');
      expect(typeof helpers.testCreateTicket).toBe('function');
      expect(typeof helpers.testLogSyncEvent).toBe('function');
    });
  });
});
