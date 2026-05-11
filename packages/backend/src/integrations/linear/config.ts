/**
 * Linear Configuration Manager
 *
 * Mirrors `JiraConfigManager` in shape so the surrounding plumbing
 * (project_integrations table, encryption, route validation) doesn't need
 * any platform branches — just a different config-manager instance.
 *
 * Differences from Jira:
 *   - Single credential field (`apiKey`), no email/host pair.
 *   - Host is fixed (api.linear.app); no per-tenant URL validation.
 *   - Issue scope is a Team (`teamId` UUID + `teamKey` like "ENG") rather
 *     than a Jira project key.
 */

import type { ProjectIntegrationRepository } from '../../db/project-integration.repository.js';
import { getLogger } from '../../logger.js';
import { getEncryptionService } from '../../utils/encryption.js';
import { LinearClient } from './client.js';
import type {
  LinearConfig,
  LinearCredentials,
  LinearProjectConfig,
  LinearConnectionTestResult,
} from './types.js';

const logger = getLogger();

const PLATFORM = 'linear';

/**
 * Linear team keys are uppercase short identifiers (e.g. "ENG", "PROD-A").
 * We don't enforce a strict regex — Linear lets teams choose their own
 * key format, including non-uppercase characters in older orgs. The API
 * rejects malformed keys server-side with a clear error, which is what we
 * surface to the user.
 */
const TEAM_KEY_MIN_LENGTH = 1;
const TEAM_KEY_MAX_LENGTH = 64;

export class LinearConfigManager {
  private integrationRepo: ProjectIntegrationRepository;
  private encryptionService = getEncryptionService();

  constructor(integrationRepo: ProjectIntegrationRepository) {
    this.integrationRepo = integrationRepo;
  }

