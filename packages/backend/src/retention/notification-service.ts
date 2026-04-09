/**
 * Notification Service
 * Strategy pattern for sending retention job notifications
 * Uses the queue-based notifier system for actual delivery
 */

import { getLogger } from '../logger.js';
import type { RetentionResult } from './types.js';
import { EmailNotifier } from '../queue/workers/notifications/email-notifier.js';
import { SlackNotifier } from '../queue/workers/notifications/slack-notifier.js';

const logger = getLogger();

/**
 * Notification payload for retention job completion
 */
export interface RetentionNotification extends Record<string, unknown> {
  projectsProcessed: number;
  totalDeleted: number;
  totalArchived: number;
  storageFreed: string;
  errors: number;
  duration: string;
}

/**
 * Base notification service (Strategy pattern)
 * Defines the interface for sending notifications about retention jobs
 */
export abstract class BaseNotificationService {
  /**
   * Send notification when retention job completes successfully
   */
  abstract sendCompletionNotification(result: RetentionResult, duration: number): Promise<void>;

  /**
   * Send notification when retention job fails
   */
  abstract sendErrorNotification(error: unknown): Promise<void>;

  /**
   * Format bytes to human-readable string
   */
  protected formatBytes(bytes: number): string {
    if (bytes === 0) {
      return '0 Bytes';
    }

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Format duration to human-readable string
   */
  protected formatDuration(milliseconds: number): string {
    return `${(milliseconds / 1000).toFixed(2)}s`;
  }

  /**
   * Build notification payload from retention result
   */
  protected buildNotificationPayload(
    result: RetentionResult,
    duration: number
  ): RetentionNotification {
    return {
      projectsProcessed: result.projectsProcessed,
      totalDeleted: result.totalDeleted,
      totalArchived: result.totalArchived,
      storageFreed: this.formatBytes(result.storageFreed),
      errors: result.errors.length,
      duration: this.formatDuration(duration),
    };
  }
}

/**
 * Logger-based notification service (default implementation)
 * Logs notifications to application logger
 */
export class LoggerNotificationService extends BaseNotificationService {
  async sendCompletionNotification(result: RetentionResult, duration: number): Promise<void> {
    const payload = this.buildNotificationPayload(result, duration);

    logger.info('Retention job summary', payload as Record<string, unknown>);
  }

