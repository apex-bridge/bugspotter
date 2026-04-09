/**
 * Discord Channel Handler
 * Sends notifications to Discord via webhooks
 */

import axios from 'axios';
import type {
  ChannelHandler,
  DiscordChannelConfig,
  NotificationPayload,
  DeliveryResult,
} from '../../types/notifications.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

// ============================================================================
// CONSTANTS
// ============================================================================

const DISCORD_COLORS = {
  HIGH: 15158332, // Red
  NORMAL: 3447003, // Blue
  LOW: 10070709, // Gray
} as const;

const TIMEOUT_MS = 50000; // 50 seconds for slow networks

// ============================================================================
// HELPERS
// ============================================================================

function getPriorityColor(priority?: string): number {
  switch (priority) {
    case 'high':
      return DISCORD_COLORS.HIGH;
    case 'normal':
      return DISCORD_COLORS.NORMAL;
    case 'low':
      return DISCORD_COLORS.LOW;
    default:
      return DISCORD_COLORS.NORMAL;
  }
}

function parseOrCreatePayload(payload: NotificationPayload): Record<string, unknown> {
  try {
    return JSON.parse(payload.body) as Record<string, unknown>;
  } catch {
    return createEmbedPayload(payload);
  }
}

function createEmbedPayload(payload: NotificationPayload): Record<string, unknown> {
  const result: Record<string, unknown> = { content: payload.body };

  if (payload.subject) {
    result.embeds = [
      {
        title: payload.subject,
        description: payload.body,
        color: getPriorityColor(payload.priority),
        timestamp: new Date().toISOString(),
      },
    ];
  }

  return result;
}

function applyConfigOverrides(
  payload: Record<string, unknown>,
  config: DiscordChannelConfig
): Record<string, unknown> {
  const result = { ...payload };

  if (config.username) {
    result.username = config.username;
  }
  if (config.avatar_url) {
    result.avatar_url = config.avatar_url;
  }

  return result;
}

// ============================================================================
// PUBLIC API
// ============================================================================

export class DiscordChannelHandler implements ChannelHandler {
  readonly type = 'discord' as const;

  async send(config: DiscordChannelConfig, payload: NotificationPayload): Promise<DeliveryResult> {
    try {
      const discordPayload = applyConfigOverrides(parseOrCreatePayload(payload), config);

      const response = await axios.post(config.webhook_url, discordPayload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: TIMEOUT_MS,
      });

      logger.info('Discord message sent successfully', { status: response.status });

      return {
        success: true,
        response: {
          status: response.status,
          data: response.data,
        },
      };
    } catch (error: unknown) {
      logger.error('Failed to send Discord message', { error });

      if (axios.isAxiosError(error) && error.response) {
        return {
          success: false,
          error:
            typeof error.response.data === 'object'
              ? JSON.stringify(error.response.data)
              : error.response.data || error.message,
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
  }

  async test(config: DiscordChannelConfig, testMessage?: string): Promise<DeliveryResult> {
    const testPayload: NotificationPayload = {
      to: 'test',
      subject: '',
      body: JSON.stringify({
        content: '🧪 **BugSpotter Test Message**',
        embeds: [
          {
            title: 'Test Message from BugSpotter',
            description:
              testMessage ||
              'This is a test message to verify your Discord notification channel configuration.',
            color: DISCORD_COLORS.NORMAL,
            fields: [
              {
                name: 'Username',
                value: config.username || 'BugSpotter',
                inline: true,
              },
              {
                name: 'Status',
                value: '✅ Configuration working',
                inline: true,
              },
            ],
            timestamp: new Date().toISOString(),
            footer: {
              text: 'BugSpotter Notification System',
            },
          },
        ],
      }),
    };

    return this.send(config, testPayload);
  }
}
