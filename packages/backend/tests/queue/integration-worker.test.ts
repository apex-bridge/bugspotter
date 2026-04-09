/**
 * Integration Worker Tests
 * Unit tests for integration platform worker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createIntegrationWorker } from '../../src/queue/workers/integration-worker.js';
import type { BugReportRepository } from '../../src/db/repositories.js';
import type { Redis } from 'ioredis';
import {
  validateIntegrationJobData,
  createIntegrationJobResult,
} from '../../src/queue/jobs/integration-job.js';
import { JobProcessingError } from '../../src/queue/errors.js';

describe('Integration Worker', () => {
  let mockBugReportRepo: Partial<BugReportRepository>;
  let mockRedis: Partial<Redis>;
  let mockRegistry: any;

  beforeEach(() => {
    mockBugReportRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'bug-123',
        project_id: 'proj-456',
        title: 'Test Bug',
        description: 'Test description',
        status: 'open',
        priority: 'high',
        metadata: {},
      }),
      updateExternalIntegration: vi.fn().mockResolvedValue(1),
    };

    mockRegistry = {
      get: vi.fn().mockReturnValue({
        createFromBugReport: vi.fn().mockResolvedValue({
          externalId: 'JIRA-123',
          externalUrl: 'https://jira.example.com/browse/JIRA-123',
          platform: 'jira',
        }),
      }),
      getSupportedPlatforms: vi.fn().mockReturnValue(['jira']),
    };

    mockRedis = {
      ping: vi.fn().mockResolvedValue('PONG'),
      on: vi.fn(),
      once: vi.fn(),
      duplicate: vi.fn().mockReturnThis(),
    };
  });

  describe('Worker Creation', () => {
    it('should create integration worker successfully', () => {
      const worker = createIntegrationWorker(
        mockRegistry as any,
        mockBugReportRepo as BugReportRepository,
        mockRedis as Redis
      );

      expect(worker).toBeDefined();
      expect(worker.close).toBeDefined();
    });

    it('should create worker with correct configuration', () => {
      const worker = createIntegrationWorker(
        mockRegistry as any,
        mockBugReportRepo as BugReportRepository,
        mockRedis as Redis
      );

      expect(worker).toBeDefined();
    });
  });

  describe('Job Data Validation', () => {
    it('should validate correct integration job data', () => {
      const validData = {
        bugReportId: 'bug-123',
        projectId: 'proj-123',
        platform: 'jira',
        credentials: { apiToken: 'token', domain: 'example.atlassian.net' },
        config: { projectKey: 'BUG' },
      };

      expect(validateIntegrationJobData(validData)).toBe(true);
    });

    it('should reject integration data without bugReportId', () => {
      const invalidData = {
        platform: 'jira',
        credentials: { apiToken: 'token' },
        config: {},
      };

      expect(validateIntegrationJobData(invalidData)).toBe(false);
    });

    it('should reject integration data without platform', () => {
      const invalidData = {
        bugReportId: 'bug-123',
        credentials: { apiToken: 'token' },
        config: {},
      };

      expect(validateIntegrationJobData(invalidData)).toBe(false);
    });

    it('should reject integration data without credentials', () => {
      const invalidData = {
        bugReportId: 'bug-123',
        platform: 'jira',
        config: {},
      };

      expect(validateIntegrationJobData(invalidData)).toBe(false);
    });

    it('should reject integration data without config', () => {
      const invalidData = {
        bugReportId: 'bug-123',
        platform: 'jira',
        credentials: { apiToken: 'token' },
      };

      expect(validateIntegrationJobData(invalidData)).toBe(false);
    });
  });

  describe('Platform Support', () => {
    it('should validate jira platform', () => {
      const data = {
        bugReportId: 'bug-123',
        projectId: 'proj-123',
        platform: 'jira',
        credentials: { apiToken: 'token', email: 'user@example.com', domain: 'example' },
        config: { projectKey: 'BUG', issueType: 'Bug' },
      };

      expect(validateIntegrationJobData(data)).toBe(true);
    });

    it('should validate github platform', () => {
      const data = {
        bugReportId: 'bug-123',
        projectId: 'proj-123',
        platform: 'github',
        credentials: { token: 'ghp_token' },
        config: { owner: 'org', repo: 'repo' },
      };

      expect(validateIntegrationJobData(data)).toBe(true);
    });

    it('should validate linear platform test', () => {
      const data = {
        bugReportId: 'bug-123',
        projectId: 'proj-123',
        platform: 'linear',
        credentials: { apiKey: 'lin_key' },
        config: { teamId: 'team-123' },
      };

      expect(validateIntegrationJobData(data)).toBe(true);
    });

    it('should validate slack platform', () => {
      const data = {
        bugReportId: 'bug-123',
        projectId: 'proj-123',
        platform: 'slack',
        credentials: { token: 'xoxb-token' },
        config: { channel: '#bugs' },
      };

      expect(validateIntegrationJobData(data)).toBe(true);
    });
  });

  describe('Job Result Creation', () => {
    it('should create result with external ID and URL', () => {
      const result = createIntegrationJobResult(
        'jira',
        'JIRA-123',
        'https://example.atlassian.net/browse/JIRA-123',
        'created'
      );

      expect(result.platform).toBe('jira');
      expect(result.externalId).toBe('JIRA-123');
      expect(result.externalUrl).toBe('https://example.atlassian.net/browse/JIRA-123');
      expect(result.status).toBe('created');
    });

    it('should create result with optional metadata', () => {
      const metadata = { issueType: 'Bug', priority: 'High' };
      const result = createIntegrationJobResult(
        'jira',
        'JIRA-123',
        'https://example.com',
        'created',
        metadata
      );

      expect(result.metadata).toEqual(metadata);
    });

    it('should handle different platforms', () => {
      const platforms = ['jira', 'github', 'linear', 'slack'];

      platforms.forEach((platform) => {
        const result = createIntegrationJobResult(
          platform,
          `${platform}-123`,
          'https://example.com',
          'created'
        );
        expect(result.platform).toBe(platform);
        expect(result.externalId).toBe(`${platform}-123`);
      });
    });

    it('should support different status values', () => {
      const statuses: Array<'created' | 'updated' | 'failed'> = ['created', 'updated', 'failed'];

      statuses.forEach((status) => {
        const result = createIntegrationJobResult(
          'github',
          '#123',
          'https://github.com/org/repo/issues/123',
          status
        );
        expect(result.status).toBe(status);
      });
    });
  });

  describe('Worker Lifecycle', () => {
    it('should allow closing the worker', async () => {
      const worker = createIntegrationWorker(
        mockRegistry as any,
        mockBugReportRepo as BugReportRepository,
        mockRedis as Redis
      );

      await expect(worker.close()).resolves.not.toThrow();
    });

    it('should provide access to worker host', () => {
      const worker = createIntegrationWorker(
        mockRegistry as any,
        mockBugReportRepo as BugReportRepository,
        mockRedis as Redis
      );

      expect(worker).toBeDefined();
      expect(worker.close).toBeDefined();
      expect(worker.pause).toBeDefined();
      expect(worker.resume).toBeDefined();
    });

    it('should support pause and resume', async () => {
      const worker = createIntegrationWorker(
        mockRegistry as any,
        mockBugReportRepo as BugReportRepository,
        mockRedis as Redis
      );

      await expect(worker.pause()).resolves.not.toThrow();
      await expect(worker.resume()).resolves.not.toThrow();
    });
  });

  describe('Configuration Validation', () => {
    it('should validate jira configuration', () => {
      const data = {
        bugReportId: 'bug-123',
        projectId: 'proj-123',
        platform: 'jira',
        credentials: {
          apiToken: 'token',
          email: 'user@example.com',
          domain: 'example.atlassian.net',
        },
        config: {
          projectKey: 'BUG',
          issueType: 'Bug',
        },
      };

      expect(validateIntegrationJobData(data)).toBe(true);
    });

    it('should validate github configuration', () => {
      const data = {
        bugReportId: 'bug-123',
        projectId: 'proj-123',
        platform: 'github',
        credentials: {
          token: 'ghp_token123',
        },
        config: {
          owner: 'organization',
          repo: 'repository',
          labels: ['bug', 'high-priority'],
        },
      };

      expect(validateIntegrationJobData(data)).toBe(true);
    });

    it('should accept minimal valid configuration', () => {
      const data = {
        bugReportId: 'bug-123',
        projectId: 'proj-123',
        platform: 'slack',
        credentials: { token: 'xoxb-token' },
        config: { channel: '#bugs' },
      };

      expect(validateIntegrationJobData(data)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should validate data structure before processing', () => {
      const invalidData = {
        bugReportId: 'bug-123',
        // Missing platform, credentials, config
      };

      expect(validateIntegrationJobData(invalidData)).toBe(false);
    });

    it('should require all mandatory fields', () => {
      const testCases = [
        { platform: 'jira', credentials: {}, config: {} }, // missing bugReportId
        { bugReportId: 'bug-123', credentials: {}, config: {} }, // missing platform
        { bugReportId: 'bug-123', platform: 'jira', config: {} }, // missing credentials
        { bugReportId: 'bug-123', platform: 'jira', credentials: {} }, // missing config
      ];

      testCases.forEach((data) => {
        expect(validateIntegrationJobData(data)).toBe(false);
      });
    });
  });

  describe('Database Update Failures', () => {
    it('should throw error when updateExternalIntegration returns 0 (bug report not found)', async () => {
      // Mock updateExternalIntegration to return 0 (no rows affected)
      mockBugReportRepo.updateExternalIntegration = vi.fn().mockResolvedValue(0);

      const worker = createIntegrationWorker(
        mockRegistry as any,
        mockBugReportRepo as BugReportRepository,
        mockRedis as Redis
      );

      // Create a mock job
      const mockJob = {
        id: 'job-123',
        data: {
          bugReportId: 'bug-123',
          projectId: 'proj-456',
          integrationId: 'int-789',
          platform: 'jira',
          credentials: { apiToken: 'token', domain: 'example.atlassian.net' },
          config: { projectKey: 'BUG' },
        },
        updateProgress: vi.fn(),
      };

      // Process the job - should throw error
      await expect((worker as any).getRawWorker().processFn(mockJob as any)).rejects.toThrow(
        JobProcessingError
      );

      // Verify error details
      try {
        await (worker as any).getRawWorker().processFn(mockJob as any);
      } catch (error) {
        expect(error).toBeInstanceOf(JobProcessingError);
        expect((error as JobProcessingError).jobId).toBe('job-123');
        expect((error as JobProcessingError).reason).toContain('Failed to update bug report');
        expect((error as JobProcessingError).details).toEqual({
          bugReportId: 'bug-123',
          externalId: 'JIRA-123',
          platform: 'jira',
        });
      }

      // Verify updateExternalIntegration was called
      expect(mockBugReportRepo.updateExternalIntegration).toHaveBeenCalledWith(
        'bug-123',
        'JIRA-123',
        'https://jira.example.com/browse/JIRA-123'
      );
    });

    it('should succeed when updateExternalIntegration returns 1 (bug report updated)', async () => {
      // Mock updateExternalIntegration to return 1 (row affected)
      mockBugReportRepo.updateExternalIntegration = vi.fn().mockResolvedValue(1);

      const worker = createIntegrationWorker(
        mockRegistry as any,
        mockBugReportRepo as BugReportRepository,
        mockRedis as Redis
      );

      const mockJob = {
        id: 'job-123',
        data: {
          bugReportId: 'bug-123',
          projectId: 'proj-456',
          platform: 'jira',
          credentials: { apiToken: 'token', domain: 'example.atlassian.net' },
          config: { projectKey: 'BUG' },
        },
        updateProgress: vi.fn(),
      };

      // Process the job - should succeed
      const result = await (worker as any).getRawWorker().processFn(mockJob as any);

      expect(result).toBeDefined();
      expect(result.externalId).toBe('JIRA-123');
      expect(result.platform).toBe('jira');
      expect(mockBugReportRepo.updateExternalIntegration).toHaveBeenCalledWith(
        'bug-123',
        'JIRA-123',
        'https://jira.example.com/browse/JIRA-123'
      );
    });

    it('should throw error when bug report is deleted between fetch and update', async () => {
      // First call succeeds (findById), second call returns 0 (updateExternalIntegration)
      mockBugReportRepo.findById = vi.fn().mockResolvedValue({
        id: 'bug-123',
        project_id: 'proj-456',
        title: 'Test Bug',
        description: 'Test description',
        status: 'open',
        priority: 'high',
        metadata: {},
      });
      mockBugReportRepo.updateExternalIntegration = vi.fn().mockResolvedValue(0);

      const worker = createIntegrationWorker(
        mockRegistry as any,
        mockBugReportRepo as BugReportRepository,
        mockRedis as Redis
      );

      const mockJob = {
        id: 'job-123',
        data: {
          bugReportId: 'bug-123',
          projectId: 'proj-456',
          integrationId: 'int-789',
          platform: 'jira',
          credentials: { apiToken: 'token', domain: 'example.atlassian.net' },
          config: { projectKey: 'BUG' },
        },
        updateProgress: vi.fn(),
      };

      // Should throw JobProcessingError
      await expect((worker as any).getRawWorker().processFn(mockJob as any)).rejects.toThrow(
        JobProcessingError
      );

      // Verify error details
      try {
        await (worker as any).getRawWorker().processFn(mockJob as any);
      } catch (error) {
        expect(error).toBeInstanceOf(JobProcessingError);
        expect((error as JobProcessingError).jobId).toBe('job-123');
        expect((error as JobProcessingError).reason).toContain('Failed to update bug report');
        expect((error as JobProcessingError).details).toEqual({
          bugReportId: 'bug-123',
          externalId: 'JIRA-123',
          platform: 'jira',
        });
      }
    });
  });
});
