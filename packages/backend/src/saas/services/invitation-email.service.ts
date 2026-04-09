/**
 * Invitation Email Service
 * Sends invitation emails using SMTP (direct send, not queue-based).
 * Low-volume operation — no need for job queue overhead.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../../config.js';
import { getLogger } from '../../logger.js';
import { ConfigurationError } from '../../api/middleware/error.js';

export type EmailLocale = 'en' | 'ru' | 'kk';

interface InvitationEmailParams {
  recipientEmail: string;
  organizationName: string;
  inviterEmail: string;
  inviterName: string | null;
  role: string;
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

/** Locale-aware email strings (HTML-agnostic — callers handle markup) */
const EMAIL_TRANSLATIONS: Record<
  EmailLocale,
  {
    subject: (orgName: string) => string;
    heading: string;
    rolePhrase: (role: string) => string;
    body: (inviter: string, orgName: string, rolePhrase: string) => string;
    acceptButton: string;
    expiresOn: (date: string) => string;
    ignoreNotice: string;
    dateLocale: string;
  }
> = {
  en: {
    subject: (org) => `You've been invited to join ${org} on BugSpotter`,
    heading: "You're invited!",
    rolePhrase: (role) =>
      role === 'owner' ? 'the owner' : role === 'admin' ? 'an admin' : 'a member',
    body: (inviter, org, rolePhrase) =>
      `${inviter} has invited you to join ${org} as ${rolePhrase}.`,
    acceptButton: 'Accept Invitation',
    expiresOn: (date) => `This invitation expires on ${date}.`,
    ignoreNotice: "If you didn't expect this email, you can safely ignore it.",
    dateLocale: 'en-US',
  },
  ru: {
    subject: (org) => `Вас пригласили в организацию ${org} на BugSpotter`,
    heading: 'Вас пригласили!',
    rolePhrase: (role) =>
      role === 'owner' ? 'владельца' : role === 'admin' ? 'администратора' : 'участника',
    body: (inviter, org, rolePhrase) => `${inviter} приглашает вас в ${org} в роли ${rolePhrase}.`,
    acceptButton: 'Принять приглашение',
    expiresOn: (date) => `Срок действия приглашения истекает ${date}.`,
    ignoreNotice: 'Если вы не ожидали это письмо, просто проигнорируйте его.',
    dateLocale: 'ru-RU',
  },
  kk: {
    subject: (org) => `Сізді BugSpotter-де ${org} ұйымына шақырды`,
    heading: 'Сізді шақырды!',
    rolePhrase: (role) => (role === 'owner' ? 'иесі' : role === 'admin' ? 'әкімші' : 'мүше'),
    body: (inviter, org, rolePhrase) =>
      `${inviter} сізді ${org} ұйымына ${rolePhrase} ретінде шақырды.`,
    acceptButton: 'Шақыруды қабылдау',
    expiresOn: (date) => `Шақырудың мерзімі ${date} күні аяқталады.`,
    ignoreNotice: 'Егер сіз бұл хатты күтпесеңіз, оны елемей қоюыңызға болады.',
    dateLocale: 'kk-KZ',
  },
};

export class InvitationEmailService {
  private transporter: Transporter | null = null;

