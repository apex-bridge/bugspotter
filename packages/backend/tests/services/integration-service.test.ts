/**
 * Integration Service Tests
 * Unit tests for integration merging logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntegrationService } from '../../src/services/integration-service.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { PluginRegistry } from '../../src/integrations/plugin-registry.js';

describe('IntegrationService', () => {
  let service: IntegrationService;
  let mockDb: DatabaseClient;
  let mockRegistry: PluginRegistry;

  beforeEach(() => {
    // Create mock database client
    mockDb = {
      integrations: {
        findAll: vi.fn(),
      },
      projectIntegrations: {
        findAllByProjectWithType: vi.fn(),
      },
    } as any;

    // Create mock plugin registry
    mockRegistry = {
      listPlugins: vi.fn(),
      getSupportedPlatforms: vi.fn(),
    } as any;

    service = new IntegrationService(mockDb, mockRegistry);
  });

  describe('getAvailableIntegrations', () => {
    it('should return built-in integrations when no custom integrations exist', async () => {
      const projectId = 'project-123';

      // Mock built-in plugins
      vi.mocked(mockRegistry.listPlugins).mockReturnValue([
        {
          platform: 'jira',
          name: 'Jira',
          description: 'Jira issue tracking',
          createTicket: vi.fn(),
          updateTicket: vi.fn(),
        },
        {
          platform: 'github',
          name: 'GitHub',
          description: 'GitHub issues',
          createTicket: vi.fn(),
          updateTicket: vi.fn(),
        },
      ] as any);

      // Mock no custom integrations
      vi.mocked(mockDb.integrations.findAll).mockResolvedValue([]);

      // Mock no project configurations
      vi.mocked(mockDb.projectIntegrations.findAllByProjectWithType).mockResolvedValue([]);

      const result = await service.getAvailableIntegrations(projectId);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        platform: 'jira',
        name: 'Jira',
        description: 'Jira issue tracking',
        hasRules: true,
        enabled: false,
      });
      expect(result[1]).toMatchObject({
        platform: 'github',
        name: 'GitHub',
        description: 'GitHub issues',
        hasRules: true,
        enabled: false,
      });
    });

    it('should merge custom integrations with built-in', async () => {
      const projectId = 'project-123';

      // Mock built-in plugins
      vi.mocked(mockRegistry.listPlugins).mockReturnValue([
        {
          platform: 'jira',
          name: 'Jira',
          description: 'Jira issue tracking',
          createTicket: vi.fn(),
          updateTicket: vi.fn(),
        },
      ] as any);

      // Mock supported platforms
      vi.mocked(mockRegistry.getSupportedPlatforms).mockReturnValue(['jira', 'github', 'linear']);

      // Mock custom integrations (including one that overrides built-in)
      vi.mocked(mockDb.integrations.findAll).mockResolvedValue([
        {
          id: 'int-1',
          type: 'jira',
          name: 'Custom Jira',
          description: 'Custom Jira integration',
          is_custom: true,
        },
        {
          id: 'int-2',
          type: 'linear',
          name: 'Linear',
          description: 'Linear issue tracking',
          is_custom: true,
        },
      ] as any);

      // Mock no project configurations
      vi.mocked(mockDb.projectIntegrations.findAllByProjectWithType).mockResolvedValue([]);

      const result = await service.getAvailableIntegrations(projectId);

      expect(result).toHaveLength(2);

      // Custom Jira should override built-in
      const jiraIntegration = result.find((i) => i.platform === 'jira');
      expect(jiraIntegration?.name).toBe('Custom Jira');
      expect(jiraIntegration?.description).toBe('Custom Jira integration');

      // Linear should be included
      const linearIntegration = result.find((i) => i.platform === 'linear');
      expect(linearIntegration?.name).toBe('Linear');
    });

    it('should apply project configuration status to integrations', async () => {
      const projectId = 'project-123';

      // Mock built-in plugins
      vi.mocked(mockRegistry.listPlugins).mockReturnValue([
        {
          platform: 'jira',
          name: 'Jira',
          description: 'Jira issue tracking',
          createTicket: vi.fn(),
          updateTicket: vi.fn(),
        },
        {
          platform: 'github',
          name: 'GitHub',
          description: 'GitHub issues',
          createTicket: vi.fn(),
          updateTicket: vi.fn(),
        },
      ] as any);

      // Mock no custom integrations
      vi.mocked(mockDb.integrations.findAll).mockResolvedValue([]);

      // Mock project has Jira enabled
      vi.mocked(mockDb.projectIntegrations.findAllByProjectWithType).mockResolvedValue([
        {
          id: 'pi-1',
          project_id: projectId,
          integration_type: 'jira',
          enabled: true,
          config: {
            url: 'https://jira.example.com',
            projectKey: 'PROJ',
          },
        },
      ] as any);

      const result = await service.getAvailableIntegrations(projectId);

      expect(result).toHaveLength(2);

      // Jira should be enabled with config
      const jiraIntegration = result.find((i) => i.platform === 'jira');
      expect(jiraIntegration?.enabled).toBe(true);
      expect(jiraIntegration?.config).toEqual({
        url: 'https://jira.example.com',
        projectKey: 'PROJ',
      });

      // GitHub should be disabled with no config
      const githubIntegration = result.find((i) => i.platform === 'github');
      expect(githubIntegration?.enabled).toBe(false);
      expect(githubIntegration?.config).toBeUndefined();
    });

    it('should filter out unsupported custom integrations', async () => {
      const projectId = 'project-123';

      // Mock built-in plugins
      vi.mocked(mockRegistry.listPlugins).mockReturnValue([]);

      // Mock supported platforms (only jira)
      vi.mocked(mockRegistry.getSupportedPlatforms).mockReturnValue(['jira']);

      // Mock custom integrations with unsupported platform
      vi.mocked(mockDb.integrations.findAll).mockResolvedValue([
        {
          id: 'int-1',
          type: 'unsupported-platform',
          name: 'Unsupported',
          description: 'Should be filtered out',
          is_custom: false, // Not custom
        },
        {
          id: 'int-2',
          type: 'custom-platform',
          name: 'Custom Platform',
          description: 'Should be included',
          is_custom: true, // Custom integrations always included
        },
      ] as any);

      vi.mocked(mockDb.projectIntegrations.findAllByProjectWithType).mockResolvedValue([]);

      const result = await service.getAvailableIntegrations(projectId);

      expect(result).toHaveLength(1);
      expect(result[0].platform).toBe('custom-platform');
    });

    it('should handle multiple project configurations', async () => {
      const projectId = 'project-123';

      vi.mocked(mockRegistry.listPlugins).mockReturnValue([
        {
          platform: 'jira',
          name: 'Jira',
          description: 'Jira',
          createTicket: vi.fn(),
          updateTicket: vi.fn(),
        },
        {
          platform: 'github',
          name: 'GitHub',
          description: 'GitHub',
          createTicket: vi.fn(),
          updateTicket: vi.fn(),
        },
        {
          platform: 'slack',
          name: 'Slack',
          description: 'Slack',
          createTicket: vi.fn(),
          updateTicket: vi.fn(),
        },
      ] as any);

      vi.mocked(mockDb.integrations.findAll).mockResolvedValue([]);

      // Mock multiple enabled integrations
      vi.mocked(mockDb.projectIntegrations.findAllByProjectWithType).mockResolvedValue([
        {
          id: 'pi-1',
          project_id: projectId,
          integration_type: 'jira',
          enabled: true,
          config: { url: 'https://jira.example.com' },
        },
        {
          id: 'pi-2',
          project_id: projectId,
          integration_type: 'github',
          enabled: false,
          config: { repo: 'org/repo' },
        },
      ] as any);

      const result = await service.getAvailableIntegrations(projectId);

      expect(result).toHaveLength(3);

      const jira = result.find((i) => i.platform === 'jira');
      expect(jira?.enabled).toBe(true);
      expect(jira?.config).toBeDefined();

      const github = result.find((i) => i.platform === 'github');
      expect(github?.enabled).toBe(false);
      expect(github?.config).toBeDefined();

      const slack = result.find((i) => i.platform === 'slack');
      expect(slack?.enabled).toBe(false);
      expect(slack?.config).toBeUndefined();
    });
  });
});
