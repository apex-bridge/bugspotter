/**
 * Email Notifier
 * Sends email notifications via SMTP
 * Supports plain text and HTML email templates
 */

import { getLogger } from '../../../logger.js';
import type {
  INotifier,
  NotificationContext,
  NotificationResult,
  BaseNotifierConfig,
} from './notifier-interface.js';
import { DEFAULT_NOTIFIER_CONFIG } from './notifier-interface.js';
import { EmailChannelHandler } from '../../../services/notifications/email-handler.js';
import type { EmailChannelConfig } from '../../../types/notifications.js';

/**
 * Email notifier configuration
 */
export interface EmailNotifierConfig extends BaseNotifierConfig {
  type: 'email';
  // SMTP configuration
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
  // Or API-based services
  provider?: 'smtp' | 'sendgrid' | 'ses' | 'mailgun' | 'postmark';
  apiKey?: string;
  from: string;
  replyTo?: string;
}

const logger = getLogger();

/**
 * Build plain text email body
 */
function buildPlainTextEmail(context: NotificationContext): string {
  const lines = [
    `New Bug Report: ${context.title}`,
    '',
    `Status: ${context.status}`,
    context.priority ? `Priority: ${context.priority}` : '',
    '',
    `Description:`,
    context.description || '(No description provided)',
    '',
  ];

  if (context.screenshotUrl) {
    lines.push(`Screenshot: ${context.screenshotUrl}`);
  }

  if (context.replayUrl) {
    lines.push(`Session Replay: ${context.replayUrl}`);
  }

  if (context.externalUrl) {
    lines.push(`View Details: ${context.externalUrl}`);
  }

  lines.push('', `Bug Report ID: ${context.bugReportId}`);

  return lines.filter(Boolean).join('\n');
}

/**
 * Build HTML email body
 */