  /**
   * Test SMTP connectivity at startup. Logs result but never throws.
   */
  async verifyConnection(): Promise<boolean> {
    const logger = getLogger();

    try {
      const transporter = this.getTransporter();
      await transporter.verify();
      logger.info('SMTP connection verified', {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ?? '587',
      });
      return true;
    } catch (error) {
      if (error instanceof ConfigurationError) {
        logger.warn('SMTP not configured — invitation emails will not be sent');
      } else {
        logger.error('SMTP connection failed — invitation emails will not work', {
          host: process.env.SMTP_HOST,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return false;
    } finally {
      this.transporter?.close();
      this.transporter = null;
    }
  }

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
        'InvitationEmailService'
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

  /**
   * Convenience method: maps invitation record + org name + inviter to email params.
   * Avoids duplicating field mapping in every route handler.
   */
  async sendForInvitation(params: {
    organizationName: string;
    invitation: { email: string; role: string; token: string; expires_at: Date };
    inviter: { email: string; name: string | null };
    locale?: EmailLocale;
  }): Promise<boolean> {
    return this.sendInvitationEmail({
      recipientEmail: params.invitation.email,
      organizationName: params.organizationName,
      inviterEmail: params.inviter.email,
      inviterName: params.inviter.name,
      role: params.invitation.role,
      token: params.invitation.token,
      expiresAt: params.invitation.expires_at,
      locale: params.locale,
    });
  }

  /**
   * Send an invitation email.
   * Returns true if sent successfully, false otherwise (never throws).
   */
  async sendInvitationEmail(params: InvitationEmailParams): Promise<boolean> {
    const logger = getLogger();
    const locale = params.locale ?? 'en';
    const strings = EMAIL_TRANSLATIONS[locale];

    const frontendUrl = config.frontend.url;
    if (!frontendUrl) {
      logger.warn('FRONTEND_URL not configured — cannot send invitation email', {
        email: params.recipientEmail,
        organizationName: params.organizationName,
      });
      return false;
    }

    const acceptUrl = `${frontendUrl}/invitations/accept?token=${params.token}`;
    const inviterDisplay = params.inviterName ?? params.inviterEmail;
    const fromAddress = process.env.EMAIL_FROM_ADDRESS ?? 'noreply@bugspotter.io';

    const subject = strings.subject(params.organizationName);
    const html = this.buildHtml(params, acceptUrl, inviterDisplay, locale);
    const text = this.buildPlainText(params, acceptUrl, inviterDisplay, locale);

    try {
      const transporter = this.getTransporter();
      const result = await transporter.sendMail({
        from: `BugSpotter <${fromAddress}>`,
        to: params.recipientEmail,
        subject,
        html,
        text,
      });

      logger.info('Invitation email sent', {
        email: params.recipientEmail,
        organizationName: params.organizationName,
        messageId: result.messageId,
      });
      return true;
    } catch (error) {
      if (error instanceof ConfigurationError) {
        logger.warn('SMTP not configured — invitation email not sent', {
          email: params.recipientEmail,
          organizationName: params.organizationName,
          component: error.component,
        });
      } else {
        logger.error('Failed to send invitation email', {
          email: params.recipientEmail,
          organizationName: params.organizationName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return false;
    }
  }

  private buildHtml(
    params: InvitationEmailParams,
    acceptUrl: string,
    inviterDisplay: string,
    locale: EmailLocale
  ): string {
    const strings = EMAIL_TRANSLATIONS[locale];
    const expiryDate = new Date(params.expiresAt).toLocaleDateString(strings.dateLocale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const safeInviter = escapeHtml(inviterDisplay);
    const safeOrgName = escapeHtml(params.organizationName);
    const safeRolePhrase = escapeHtml(strings.rolePhrase(params.role));
    const safeAcceptUrl = escapeHtml(acceptUrl);

    const bodyHtml = strings.body(
      `<strong>${safeInviter}</strong>`,
      `<strong>${safeOrgName}</strong>`,
      `<strong>${safeRolePhrase}</strong>`
    );

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
      ${bodyHtml}
    </p>
  </div>
  <div style="text-align: center; margin: 32px 0;">
    <a href="${safeAcceptUrl}"
       style="background: #4f46e5; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">
      ${strings.acceptButton}
    </a>
  </div>
  <p style="color: #888; font-size: 13px; text-align: center;">
    ${strings.expiresOn(expiryDate)}<br>
    ${strings.ignoreNotice}
  </p>
</body>
</html>`.trim();
  }

  private buildPlainText(
    params: InvitationEmailParams,
    acceptUrl: string,
    inviterDisplay: string,
    locale: EmailLocale
  ): string {
    const strings = EMAIL_TRANSLATIONS[locale];
    const expiryDate = new Date(params.expiresAt).toLocaleDateString(strings.dateLocale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const rolePhrase = strings.rolePhrase(params.role);

    return [
      strings.subject(params.organizationName),
      '',
      strings.body(inviterDisplay, params.organizationName, rolePhrase),
      '',
      `${strings.acceptButton}: ${acceptUrl}`,
      '',
      strings.expiresOn(expiryDate),
    ].join('\n');
  }
}
