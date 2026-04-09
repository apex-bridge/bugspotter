/**
 * Jira Configuration Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JiraConfigManager } from '../../../src/integrations/jira/config.js';
import type { ProjectIntegrationRepository } from '../../../src/db/project-integration.repository.js';
import type { CredentialEncryption } from '../../../src/utils/encryption.js';

// Mock JiraClient
vi.mock('../../../src/integrations/jira/client.js', () => ({
  JiraClient: vi.fn().mockImplementation(() => ({
    testConnection: vi.fn().mockResolvedValue({
      valid: true,
      details: { projectExists: true },
    }),
  })),
}));

describe('JiraConfigManager', () => {
  let configManager: JiraConfigManager;
  let mockRepository: ProjectIntegrationRepository;

  beforeEach(() => {
    mockRepository = {
      findEnabledByProjectAndPlatform: vi.fn(),
      findByIdWithType: vi.fn(),
      upsert: vi.fn(),
      setEnabled: vi.fn(),
      deleteByProjectAndPlatform: vi.fn(),
    } as any;

    configManager = new JiraConfigManager(mockRepository);
  });

  describe('fromDatabase', () => {
    it('should load and decrypt configuration', async () => {
      // Import encryption service to encrypt test data
      const { getEncryptionService } = await import('../../../src/utils/encryption.js');
      const encryptionService = getEncryptionService();
      const encryptedCreds = encryptionService.encrypt(
        JSON.stringify({ email: 'test@example.com', apiToken: 'token' })
      );

      mockRepository.findEnabledByProjectAndPlatform = vi.fn().mockResolvedValue({
        project_id: 'proj-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        config: {
          instanceUrl: 'https://example.atlassian.net',
          projectKey: 'PROJ',
          issueType: 'Bug',
        },
        encrypted_credentials: encryptedCreds,
        enabled: true,
      });

      const config = await configManager.fromDatabase('proj-123');

      expect(config).toBeDefined();
      expect(config?.host).toBe('https://example.atlassian.net');
      expect(config?.projectKey).toBe('PROJ');
      expect(config?.issueType).toBe('Bug');
      expect(config?.enabled).toBe(true);
      expect(mockRepository.findEnabledByProjectAndPlatform).toHaveBeenCalledWith(
        'proj-123',
        'jira'
      );
    });

    it('should pass through templateConfig from database config', async () => {
      const { getEncryptionService } = await import('../../../src/utils/encryption.js');
      const encryptionService = getEncryptionService();
      const encryptedCreds = encryptionService.encrypt(
        JSON.stringify({ email: 'test@example.com', apiToken: 'token' })
      );

      const templateConfig = {
        includeConsoleLogs: true,
        consoleLogLimit: 25,
        includeNetworkLogs: false,
        networkLogFilter: 'failures' as const,
        includeShareReplay: true,
        shareReplayExpiration: 168,
      };

      mockRepository.findEnabledByProjectAndPlatform = vi.fn().mockResolvedValue({
        project_id: 'proj-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        config: {
          instanceUrl: 'https://example.atlassian.net',
          projectKey: 'PROJ',
          issueType: 'Bug',
          templateConfig,
        },
        encrypted_credentials: encryptedCreds,
        enabled: true,
      });

      const config = await configManager.fromDatabase('proj-123');

      expect(config).toBeDefined();
      expect(config?.templateConfig).toEqual(templateConfig);
      expect(config?.templateConfig?.includeConsoleLogs).toBe(true);
      expect(config?.templateConfig?.consoleLogLimit).toBe(25);
      expect(config?.templateConfig?.includeNetworkLogs).toBe(false);
      expect(config?.templateConfig?.shareReplayExpiration).toBe(168);
    });

    it('should omit templateConfig when not present in database config', async () => {
      const { getEncryptionService } = await import('../../../src/utils/encryption.js');
      const encryptionService = getEncryptionService();
      const encryptedCreds = encryptionService.encrypt(
        JSON.stringify({ email: 'test@example.com', apiToken: 'token' })
      );

      mockRepository.findEnabledByProjectAndPlatform = vi.fn().mockResolvedValue({
        project_id: 'proj-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        config: {
          instanceUrl: 'https://example.atlassian.net',
          projectKey: 'PROJ',
          issueType: 'Bug',
        },
        encrypted_credentials: encryptedCreds,
        enabled: true,
      });

      const config = await configManager.fromDatabase('proj-123');

      expect(config).toBeDefined();
      expect(config?.templateConfig).toBeUndefined();
    });

    it('should return null when config not found', async () => {
      mockRepository.findEnabledByProjectAndPlatform = vi.fn().mockResolvedValue(null);

      const config = await configManager.fromDatabase('proj-123');

      expect(config).toBeNull();
    });

    it('should return null when credentials missing', async () => {
      mockRepository.findEnabledByProjectAndPlatform = vi.fn().mockResolvedValue({
        project_id: 'proj-123',
        integration_id: 'int-jira-id',
        integration_type: 'jira',
        config: { instanceUrl: 'https://example.atlassian.net', projectKey: 'PROJ' },
        encrypted_credentials: null,
        enabled: true,
      });

      const config = await configManager.fromDatabase('proj-123');

      expect(config).toBeNull();
    });
  });

  describe('saveToDatabase', () => {
    it('should encrypt and save configuration', async () => {
      mockRepository.upsert = vi.fn().mockResolvedValue({});

      const config = {
        host: 'https://example.atlassian.net',
        projectKey: 'PROJ',
        issueType: 'Bug',
        email: 'test@example.com',
        apiToken: 'secret-token',
        enabled: true,
      };

      await configManager.saveToDatabase('proj-123', config);

      expect(mockRepository.upsert).toHaveBeenCalledWith(
        'proj-123',
        'jira',
        expect.objectContaining({
          enabled: true,
          config: expect.objectContaining({
            instanceUrl: 'https://example.atlassian.net',
            projectKey: 'PROJ',
          }),
          encrypted_credentials: expect.any(String),
        })
      );
    });

    it('should throw error for invalid configuration', async () => {
      const invalidConfig = {
        host: '', // Invalid
        projectKey: 'PROJ',
        issueType: 'Bug',
        email: 'test@example.com',
        apiToken: 'secret-token',
        enabled: true,
      };

      await expect(configManager.saveToDatabase('proj-123', invalidConfig)).rejects.toThrow(
        'Invalid Jira configuration'
      );
    });
  });

  describe('validate', () => {
    it('should validate valid configuration', async () => {
      const config = {
        host: 'https://example.atlassian.net',
        projectKey: 'PROJ',
        issueType: 'Bug',
        email: 'test@example.com',
        apiToken: 'secret-token',
        enabled: true,
      };

      const result = await JiraConfigManager.validate(config);

      expect(result.valid).toBe(true);
    });

    it('should fail for missing host', async () => {
      const config = {
        host: '',
        projectKey: 'PROJ',
        issueType: 'Bug',
        email: 'test@example.com',
        apiToken: 'secret-token',
        enabled: true,
      };

      const result = await JiraConfigManager.validate(config);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('host');
    });

    it('should fail for invalid host format', async () => {
      const config = {
        host: 'not-a-url',
        projectKey: 'PROJ',
        issueType: 'Bug',
        email: 'test@example.com',
        apiToken: 'secret-token',
        enabled: true,
      };

      const result = await JiraConfigManager.validate(config);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('http');
    });

    it('should fail for invalid email format', async () => {
      const config = {
        host: 'https://example.atlassian.net',
        projectKey: 'PROJ',
        issueType: 'Bug',
        email: 'not-an-email',
        apiToken: 'secret-token',
        enabled: true,
      };

      const result = await JiraConfigManager.validate(config);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('email');
    });

    it('should fail for missing API token', async () => {
      const config = {
        host: 'https://example.atlassian.net',
        projectKey: 'PROJ',
        issueType: 'Bug',
        email: 'test@example.com',
        apiToken: '',
        enabled: true,
      };

      const result = await JiraConfigManager.validate(config);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('token');
    });
  });

  describe('deleteFromDatabase', () => {
    it('should delete configuration', async () => {
      mockRepository.deleteByProjectAndPlatform = vi.fn().mockResolvedValue(true);

      await configManager.deleteFromDatabase('proj-123');

      expect(mockRepository.deleteByProjectAndPlatform).toHaveBeenCalledWith('proj-123', 'jira');
    });
  });

  describe('setEnabled', () => {
    it('should enable integration', async () => {
      mockRepository.setEnabled = vi.fn().mockResolvedValue(true);

      await configManager.setEnabled('proj-123', true);

      expect(mockRepository.setEnabled).toHaveBeenCalledWith('proj-123', 'jira', true);
    });

    it('should throw error when integration not found', async () => {
      mockRepository.setEnabled = vi.fn().mockResolvedValue(false);

      await expect(configManager.setEnabled('proj-123', true)).rejects.toThrow('not found');
    });
  });

  describe('instanceUrl field validation (post-migration)', () => {
    let encryptionService: CredentialEncryption;

    beforeEach(async () => {
      const { getEncryptionService } = await import('../../../src/utils/encryption.js');
      encryptionService = getEncryptionService();
    });

    describe('fromDatabase', () => {
      it('should load config with instanceUrl (admin panel format)', async () => {
        const encryptedCreds = encryptionService.encrypt(
          JSON.stringify({ email: 'test@bugspotter.com', apiToken: 'secret-token-123' })
        );

        mockRepository.findEnabledByProjectAndPlatform = vi.fn().mockResolvedValue({
          project_id: '4ffb4250-f886-4f1e-af4c-ff9966b48aa6',
          integration_id: '0f3961e5-d429-4271-a057-6aabdde76543',
          integration_type: 'jira',
          config: {
            projectKey: 'KAN',
            instanceUrl: 'https://bugspotter-team-cbvd4hje.atlassian.net',
          },
          encrypted_credentials: encryptedCreds,
          enabled: true,
        });

        const config = await configManager.fromDatabase('4ffb4250-f886-4f1e-af4c-ff9966b48aa6');

        expect(config).toBeDefined();
        expect(config?.host).toBe('https://bugspotter-team-cbvd4hje.atlassian.net');
        expect(config?.projectKey).toBe('KAN');
        expect(config?.email).toBe('test@bugspotter.com');
        expect(config?.apiToken).toBe('secret-token-123');
      });

      it('should return null for legacy host field (no longer supported after migration)', async () => {
        const encryptedCreds = encryptionService.encrypt(
          JSON.stringify({ email: 'test@example.com', apiToken: 'token' })
        );

        mockRepository.findEnabledByProjectAndPlatform = vi.fn().mockResolvedValue({
          project_id: 'proj-123',
          integration_id: 'int-jira-id',
          integration_type: 'jira',
          config: {
            host: 'https://example.atlassian.net', // Legacy field - should fail
            projectKey: 'PROJ',
            issueType: 'Bug',
          },
          encrypted_credentials: encryptedCreds,
          enabled: true,
        });

        const config = await configManager.fromDatabase('proj-123');

        // Should return null because only instanceUrl is supported
        expect(config).toBeNull();
      });

      it('should use only instanceUrl (host field is ignored)', async () => {
        const encryptedCreds = encryptionService.encrypt(
          JSON.stringify({ email: 'test@example.com', apiToken: 'token' })
        );

        mockRepository.findEnabledByProjectAndPlatform = vi.fn().mockResolvedValue({
          project_id: 'proj-123',
          integration_id: 'int-jira-id',
          integration_type: 'jira',
          config: {
            instanceUrl: 'https://new-instance.atlassian.net',
            host: 'https://old-instance.atlassian.net', // Ignored
            projectKey: 'PROJ',
          },
          encrypted_credentials: encryptedCreds,
          enabled: true,
        });

        const config = await configManager.fromDatabase('proj-123');

        expect(config?.host).toBe('https://new-instance.atlassian.net');
      });

      it('should return null when instanceUrl is missing', async () => {
        const encryptedCreds = encryptionService.encrypt(
          JSON.stringify({ email: 'test@example.com', apiToken: 'token' })
        );

        mockRepository.findEnabledByProjectAndPlatform = vi.fn().mockResolvedValue({
          project_id: 'proj-123',
          integration_id: 'int-jira-id',
          integration_type: 'jira',
          config: {
            projectKey: 'PROJ',
            // Missing both instanceUrl and host
          },
          encrypted_credentials: encryptedCreds,
          enabled: true,
        });

        const config = await configManager.fromDatabase('proj-123');

        expect(config).toBeNull();
      });
    });

    describe('getConfigByIntegrationId', () => {
      it('should load config with instanceUrl (admin panel format)', async () => {
        const encryptedCreds = encryptionService.encrypt(
          JSON.stringify({ email: 'test@bugspotter.com', apiToken: 'secret-token-123' })
        );

        mockRepository.findByIdWithType = vi.fn().mockResolvedValue({
          project_id: '4ffb4250-f886-4f1e-af4c-ff9966b48aa6',
          integration_id: '0f3961e5-d429-4271-a057-6aabdde76543',
          integration_type: 'jira',
          config: {
            projectKey: 'KAN',
            instanceUrl: 'https://bugspotter-team-cbvd4hje.atlassian.net',
          },
          encrypted_credentials: encryptedCreds,
          enabled: true,
        });

        const config = await configManager.getConfigByIntegrationId(
          '0f3961e5-d429-4271-a057-6aabdde76543'
        );

        expect(config).toBeDefined();
        expect(config?.host).toBe('https://bugspotter-team-cbvd4hje.atlassian.net');
        expect(config?.projectKey).toBe('KAN');
        expect(config?.email).toBe('test@bugspotter.com');
        expect(config?.apiToken).toBe('secret-token-123');
      });

      it('should return null for legacy host field (no longer supported after migration)', async () => {
        const encryptedCreds = encryptionService.encrypt(
          JSON.stringify({ email: 'test@example.com', apiToken: 'token' })
        );

        mockRepository.findByIdWithType = vi.fn().mockResolvedValue({
          project_id: 'proj-123',
          integration_id: 'int-legacy-123',
          integration_type: 'jira',
          config: {
            host: 'https://example.atlassian.net', // Legacy field - should fail
            projectKey: 'PROJ',
            issueType: 'Bug',
          },
          encrypted_credentials: encryptedCreds,
          enabled: true,
        });

        const config = await configManager.getConfigByIntegrationId('int-legacy-123');

        // Should return null because only instanceUrl is supported
        expect(config).toBeNull();
      });

      it('should return null for non-jira integration type', async () => {
        const encryptedCreds = encryptionService.encrypt(JSON.stringify({ apiKey: 'some-key' }));

        mockRepository.findByIdWithType = vi.fn().mockResolvedValue({
          project_id: 'proj-123',
          integration_id: 'int-slack-123',
          integration_type: 'slack',
          config: { webhookUrl: 'https://slack.com/webhook' },
          encrypted_credentials: encryptedCreds,
          enabled: true,
        });

        const config = await configManager.getConfigByIntegrationId('int-slack-123');

        expect(config).toBeNull();
      });

      it('should return null when integration not enabled', async () => {
        mockRepository.findByIdWithType = vi.fn().mockResolvedValue({
          project_id: 'proj-123',
          integration_id: 'int-disabled-123',
          integration_type: 'jira',
          config: { projectKey: 'PROJ' },
          encrypted_credentials: 'encrypted',
          enabled: false,
        });

        const config = await configManager.getConfigByIntegrationId('int-disabled-123');

        expect(config).toBeNull();
      });

      it('should return null when instanceUrl is missing', async () => {
        const encryptedCreds = encryptionService.encrypt(
          JSON.stringify({ email: 'test@example.com', apiToken: 'token' })
        );

        mockRepository.findByIdWithType = vi.fn().mockResolvedValue({
          project_id: 'proj-123',
          integration_id: 'int-jira-id',
          integration_type: 'jira',
          config: {
            projectKey: 'PROJ',
            // Missing instanceUrl
          },
          encrypted_credentials: encryptedCreds,
          enabled: true,
        });

        const config = await configManager.getConfigByIntegrationId('int-jira-id');

        expect(config).toBeNull();
      });
    });
  });
});
