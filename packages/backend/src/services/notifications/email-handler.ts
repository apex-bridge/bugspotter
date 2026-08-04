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
import { resolveSmtpTls } from '../../utils/smtp-tls.js';

const logger = getLogger();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create SMTP transporter from config
 */
function createTransporter(config: EmailChannelConfig): Transporter {
  // Port -> transport security lives in resolveSmtpTls so the six places that
  // build a transporter cannot drift. smtp_secure stays an operator override:
  // it can force implicit TLS off for a channel, but never on for a port that
  // does not speak it.
  //
  // The channel config is stored as unvalidated JSON, so smtp_secure can be
  // absent on a persisted record even though the type marks it required. Fall
  // back to the port's own policy rather than to `undefined`, which would
  // otherwise open a plaintext connection against a TLS-only listener.
  const portTls = resolveSmtpTls(config.smtp_port);
  const useSecure = (config.smtp_secure ?? portTls.secure) && portTls.secure;
  const requireTls = portTls.requireTLS || !useSecure;

  return nodemailer.createTransport({
    host: config.smtp_host,
    port: config.smtp_port,
    secure: useSecure, // implicit TLS: 465 and 2465
    requireTLS: requireTls, // force STARTTLS: 25, 587, 2525, 2587 and unknown ports
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
 * Strip HTML tags from string for the multipart `text/plain` alternative.
 *
 * `<br>` and block-level closers (`</p>`, `</div>`, `</li>`, `</h1..6>`) are
 * converted to `\n` before the catch-all strip so text-only clients see the
 * document's line / paragraph structure. Without this, a body whose HTML
 * uses `<br>` to separate lines collapses into one run-on paragraph in plain
 * text (HTML clients render fine because they read the `html:` part).
 *
 * Horizontal whitespace runs collapse to one space; newline runs collapse to
 * at most a blank line so paragraph breaks survive without unbounded vertical
 * gaps.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>.*?<\/style>/gis, '')
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
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
