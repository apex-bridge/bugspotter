/**
 * Integration Service
 * Business logic for project integrations
 */

import type { DatabaseClient } from '../db/client.js';
import type { PluginRegistry } from '../integrations/plugin-registry.js';

// ============================================================================
// TYPES
// ============================================================================

export interface AvailableIntegration {
  platform: string;
  name: string;
  description: string;
  hasRules: boolean;
  enabled: boolean;
  config?: Record<string, unknown>;
}

// ============================================================================
// INTEGRATION SERVICE
// ============================================================================

export class IntegrationService {
  constructor(
    private db: DatabaseClient,
    private registry: PluginRegistry
  ) {}

  /**
   * Get all available integrations for a project
   * Merges built-in plugins with custom integrations
   */
  async getAvailableIntegrations(projectId: string): Promise<AvailableIntegration[]> {
    // Get built-in integrations from plugin registry
    const builtInIntegrations = this.getBuiltInIntegrations();

    // Get custom integrations from database
    const customIntegrations = await this.getCustomIntegrations();

    // Merge built-in and custom (custom overrides built-in)
    const availableIntegrations = this.mergeIntegrations(builtInIntegrations, customIntegrations);

    // Get configured integrations for this project
    const projectIntegrations =
      await this.db.projectIntegrations.findAllByProjectWithType(projectId);

    // Merge with configuration status
    return this.applyConfigurationStatus(availableIntegrations, projectIntegrations);
  }

  /**
   * Get built-in integrations from plugin registry
   */
  private getBuiltInIntegrations(): AvailableIntegration[] {
    const plugins = this.registry.listPlugins();

    return plugins.map((plugin) => ({
      platform: plugin.platform,
      name: plugin.name,
      description: plugin.description || `${plugin.name} integration`,
      hasRules: true, // Plugins support rules by default
      enabled: false,
    }));
  }

  /**
   * Get custom integrations from database
   */
  private async getCustomIntegrations(): Promise<AvailableIntegration[]> {
    const customIntegrations = await this.db.integrations.findAll();
    const supportedPlatforms = new Set(this.registry.getSupportedPlatforms());

    // Only include integrations that have plugins OR are custom (user-created)
    return customIntegrations
      .filter((integration) => integration.is_custom || supportedPlatforms.has(integration.type))
      .map((integration) => ({
        platform: integration.type,
        name: integration.name,
        description: integration.description || `${integration.name} integration`,
        hasRules: true,
        enabled: false,
      }));
  }

  /**
   * Merge built-in and custom integrations
   * Custom integrations override built-in ones with same platform
   */
  private mergeIntegrations(
    builtIn: AvailableIntegration[],
    custom: AvailableIntegration[]
  ): AvailableIntegration[] {
    const integrationsMap = new Map<string, AvailableIntegration>();

    // Add built-in first
    builtIn.forEach((integration) => {
      integrationsMap.set(integration.platform, integration);
    });

    // Custom overrides built-in
    custom.forEach((integration) => {
      integrationsMap.set(integration.platform, integration);
    });

    return Array.from(integrationsMap.values());
  }

  /**
   * Apply project-specific configuration status to integrations
   */
  private applyConfigurationStatus(
    availableIntegrations: AvailableIntegration[],
    projectIntegrations: Array<{ integration_type: string; enabled: boolean; config: unknown }>
  ): AvailableIntegration[] {
    // Map configured integrations to platform → config
    const configuredMap = new Map(
      projectIntegrations.map((pi) => [
        pi.integration_type,
        { enabled: pi.enabled, config: pi.config as Record<string, unknown> | undefined },
      ])
    );

    // Merge available integrations with configured status
    return availableIntegrations.map((integration) => {
      const configured = configuredMap.get(integration.platform);
      return {
        ...integration,
        enabled: configured?.enabled ?? false,
        config: configured?.config,
      };
    });
  }
}
