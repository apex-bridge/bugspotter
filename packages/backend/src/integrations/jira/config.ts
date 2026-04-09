/**
 * Jira Configuration Manager
 * Handles loading, validation, and encryption of Jira credentials
 */

import type { ProjectIntegrationRepository } from '../../db/project-integration.repository.js';
import { getLogger } from '../../logger.js';
import { getEncryptionService } from '../../utils/encryption.js';
import type {
  JiraConfig,
  JiraCredentials,
  JiraProjectConfig,
  JiraConnectionTestResult,
} from './types.js';
import { JiraClient } from './client.js';

const logger = getLogger();

/**
 * Jira Configuration Manager
 * Manages Jira configuration storage and retrieval
 */
export class JiraConfigManager {
  private integrationRepo: ProjectIntegrationRepository;
  private encryptionService = getEncryptionService();

  constructor(integrationRepo: ProjectIntegrationRepository) {
    this.integrationRepo = integrationRepo;
  }

  /**
   * Decrypt and parse Jira credentials
   * @param encryptedCredentials - Encrypted credentials string
   * @param contextId - Project ID or integration ID for logging
   * @returns Decrypted credentials or null if decryption fails
   */
  private decryptCredentials(
    encryptedCredentials: string,
    contextId: string
  ): JiraCredentials | null {
    try {
      const decrypted = this.encryptionService.decrypt(encryptedCredentials);
      return JSON.parse(decrypted);
    } catch (error) {
      logger.error('Failed to decrypt Jira credentials', {
        contextId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Build JiraConfig from project config and credentials
   * @param config - Project-specific Jira configuration
   * @param credentials - Decrypted Jira credentials
   * @param enabled - Whether integration is enabled
   * @param contextId - Project ID or integration ID for logging
   * @returns JiraConfig object or null if instance URL is missing
   */
  private buildJiraConfig(
    config: JiraProjectConfig,
    credentials: JiraCredentials,
    enabled: boolean,
    contextId: string
  ): JiraConfig | null {
    // Validate instance URL exists
    if (!config.instanceUrl) {
      logger.error('Jira integration missing instanceUrl in config', { contextId });
      return null;
    }

    return {
      host: config.instanceUrl,
      email: credentials.email,
      apiToken: credentials.apiToken,
      projectKey: config.projectKey,
      issueType: config.issueType || 'Bug',
      enabled,
      ...(config.templateConfig ? { templateConfig: config.templateConfig } : {}),
    };
  }

  /**
   * Load Jira configuration from environment variables
   * Used for global/default Jira integration
   */
  static fromEnvironment(): JiraConfig | null {
    const host = process.env.JIRA_HOST;
    const email = process.env.JIRA_EMAIL;
    const apiToken = process.env.JIRA_API_TOKEN;
    const projectKey = process.env.JIRA_PROJECT_KEY;

    // Return null if any required field is missing
    if (!host || !email || !apiToken || !projectKey) {
      logger.debug('Jira environment configuration incomplete', {
        hasHost: !!host,
        hasEmail: !!email,
        hasApiToken: !!apiToken,
        hasProjectKey: !!projectKey,
      });
      return null;
    }

    const config: JiraConfig = {
      host,
      email,
      apiToken,
      projectKey,
      issueType: process.env.JIRA_ISSUE_TYPE || 'Bug',
      enabled: true,
    };

    logger.info('Loaded Jira configuration from environment', {
      host,
      projectKey,
      issueType: config.issueType,
    });

    return config;
  }

  /**
   * Load Jira configuration from database for specific project
   */
  async fromDatabase(projectId: string): Promise<JiraConfig | null> {
    try {
      // Use injected repository
      const integration = await this.integrationRepo.findEnabledByProjectAndPlatform(
        projectId,
        'jira'
      );

      if (!integration) {
        logger.debug('No Jira integration found for project', { projectId });
        return null;
      }

      // Decrypt credentials
      if (!integration.encrypted_credentials) {
        logger.error('Jira integration missing encrypted credentials', { projectId });
        return null;
      }

      const credentials = this.decryptCredentials(integration.encrypted_credentials, projectId);
      if (!credentials) {
        return null;
      }

      // Extract config and build JiraConfig
      const config = integration.config as unknown as JiraProjectConfig;
      const jiraConfig = this.buildJiraConfig(config, credentials, integration.enabled, projectId);

      if (!jiraConfig) {
        return null;
      }

      logger.debug('Loaded Jira configuration from database', {
        projectId,
        host: jiraConfig.host,
        projectKey: jiraConfig.projectKey,
      });

      return jiraConfig;
    } catch (error) {
      logger.error('Error loading Jira configuration from database', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Save Jira configuration to database
   */
  async saveToDatabase(projectId: string, config: JiraConfig): Promise<void> {
    try {
      // Validate configuration first
      const validation = await JiraConfigManager.validate(config);
      if (!validation.valid) {
        throw new Error(`Invalid Jira configuration: ${validation.error}`);
      }

      // Separate credentials from config
      const credentials: JiraCredentials = {
        email: config.email,
        apiToken: config.apiToken,
      };

      // Always save as 'instanceUrl' (modern field name) to migrate away from legacy 'host'
      const projectConfig: JiraProjectConfig = {
        instanceUrl: config.host, // Normalize: always store as instanceUrl
        projectKey: config.projectKey,
        issueType: config.issueType || 'Bug',
        autoCreate: true,
        syncStatus: false,
        syncComments: false,
      };

      // Encrypt credentials
      const encryptedCredentials = this.encryptionService.encrypt(JSON.stringify(credentials));

      // Upsert using injected repository
      await this.integrationRepo.upsert(projectId, 'jira', {
        enabled: config.enabled,
        config: projectConfig as unknown as Record<string, unknown>,
        encrypted_credentials: encryptedCredentials,
      });

      logger.info('Saved Jira configuration to database', {
        projectId,
        host: config.host,
        projectKey: config.projectKey,
        enabled: config.enabled,
      });
    } catch (error) {
      logger.error('Failed to save Jira configuration', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete Jira configuration for project
   */
  async deleteFromDatabase(projectId: string): Promise<void> {
    try {
      const deleted = await this.integrationRepo.deleteByProjectAndPlatform(projectId, 'jira');

      if (!deleted) {
        logger.warn('No Jira configuration found to delete', { projectId });
      }

      logger.info('Deleted Jira configuration from database', { projectId });
    } catch (error) {
      logger.error('Failed to delete Jira configuration', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Enable/disable Jira integration for project
   */
  async setEnabled(projectId: string, enabled: boolean): Promise<void> {
    try {
      const updated = await this.integrationRepo.setEnabled(projectId, 'jira', enabled);

      if (!updated) {
        throw new Error('Jira integration not found for project');
      }

      logger.info('Updated Jira integration status', { projectId, enabled });
    } catch (error) {
      logger.error('Failed to update Jira integration status', {
        projectId,
        enabled,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Validate required field is present and non-empty
   */
  private static validateRequiredField(
    value: string | undefined,
    fieldName: string
  ): JiraConnectionTestResult | null {
    if (!value || value.trim().length === 0) {
      return { valid: false, error: `Jira ${fieldName} is required` };
    }
    return null;
  }

  /**
   * Validate Jira configuration format
   */
  private static validateFormat(config: JiraConfig): JiraConnectionTestResult | null {
    // Validate host format
    if (!config.host.startsWith('http://') && !config.host.startsWith('https://')) {
      return {
        valid: false,
        error: 'Jira host must start with http:// or https://',
      };
    }

    // Validate email format (basic check)
    if (!config.email.includes('@')) {
      return { valid: false, error: 'Invalid email format' };
    }

    // Validate project key format (alphanumeric, 2-10 characters)
    if (!/^[A-Z0-9]{2,10}$/.test(config.projectKey)) {
      return {
        valid: false,
        error: 'Project key must be 2-10 uppercase alphanumeric characters',
      };
    }

    return null;
  }

  /**
   * Validate Jira configuration
   * Checks that all required fields are present and tests connection
   */
  static async validate(config: JiraConfig): Promise<JiraConnectionTestResult> {
    // Validate required fields
    const requiredFields = [
      { value: config.host, name: 'host' },
      { value: config.email, name: 'email' },
      { value: config.apiToken, name: 'API token' },
      { value: config.projectKey, name: 'project key' },
    ];

    for (const field of requiredFields) {
      const error = this.validateRequiredField(field.value, field.name);
      if (error) {
        return error;
      }
    }

    // Validate formats
    const formatError = this.validateFormat(config);
    if (formatError) {
      return formatError;
    }

    // Test connection to Jira
    try {
      const client = new JiraClient(config);
      const testResult = await client.testConnection(config.projectKey);

      if (!testResult.valid) {
        return testResult;
      }

      // Check project access
      if (testResult.details && !testResult.details.projectExists) {
        return {
          valid: false,
          error: `Project "${config.projectKey}" not found or you don't have access`,
        };
      }

      logger.info('Jira configuration validated successfully', {
        host: config.host,
        projectKey: config.projectKey,
      });

      return { valid: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Jira configuration validation failed', {
        host: config.host,
        error: errorMessage,
      });

      return {
        valid: false,
        error: `Connection test failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Get Jira configuration for project (tries database first, then environment)
   */
  async getConfig(projectId: string): Promise<JiraConfig | null> {
    // Try database first
    const dbConfig = await this.fromDatabase(projectId);
    if (dbConfig) {
      return dbConfig;
    }

    // Fall back to environment variables
    const envConfig = JiraConfigManager.fromEnvironment();
    if (envConfig) {
      logger.debug('Using environment Jira configuration', { projectId });
      return envConfig;
    }

    return null;
  }

  /**
   * Get Jira configuration by integration ID
   * Used when project has multiple Jira integrations to get specific one
   */
  async getConfigByIntegrationId(integrationId: string): Promise<JiraConfig | null> {
    try {
      const integration = await this.integrationRepo.findByIdWithType(integrationId);

      if (!integration || !integration.enabled) {
        logger.debug('No enabled Jira integration found', { integrationId });
        return null;
      }

      // Verify it's a Jira integration
      if (integration.integration_type !== 'jira') {
        logger.error('Integration is not a Jira integration', {
          integrationId,
          platform: integration.integration_type,
        });
        return null;
      }

      // Decrypt credentials
      if (!integration.encrypted_credentials) {
        logger.error('Jira integration missing encrypted credentials', { integrationId });
        return null;
      }

      const credentials = this.decryptCredentials(integration.encrypted_credentials, integrationId);
      if (!credentials) {
        return null;
      }

      // Extract config and build JiraConfig
      const config = integration.config as unknown as JiraProjectConfig;
      const jiraConfig = this.buildJiraConfig(
        config,
        credentials,
        integration.enabled,
        integrationId
      );

      if (!jiraConfig) {
        return null;
      }

      logger.debug('Loaded Jira configuration by integration ID', {
        integrationId,
        host: jiraConfig.host,
        projectKey: jiraConfig.projectKey,
      });

      return jiraConfig;
    } catch (error) {
      logger.error('Error loading Jira configuration by integration ID', {
        integrationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
