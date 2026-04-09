/**
 * Notification Delivery Service
 * Handles actual delivery to channels with retry logic
 */

import { NotificationJob } from '../models/notification-job.js';
import { NotificationContext } from '../models/notification-context.js';
import { DeliveryResult } from '../models/delivery-result.js';
import type {
  ChannelHandler,
  NotificationPayload,
  ChannelConfig,
} from '../../../types/notifications.js';
import { renderTemplate } from '../template-renderer.js';
import { getLogger } from '../../../logger.js';

const logger = getLogger();

export interface DeliveryOptions {
  maxRetries?: number;
  retryDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<DeliveryOptions> = {
  maxRetries: 3,
  retryDelayMs: 1000,
};

/**
 * Notification Delivery Service
 * Single responsibility: deliver notifications to channels
 */
export class NotificationDeliveryService {
  private readonly options: Required<DeliveryOptions>;

  constructor(
    private readonly handlers: Map<string, ChannelHandler>,
    options: DeliveryOptions = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Delivers a notification job to its target channel
   */
  async deliver(job: NotificationJob, context: NotificationContext): Promise<DeliveryResult> {
    const handler = this.handlers.get(job.channelType);

    if (!handler) {
      logger.error('No handler found for channel type', {
        channelType: job.channelType,
        channelId: job.channelId,
      });

      return DeliveryResult.failure(
        job.channelId,
        job.triggerId,
        job.projectId,
        job.bugId,
        `No handler found for channel type: ${job.channelType}`,
        false // Not retryable - handler doesn't exist
      );
    }

    // Render template with context
    let renderedPayload;
    try {
      renderedPayload = renderTemplate(job.template, context.toTemplateData());
    } catch (error) {
      logger.error('Template rendering failed', {
        templateId: job.templateId,
        error,
      });

      return DeliveryResult.failure(
        job.channelId,
        job.triggerId,
        job.projectId,
        job.bugId,
        error instanceof Error ? error : 'Template rendering failed',
        false // Not retryable - template is broken
      );
    }

    // Attempt delivery with retries
    return await this.deliverWithRetry(job, handler, renderedPayload, 0);
  }

  /**
   * Delivers with exponential backoff retry logic
   */
  private async deliverWithRetry(
    job: NotificationJob,
    handler: ChannelHandler,
    payload: NotificationPayload,
    attempt: number
  ): Promise<DeliveryResult> {
    try {
      await handler.send(job.channel.config, payload);

      logger.info('Notification delivered successfully', {
        channelId: job.channelId,
        channelType: job.channelType,
        projectId: job.projectId,
        bugId: job.bugId,
        attempt: attempt + 1,
      });

      return DeliveryResult.success(
        job.channelId,
        job.triggerId,
        job.projectId,
        job.bugId,
        'Notification delivered successfully',
        { attempts: attempt + 1 }
      );
    } catch (error) {
      const isLastAttempt = attempt >= this.options.maxRetries - 1;

      logger.error('Notification delivery failed', {
        channelId: job.channelId,
        channelType: job.channelType,
        projectId: job.projectId,
        bugId: job.bugId,
        attempt: attempt + 1,
        maxRetries: this.options.maxRetries,
        error,
      });

      // If not last attempt, retry with exponential backoff
      if (!isLastAttempt) {
        const delay = this.options.retryDelayMs * Math.pow(2, attempt);
        await this.sleep(delay);
        return this.deliverWithRetry(job, handler, payload, attempt + 1);
      }

      // Last attempt failed
      return DeliveryResult.failure(
        job.channelId,
        job.triggerId,
        job.projectId,
        job.bugId,
        error instanceof Error ? error : 'Delivery failed',
        false, // Not retryable - max retries exhausted
        {
          attempts: attempt + 1,
          maxRetriesExhausted: true,
        }
      );
    }
  }

  /**
   * Tests a channel configuration
   */
  async testChannel(
    channelType: string,
    channel: { id: string; config: ChannelConfig },
    _testMessage: string
  ): Promise<DeliveryResult> {
    const handler = this.handlers.get(channelType);

    if (!handler) {
      return DeliveryResult.failure(
        channel.id,
        'test',
        'test',
        'test',
        `No handler found for channel type: ${channelType}`,
        false
      );
    }

    try {
      await handler.test(channel.config);

      return DeliveryResult.success(
        channel.id,
        'test',
        'test',
        'test',
        'Test notification sent successfully'
      );
    } catch (error) {
      return DeliveryResult.failure(
        channel.id,
        'test',
        'test',
        'test',
        error instanceof Error ? error : 'Test delivery failed',
        false
      );
    }
  }

  /**
   * Gets the handler for a channel type
   */
  getHandler(channelType: string): ChannelHandler | undefined {
    return this.handlers.get(channelType);
  }

  /**
   * Lists all registered channel types
   */
  getRegisteredChannelTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
