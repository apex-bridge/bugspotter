/**
 * Slack Notifier
 * Sends notifications to Slack channels via Incoming Webhooks
 */

import { getLogger } from '../../../logger.js';
import type {
  INotifier,
  NotificationContext,
  NotificationResult,
  BaseNotifierConfig,
} from './notifier-interface.js';
import { DEFAULT_NOTIFIER_CONFIG } from './notifier-interface.js';

/**
 * Slack notifier configuration
 */
export interface SlackNotifierConfig extends BaseNotifierConfig {
  type: 'slack';
  // Incoming Webhook URL
  webhookUrl?: string;
  // Or Bot Token for Web API
  botToken?: string;
  // Default channel if not specified in recipient
  defaultChannel?: string;
}

const logger = getLogger();

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: unknown[];
  fields?: Array<{
    type: string;
    text: string;
  }>;
  image_url?: string;
  alt_text?: string;
  accessory?: unknown;
}

/**
 * Build Slack Block Kit message
 * https://api.slack.com/block-kit
 */
function buildSlackBlocks(context: NotificationContext): SlackBlock[] {
  const blocks: SlackBlock[] = [
    // Header
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🐛 ${context.title}`,
        emoji: true,
      },
    },
    // Context (status and priority)
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Status:*\n${context.status}`,
        },
        ...(context.priority
          ? [
              {
                type: 'mrkdwn',
                text: `*Priority:*\n${context.priority}`,
              },
            ]
          : []),
      ],
    },
  ];

  // Description
  if (context.description) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Description:*\n${context.description.substring(0, 500)}${context.description.length > 500 ? '...' : ''}`,
      },
    });
  }

  // Screenshot preview
  if (context.screenshotUrl) {
    blocks.push({
      type: 'image',
      image_url: context.screenshotUrl,
      alt_text: 'Bug screenshot',
    });
  }

  // Action buttons
  const actions: unknown[] = [];

  if (context.replayUrl) {
    actions.push({
      type: 'button',
      text: {
        type: 'plain_text',
        text: '▶️ Watch Replay',
        emoji: true,
      },
      url: context.replayUrl,
      style: 'primary',
    });
  }

  if (context.externalUrl) {
    actions.push({
      type: 'button',
      text: {
        type: 'plain_text',
        text: '🔗 View Details',
        emoji: true,
      },
      url: context.externalUrl,
    });
  }

  if (actions.length > 0) {
    blocks.push({
      type: 'actions',
      elements: actions,
    });
  }

  // Footer with metadata
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Report ID: \`${context.bugReportId}\` | Project: \`${context.projectId}\``,
      },
    ],
  });

  return blocks;
}

/**
 * Slack Notifier Implementation
 *
 * Slack webhook URL format: https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX
 *
 * To get a webhook URL:
 * 1. Go to https://api.slack.com/apps
 * 2. Create an app or select existing
 * 3. Enable \"Incoming Webhooks\"
 * 4. Add webhook to workspace
 * 5. Copy webhook URL
 */
export class SlackNotifier implements INotifier {
  readonly type = 'slack';

  constructor(private config: SlackNotifierConfig) {}

  /**
   * Load Slack notifier configuration from environment variables
   */
  static loadConfig(): SlackNotifierConfig | null {
    const enabled = process.env.SLACK_NOTIFICATIONS_ENABLED === 'true';

    if (!enabled) {
      return null;
    }

    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    const botToken = process.env.SLACK_BOT_TOKEN;
    const defaultChannel = process.env.SLACK_DEFAULT_CHANNEL;

    if (webhookUrl) {
      return {
        type: 'slack',
        enabled: true,
        webhookUrl,
        defaultChannel,
        ...DEFAULT_NOTIFIER_CONFIG,
      };
    }

    if (botToken) {
      return {
        type: 'slack',
        enabled: true,
        botToken,
        defaultChannel,
        ...DEFAULT_NOTIFIER_CONFIG,
      };
    }

    logger.warn('Slack notifications enabled but no valid configuration found');
    return null;
  }

  validateConfig(): void {
    if (!this.config.enabled) {
      throw new Error('Slack notifier is disabled');
    }
    if (!this.config.webhookUrl && !this.config.botToken) {
      throw new Error('Slack notifier requires webhookUrl or botToken');
    }
  }

  async send(
    recipient: string,
    context: NotificationContext,
    _event: string
  ): Promise<NotificationResult> {
    try {
      // Use provided recipient (webhook URL) or fall back to config webhook
      const webhookUrl = recipient.startsWith('https://hooks.slack.com')
        ? recipient
        : this.config.webhookUrl;

      if (!webhookUrl) {
        throw new Error('No webhook URL provided');
      }

      logger.info('Sending Slack notification', {
        webhookUrl: webhookUrl.substring(0, 30) + '...',
        bugReportId: context.bugReportId,
      });

      const blocks = buildSlackBlocks(context);
      const payload = {
        text: `New bug report: ${context.title}`, // Fallback text
        blocks,
      };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Slack API error: ${response.status} ${errorText}`);
      }

      const responseText = await response.text();
      if (responseText !== 'ok') {
        throw new Error(`Slack webhook returned: ${responseText}`);
      }

      logger.debug('Slack message sent successfully', {
        bugReportId: context.bugReportId,
        blocksCount: blocks.length,
      });

      return {
        success: true,
        deliveredAt: new Date(),
        metadata: { blocksCount: blocks.length },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to send Slack notification', {
        error: errorMessage,
        bugReportId: context.bugReportId,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.config.webhookUrl) {
      return false;
    }

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'BugSpotter connection test' }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Factory function to create Slack notifier
 */
export function createSlackNotifier(config: SlackNotifierConfig): SlackNotifier {
  return new SlackNotifier(config);
}