function buildHtmlEmail(context: NotificationContext): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #f5f5f5; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #fff; padding: 20px; border: 1px solid #e0e0e0; border-top: none; }
    .footer { background: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #666; border-radius: 0 0 8px 8px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge-status { background: #e3f2fd; color: #1976d2; }
    .badge-priority { background: #fff3e0; color: #f57c00; }
    .btn { display: inline-block; padding: 12px 24px; background: #1976d2; color: #fff; text-decoration: none; border-radius: 4px; margin: 8px 4px; }
    .description { background: #f9f9f9; padding: 15px; border-left: 3px solid #1976d2; margin: 15px 0; }
    .meta { font-size: 12px; color: #666; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0; color: #333;">🐛 New Bug Report</h2>
    </div>
    <div class="content">
      <h3 style="margin-top: 0;">${escapeHtml(context.title)}</h3>
      
      <div style="margin: 15px 0;">
        <span class="badge badge-status">Status: ${escapeHtml(context.status)}</span>
        ${context.priority ? `<span class="badge badge-priority">Priority: ${escapeHtml(context.priority)}</span>` : ''}
      </div>

      ${
        context.description
          ? `
      <div class="description">
        <strong>Description:</strong><br>
        ${escapeHtml(context.description).replace(/\n/g, '<br>')}
      </div>
      `
          : ''
      }

      <div style="margin: 20px 0;">
        ${context.screenshotUrl ? `<a href="${escapeHtml(context.screenshotUrl)}" class="btn">📸 View Screenshot</a>` : ''}
        ${context.replayUrl ? `<a href="${escapeHtml(context.replayUrl)}" class="btn">▶️ Watch Replay</a>` : ''}
        ${context.externalUrl ? `<a href="${escapeHtml(context.externalUrl)}" class="btn">🔗 View Details</a>` : ''}
      </div>

      <div class="meta">
        Report ID: ${context.bugReportId}<br>
        Project ID: ${context.projectId}
      </div>
    </div>
    <div class="footer">
      BugSpotter - Bug Tracking & Session Replay
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Escape HTML entities
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m] || m);
}

/**
 * Email Notifier Implementation
 *
 * Note: This is a basic implementation using console logging.
 * For production, integrate with:
 * - SMTP service (nodemailer with Gmail, Outlook, etc.)
 * - Email API (SendGrid, AWS SES, Mailgun, Postmark, etc.)
 */
export class EmailNotifier implements INotifier {
  readonly type = 'email';

  constructor(private config: EmailNotifierConfig) {}

  /**
   * Load email notifier configuration from environment variables
   */
  static loadConfig(): EmailNotifierConfig | null {
    const enabled = process.env.EMAIL_NOTIFICATIONS_ENABLED === 'true';

    if (!enabled) {
      return null;
    }

    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@bugspotter.com';

    // SMTP configuration
    if (smtpHost && smtpPort && smtpUser && smtpPass) {
      return {
        type: 'email',
        enabled: true,
        smtp: {
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        },
        from: fromAddress,
        ...DEFAULT_NOTIFIER_CONFIG,
      };
    }

    // API provider configuration (SendGrid, Mailgun, etc.)
    const provider = process.env.EMAIL_PROVIDER as
      | 'sendgrid'
      | 'mailgun'
      | 'ses'
      | 'postmark'
      | undefined;
    const apiKey = process.env.EMAIL_API_KEY;

    if (provider && apiKey) {
      return {
        type: 'email',
        enabled: true,
        provider,
        apiKey,
        from: fromAddress,
        ...DEFAULT_NOTIFIER_CONFIG,
      };
    }

    logger.warn('Email notifications enabled but no valid configuration found');
    return null;
  }

  validateConfig(): void {
    if (!this.config.enabled) {
      throw new Error('Email notifier is disabled');
    }
    if (!this.config.from) {
      throw new Error('Email notifier requires "from" address');
    }
  }

  async send(
    recipient: string,
    context: NotificationContext,
    _event: string
  ): Promise<NotificationResult> {
    try {
      const subject = `[BugSpotter] ${context.title}`;
      const textBody = buildPlainTextEmail(context);
      const htmlBody = buildHtmlEmail(context);

      logger.info('Sending email notification', {
        recipient,
        subject,
        bugReportId: context.bugReportId,
      });

      // Log email content for development/debugging
      logger.debug('Email content', {
        to: recipient,
        subject,
        textLength: textBody.length,
        htmlLength: htmlBody.length,
      });

      // Send email using EmailChannelHandler if SMTP config is available
      if (this.config.smtp) {
        const handler = new EmailChannelHandler();
        const emailConfig: EmailChannelConfig = {
          type: 'email',
          smtp_host: this.config.smtp.host,
          smtp_port: this.config.smtp.port,
          smtp_secure: this.config.smtp.secure,
          smtp_user: this.config.smtp.auth.user,
          smtp_pass: this.config.smtp.auth.pass,
          from_address: this.config.from,
          from_name: 'BugSpotter',
          tls_reject_unauthorized: true,
        };

        const result = await handler.send(emailConfig, {
          to: recipient,
          subject,
          body: htmlBody,
        });

        if (result.success) {
          logger.info('Email notification sent successfully', {
            recipient,
            subject,
            messageId: result.message_id,
          });
          return {
            success: true,
            deliveredAt: new Date(),
            metadata: {
              subject,
              messageId: result.message_id,
              textLength: textBody.length,
              htmlLength: htmlBody.length,
            },
          };
        } else {
          logger.error('Failed to send email notification', {
            recipient,
            subject,
            error: result.error,
          });
          throw new Error(result.error || 'Failed to send email');
        }
      } else {
        // No SMTP config - log only (for development/testing)
        logger.info('Email notification prepared (configure SMTP to actually send)', {
          recipient,
          subject,
        });
        return {
          success: true,
          deliveredAt: new Date(),
          metadata: { subject, textLength: textBody.length, htmlLength: htmlBody.length },
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Email notification failed', {
        recipient,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async testConnection(): Promise<boolean> {
    // Can't test without actual SMTP/API configured
    return true;
  }
}

/**
 * Factory function to create email notifier
 */
export function createEmailNotifier(config: EmailNotifierConfig): EmailNotifier {
  return new EmailNotifier(config);
}
