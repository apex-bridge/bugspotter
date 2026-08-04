/**
 * Password Reset Email Service
 *
 * Sends "you (or someone) requested a password reset" emails. Direct
 * SMTP send (not queued) — low volume, same pattern as
 * InvitationEmailService. Returns false on failure, never throws,
 * so the calling endpoint can keep its uniform 200 response and
 * not leak whether the email actually went out.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../../config.js';
import { getLogger } from '../../logger.js';
import { ConfigurationError } from '../../api/middleware/error.js';
import { resolveSmtpTls } from '../../utils/smtp-tls.js';

export type EmailLocale = 'en' | 'ru' | 'kk';

interface PasswordResetEmailParams {
  recipientEmail: string;
  token: string;
  expiresAt: Date;
  locale?: EmailLocale;
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const EMAIL_TRANSLATIONS: Record<
  EmailLocale,
  {
    subject: string;
    heading: string;
    body: string;
    resetButton: string;
    expiresIn: (minutes: number) => string;
    ignoreNotice: string;
    dateLocale: string;
  }
> = {
  en: {
    subject: 'Reset your BugSpotter password',
    heading: 'Reset your password',
    body: 'We received a request to reset the password for your BugSpotter account. Click the button below to choose a new one.',
    resetButton: 'Reset password',
    expiresIn: (minutes) => `This link expires in ${minutes} minutes.`,
    ignoreNotice:
      "If you didn't request a password reset, you can safely ignore this email — your password won't change.",
    dateLocale: 'en-US',
  },
  ru: {
    subject: 'Сброс пароля BugSpotter',
    heading: 'Сброс пароля',
    body: 'Мы получили запрос на сброс пароля для вашего аккаунта BugSpotter. Нажмите кнопку ниже, чтобы задать новый пароль.',
    resetButton: 'Сбросить пароль',
    expiresIn: (minutes) => `Ссылка действительна ${minutes} минут.`,
    ignoreNotice:
      'Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо — ваш пароль не изменится.',
    dateLocale: 'ru-RU',
  },
  kk: {
    subject: 'BugSpotter құпиясөзін қалпына келтіру',
    heading: 'Құпиясөзді қалпына келтіру',
    body: 'Біз сіздің BugSpotter тіркелгіңіздің құпиясөзін қалпына келтіруге сұраныс алдық. Жаңа құпиясөз орнату үшін төмендегі түймені басыңыз.',
    resetButton: 'Құпиясөзді қалпына келтіру',
    expiresIn: (minutes) => `Сілтеме ${minutes} минут жарамды.`,
    ignoreNotice:
      'Егер сіз құпиясөзді қалпына келтіруді сұрамасаңыз, бұл хатты елемей қоюыңызға болады — құпиясөзіңіз өзгермейді.',
    dateLocale: 'kk-KZ',
  },
};

export class PasswordResetEmailService {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      throw new ConfigurationError(
        'SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS env vars.',
        'PasswordResetEmailService'
      );
    }

    const tlsOptions = resolveSmtpTls(port);

    this.transporter = nodemailer.createTransport({
      host,
      port,
      ...tlsOptions,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
      },
    });

    return this.transporter;
  }

  /**
   * Send a password-reset email. Returns true on send, false otherwise.
   * Never throws — callers must keep returning a uniform 200 response
   * regardless of email-delivery outcome (anti-enumeration).
   */
  async sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<boolean> {
    const logger = getLogger();
    const locale = params.locale ?? 'en';
    const strings = EMAIL_TRANSLATIONS[locale];

    const frontendUrl = config.frontend.url;
    if (!frontendUrl) {
      logger.warn('FRONTEND_URL not configured — cannot send password-reset email');
      return false;
    }

    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(params.token)}`;
    const fromAddress = process.env.EMAIL_FROM_ADDRESS ?? 'noreply@bugspotter.io';
    // Ceil — never tell the user "expires in 0 minutes" when there
    // is still real time on the clock (under 30 seconds would round
    // down to zero, but the link is still usable).
    const minutesUntilExpiry = Math.max(
      1,
      Math.ceil((params.expiresAt.getTime() - Date.now()) / 60_000)
    );

    const html = this.buildHtml(strings, resetUrl, minutesUntilExpiry, locale);
    const text = this.buildPlainText(strings, resetUrl, minutesUntilExpiry);

    try {
      const transporter = this.getTransporter();
      const result = await transporter.sendMail({
        from: `BugSpotter <${fromAddress}>`,
        to: params.recipientEmail,
        subject: strings.subject,
        html,
        text,
      });

      logger.info('Password reset email sent', {
        messageId: result.messageId,
      });
      return true;
    } catch (error) {
      if (error instanceof ConfigurationError) {
        logger.warn('SMTP not configured — password reset email not sent', {
          component: error.component,
        });
      } else {
        logger.error('Failed to send password reset email', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return false;
    }
  }

  private buildHtml(
    strings: (typeof EMAIL_TRANSLATIONS)[EmailLocale],
    resetUrl: string,
    minutesUntilExpiry: number,
    locale: EmailLocale
  ): string {
    const safeResetUrl = escapeHtml(resetUrl);

    return `
<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="background: #f8f9fa; border-radius: 8px; padding: 32px; text-align: center;">
    <h1 style="color: #1a1a2e; margin: 0 0 8px 0; font-size: 24px;">${strings.heading}</h1>
    <p style="color: #666; margin: 0; font-size: 16px;">
      ${strings.body}
    </p>
  </div>
  <div style="text-align: center; margin: 32px 0;">
    <a href="${safeResetUrl}"
       style="background: #4f46e5; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">
      ${strings.resetButton}
    </a>
  </div>
  <p style="color: #888; font-size: 13px; text-align: center;">
    ${strings.expiresIn(minutesUntilExpiry)}<br>
    ${strings.ignoreNotice}
  </p>
</body>
</html>`.trim();
  }

  private buildPlainText(
    strings: (typeof EMAIL_TRANSLATIONS)[EmailLocale],
    resetUrl: string,
    minutesUntilExpiry: number
  ): string {
    return [
      strings.subject,
      '',
      strings.body,
      '',
      `${strings.resetButton}: ${resetUrl}`,
      '',
      strings.expiresIn(minutesUntilExpiry),
      strings.ignoreNotice,
    ].join('\n');
  }
}
