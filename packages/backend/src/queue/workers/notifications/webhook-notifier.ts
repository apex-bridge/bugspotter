/**
 * Webhook Notifier
 * Sends HTTP POST notifications to webhook URLs with optional HMAC-SHA256 signatures
 */

import { getLogger } from '../../../logger.js';
import type {
  INotifier,
  NotificationContext,
  NotificationResult,
  BaseNotifierConfig,
} from './notifier-interface.js';
import { DEFAULT_NOTIFIER_CONFIG } from './notifier-interface.js';
import { createSignatureHeaders } from '../../../integrations/webhook/signature.js';

/**
 * Webhook notifier configuration
 */
export interface WebhookNotifierConfig extends BaseNotifierConfig {
  type: 'webhook';
  // Custom headers for all webhook requests
  headers?: Record<string, string>;
  // Signature verification
  signatureHeader?: string;
  signatureSecret?: string;
}

const logger = getLogger();

interface WebhookPayload {
  event: string;
  bugReport: {
    id: string;
    projectId: string;
    title: string;
    description: string;
    status: string;
    priority?: string;
    screenshotUrl?: string;
    replayUrl?: string;
    externalUrl?: string;
  };
  timestamp: string;
}

/**
 * Webhook Notifier Implementation
 */
export class WebhookNotifier implements INotifier {
  readonly type = 'webhook';

  constructor(private config: WebhookNotifierConfig) {}

  /**
   * Load webhook notifier configuration from environment variables
   */
  static loadConfig(): WebhookNotifierConfig | null {
    const enabled = process.env.WEBHOOK_NOTIFICATIONS_ENABLED === 'true';

    if (!enabled) {
      return null;
    }

    const customHeaders: Record<string, string> = {};

    // Load custom headers from environment (WEBHOOK_HEADER_<NAME>=<VALUE>)
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('WEBHOOK_HEADER_')) {
        const headerName = key.replace('WEBHOOK_HEADER_', '').toLowerCase();
        const headerValue = process.env[key];
        if (headerValue) {
          customHeaders[headerName] = headerValue;
        }
      }
    });

    const signatureSecret = process.env.WEBHOOK_SIGNATURE_SECRET;

    return {
      type: 'webhook',
      enabled: true,
      headers: Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
      signatureSecret,
      signatureHeader: 'x-bugspotter-signature',
      ...DEFAULT_NOTIFIER_CONFIG,
    };
  }

  validateConfig(): void {
    if (!this.config.enabled) {
      throw new Error('Webhook notifier is disabled');
    }
  }

  async send(
    recipient: string,
    context: NotificationContext,
    event: string
  ): Promise<NotificationResult> {
    try {
      const payload: WebhookPayload = {
        event,
        bugReport: {
          id: context.bugReportId,
          projectId: context.projectId,
          title: context.title,
          description: context.description,
          status: context.status,
          priority: context.priority,
          screenshotUrl: context.screenshotUrl,
          replayUrl: context.replayUrl,
          externalUrl: context.externalUrl,
        },
        timestamp: new Date().toISOString(),
      };

      logger.info('Sending webhook notification', {
        url: recipient,
        event,
        bugReportId: context.bugReportId,
      });

      await this.sendWithRetry(recipient, payload, 1);

      return {
        success: true,
        deliveredAt: new Date(),
        metadata: { url: recipient, event },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Webhook notification failed', {
        url: recipient,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async testConnection(): Promise<boolean> {
    // Webhook URLs can't be tested without actually sending
    return true;
  }

  private async sendWithRetry(
    url: string,
    payload: WebhookPayload,
    attempt: number
  ): Promise<void> {
    const timeout = this.config.timeoutMs || DEFAULT_NOTIFIER_CONFIG.timeoutMs!;
    const maxRetries = this.config.retryAttempts || DEFAULT_NOTIFIER_CONFIG.retryAttempts!;
    const retryDelay = this.config.retryDelayMs || DEFAULT_NOTIFIER_CONFIG.retryDelayMs!;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Stringify payload once for both signature and body
      const payloadString = JSON.stringify(payload);

      // Build headers with optional signature
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'BugSpotter-Webhook/1.0',
        ...this.config.headers,
      };

      // Add signature headers if secret is configured
      if (this.config.signatureSecret) {
        const signatureHeaders = createSignatureHeaders(payloadString, this.config.signatureSecret);
        Object.assign(headers, signatureHeaders);
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: payloadString,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      logger.debug('Webhook delivered successfully', {
        url,
        attempt,
        status: response.status,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (attempt < maxRetries) {
        logger.warn('Webhook delivery failed, retrying', {
          url,
          attempt,
          error: errorMessage,
          nextAttempt: attempt + 1,
        });

        await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt));
        return this.sendWithRetry(url, payload, attempt + 1);
      }

      throw new Error(`Webhook delivery failed after ${attempt} attempts: ${errorMessage}`);
    }
  }
}

/**
 * Factory function to create webhook notifier
 */
export function createWebhookNotifier(config: WebhookNotifierConfig): WebhookNotifier {
  return new WebhookNotifier(config);
}
