/**
 * Webhook Channel Handler
 * Sends notifications via HTTP webhooks with optional HMAC-SHA256 signatures
 */

import axios, { type AxiosRequestConfig } from 'axios';
import type {
  ChannelHandler,
  WebhookChannelConfig,
  NotificationPayload,
  DeliveryResult,
} from '../../types/notifications.js';
import { getLogger } from '../../logger.js';
import { createSignatureHeaders } from '../../integrations/webhook/signature.js';

const logger = getLogger();

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 1000;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Apply authentication to axios config based on auth type
 */
function applyAuthentication(
  axiosConfig: AxiosRequestConfig,
  authType: string,
  authValue?: string
): void {
  if (!authValue) {
    return;
  }

  switch (authType) {
    case 'bearer':
      axiosConfig.headers = {
        ...axiosConfig.headers,
        Authorization: `Bearer ${authValue}`,
      };
      break;
    case 'basic': {
      const encodedAuth = Buffer.from(authValue).toString('base64');
      axiosConfig.headers = {
        ...axiosConfig.headers,
        Authorization: `Basic ${encodedAuth}`,
      };
      break;
    }
    case 'apikey':
      axiosConfig.headers = {
        ...axiosConfig.headers,
        'X-API-Key': authValue,
      };
      break;
  }
}

/**
 * Build webhook payload from notification data
 */
function buildWebhookPayload(payload: NotificationPayload): Record<string, unknown> {
  return {
    to: payload.to,
    subject: payload.subject,
    body: payload.body,
    data: payload.data,
    priority: payload.priority,
  };
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoff(attempt: number, baseBackoffMs: number): number {
  return baseBackoffMs * Math.pow(2, attempt - 1);
}

/**
 * Build success delivery result
 */
function buildSuccessResult(
  response: { status: number; headers: unknown; data: unknown },
  attempts: number
): DeliveryResult {
  return {
    success: true,
    response: {
      status: response.status,
      headers: response.headers,
      data: response.data,
    },
    attempts,
  };
}

/**
 * Build error delivery result
 */
function buildErrorResult(error: unknown, attempts: number): DeliveryResult {
  if (axios.isAxiosError(error) && error.response) {
    return {
      success: false,
      error: error.response.data || error.message,
      response: {
        status: error.response.status,
        data: error.response.data,
      },
      attempts,
    };
  }

  if (axios.isAxiosError(error)) {
    return {
      success: false,
      error: error.message,
      attempts,
    };
  }

  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
    attempts,
  };
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ============================================================================
// CHANNEL HANDLER
// ============================================================================

export class WebhookChannelHandler implements ChannelHandler {
  readonly type = 'webhook' as const;

  async send(config: WebhookChannelConfig, payload: NotificationPayload): Promise<DeliveryResult> {
    const maxAttempts = config.retry_policy?.max_attempts || DEFAULT_MAX_ATTEMPTS;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const webhookPayload = buildWebhookPayload(payload);

        // Stringify payload once for both signature and request body
        const payloadString = JSON.stringify(webhookPayload);

        const axiosConfig: AxiosRequestConfig = {
          method: config.method,
          url: config.url,
          data: payloadString,
          headers: {
            'Content-Type': 'application/json',
            ...config.headers,
          },
          timeout: config.timeout_ms || DEFAULT_TIMEOUT_MS,
        };

        // Add authentication
        applyAuthentication(axiosConfig, config.auth_type, config.auth_value);

        // Add signature headers if secret is configured
        if (config.signature_secret) {
          const signatureHeaders = createSignatureHeaders(payloadString, config.signature_secret);
          axiosConfig.headers = {
            ...axiosConfig.headers,
            ...signatureHeaders,
          };
        }

        const response = await axios(axiosConfig);

        logger.info('Webhook sent successfully', {
          url: config.url,
          status: response.status,
          attempt,
        });

        return buildSuccessResult(response, attempt);
      } catch (error: unknown) {
        lastError = error;
        logger.warn(`Webhook attempt ${attempt}/${maxAttempts} failed`, {
          url: config.url,
          error,
        });

        // Don't retry on 4xx client errors (except 408 Request Timeout, 429 Too Many Requests)
        if (axios.isAxiosError(error) && error.response) {
          const status = error.response.status;
          if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
            logger.error('Webhook failed with client error (no retry)', {
              url: config.url,
              status,
              attempt,
            });
            return buildErrorResult(error, attempt);
          }
        }

        // Wait before retry (exponential backoff)
        if (attempt < maxAttempts) {
          const backoffMs = calculateBackoff(
            attempt,
            config.retry_policy?.backoff_ms || DEFAULT_BACKOFF_MS
          );
          await sleep(backoffMs);
        }
      }
    }

    // All attempts failed
    logger.error('Webhook failed after all attempts', {
      url: config.url,
      attempts: maxAttempts,
      error: lastError,
    });

    return buildErrorResult(lastError, maxAttempts);
  }

  async test(config: WebhookChannelConfig, testMessage?: string): Promise<DeliveryResult> {
    const testPayload: NotificationPayload = {
      to: 'test@bugspotter.io',
      subject: 'BugSpotter Test Webhook',
      body:
        testMessage ||
        'This is a test webhook payload from BugSpotter to verify your webhook configuration.',
      data: {
        test: true,
        timestamp: new Date().toISOString(),
        config: {
          url: config.url,
          method: config.method,
          auth_type: config.auth_type,
        },
      },
    };

    return this.send(config, testPayload);
  }
}
