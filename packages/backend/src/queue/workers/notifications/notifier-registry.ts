/**
 * Notifier Registry
 * Central registry for managing notification providers
 * Implements Factory Pattern + Registry Pattern
 */

import type { INotifier } from './notifier-interface.js';
import { EmailNotifier, createEmailNotifier, type EmailNotifierConfig } from './email-notifier.js';
import { SlackNotifier, createSlackNotifier, type SlackNotifierConfig } from './slack-notifier.js';
import {
  WebhookNotifier,
  createWebhookNotifier,
  type WebhookNotifierConfig,
} from './webhook-notifier.js';
import { getLogger } from '../../../logger.js';

/**
 * Union type of all notifier configurations
 */
export type NotifierConfig = EmailNotifierConfig | SlackNotifierConfig | WebhookNotifierConfig;

const logger = getLogger();

/**
 * Notifier Registry - manages all notification providers
 */
export class NotifierRegistry {
  private notifiers = new Map<string, INotifier>();

  /**
   * Register a notifier with configuration
   */
  register(config: NotifierConfig): void {
    if (!config.enabled) {
      logger.debug(`Notifier ${config.type} is disabled, skipping registration`);
      return;
    }

    try {
      const notifier = this.createNotifier(config);
      notifier.validateConfig();

      this.notifiers.set(config.type, notifier);
      logger.info(`Registered ${config.type} notifier`);
    } catch (error) {
      logger.error(`Failed to register ${config.type} notifier`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Register multiple notifiers at once
   */
  registerMultiple(configs: NotifierConfig[]): void {
    for (const config of configs) {
      this.register(config);
    }
  }

  /**
   * Get notifier by type
   */
  get(type: string): INotifier | undefined {
    return this.notifiers.get(type);
  }

  /**
   * Check if notifier type is registered
   */
  has(type: string): boolean {
    return this.notifiers.has(type);
  }

  /**
   * Get all registered notifier types
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.notifiers.keys());
  }

  /**
   * Unregister a notifier
   */
  unregister(type: string): void {
    this.notifiers.delete(type);
    logger.info(`Unregistered ${type} notifier`);
  }

  /**
   * Clear all notifiers
   */
  clear(): void {
    this.notifiers.clear();
    logger.info('Cleared all notifiers');
  }

  /**
   * Create notifier instance from configuration
   */
  private createNotifier(config: NotifierConfig): INotifier {
    switch (config.type) {
      case 'email':
        return createEmailNotifier(config);
      case 'slack':
        return createSlackNotifier(config);
      case 'webhook':
        return createWebhookNotifier(config);
      default: {
        // Type guard to ensure exhaustive check
        const _exhaustive: never = config;
        throw new Error(`Unknown notifier type: ${(_exhaustive as NotifierConfig).type}`);
      }
    }
  }
}

/**
 * Load all notifier configurations from environment
 */
export function loadAllNotifierConfigs(): NotifierConfig[] {
  const configs: NotifierConfig[] = [];

  // Load each notifier configuration
  const loaders = [
    { name: 'email', loader: EmailNotifier.loadConfig },
    { name: 'slack', loader: SlackNotifier.loadConfig },
    { name: 'webhook', loader: WebhookNotifier.loadConfig },
  ];

  for (const { name, loader } of loaders) {
    try {
      const config = loader();
      if (config) {
        configs.push(config);
        logger.info(`Loaded ${name} notifier configuration`);
      }
    } catch (error) {
      logger.error(`Failed to load ${name} notifier configuration`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (configs.length === 0) {
    logger.warn('No notification providers configured');
  } else {
    logger.info(`Loaded ${configs.length} notification provider(s)`);
  }

  return configs;
}

/**
 * Create and configure notifier registry
 */
export function createNotifierRegistry(configs: NotifierConfig[]): NotifierRegistry {
  const registry = new NotifierRegistry();
  registry.registerMultiple(configs);
  return registry;
}

/**
 * Create notifier registry with auto-loaded configurations
 */
export function createNotifierRegistryFromEnv(): NotifierRegistry {
  const configs = loadAllNotifierConfigs();
  return createNotifierRegistry(configs);
}
