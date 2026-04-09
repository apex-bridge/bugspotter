/**
 * Email Channel Handler
 * Sends notifications via SMTP email
 */

import nodemailer, { type Transporter } from 'nodemailer';
import type {
  ChannelHandler,
  EmailChannelConfig,
  NotificationPayload,
  DeliveryResult,
} from '../../types/notifications.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create SMTP transporter from config
 */
function createTransporter(config: EmailChannelConfig): Transporter {
  // Port 465 uses direct SSL (secure: true)
  // Port 587 uses STARTTLS (secure: false, but still encrypted)
  // See: https://nodemailer.com/smtp/#tls-options
  const useSecure = config.smtp_secure && config.smtp_port === 465;
  const requireTls = config.smtp_port === 587 || !useSecure;

  return nodemailer.createTransport({
    host: config.smtp_host,
    port: config.smtp_port,
    secure: useSecure, // true for 465, false for other ports
    requireTLS: requireTls, // true for 587 to force STARTTLS
    auth: {
      user: config.smtp_user,
      pass: config.smtp_pass,
    },
    tls: {
      rejectUnauthorized: config.tls_reject_unauthorized ?? true,
    },
  });
}

/**
 * Strip HTML tags from string for plain text version
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>.*?<\/style>/gis, '')
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build test email HTML template
 */
function buildTestEmailHtml(config: EmailChannelConfig, customMessage?: string): string {
  return `
    <html>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Test Email from BugSpotter</h2>
        <p>${customMessage || 'This is a test email to verify your email notification channel configuration.'}</p>
        <p><strong>Configuration:</strong></p>
        <ul>
          <li>SMTP Host: ${config.smtp_host}</li>
          <li>SMTP Port: ${config.smtp_port}</li>
          <li>SMTP Secure: ${config.smtp_secure ? 'Yes' : 'No'}</li>
          <li>From: ${config.from_name} &lt;${config.from_address}&gt;</li>
        </ul>
        <p>If you received this email, your configuration is working correctly.</p>
      </body>
    </html>
  `;
}

/**
 * Build success delivery result
 */
function buildSuccessResult(info: {
  messageId: string;
  accepted: unknown[];
  rejected: unknown[];
  response: string;
}): DeliveryResult {
  return {
    success: true,
    message_id: info.messageId,
    response: {
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    },
  };
}

/**
 * Build error delivery result
 */
function buildErrorResult(error: unknown): DeliveryResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  };
}

// ============================================================================
// CHANNEL HANDLER
// ============================================================================

export class EmailChannelHandler implements ChannelHandler {
  readonly type = 'email' as const;

  async send(config: EmailChannelConfig, payload: NotificationPayload): Promise<DeliveryResult> {
    try {
      const transporter = createTransporter(config);

      const mailOptions = {
        from: `${config.from_name} <${config.from_address}>`,
        to: Array.isArray(payload.to) ? payload.to.join(', ') : payload.to,
        subject: payload.subject || 'Notification',
        html: payload.body,
        text: stripHtml(payload.body),
      };

      const info = await transporter.sendMail(mailOptions);

      logger.info('Email sent successfully', {
        messageId: info.messageId,
        recipients: mailOptions.to,
      });

      return buildSuccessResult(info);
    } catch (error) {
      logger.error('Failed to send email', { error });
      return buildErrorResult(error);
    }
  }

  async test(config: EmailChannelConfig, testMessage?: string): Promise<DeliveryResult> {
    const testPayload: NotificationPayload = {
      to: config.from_address, // Send to self for testing
      subject: 'BugSpotter Test Email',
      body: buildTestEmailHtml(config, testMessage),
    };

    return this.send(config, testPayload);
  }
}
