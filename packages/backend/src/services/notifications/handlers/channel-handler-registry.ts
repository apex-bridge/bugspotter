/**
 * Channel Handler Registry
 * Manages registration and retrieval of notification channel handlers
 */

import type { ChannelHandler } from '../../../types/notifications.js';
import { EmailChannelHandler } from '../email-handler.js';
import { SlackChannelHandler } from '../slack-handler.js';
import { WebhookChannelHandler } from '../webhook-handler.js';
import { DiscordChannelHandler } from '../discord-handler.js';
import { TeamsChannelHandler } from '../teams-handler.js';
import { getLogger } from '../../../logger.js';

const logger = getLogger();

export type ChannelHandlerFactory = () => ChannelHandler;

/**
 * Channel Handler Registry
 * Provides dynamic registration and factory pattern for handlers
 */
export class ChannelHandlerRegistry {
  private readonly factories: Map<string, ChannelHandlerFactory>;
  private readonly instances: Map<string, ChannelHandler>;

  constructor() {
    this.factories = new Map();
    this.instances = new Map();

    // Register default handlers
    this.registerDefaults();
  }

  /**
   * Registers default channel handlers
   */
  private registerDefaults(): void {
    this.register('email', () => new EmailChannelHandler());
    this.register('slack', () => new SlackChannelHandler());
    this.register('webhook', () => new WebhookChannelHandler());
    this.register('discord', () => new DiscordChannelHandler());
    this.register('teams', () => new TeamsChannelHandler());

    logger.info('Channel handlers registered', {
      types: this.getSupportedTypes(),
    });
  }

  /**
   * Registers a new channel handler type
   */
  register(type: string, factory: ChannelHandlerFactory): void {
    if (this.factories.has(type)) {
      logger.warn('Overwriting existing channel handler', { type });
    }

    this.factories.set(type, factory);

    // Clear cached instance if exists
    if (this.instances.has(type)) {
      this.instances.delete(type);
    }
  }

  /**
   * Gets a handler instance (singleton per type)
   */
  getHandler(type: string): ChannelHandler | undefined {
    // Return cached instance if available
    if (this.instances.has(type)) {
      return this.instances.get(type);
    }

    // Create new instance from factory
    const factory = this.factories.get(type);
    if (!factory) {
      logger.error('No handler factory found', { type });
      return undefined;
    }

    const instance = factory();
    this.instances.set(type, instance);

    return instance;
  }

  /**
   * Gets all handler instances as a Map
   */
  getAllHandlers(): Map<string, ChannelHandler> {
    const handlers = new Map<string, ChannelHandler>();

    for (const type of this.factories.keys()) {
      const handler = this.getHandler(type);
      if (handler) {
        handlers.set(type, handler);
      }
    }

    return handlers;
  }

  /**
   * Checks if a handler type is registered
   */
  hasHandler(type: string): boolean {
    return this.factories.has(type);
  }

  /**
   * Gets all supported channel types
   */
  getSupportedTypes(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * Unregisters a handler type
   */
  unregister(type: string): boolean {
    const hadFactory = this.factories.delete(type);
    this.instances.delete(type);

    if (hadFactory) {
      logger.info('Channel handler unregistered', { type });
    }

    return hadFactory;
  }

  /**
   * Clears all cached instances (forces new instances on next get)
   */
  clearCache(): void {
    this.instances.clear();
    logger.debug('Channel handler cache cleared');
  }

  /**
   * Gets the number of registered handler types
   */
  get size(): number {
    return this.factories.size;
  }
}
