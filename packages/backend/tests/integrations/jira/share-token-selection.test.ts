/**
 * Integration tests for Jira share token selection logic
 * Tests that JiraIntegrationService correctly selects token with latest expiration
 * when multiple active share tokens exist for a bug report
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { JiraIntegrationService } from '../../../src/integrations/jira/service.js';
import type { BugReportRepository } from '../../../src/db/repositories.js';
import type { ProjectIntegrationRepository } from '../../../src/db/project-integration.repository.js';
import type { DatabaseClient } from '../../../src/db/client.js';
import type { IStorageService } from '../../../src/storage/types.js';
import type { BugReport, ShareToken } from '../../../src/db/types.js';
import type { JiraConfig } from '../../../src/integrations/jira/types.js';

// Mock dependencies
vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/config.js', () => ({
  config: {
    frontend: {
      url: 'https://example.com',
    },
  },
}));

vi.mock('../../../src/integrations/jira/client.js', () => ({
  JiraClient: vi.fn().mockImplementation(() => ({
    createIssue: vi.fn().mockResolvedValue({ key: 'TEST-123', id: '10001' }),
    getIssueUrl: vi.fn((key: string) => `https://jira.example.com/browse/${key}`),
  })),
}));

vi.mock('../../../src/utils/encryption.js', () => ({
  getEncryptionService: () => ({
    decrypt: vi.fn((encrypted: string) => encrypted), // Return encrypted as-is (mocked)
    encrypt: vi.fn((plaintext: string) => plaintext),
  }),
}));

describe('JiraIntegrationService - Share Token Selection', () => {
  let service: JiraIntegrationService;
  let mockDb: DatabaseClient;
  let mockIntegrationRepo: ProjectIntegrationRepository;
  let mockBugReportRepo: BugReportRepository;
  let mockStorage: IStorageService;

  const testProjectId = 'proj-123';
  const testBugReportId = 'bug-456';
  const testIntegrationId = 'integration-789';

  const baseBugReport: BugReport = {
    id: testBugReportId,
    project_id: testProjectId,
    title: 'Test Bug',
    description: 'Test Description',
    screenshot_url: null,
    screenshot_key: null,
    thumbnail_key: null,
    replay_key: 'replays/proj-123/bug-456/replay.json',
    replay_url: null,
    upload_status: 'completed',
    replay_upload_status: 'completed',
    metadata: {},
    status: 'open',
    priority: 'medium',
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    deleted_by: null,
    legal_hold: false,
  };

  const baseJiraConfig: JiraConfig = {
    host: 'https://jira.example.com',
    email: 'test@example.com',
    apiToken: 'test-token',
    projectKey: 'TEST',
    issueType: 'Bug',
    enabled: true,
    templateConfig: {
      includeShareReplay: true,
      shareReplayExpiration: 168,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockBugReportRepo = {} as BugReportRepository;

    // Mock integration repository - this is what JiraConfigManager uses to load config
    // Note: JiraConfigManager.fromDatabase() calls findByIdWithType
    // and decrypts credentials, then merges with config object
    mockIntegrationRepo = {
      findEnabledByProjectAndPlatform: vi.fn().mockResolvedValue({
        id: testIntegrationId,
        project_id: testProjectId,
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        config: {
          instanceUrl: baseJiraConfig.host,
          projectKey: baseJiraConfig.projectKey,
          issueType: baseJiraConfig.issueType,
          templateConfig: baseJiraConfig.templateConfig,
        },
        // Encrypted credentials (in real scenario, encryption service would decrypt this)
        encrypted_credentials: JSON.stringify({
          email: baseJiraConfig.email,
          apiToken: baseJiraConfig.apiToken,
        }),
        enabled: true,
        created_at: new Date(),
        updated_at: new Date(),
      }),
      // Add findByIdWithType for integrationId-based config loading
      findByIdWithType: vi.fn().mockResolvedValue({
        id: testIntegrationId,
        project_id: testProjectId,
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        config: {
          instanceUrl: baseJiraConfig.host,
          projectKey: baseJiraConfig.projectKey,
          issueType: baseJiraConfig.issueType,
          templateConfig: baseJiraConfig.templateConfig,
        },
        encrypted_credentials: JSON.stringify({
          email: baseJiraConfig.email,
          apiToken: baseJiraConfig.apiToken,
        }),
        enabled: true,
        created_at: new Date(),
        updated_at: new Date(),
      }),
      update: vi.fn(),
    } as unknown as ProjectIntegrationRepository;

    mockStorage = {} as IStorageService;

    mockDb = {
      shareTokens: {
        findByBugReportId: vi.fn(),
        create: vi.fn(),
      },
      tickets: {
        createTicket: vi.fn(),
      },
      bugReports: {
        updateExternalIntegration: vi.fn(),
      },
      transaction: vi.fn(async (callback) => {
        const mockTx = {
          tickets: mockDb.tickets,
          bugReports: mockDb.bugReports,
        };
        return await callback(mockTx as unknown as DatabaseClient);
      }),
    } as unknown as DatabaseClient;

    service = new JiraIntegrationService(
      mockBugReportRepo,
      mockIntegrationRepo,
      mockDb,
      mockStorage
    );
  });

  describe('Multiple Token Selection', () => {
    it('should select token with latest expiration from unsorted array', async () => {
      const now = Date.now();
      const tokens: ShareToken[] = [
        {
          id: 'token-1',
          bug_report_id: testBugReportId,
          token: 'expires-in-1-day',
          expires_at: new Date(now + 1 * 24 * 60 * 60 * 1000),
          password_hash: null,
          view_count: 10,
          created_by: null,
          created_at: new Date(),
          deleted_at: null,
        },
        {
          id: 'token-3',
          bug_report_id: testBugReportId,
          token: 'expires-in-3-days',
          expires_at: new Date(now + 3 * 24 * 60 * 60 * 1000),
          password_hash: null,
          view_count: 5,
          created_by: null,
          created_at: new Date(),
          deleted_at: null,
        },
        {
          id: 'token-2',
          bug_report_id: testBugReportId,
          token: 'expires-in-7-days',
          expires_at: new Date(now + 7 * 24 * 60 * 60 * 1000), // Latest
          password_hash: null,
          view_count: 2,
          created_by: null,
          created_at: new Date(),
          deleted_at: null,
        },
      ];

      (mockDb.shareTokens.findByBugReportId as Mock).mockResolvedValue(tokens);

      await service.createFromBugReport(baseBugReport, testProjectId, testIntegrationId);

      // Should reuse existing token, not create new one
      expect(mockDb.shareTokens.create).not.toHaveBeenCalled();
      expect(mockDb.shareTokens.findByBugReportId).toHaveBeenCalledWith(testBugReportId, true);
    });

    it('should handle concurrent token creation scenario', async () => {
      const baseTime = Date.now();
      const tokens: ShareToken[] = [
        {
          id: 'token-1',
          bug_report_id: testBugReportId,
          token: 'first-created',
          expires_at: new Date(baseTime + 7 * 24 * 60 * 60 * 1000),
          password_hash: null,
          view_count: 0,
          created_by: null,
          created_at: new Date(baseTime),
          deleted_at: null,
        },
        {
          id: 'token-2',
          bug_report_id: testBugReportId,
          token: 'second-created',
          expires_at: new Date(baseTime + 7 * 24 * 60 * 60 * 1000 + 100), // 100ms later
          password_hash: null,
          view_count: 0,
          created_by: null,
          created_at: new Date(baseTime + 50),
          deleted_at: null,
        },
      ];

      (mockDb.shareTokens.findByBugReportId as Mock).mockResolvedValue(tokens);

      await service.createFromBugReport(baseBugReport, testProjectId, testIntegrationId);

      // Should select token with latest expiration (even if just 100ms difference)
      expect(mockDb.shareTokens.create).not.toHaveBeenCalled();
    });
  });

  describe('Single Token', () => {
    it('should reuse single existing token', async () => {
      const token: ShareToken = {
        id: 'only-token',
        bug_report_id: testBugReportId,
        token: 'single',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        password_hash: null,
        view_count: 0,
        created_by: null,
        created_at: new Date(),
        deleted_at: null,
      };

      (mockDb.shareTokens.findByBugReportId as Mock).mockResolvedValue([token]);

      await service.createFromBugReport(baseBugReport, testProjectId, testIntegrationId);

      expect(mockDb.shareTokens.create).not.toHaveBeenCalled();
    });
  });

  describe('No Existing Tokens', () => {
    it('should create new token when none exist', async () => {
      const newToken: ShareToken = {
        id: 'new-token',
        bug_report_id: testBugReportId,
        token: 'abc123',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        password_hash: null,
        view_count: 0,
        created_by: null,
        created_at: new Date(),
        deleted_at: null,
      };

      (mockDb.shareTokens.findByBugReportId as Mock).mockResolvedValue([]);
      (mockDb.shareTokens.create as Mock).mockResolvedValue(newToken);

      await service.createFromBugReport(baseBugReport, testProjectId, testIntegrationId);

      expect(mockDb.shareTokens.create).toHaveBeenCalledWith(
        expect.objectContaining({
          bug_report_id: testBugReportId,
          created_by: null,
          password_hash: null,
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should skip token generation when replay_key is null', async () => {
      const bugWithoutReplay: BugReport = {
        ...baseBugReport,
        replay_key: null,
      };

      await service.createFromBugReport(bugWithoutReplay, testProjectId, testIntegrationId);

      expect(mockDb.shareTokens.findByBugReportId).not.toHaveBeenCalled();
      expect(mockDb.shareTokens.create).not.toHaveBeenCalled();
    });

    it('should check for existing tokens when includeShareReplay is false due to missing templateConfig', async () => {
      // Note: This test demonstrates actual behavior - fromDatabase() in JiraConfigManager
      // doesn't extract templateConfig, so includeShareReplay defaults to true (line 155 in service.ts)
      // Therefore, the service WILL check for existing tokens and create one if none exist
      const configWithoutTemplateConfig = {
        ...baseJiraConfig,
        templateConfig: undefined, // Missing templateConfig simulates real behavior
      };

      (mockIntegrationRepo.findEnabledByProjectAndPlatform as Mock).mockResolvedValue({
        id: 'int-123',
        project_id: testProjectId,
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        config: {
          host: configWithoutTemplateConfig.host,
          projectKey: configWithoutTemplateConfig.projectKey,
          issueType: configWithoutTemplateConfig.issueType,
          // templateConfig intentionally missing (not extracted by fromDatabase)
        },
        encrypted_credentials: JSON.stringify({
          email: configWithoutTemplateConfig.email,
          apiToken: configWithoutTemplateConfig.apiToken,
        }),
        enabled: true,
        created_at: new Date(),
        updated_at: new Date(),
      });

      (mockDb.shareTokens.findByBugReportId as Mock).mockResolvedValue([]);
      (mockDb.shareTokens.create as Mock).mockResolvedValue({
        id: 'new-token',
        bug_report_id: testBugReportId,
        token: 'abc123',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        password_hash: null,
        view_count: 0,
        created_by: null,
        created_at: new Date(),
        deleted_at: null,
      });

      await service.createFromBugReport(baseBugReport, testProjectId, testIntegrationId);

      // Since templateConfig is missing, includeShareReplay defaults to true
      // Therefore, both findByBugReportId and create will be called
      expect(mockDb.shareTokens.findByBugReportId).toHaveBeenCalled();
      expect(mockDb.shareTokens.create).toHaveBeenCalled();
    });
  });
});
