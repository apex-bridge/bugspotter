/**
 * Slack Channel Handler
 * Sends notifications to Slack via webhooks
 */

import axios from 'axios';
import type {
  ChannelHandler,
  SlackChannelConfig,
  NotificationPayload,
  DeliveryResult,
} from '../../types/notifications.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

// ============================================================================
// CONSTANTS
// ============================================================================

const TIMEOUT_MS = 50000; // 50 seconds for slow networks

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse payload body as JSON or return plain text wrapper
 */
function parseOrCreatePayload(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return { text: body };
  }
}

/**
 * Apply Slack configuration overrides to payload
 */
function applyConfigOverrides(payload: Record<string, unknown>, config: SlackChannelConfig): void {
  if (config.channel) {
    payload.channel = config.channel;
  }
  if (config.username) {
    payload.username = config.username;
  }
  if (config.icon_emoji) {
    payload.icon_emoji = config.icon_emoji;
  }
}

/**
 * Create test message Block Kit payload
 */
function createTestBlockPayload(config: SlackChannelConfig, customMessage?: string): string {
  return JSON.stringify({
    text: '🧪 BugSpotter Test Message',
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🧪 Test Message from BugSpotter',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            customMessage ||
            'This is a test message to verify your Slack notification channel configuration.',
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Channel:*\n${config.channel || 'Default'}`,
          },
          {
            type: 'mrkdwn',
            text: `*Username:*\n${config.username || 'BugSpotter'}`,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'If you see this message, your configuration is working correctly! ✅',
          },
        ],
      },
    ],
  });
}

/**
 * Build success delivery result from axios response
 */
function buildSuccessResult(response: { status: number; data: unknown }): DeliveryResult {
  return {
    success: true,
    response: {
      status: response.status,
      data: response.data,
    },
  };
}

/**
 * Build error delivery result from caught error
 */
function buildErrorResult(error: unknown): DeliveryResult {
  if (axios.isAxiosError(error) && error.response) {
    return {
      success: false,
      error: error.response.data || error.message,
      response: {
        status: error.response.status,
        data: error.response.data,
      },
    };
  }

  if (axios.isAxiosError(error)) {
    return {
      success: false,
      error: error.message,
    };
  }

  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  };
}

// ============================================================================
// CHANNEL HANDLER
// ============================================================================

export class SlackChannelHandler implements ChannelHandler {
  readonly type = 'slack' as const;

  async send(config: SlackChannelConfig, payload: NotificationPayload): Promise<DeliveryResult> {
    try {
      // Parse and prepare payload
      const slackPayload = parseOrCreatePayload(payload.body);
      applyConfigOverrides(slackPayload, config);

      const response = await axios.post(config.webhook_url, slackPayload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: TIMEOUT_MS,
      });

      logger.info('Slack message sent successfully', {
        channel: config.channel,
        status: response.status,
      });

      return buildSuccessResult(response);
    } catch (error) {
      logger.error('Failed to send Slack message', { error });
      return buildErrorResult(error);
    }
  }

  async test(config: SlackChannelConfig, testMessage?: string): Promise<DeliveryResult> {
    const testPayload: NotificationPayload = {
      to: config.channel || 'test',
      subject: '',
      body: createTestBlockPayload(config, testMessage),
    };

    return this.send(config, testPayload);
  }
}
