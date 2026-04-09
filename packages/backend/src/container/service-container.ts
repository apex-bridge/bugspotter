/**
 * Service Container (Dependency Injection)
 *
 * Provides centralized service management with lazy initialization.
 * Improves testability by allowing service mocking and provides
 * better lifecycle management for services.
 */

import type { DatabaseClient } from '../db/client.js';
import type { IStorageService } from '../storage/types.js';
import type { PluginRegistry } from '../integrations/plugin-registry.js';
import type { QueueManager } from '../queue/queue-manager.js';
import type { RetentionService } from '../retention/retention-service.js';
import type { RetentionScheduler } from '../retention/retention-scheduler.js';
import { NotificationService } from '../services/notifications/notification-service.js';
import { OrganizationService } from '../saas/services/organization.service.js';
import { getLogger } from '../logger.js';

/**
 * Service Container Interface
 * Defines all available services in the container
 */
export interface IServiceContainer {
  // Core infrastructure
  readonly db: DatabaseClient;
  readonly storage: IStorageService;
  readonly pluginRegistry: PluginRegistry;

  // Optional services (lazy-loaded)
  readonly queueManager?: QueueManager;
  readonly retentionService?: RetentionService;
  readonly retentionScheduler?: RetentionScheduler;

  // Business services (lazy-loaded)
  getNotificationService(): NotificationService | undefined;
  getOrganizationService(): OrganizationService;

  // Lifecycle management
  isInitialized(): boolean;
  dispose(): Promise<void>;
}

/**
 * Service Container Configuration
 */
export interface ServiceContainerConfig {
  db: DatabaseClient;
  storage: IStorageService;
  pluginRegistry: PluginRegistry;
  queueManager?: QueueManager;
  retentionService?: RetentionService;
  retentionScheduler?: RetentionScheduler;
}

/**
 * Service Container Implementation
 * Manages service lifecycle with lazy initialization
 */
export class ServiceContainer implements IServiceContainer {
  // Core services (always available)
  public readonly db: DatabaseClient;
  public readonly storage: IStorageService;
  public readonly pluginRegistry: PluginRegistry;

  // Optional infrastructure services
  public readonly queueManager?: QueueManager;
  public readonly retentionService?: RetentionService;
  public readonly retentionScheduler?: RetentionScheduler;

  // Lazy-loaded business services
  private _notificationService?: NotificationService;
  private _organizationService?: OrganizationService;
  private _initialized = false;
  private _disposed = false;

  constructor(config: ServiceContainerConfig) {
    this.db = config.db;
    this.storage = config.storage;
    this.pluginRegistry = config.pluginRegistry;
    this.queueManager = config.queueManager;
    this.retentionService = config.retentionService;
    this.retentionScheduler = config.retentionScheduler;
    this._initialized = true;

    getLogger().debug('ServiceContainer initialized');
  }

  /**
   * Get notification service (lazy-loaded)
   * Only created if queueManager is available
   */
  getNotificationService(): NotificationService | undefined {
    if (!this.queueManager) {
      return undefined;
    }

    if (!this._notificationService) {
      this._notificationService = new NotificationService(this.db, null, this.queueManager);
      getLogger().debug('NotificationService lazy-loaded');
    }

    return this._notificationService;
  }

  /**
   * Get organization service (lazy-loaded)
   */
  getOrganizationService(): OrganizationService {
    if (!this._organizationService) {
      this._organizationService = new OrganizationService(this.db);
      getLogger().debug('OrganizationService lazy-loaded');
    }

    return this._organizationService;
  }

  /**
   * Check if container is initialized
   */
  isInitialized(): boolean {
    return this._initialized && !this._disposed;
  }

  /**
   * Dispose of all services and cleanup resources
   */
  async dispose(): Promise<void> {
    if (this._disposed) {
      return;
    }

    const logger = getLogger();
    logger.info('Disposing ServiceContainer...');

    try {
      // Shutdown queue manager
      if (this.queueManager) {
        await this.queueManager.shutdown();
        logger.debug('QueueManager shutdown complete');
      }

      // Stop retention scheduler
      if (this.retentionScheduler) {
        await this.retentionScheduler.stop();
        logger.debug('RetentionScheduler stopped');
      }

      // Close database connections
      await this.db.close();
      logger.debug('Database connections closed');

      this._disposed = true;
      logger.info('ServiceContainer disposed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error disposing ServiceContainer: ${errorMessage}`);
      throw error;
    }
  }
}

/**
 * Factory function to create a service container
 */
export function createServiceContainer(config: ServiceContainerConfig): IServiceContainer {
  return new ServiceContainer(config);
}