  /**
   * Decrypt and parse Linear credentials.
   *
   * `contextId` is only used for log breadcrumbs — same convention as
   * `JiraConfigManager.decryptCredentials`.
   */
  private decryptCredentials(
    encryptedCredentials: string,
    contextId: string
  ): LinearCredentials | null {
    try {
      const decrypted = this.encryptionService.decrypt(encryptedCredentials);
      const parsed = JSON.parse(decrypted) as LinearCredentials;
      if (!parsed.apiKey || typeof parsed.apiKey !== 'string') {
        logger.error('Linear credentials decrypted but apiKey missing/invalid', { contextId });
        return null;
      }
      return parsed;
    } catch (error) {
      logger.error('Failed to decrypt Linear credentials', {
        contextId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Build a runtime `LinearConfig` from the persisted plaintext config
   * and the decrypted credentials. Returns `null` if essential fields are
   * missing — the caller surfaces a 404 / disabled-integration error.
   */
  private buildConfig(
    config: LinearProjectConfig,
    credentials: LinearCredentials,
    enabled: boolean,
    contextId: string
  ): LinearConfig | null {
    if (!config.teamId || !config.teamKey) {
      logger.error('Linear integration missing teamId/teamKey in config', { contextId });
      return null;
    }

    return {
      apiKey: credentials.apiKey,
      teamId: config.teamId,
      teamKey: config.teamKey,
      projectId: config.projectId,
      projectName: config.projectName,
      defaultLabels: config.defaultLabels,
      enabled,
      ...(config.templateConfig ? { templateConfig: config.templateConfig } : {}),
    };
  }

  /**
   * Load Linear configuration from environment variables.
   *
   * Provided for parity with Jira's `fromEnvironment` so a single
   * self-hosted instance can seed a default Linear integration without
   * UI configuration. Optional — most users will configure via the admin
   * panel and ignore this path.
   */
  static fromEnvironment(): LinearConfig | null {
    const apiKey = process.env.LINEAR_API_KEY;
    const teamId = process.env.LINEAR_TEAM_ID;
    const teamKey = process.env.LINEAR_TEAM_KEY;

    if (!apiKey || !teamId || !teamKey) {
      logger.debug('Linear environment configuration incomplete', {
        hasApiKey: !!apiKey,
        hasTeamId: !!teamId,
        hasTeamKey: !!teamKey,
      });
      return null;
    }

    const config: LinearConfig = {
      apiKey,
      teamId,
      teamKey,
      projectId: process.env.LINEAR_PROJECT_ID,
      projectName: process.env.LINEAR_PROJECT_NAME,
      enabled: true,
    };

    logger.info('Loaded Linear configuration from environment', {
      teamKey,
      hasProject: !!config.projectId,
    });

    return config;
  }

  /**
   * Load Linear configuration for a project from the database.
   */
  async fromDatabase(projectId: string): Promise<LinearConfig | null> {
    try {
      const integration = await this.integrationRepo.findEnabledByProjectAndPlatform(
        projectId,
        PLATFORM
      );

      if (!integration) {
        logger.debug('No Linear integration found for project', { projectId });
        return null;
      }

      if (!integration.encrypted_credentials) {
        logger.error('Linear integration missing encrypted credentials', { projectId });
        return null;
      }

      const credentials = this.decryptCredentials(integration.encrypted_credentials, projectId);
      if (!credentials) {
        return null;
      }

      const config = integration.config as unknown as LinearProjectConfig;
      return this.buildConfig(config, credentials, integration.enabled, projectId);
    } catch (error) {
      logger.error('Error loading Linear configuration from database', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Persist a `LinearConfig` to the database. Validates first; encrypts
   * credentials; stores config + encrypted_credentials atomically via
   * `ProjectIntegrationRepository.upsert`.
   */
  async saveToDatabase(projectId: string, config: LinearConfig): Promise<void> {
    try {
      const validation = await LinearConfigManager.validate(config);
      if (!validation.valid) {
        throw new Error(`Invalid Linear configuration: ${validation.error}`);
      }

      const credentials: LinearCredentials = { apiKey: config.apiKey };

      const projectConfig: LinearProjectConfig = {
        teamId: config.teamId,
        teamKey: config.teamKey,
        projectId: config.projectId,
        projectName: config.projectName,
        defaultLabels: config.defaultLabels,
        autoCreate: true,
        syncStatus: false,
        syncComments: false,
        ...(config.templateConfig ? { templateConfig: config.templateConfig } : {}),
      };

      const encryptedCredentials = this.encryptionService.encrypt(JSON.stringify(credentials));

      await this.integrationRepo.upsert(projectId, PLATFORM, {
        enabled: config.enabled,
        config: projectConfig as unknown as Record<string, unknown>,
        encrypted_credentials: encryptedCredentials,
      });

      logger.info('Saved Linear configuration to database', {
        projectId,
        teamKey: config.teamKey,
        hasLinearProject: !!config.projectId,
        enabled: config.enabled,
      });
    } catch (error) {
      logger.error('Failed to save Linear configuration', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async deleteFromDatabase(projectId: string): Promise<void> {
    try {
      const deleted = await this.integrationRepo.deleteByProjectAndPlatform(projectId, PLATFORM);
      if (!deleted) {
        logger.warn('No Linear configuration found to delete', { projectId });
      }
      logger.info('Deleted Linear configuration from database', { projectId });
    } catch (error) {
      logger.error('Failed to delete Linear configuration', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async setEnabled(projectId: string, enabled: boolean): Promise<void> {
    try {
      const updated = await this.integrationRepo.setEnabled(projectId, PLATFORM, enabled);
      if (!updated) {
        throw new Error('Linear integration not found for project');
      }
      logger.info('Updated Linear integration status', { projectId, enabled });
    } catch (error) {
      logger.error('Failed to update Linear integration status', {
        projectId,
        enabled,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get config for a project, trying DB first then environment.
   * Identical fallback policy to `JiraConfigManager.getConfig`.
   */
  async getConfig(projectId: string): Promise<LinearConfig | null> {
    const dbConfig = await this.fromDatabase(projectId);
    if (dbConfig) {
      return dbConfig;
    }

    const envConfig = LinearConfigManager.fromEnvironment();
    if (envConfig) {
      logger.debug('Using environment Linear configuration', { projectId });
      return envConfig;
    }
    return null;
  }

  /**
   * Load config by specific integration row id — required when a project
   * has multiple integrations and the caller wants to disambiguate.
   * Mirrors `JiraConfigManager.getConfigByIntegrationId`.
   */
  async getConfigByIntegrationId(integrationId: string): Promise<LinearConfig | null> {
    try {
      const integration = await this.integrationRepo.findByIdWithType(integrationId);
      if (!integration || !integration.enabled) {
        logger.debug('No enabled Linear integration found', { integrationId });
        return null;
      }

      if (integration.integration_type !== PLATFORM) {
        logger.error('Integration is not a Linear integration', {
          integrationId,
          platform: integration.integration_type,
        });
        return null;
      }

      if (!integration.encrypted_credentials) {
        logger.error('Linear integration missing encrypted credentials', { integrationId });
        return null;
      }

      const credentials = this.decryptCredentials(integration.encrypted_credentials, integrationId);
      if (!credentials) {
        return null;
      }

      const config = integration.config as unknown as LinearProjectConfig;
      return this.buildConfig(config, credentials, integration.enabled, integrationId);
    } catch (error) {
      logger.error('Error loading Linear configuration by integration ID', {
        integrationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // ============================================================================
  // VALIDATION
  // ============================================================================

  /**
   * Validate a `LinearConfig` shape and reachability.
   *
   * Format checks are cheap and run first. The connection test (`viewer`
   * query) is the expensive step — gated behind format checks so we don't
   * burn rate budget on obviously-invalid inputs.
   */
  static async validate(config: LinearConfig): Promise<LinearConnectionTestResult> {
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      return { valid: false, error: 'Linear API key is required' };
    }
    if (!config.teamId || config.teamId.trim().length === 0) {
      return { valid: false, error: 'Linear teamId is required' };
    }
    if (!config.teamKey || config.teamKey.trim().length === 0) {
      return { valid: false, error: 'Linear teamKey is required' };
    }
    if (
      config.teamKey.length < TEAM_KEY_MIN_LENGTH ||
      config.teamKey.length > TEAM_KEY_MAX_LENGTH
    ) {
      return {
        valid: false,
        error: `Team key length must be between ${TEAM_KEY_MIN_LENGTH} and ${TEAM_KEY_MAX_LENGTH} characters`,
      };
    }

    try {
      const client = new LinearClient(config.apiKey);
      const viewer = await client.viewer();

      // Verify the team is reachable for this key. We don't run a separate
      // `team(id)` query if `teams` already includes it — Linear's `viewer`
      // doesn't carry team membership, so a dedicated `teams` call is the
      // cheapest reliable check.
      const teams = await client.teams();
      const teamExists = teams.some((t) => t.id === config.teamId);

      if (!teamExists) {
        return {
          valid: false,
          error: `Team "${config.teamKey}" not found or you don't have access`,
          details: {
            viewerEmail: viewer.email,
            organizationName: viewer.organization?.name,
            teamExists: false,
          },
        };
      }

      logger.info('Linear configuration validated', {
        teamKey: config.teamKey,
        viewerEmail: viewer.email,
        organization: viewer.organization?.name,
      });

      return {
        valid: true,
        details: {
          viewerEmail: viewer.email,
          organizationName: viewer.organization?.name,
          teamExists: true,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Linear configuration validation failed', { error: message });
      return { valid: false, error: `Connection test failed: ${message}` };
    }
  }
}
