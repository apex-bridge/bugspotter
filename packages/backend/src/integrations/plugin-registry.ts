/**
 * Plugin-based Integration Registry
 * Manages integration plugins with auto-discovery
 */

import type { DatabaseClient } from '../db/client.js';
import type { IStorageService } from '../storage/types.js';
import type { IntegrationService } from './base-integration.service.js';
import type {
  IntegrationPlugin,
  AdvancedIntegrationPlugin,
  PluginContext,
} from './plugin.types.js';
import { SecurePluginExecutor } from './security/plugin-executor.js';
import { createPluginContextHelpers } from './plugin-context-helpers.js';
import { getLogger } from '../logger.js';

const logger = getLogger();

/**
 * Plugin Registry
 * Discovers, loads, and manages integration plugins
 */
export class PluginRegistry {
  private plugins: Map<string, AdvancedIntegrationPlugin> = new Map();
  private services: Map<string, IntegrationService> = new Map();
  private serviceDisposers: Map<string, Array<() => void>> = new Map();
  private serviceCaches: Map<string, Map<string, Promise<IntegrationService>>> = new Map();
  private context: PluginContext;
  private executor: SecurePluginExecutor;

  constructor(db: DatabaseClient, storage: IStorageService) {
    // Base context shared across all plugins (no projectId for security)
    // Custom plugins create per-project contexts in loadFromDatabase()
    const baseHelpers = createPluginContextHelpers(db, storage, '', '');
    this.context = {
      db,
      storage,
      projectId: '',
      platform: '',
      ...baseHelpers,
    };
    // SecurePluginExecutor constructor handles PLUGIN_EXECUTION_TIMEOUT_MS env var
    this.executor = new SecurePluginExecutor({
      memoryLimit: 128, // 128 MB
    });
  }

