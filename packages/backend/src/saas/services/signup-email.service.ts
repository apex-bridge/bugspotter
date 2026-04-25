/**
 * Signup Email Service
 *
 * Sends the post-signup verification email for the self-service flow.
 * Mirrors `OrgRequestEmailService` (SMTP via nodemailer, locale-aware,
 * never throws — returns boolean success).
 *
 * Distinct service rather than methods on `OrgRequestEmailService`
 * because the copy and verification URL differ (`/verify-email` vs
 * `/verify-request`) and the surface is owned by a different flow.
 * Sharing the SMTP transporter is fine — both services read the same
 * SMTP_* env vars.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../../config.js';
import { getLogger } from '../../logger.js';
import { ConfigurationError } from '../../api/middleware/error.js';

export type EmailLocale = 'en' | 'ru' | 'kk';

const logger = getLogger();

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// LOCALE STRINGS
// ============================================================================

interface VerificationStrings {
  subject: string;
  heading: string;
  body: (name: string) => string;
  button: string;
  expiryNotice: string;
  ignoreNotice: string;
}

const VERIFICATION_STRINGS: Record<EmailLocale, VerificationStrings> = {
  en: {
    subject: 'Verify your email — BugSpotter',
    heading: 'Welcome to BugSpotter',
    body: (name) =>
      `Hi ${name}, please confirm your email address so we can finish setting up your account. You can keep using BugSpotter while this is pending — verifying just dismisses the banner.`,
    button: 'Verify Email',
    expiryNotice: 'This link expires in 24 hours.',
    ignoreNotice: "If you didn't sign up for BugSpotter, you can safely ignore this email.",
  },
  ru: {
    subject: 'Подтвердите email — BugSpotter',
    heading: 'Добро пожаловать в BugSpotter',
    body: (name) =>
      `Здравствуйте, ${name}! Подтвердите, пожалуйста, ваш email, чтобы мы завершили настройку аккаунта. Вы можете продолжать пользоваться BugSpotter — подтверждение просто убирает баннер.`,
    button: 'Подтвердить email',
    expiryNotice: 'Ссылка действительна 24 часа.',
    ignoreNotice: 'Если вы не регистрировались в BugSpotter, просто проигнорируйте это письмо.',
  },
  kk: {
    subject: 'Email-ді растаңыз — BugSpotter',
    heading: 'BugSpotter-ге қош келдіңіз',
    body: (name) =>
      `Сәлеметсіз бе, ${name}! Аккаунтыңызды баптауды аяқтау үшін email-ді растаңыз. Сіз BugSpotter-ді пайдалануды жалғастыра аласыз — растау тек баннерді жояды.`,
    button: 'Email-ді растау',
    expiryNotice: 'Сілтеме 24 сағат бойы жарамды.',
    ignoreNotice: 'Егер сіз BugSpotter-ге тіркелмеген болсаңыз, бұл хатты елемей қойсаңыз болады.',
  },
};

// ============================================================================
// SERVICE
// ============================================================================

export interface SendVerificationEmailParams {
  recipientEmail: string;
  contactName: string;
  token: string;
  locale?: EmailLocale;
}

export class SignupEmailService {
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
        'SignupEmailService'
      );
    }

    const useSecure = port === 465;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: useSecure,
      requireTLS: port === 587,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
      },
    });

    return this.transporter;
  }

  private getFromAddress(): string {
    return process.env.EMAIL_FROM_ADDRESS ?? 'noreply@bugspotter.io';
  }

  /**
   * Send the post-signup email-verification email to the user.
   *
   * Returns false (and logs) instead of throwing on any failure — the
   * signup flow is non-blocking, so a transient SMTP issue must not
   * roll back the user's API key. They can hit /auth/resend-verification
   * later if the email never arrives.
   */
  async sendVerificationEmail(params: SendVerificationEmailParams): Promise<boolean> {
    // Defend the "never throws" contract: an unknown locale slipping
    // through (e.g. via an untyped caller or a future header-driven
    // path) would otherwise hit `VERIFICATION_STRINGS[locale]` as
    // undefined and crash. Fall back to English. Use a strict
    // own-property check — `in` would return true for inherited keys
    // like 'toString' and silently produce a broken `strings` object.
    const requested = params.locale ?? 'en';
    const locale: EmailLocale = Object.prototype.hasOwnProperty.call(
      VERIFICATION_STRINGS,
      requested
    )
      ? requested
      : 'en';
    const strings = VERIFICATION_STRINGS[locale];
    const frontendUrl = config.frontend.url;

    if (!frontendUrl) {
      logger.warn('FRONTEND_URL not configured — signup verification email not sent', {
        email: params.recipientEmail,
      });
      return false;
    }

    // Strip trailing slash on `frontendUrl` so a config of
    // `https://app.bugspotter.io/` doesn't produce
    // `https://app.bugspotter.io//verify-email` — some routers and
    // CDNs collapse the double slash, others 404.
    const baseUrl = frontendUrl.endsWith('/') ? frontendUrl.slice(0, -1) : frontendUrl;
    const verifyUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(params.token)}`;
    const safeName = escapeHtml(params.contactName);
    const safeUrl = escapeHtml(verifyUrl);

    const html = `
<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="background: #f8f9fa; border-radius: 8px; padding: 32px; text-align: center;">
    <h1 style="color: #1a1a2e; margin: 0 0 8px 0; font-size: 24px;">${strings.heading}</h1>
    <p style="color: #666; margin: 0; font-size: 16px;">${strings.body(safeName)}</p>
  </div>
  <div style="text-align: center; margin: 32px 0;">
    <a href="${safeUrl}" style="background: #4f46e5; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">
      ${strings.button}
    </a>
  </div>
  <p style="color: #888; font-size: 13px; text-align: center;">
    ${strings.expiryNotice}<br>${strings.ignoreNotice}
  </p>
</body>
</html>`.trim();

    const text = [
      strings.heading,
      '',
      strings.body(params.contactName),
      '',
      `${strings.button}: ${verifyUrl}`,
      '',
      strings.expiryNotice,
    ].join('\n');

    return this.send(params.recipientEmail, strings.subject, html, text);
  }

  private async send(to: string, subject: string, html: string, text: string): Promise<boolean> {
    try {
      const transporter = this.getTransporter();
      const result = await transporter.sendMail({
        from: `BugSpotter <${this.getFromAddress()}>`,
        to,
        subject,
        html,
        text,
      });

      logger.info('Signup verification email sent', {
        to,
        subject,
        messageId: result.messageId,
      });
      return true;
    } catch (error) {
      if (error instanceof ConfigurationError) {
        logger.warn('SMTP not configured — signup verification email not sent', { to });
      } else {
        logger.error('Failed to send signup verification email', {
          to,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return false;
    }
  }
}
