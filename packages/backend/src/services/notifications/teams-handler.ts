/**
 * Microsoft Teams Channel Handler
 * Sends notifications to Teams via webhooks with Adaptive Cards
 */

import axios from 'axios';
import type {
  ChannelHandler,
  TeamsChannelConfig,
  NotificationPayload,
  DeliveryResult,
} from '../../types/notifications.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

// ============================================================================
// CONSTANTS
// ============================================================================

const TIMEOUT_MS = 10000;

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'DC143C', // Red
  high: 'FFA500', // Orange
  medium: 'FFD700', // Yellow
  low: '4169E1', // Blue
  info: '808080', // Gray
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse payload body as JSON or create simple MessageCard
 */
function parseOrCreateMessageCard(body: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    // Map priority names to actual color codes
    if (parsed.themeColor && typeof parsed.themeColor === 'string') {
      const colorMap = PRIORITY_COLORS as Record<string, string>;
      if (colorMap[parsed.themeColor]) {
        parsed.themeColor = colorMap[parsed.themeColor];
      }
    }
    return parsed;
  } catch {
    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      text: body,
    };
  }
}

/**
 * Create test MessageCard payload
 */
function createTestMessageCard(customMessage?: string): string {
  return JSON.stringify({
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: 'Test message from BugSpotter',
    themeColor: PRIORITY_COLORS.info,
    title: '🧪 Test Message from BugSpotter',
    sections: [
      {
        activityTitle: 'Notification Channel Test',
        activitySubtitle: 'Configuration Verification',
        facts: [
          {
            name: 'Channel Type:',
            value: 'Microsoft Teams',
          },
          {
            name: 'Status:',
            value: '✅ Configuration working',
          },
          {
            name: 'Timestamp:',
            value: new Date().toISOString(),
          },
        ],
        text:
          customMessage ||
          'If you see this message, your Teams notification channel is configured correctly.',
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

export class TeamsChannelHandler implements ChannelHandler {
  readonly type = 'teams' as const;

  async send(config: TeamsChannelConfig, payload: NotificationPayload): Promise<DeliveryResult> {
    try {
      // Parse or create MessageCard payload
      const teamsPayload = parseOrCreateMessageCard(payload.body);

      const response = await axios.post(config.webhook_url, teamsPayload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: TIMEOUT_MS,
      });

      logger.info('Teams message sent successfully', {
        status: response.status,
      });

      return buildSuccessResult(response);
    } catch (error: unknown) {
      logger.error('Failed to send Teams message', { error });
      return buildErrorResult(error);
    }
  }

  async test(config: TeamsChannelConfig, testMessage?: string): Promise<DeliveryResult> {
    const testPayload: NotificationPayload = {
      to: 'test',
      subject: 'BugSpotter Test Message',
      body: createTestMessageCard(testMessage),
    };

    return this.send(config, testPayload);
  }
}
