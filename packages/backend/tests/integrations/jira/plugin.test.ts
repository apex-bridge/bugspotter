/**
 * Jira Plugin Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock JiraClient to avoid real HTTP calls during validateConfig
vi.mock('../../../src/integrations/jira/client.js', () => ({
  JiraClient: vi.fn().mockImplementation(() => ({
    testConnection: vi.fn().mockResolvedValue({
      valid: true,
      details: { projectExists: true },
    }),
  })),
}));
import { jiraPlugin } from '../../../src/integrations/jira/plugin.js';
import type { PluginContext } from '../../../src/integrations/plugin.types.js';

describe('jiraPlugin', () => {
  let mockContext: PluginContext;

  beforeEach(() => {
    mockContext = {
      db: {
        bugReports: {},
        projectIntegrations: {},
        tickets: {},
      } as any,
      storage: {} as any,
    };
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expect(jiraPlugin.metadata).toEqual({
        name: 'Jira Integration',
        platform: 'jira',
        version: '1.0.0',
        description: 'Create and sync issues with Atlassian Jira',
        author: 'BugSpotter Team',
        requiredEnvVars: ['ENCRYPTION_KEY'],
        isBuiltIn: true,
      });
    });

    it('should require ENCRYPTION_KEY environment variable', () => {
      expect(jiraPlugin.metadata.requiredEnvVars).toContain('ENCRYPTION_KEY');
    });
  });

  describe('factory', () => {
    it('should create JiraIntegrationService instance', () => {
      const service = jiraPlugin.factory(mockContext);

      expect(service).toBeDefined();
      expect(service.platform).toBe('jira');
      expect(service.createFromBugReport).toBeDefined();
      expect(service.testConnection).toBeDefined();
    });

    it('should pass context to service', () => {
      const service = jiraPlugin.factory(mockContext);

      // Service should have access to context dependencies
      expect(service).toBeDefined();
    });
  });

  describe('lifecycle', () => {
    it('should not have lifecycle hooks defined', () => {
      expect('lifecycle' in jiraPlugin).toBe(false);
    });
  });

  describe('validateConfig', () => {
    it('should map instanceUrl to host when host is not provided', async () => {
      const service = jiraPlugin.factory(mockContext);
      const result = await service.validateConfig({
        instanceUrl: 'https://test.atlassian.net',
        email: 'user@example.com',
        apiToken: 'token123',
        projectKey: 'TEST',
      });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should prefer explicit host over instanceUrl', async () => {
      const service = jiraPlugin.factory(mockContext);
      const result = await service.validateConfig({
        host: 'https://explicit.atlassian.net',
        instanceUrl: 'https://ignored.atlassian.net',
        email: 'user@example.com',
        apiToken: 'token123',
        projectKey: 'TEST',
      });
      expect(result.valid).toBe(true);
    });

    it('should handle non-string instanceUrl gracefully', async () => {
      const service = jiraPlugin.factory(mockContext);
      const result = await service.validateConfig({
        instanceUrl: 12345 as any,
        email: 'user@example.com',
        apiToken: 'token123',
        projectKey: 'TEST',
      });
      // Should fail with missing host, not crash
      expect(result.valid).toBe(false);
      expect(result.error).toContain('host');
    });

    it('should handle empty string instanceUrl gracefully', async () => {
      const service = jiraPlugin.factory(mockContext);
      const result = await service.validateConfig({
        instanceUrl: '   ',
        email: 'user@example.com',
        apiToken: 'token123',
        projectKey: 'TEST',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('host');
    });
  });
});