  async sendErrorNotification(error: unknown): Promise<void> {
    logger.error('Retention job error notification', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Email notification service
 * Sends retention job notifications via email using EmailNotifier
 */
export class EmailNotificationService extends BaseNotificationService {
  private emailNotifier: EmailNotifier | null = null;

  constructor(private recipientEmails: string[]) {
    super();

    // Load email notifier configuration
    const config = EmailNotifier.loadConfig();
    if (config) {
      this.emailNotifier = new EmailNotifier(config);
    } else {
      logger.warn('Email notifier not configured, notifications will be logged only');
    }
  }

  async sendCompletionNotification(result: RetentionResult, duration: number): Promise<void> {
    const payload = this.buildNotificationPayload(result, duration);

    if (!this.emailNotifier) {
      logger.info('Email notifier unavailable, logging completion notification', {
        recipients: this.recipientEmails,
        ...payload,
      });
      return;
    }

    // Send email to each recipient
    for (const recipient of this.recipientEmails) {
      const context = {
        bugReportId: 'retention-job',
        projectId: 'system',
        title: 'Data Retention Job Completed',
        description: this.formatCompletionMessage(payload),
        status: result.errors.length > 0 ? 'completed-with-errors' : 'completed',
        priority: result.errors.length > 0 ? 'high' : 'low',
        metadata: payload,
      };

      const result_email = await this.emailNotifier.send(recipient, context, 'retention_completed');

      if (!result_email.success) {
        logger.error('Failed to send retention completion email', {
          recipient,
          error: result_email.error,
        });
      }
    }
  }

  async sendErrorNotification(error: unknown): Promise<void> {
    if (!this.emailNotifier) {
      logger.error('Email notifier unavailable, logging error notification', {
        recipients: this.recipientEmails,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // Send error alert to each recipient
    for (const recipient of this.recipientEmails) {
      const context = {
        bugReportId: 'retention-job-error',
        projectId: 'system',
        title: '⚠️ Data Retention Job Failed',
        description: `The scheduled data retention job encountered an error:\n\n${error instanceof Error ? error.message : String(error)}`,
        status: 'failed',
        priority: 'critical',
        metadata: {},
      };

      const result_email = await this.emailNotifier.send(recipient, context, 'retention_error');

      if (!result_email.success) {
        logger.error('Failed to send retention error email', {
          recipient,
          error: result_email.error,
        });
      }
    }
  }

  private formatCompletionMessage(payload: RetentionNotification): string {
    return `
Data Retention Job Summary:

📊 Statistics:
- Projects Processed: ${payload.projectsProcessed}
- Bug Reports Deleted: ${payload.totalDeleted}
- Bug Reports Archived: ${payload.totalArchived}
- Storage Freed: ${payload.storageFreed}
- Errors: ${payload.errors}
- Duration: ${payload.duration}

${payload.errors > 0 ? '⚠️ Some errors occurred during processing. Check logs for details.' : '✅ All operations completed successfully.'}
    `.trim();
  }
}

/**
 * Slack notification service
 * Sends retention job notifications to Slack channel using SlackNotifier
 */
export class SlackNotificationService extends BaseNotificationService {
  private slackNotifier: SlackNotifier | null = null;

  constructor(private channel: string) {
    super();

    // Load Slack notifier configuration
    const config = SlackNotifier.loadConfig();
    if (config) {
      this.slackNotifier = new SlackNotifier(config);
    } else {
      logger.warn('Slack notifier not configured, notifications will be logged only');
    }
  }

  async sendCompletionNotification(result: RetentionResult, duration: number): Promise<void> {
    const payload = this.buildNotificationPayload(result, duration);

    if (!this.slackNotifier) {
      logger.info('Slack notifier unavailable, logging completion notification', {
        channel: this.channel,
        ...payload,
      });
      return;
    }

    const context = {
      bugReportId: 'retention-job',
      projectId: 'system',
      title: '🗑️ Data Retention Job Completed',
      description: this.formatCompletionMessage(payload),
      status: result.errors.length > 0 ? 'completed-with-errors' : 'completed',
      priority: result.errors.length > 0 ? 'high' : 'low',
      metadata: payload,
    };

    const result_slack = await this.slackNotifier.send(
      this.channel,
      context,
      'retention_completed'
    );

    if (!result_slack.success) {
      logger.error('Failed to send retention completion to Slack', {
        channel: this.channel,
        error: result_slack.error,
      });
    }
  }

  async sendErrorNotification(error: unknown): Promise<void> {
    if (!this.slackNotifier) {
      logger.error('Slack notifier unavailable, logging error notification', {
        channel: this.channel,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const context = {
      bugReportId: 'retention-job-error',
      projectId: 'system',
      title: '⚠️ Data Retention Job Failed',
      description: `The scheduled data retention job encountered an error:\n\n\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\``,
      status: 'failed',
      priority: 'critical',
      metadata: {},
    };

    const result_slack = await this.slackNotifier.send(this.channel, context, 'retention_error');

    if (!result_slack.success) {
      logger.error('Failed to send retention error to Slack', {
        channel: this.channel,
        error: result_slack.error,
      });
    }
  }

  private formatCompletionMessage(payload: RetentionNotification): string {
    return `
📊 *Statistics:*
• Projects Processed: ${payload.projectsProcessed}
• Bug Reports Deleted: ${payload.totalDeleted}
• Bug Reports Archived: ${payload.totalArchived}
• Storage Freed: ${payload.storageFreed}
• Errors: ${payload.errors}
• Duration: ${payload.duration}

${payload.errors > 0 ? '⚠️ Some errors occurred during processing.' : '✅ All operations completed successfully.'}
    `.trim();
  }
}

/**
 * Factory function to create notification service based on configuration
 * Loads configuration from environment variables
 */
export function createNotificationService(
  type: 'logger' | 'email' | 'slack' = 'logger'
): BaseNotificationService {
  switch (type) {
    case 'email': {
      // Load recipient emails from environment
      const recipients = process.env.RETENTION_NOTIFICATION_EMAILS?.split(',').map((e) =>
        e.trim()
      ) || ['admin@example.com'];
      return new EmailNotificationService(recipients);
    }
    case 'slack': {
      // Load Slack channel from environment
      const channel = process.env.RETENTION_NOTIFICATION_SLACK_CHANNEL || '#retention-alerts';
      return new SlackNotificationService(channel);
    }
    case 'logger':
    default:
      return new LoggerNotificationService();
  }
}
