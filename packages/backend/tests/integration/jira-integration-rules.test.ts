/**
 * Jira Integration Rules E2E Tests
 *
 * Tests complete flow: Bug Report → Integration Rules Evaluation → Jira Ticket Creation
 *
 * Architecture:
 * - Integration rules are evaluated at API/trigger level (NOT in JiraIntegrationService)
 * - Service always creates tickets when called (assumes rules already passed)
 * - This test verifies the service works with various bug report patterns
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestDatabase } from '../setup.integration.js';
import { createTestProject, TestCleanupTracker } from '../utils/test-utils.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { JiraIntegrationService } from '../../src/integrations/jira/service.js';
import { getEncryptionService } from '../../src/utils/encryption.js';
import type { ProjectIntegrationRepository } from '../../src/db/project-integration.repository.js';
import type { IStorageService } from '../../src/storage/types.js';

// Mock Jira client to avoid real API calls
vi.mock('../../src/integrations/jira/client.js', () => ({
  JiraClient: vi.fn().mockImplementation(() => ({
    createIssue: vi.fn().mockResolvedValue({
      id: 'mock-issue-id',
      key: 'PROJ-123',
      self: 'https://jira.example.com/rest/api/3/issue/12345',
    }),
    getIssueUrl: vi.fn((key: string) => `https://example.atlassian.net/browse/${key}`),
    uploadAttachment: vi.fn().mockResolvedValue({
      id: 'attach-1',
      filename: 'screenshot.png',
      size: 1024,
      mimeType: 'image/png',
      content: 'https://jira.example.com/attachment/1',
    }),
  })),
}));

// Mock storage service
const mockStorage: IStorageService = {
  uploadScreenshot: vi.fn().mockResolvedValue({ key: 'mock-key', size: 1234 }),
  uploadThumbnail: vi.fn().mockResolvedValue({ key: 'mock-key', size: 1234 }),
  uploadAttachment: vi.fn().mockResolvedValue({ key: 'mock-key', size: 1234 }),
  uploadStream: vi.fn().mockResolvedValue({ key: 'mock-key', size: 1234 }),
  getObject: vi.fn().mockResolvedValue(Buffer.from('mock-data')),
  getSignedUrl: vi.fn().mockResolvedValue('mock-url'),
  getPresignedUploadUrl: vi.fn().mockResolvedValue('mock-url'),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  deleteFolder: vi.fn().mockResolvedValue(undefined),
  listObjects: vi.fn().mockResolvedValue({ objects: [], isTruncated: false }),
  headObject: vi.fn().mockResolvedValue(null),
} as any;

describe('Jira Integration Rules - E2E Flow', () => {
  let db: DatabaseClient;
  let jiraService: JiraIntegrationService;
  let integrationRepo: ProjectIntegrationRepository;
  const cleanup = new TestCleanupTracker();
  let jiraGlobalIntegrationId: string;

  // Config as stored in database (instanceUrl instead of host)
  const mockJiraDatabaseConfig = {
    instanceUrl: 'https://example.atlassian.net',
    projectKey: 'PROJ',
    issueType: 'Bug',
    autoCreate: false,
    syncStatus: false,
    syncComments: false,
  };

  // Get encrypted credentials using encryption service
  const encryptionService = getEncryptionService();
  const encryptedCredentials = encryptionService.encrypt(
    JSON.stringify({ email: 'test@example.com', apiToken: 'test' })
  );
  beforeAll(async () => {
    db = createTestDatabase();
    integrationRepo = db.projectIntegrations;
    jiraService = new JiraIntegrationService(db.bugReports, integrationRepo, db, mockStorage);

    // Use existing Jira integration from migration
    const globalIntegration = await db.integrations.findByType('jira');
    if (!globalIntegration) {
      throw new Error('Jira integration not found in database (should be created by migration)');
    }
    jiraGlobalIntegrationId = globalIntegration.id;
  });

  beforeEach(async () => {
    await cleanup.cleanup(db);
  });

  afterAll(async () => {
    await cleanup.cleanup(db);
  });

  describe('Service Layer Tests (Rules Already Evaluated)', () => {
    it('should create Jira ticket for bug with high severity metadata', async () => {
      // Given: Project with Jira integration
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      await integrationRepo.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraDatabaseConfig,
        encrypted_credentials: encryptedCredentials,
        enabled: true,
      });

      // And: Bug report with high severity (would pass typical rules)
      const bugReport = await db.bugReports.create({
        project_id: project.id,
        title: 'Critical crash',
        description: 'Application crashes on startup',
        metadata: {
          severity: 'high',
          environment: 'production',
          browser: { name: 'Chrome', version: '120.0.0' },
        },
      });
      cleanup.trackBugReport(bugReport.id);

      // When: Create Jira ticket (assumes rules already checked at API level)
      const projectIntegration = await integrationRepo.findAllByProject(project.id);
      const result = await jiraService.createFromBugReport(
        bugReport,
        project.id,
        projectIntegration![0].id
      );

      // Then: Ticket created successfully
      expect(result.externalId).toBe('PROJ-123');
      expect(result.externalUrl).toBe('https://example.atlassian.net/browse/PROJ-123');
      expect(result.platform).toBe('jira');

      // And: Ticket reference saved to database
      const tickets = await db.tickets.findByBugReport(bugReport.id);
      expect(tickets).toHaveLength(1);
      expect(tickets[0].external_id).toBe('PROJ-123');
      expect(tickets[0].platform).toBe('jira');
    });

    it('should create ticket for bug with low severity (service does not filter)', async () => {
      // Given: Project with Jira integration
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      await integrationRepo.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraDatabaseConfig,
        encrypted_credentials: encryptedCredentials,
        enabled: true,
      });

      // And: Bug with low severity (would be filtered by rules, but service doesn't check)
      const bugReport = await db.bugReports.create({
        project_id: project.id,
        title: 'Minor UI glitch',
        description: 'Button color slightly off',
        metadata: {
          severity: 'low',
          browser: { name: 'Chrome', version: '120.0.0' },
        },
      });
      cleanup.trackBugReport(bugReport.id);

      // When: Service is called directly (bypassing rule evaluation)
      const projectIntegration = await integrationRepo.findAllByProject(project.id);
      const result = await jiraService.createFromBugReport(
        bugReport,
        project.id,
        projectIntegration![0].id
      );

      // Then: Ticket created (service always creates when called)
      expect(result.externalId).toBe('PROJ-123');
      expect(result.externalUrl).toBeDefined();

      // Note: In production, triggerIntegrations() would have blocked this based on rules
      // This test verifies service behavior when rules are bypassed
    });

    it('should handle bug with production environment metadata', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      await integrationRepo.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraDatabaseConfig,
        encrypted_credentials: encryptedCredentials,
        enabled: true,
      });

      const bugReport = await db.bugReports.create({
        project_id: project.id,
        title: 'Production issue',
        metadata: {
          severity: 'medium',
          environment: 'production',
          error_count: 5,
        },
      });
      cleanup.trackBugReport(bugReport.id);

      const projectIntegration = await integrationRepo.findAllByProject(project.id);
      const result = await jiraService.createFromBugReport(
        bugReport,
        project.id,
        projectIntegration![0].id
      );

      expect(result.externalId).toBe('PROJ-123');
      expect(result.platform).toBe('jira');
    });

    it('should handle bug with rich metadata (multiple fields)', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      await integrationRepo.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraDatabaseConfig,
        encrypted_credentials: encryptedCredentials,
        enabled: true,
      });

      const bugReport = await db.bugReports.create({
        project_id: project.id,
        title: 'Complex bug report',
        metadata: {
          severity: 'high',
          environment: 'production',
          error_count: 15,
          user_impact: 'high',
          response_time_ms: 5000,
        },
      });
      cleanup.trackBugReport(bugReport.id);

      const projectIntegration = await integrationRepo.findAllByProject(project.id);
      const result = await jiraService.createFromBugReport(
        bugReport,
        project.id,
        projectIntegration![0].id
      );

      expect(result.externalId).toBe('PROJ-123');
    });

    it('should handle bug with text-based metadata (title contains keyword)', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      await integrationRepo.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraDatabaseConfig,
        encrypted_credentials: encryptedCredentials,
        enabled: true,
      });

      const bugReport = await db.bugReports.create({
        project_id: project.id,
        title: 'Payment processing failure detected',
        description: 'Credit card payment fails during checkout',
      });
      cleanup.trackBugReport(bugReport.id);

      const projectIntegration = await integrationRepo.findAllByProject(project.id);
      const result = await jiraService.createFromBugReport(
        bugReport,
        project.id,
        projectIntegration![0].id
      );

      expect(result.externalId).toBe('PROJ-123');
    });

    it('should handle bug with numeric threshold metadata', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      await integrationRepo.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraDatabaseConfig,
        encrypted_credentials: encryptedCredentials,
        enabled: true,
      });

      const bugReport = await db.bugReports.create({
        project_id: project.id,
        title: 'High error rate detected',
        metadata: {
          error_count: 50,
          response_time_ms: 8000,
        },
      });
      cleanup.trackBugReport(bugReport.id);

      const projectIntegration = await integrationRepo.findAllByProject(project.id);
      const result = await jiraService.createFromBugReport(
        bugReport,
        project.id,
        projectIntegration![0].id
      );

      expect(result.externalId).toBe('PROJ-123');
    });

    it('should handle bug with minimal metadata', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      await integrationRepo.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraDatabaseConfig,
        encrypted_credentials: encryptedCredentials,
        enabled: true,
      });

      const bugReport = await db.bugReports.create({
        project_id: project.id,
        title: 'Simple bug',
        metadata: { severity: 'low' },
      });
      cleanup.trackBugReport(bugReport.id);

      const projectIntegration = await integrationRepo.findAllByProject(project.id);
      const result = await jiraService.createFromBugReport(
        bugReport,
        project.id,
        projectIntegration![0].id
      );

      expect(result.externalId).toBe('PROJ-123');
    });

    it('should handle bug with no metadata (backward compatibility)', async () => {
      const project = await createTestProject(db);
      cleanup.trackProject(project.id);

      await integrationRepo.create({
        project_id: project.id,
        integration_id: jiraGlobalIntegrationId,
        config: mockJiraDatabaseConfig,
        encrypted_credentials: encryptedCredentials,
        enabled: true,
      });

      const bugReport = await db.bugReports.create({
        project_id: project.id,
        title: 'Bug without metadata',
        description: 'Old-style bug report',
      });
      cleanup.trackBugReport(bugReport.id);

      const projectIntegration = await integrationRepo.findAllByProject(project.id);
      const result = await jiraService.createFromBugReport(
        bugReport,
        project.id,
        projectIntegration![0].id
      );

      expect(result.externalId).toBe('PROJ-123');
    });
  });
});