  /**
   * Register a plugin
   * @param plugin - Plugin to register
   */
  async register(plugin: IntegrationPlugin | AdvancedIntegrationPlugin): Promise<void> {
    const platform = plugin.metadata.platform.toLowerCase();

    // Check if already registered
    if (this.plugins.has(platform)) {
      logger.warn('Plugin already registered, skipping', {
        platform,
        name: plugin.metadata.name,
      });
      return;
    }

    // Validate plugin metadata
    if (!plugin.metadata.name || !plugin.metadata.platform || !plugin.metadata.version) {
      throw new Error(
        `Invalid plugin metadata: missing required fields (name, platform, or version)`
      );
    }

    // Check required environment variables
    if (plugin.metadata.requiredEnvVars) {
      const missing = plugin.metadata.requiredEnvVars.filter((envVar) => !process.env[envVar]);
      if (missing.length > 0) {
        logger.warn('Plugin missing required environment variables', {
          platform,
          missing,
        });
      }
    }

    // Cast to advanced plugin
    const advancedPlugin = plugin as AdvancedIntegrationPlugin;

    // Call lifecycle hook: onLoad
    if (advancedPlugin.lifecycle?.onLoad) {
      try {
        await advancedPlugin.lifecycle.onLoad();
      } catch (error) {
        logger.error('Plugin onLoad hook failed', {
          platform,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    // Validate plugin
    if (advancedPlugin.lifecycle?.validate) {
      const isValid = await advancedPlugin.lifecycle.validate();
      if (!isValid) {
        throw new Error(`Plugin validation failed: ${platform}`);
      }
    }

    // Store plugin
    this.plugins.set(platform, advancedPlugin);

    // Create service instance
    try {
      const service = plugin.factory(this.context);
      this.services.set(platform, service);

      logger.info('Registered integration plugin', {
        name: plugin.metadata.name,
        platform,
        version: plugin.metadata.version,
      });
    } catch (error) {
      // Cleanup on failure
      this.plugins.delete(platform);
      logger.error('Failed to instantiate plugin service', {
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Unregister a plugin
   * @param platform - Platform identifier
   */
  async unregister(platform: string): Promise<void> {
    const normalizedPlatform = platform.toLowerCase();
    const plugin = this.plugins.get(normalizedPlatform);

    if (!plugin) {
      logger.warn('Plugin not found for unregistration', { platform });
      return;
    }

    // Call lifecycle hook: onUnload
    if (plugin.lifecycle?.onUnload) {
      try {
        await plugin.lifecycle.onUnload();
      } catch (error) {
        logger.error('Plugin onUnload hook failed', {
          platform,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Dispose all isolates for this plugin (one per project)
    const disposers = this.serviceDisposers.get(normalizedPlatform);
    if (disposers) {
      for (const disposer of disposers) {
        try {
          disposer();
        } catch (error) {
          logger.error('Service disposer failed', {
            platform,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Remove from registry
    this.plugins.delete(normalizedPlatform);
    this.services.delete(normalizedPlatform);
    this.serviceDisposers.delete(normalizedPlatform);
    this.serviceCaches.delete(normalizedPlatform);

    logger.info('Unregistered integration plugin', { platform });
  }

  /**
   * Get integration service by platform
   * @param platform - Platform identifier
   * @returns Integration service or null if not found
   */
  get(platform: string): IntegrationService | null {
    return this.services.get(platform.toLowerCase()) || null;
  }

  /**
   * Check if platform is supported
   * @param platform - Platform identifier
   */
  isSupported(platform: string): boolean {
    return this.services.has(platform.toLowerCase());
  }

  /**
   * Get all registered platform identifiers
   */
  getSupportedPlatforms(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Get all registered services
   */
  getAll(): IntegrationService[] {
    return Array.from(this.services.values());
  }

  /**
   * Get plugin metadata
   * @param platform - Platform identifier
   */
  getPluginMetadata(platform: string) {
    const plugin = this.plugins.get(platform.toLowerCase());
    return plugin?.metadata || null;
  }

  /**
   * Get all plugin metadata
   */
  getAllPluginMetadata() {
    return Array.from(this.plugins.values()).map((p) => p.metadata);
  }

  /**
   * List all registered plugins with metadata
   * Alias for getAllPluginMetadata() for cleaner API
   */
  listPlugins() {
    return this.getAllPluginMetadata();
  }

  /**
   * Load a dynamic plugin with fallback strategy
   * Attempts: 1) In-memory cache, 2) Filesystem, 3) Database (custom plugins), 4) Generic HTTP fallback
   * @param platform - Platform identifier (e.g., 'jira', 'github', 'linear')
   * @returns Integration service instance
   */
  async loadDynamicPlugin(platform: string): Promise<IntegrationService> {
    const normalizedPlatform = platform.toLowerCase();

    // 1. Check if already loaded in memory
    const existing = this.get(normalizedPlatform);
    if (existing) {
      logger.debug('Plugin already loaded from cache', { platform: normalizedPlatform });
      return existing;
    }

    logger.info('Loading dynamic plugin', { platform: normalizedPlatform });

    // 2. Try loading from filesystem (builtin plugins)
    try {
      const service = await this.loadFromFilesystem(normalizedPlatform);
      logger.info('Loaded plugin from filesystem', { platform: normalizedPlatform });
      return service;
    } catch (error) {
      logger.debug('Plugin not found on filesystem', {
        platform: normalizedPlatform,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 3. Try loading from database (custom user-created plugins)
    let databaseError: Error | null = null;
    let integrationFromDatabase: Awaited<
      ReturnType<typeof this.context.db.integrations.findByType>
    > | null = null;

    try {
      const service = await this.loadFromDatabase(normalizedPlatform);
      logger.info('Loaded plugin from database', { platform: normalizedPlatform });
      return service;
    } catch (error) {
      databaseError = error as Error;
      logger.debug('Plugin not found in database', {
        platform: normalizedPlatform,
        error: error instanceof Error ? error.message : String(error),
      });

      // Try to get integration to check if it has plugin_code
      try {
        integrationFromDatabase = await this.context.db.integrations.findByType(normalizedPlatform);
      } catch {
        // Integration query failed, continue to fallback
        logger.debug('Could not check integration for fallback decision', {
          platform: normalizedPlatform,
        });
      }
    }

    // 4. No more fallback - throw the error
    // If database had plugin_code that failed, throw that error
    if (databaseError && integrationFromDatabase?.plugin_code) {
      throw databaseError;
    }

    // Otherwise, plugin not found
    throw new Error(
      `Integration plugin '${normalizedPlatform}' not found. ` +
        `It must be available as a built-in plugin, database plugin, or custom code plugin.`
    );
  }

  /**
   * Load plugin from filesystem (builtin plugins)
   * @private
   */
  private async loadFromFilesystem(platform: string): Promise<IntegrationService> {
    try {
      // Try loading from integrations/{platform}/index.ts
      const pluginPath = `../../integrations/${platform}/index.js`;
      const module = await import(pluginPath);

      if (!module.default) {
        throw new Error(`Plugin module ${platform} does not export a default plugin`);
      }

      const plugin = module.default as IntegrationPlugin;

      // Register and return service
      await this.register(plugin);
      const service = this.get(platform);

      if (!service) {
        throw new Error(`Failed to instantiate service for plugin: ${platform}`);
      }

      return service;
    } catch (error) {
      logger.debug('Failed to load plugin from filesystem', {
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Plugin not found on filesystem: ${platform}`);
    }
  }

  /**
   * Load plugin from database (custom code-based plugins)
   * @private
   */
  private async loadFromDatabase(platform: string): Promise<IntegrationService> {
    const normalizedPlatform = platform.toLowerCase();
    const integration = await this.context.db.integrations.findByType(normalizedPlatform);

    if (!integration) {
      throw new Error(`Integration not found in database: ${normalizedPlatform}`);
    }

    if (!integration.plugin_code) {
      throw new Error(`Integration ${normalizedPlatform} does not have plugin code`);
    }

    if (!integration.allow_code_execution) {
      throw new Error(
        `Code execution is disabled for ${normalizedPlatform}. Enable it in admin settings.`
      );
    }

    // Validate code before execution
    const analysis = await this.executor.validate(integration.plugin_code);
    if (!analysis.safe) {
      logger.error('Plugin code failed security validation', {
        platform: normalizedPlatform,
        violations: analysis.violations,
        risk_level: analysis.risk_level,
      });
      throw new Error(
        `Security validation failed for ${normalizedPlatform}: ${analysis.violations.join(', ')}`
      );
    }

    // Log warnings but allow execution
    if (analysis.warnings.length > 0) {
      logger.warn('Plugin code has security warnings', {
        platform: normalizedPlatform,
        warnings: analysis.warnings,
      });
    }

    // Execute plugin code in isolated sandbox to extract metadata
    // Note: This validates the code and extracts metadata only.
    // The actual factory execution happens later in createSecureService().
    logger.info('Executing custom plugin code in secure sandbox', {
      platform: normalizedPlatform,
      code_hash: integration.code_hash,
      trust_level: integration.trust_level,
    });

    try {
      const executionResult = await this.executor.execute(
        integration.plugin_code,
        this.context,
        integration.code_hash || undefined
      );

      // Create plugin from validated metadata
      const plugin: IntegrationPlugin = {
        metadata: {
          ...executionResult.metadata,
          description: executionResult.metadata.description ?? undefined,
          author: executionResult.metadata.author ?? undefined,
          isBuiltIn: false, // Custom plugin loaded from database
        },
        factory: (context) => {
          // Capture executor and integration for use in methods
          const executor = this.executor;
          const pluginCode = integration.plugin_code!;
          const platformName = executionResult.metadata.platform;
          const integrationConfig = integration.config || {};

          // SECURITY: Service instances are cached per-project to ensure RpcBridge
          // is scoped to the correct projectId. Caching at platform level would
          // allow cross-project data access vulnerability.
          // Cache is stored at registry level to prevent memory leaks on plugin reload.
          if (!this.serviceCaches.has(normalizedPlatform)) {
            this.serviceCaches.set(normalizedPlatform, new Map());
          }
          const serviceCache = this.serviceCaches.get(normalizedPlatform)!;

          const getService = async (projectId: string) => {
            let servicePromise = serviceCache.get(projectId);
            if (!servicePromise) {
              // SAFETY: plugin_code is guaranteed non-null by loadFromDatabase() validation
              // This factory is only created after successful validation check above
              if (!integration.plugin_code) {
                throw new Error(`Plugin code unexpectedly missing for ${platform}`);
              }

              // Get integration config for this platform
              const config = integration.config || {};

              // SECURITY: Create immutable project-scoped context
              // Context from factory has projectId='' (shared registry context)
              // Must create NEW object with correct projectId for this service instance
              const projectHelpers = createPluginContextHelpers(
                context.db,
                context.storage,
                projectId,
                platformName
              );
              const projectContext: PluginContext = {
                db: context.db,
                storage: context.storage,
                projectId, // Correct projectId for this specific service
                platform: platformName,
                ...projectHelpers,
              };

              // CRITICAL: Set promise in cache BEFORE awaiting to prevent race condition
              // Multiple concurrent calls will now see the same pending promise
              servicePromise = this.createSecureService(
                integration.plugin_code,
                executionResult.metadata.platform,
                projectContext,
                config
              );
              serviceCache.set(projectId, servicePromise);

              // Store disposer for this per-project isolate (after promise resolves)
              servicePromise
                .then((service) => {
                  const disposers = this.serviceDisposers.get(normalizedPlatform) || [];
                  const serviceWithDispose = service as IntegrationService & {
                    dispose?: () => void;
                  };
                  if (serviceWithDispose.dispose) {
                    disposers.push(serviceWithDispose.dispose);
                    this.serviceDisposers.set(normalizedPlatform, disposers);
                  }
                })
                .catch((error) => {
                  // Remove failed promise from cache so retry can occur
                  serviceCache.delete(projectId);
                  logger.error('Failed to create secure service, removed from cache', {
                    platform: normalizedPlatform,
                    projectId,
                    error: error instanceof Error ? error.message : String(error),
                  });
                });
            }
            return servicePromise;
          };

          return {
            platform: executionResult.metadata.platform,
            async createFromBugReport(bugReport, projectId, integrationId) {
              const service = await getService(projectId);
              return await service.createFromBugReport(bugReport, projectId, integrationId);
            },
            async testConnection(projectId: string) {
              // OPTIMIZATION: Use temporary isolate instead of long-lived service
              // testConnection is typically called once during setup, not worth
              // keeping a 128MB isolate alive just for this one-time check
              const testHelpers = createPluginContextHelpers(
                context.db,
                context.storage,
                projectId,
                platformName
              );
              const projectContext: PluginContext = {
                db: context.db,
                storage: context.storage,
                projectId,
                platform: platformName,
                ...testHelpers,
              };

              return await executor.executeTestConnection(
                pluginCode,
                platformName,
                projectContext,
                integrationConfig
              );
            },
            async validateConfig(config: Record<string, unknown>) {
              // OPTIMIZATION: Use temporary isolate instead of long-lived service
              // validateConfig is called during setup/config changes, not worth
              // keeping a 128MB isolate alive for this infrequent operation
              return await executor.executeValidateConfig(pluginCode, platformName, config);
            },
          };
        },
      };

      // Register and instantiate
      await this.register(plugin);

      // IMPORTANT: Use metadata platform (from executed code) not database type
      // The plugin code defines its own platform in metadata which may differ from DB type
      const metadataPlatform = executionResult.metadata.platform.toLowerCase();
      const service = this.services.get(metadataPlatform);

      if (!service) {
        throw new Error(`Failed to instantiate plugin service for ${normalizedPlatform}`);
      }

      // CACHE FIX: If database type differs from metadata platform, cache service
      // under both names to prevent cache misses on subsequent loadDynamicPlugin() calls
      if (normalizedPlatform !== metadataPlatform) {
        this.services.set(normalizedPlatform, service);
        logger.debug('Cached service under database type for lookup consistency', {
          database_type: normalizedPlatform,
          metadata_platform: metadataPlatform,
        });
      }

      return service;
    } catch (error) {
      logger.error('Plugin code execution failed', {
        platform: normalizedPlatform,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create a secure integration service that executes plugin code in isolated-vm
   * Executes factory function and returns service instance with RPC bridge
   * @private
   */
  private async createSecureService(
    code: string,
    platform: string,
    context: PluginContext,
    config: Record<string, unknown>
  ): Promise<IntegrationService> {
    try {
      // Execute factory function in isolated-vm and get service instance with dispose method
      const serviceWithDisposer = await this.executor.executeFactory(
        code,
        platform,
        context,
        config
      );

      // Return service that bridges to isolated-vm with dispose method attached
      // Note: Disposer is stored by factory function after service is cached per-project
      const service: IntegrationService & { dispose: () => void } = {
        platform,
        async createFromBugReport(
          bugReport: Parameters<IntegrationService['createFromBugReport']>[0],
          projectId: string,
          integrationId: string,
          metadata?: Parameters<IntegrationService['createFromBugReport']>[3]
        ) {
          // Pass integrationId and metadata through to plugin
          return await serviceWithDisposer.createFromBugReport(
            bugReport,
            projectId,
            integrationId,
            metadata
          );
        },
        async testConnection(projectId: string) {
          return await serviceWithDisposer.testConnection(projectId);
        },
        async validateConfig(config: Record<string, unknown>) {
          return await serviceWithDisposer.validateConfig(config);
        },
        dispose: serviceWithDisposer.dispose, // Attach dispose for per-project cleanup
      };

      return service;
    } catch (error) {
      logger.error('Failed to create secure service', {
        platform,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return error service that fails gracefully with no-op dispose
      const errorService: IntegrationService & { dispose: () => void } = {
        platform,
        async createFromBugReport(_bugReport, _projectId, integrationId, _metadata) {
          logger.error('Plugin createFromBugReport called on error service', {
            platform,
            integrationId,
          });
          return {
            externalId: '',
            externalUrl: '',
            platform,
            metadata: {
              success: false,
              error: `Plugin execution failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          };
        },
        async testConnection() {
          return false;
        },
        async validateConfig() {
          return { valid: false, error: 'Plugin failed to load' };
        },
        dispose() {
          // No-op: error services have no resources to clean up
        },
      };

      return errorService;
    }
  }

  /**
   * SECURITY NOTE: Removed createServiceFromCode() method (November 2025)
   *
   * The old implementation had a critical security flaw where plugin code was executed
   * twice - once safely in isolated-vm sandbox, and once unsafely with new Function().
   *
   * The new Function() execution gave untrusted code full access to:
   * - Database (this.context.db) - could delete/exfiltrate all data
   * - Storage (this.context.storage) - could access all files
   * - Process memory and Node.js APIs - could execute arbitrary system commands
   *
   * This has been fixed with the secure RPC bridge pattern:
   * - Code is validated in isolated-vm with static analysis
   * - Metadata is extracted and serialized (no function references passed)
   * - Factory function is evaluated in host context with Function constructor
   * - Plugin code can only call whitelisted RPC methods via message-passing
   * - All RPC methods enforce project-scoped access control
   * - No direct access to db, storage, or Node.js APIs
   */
}
