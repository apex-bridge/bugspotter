/**
 * Organization Request Email Service
 * Sends verification, admin notification, approval, and rejection emails.
 * Follows the same pattern as InvitationEmailService (SMTP, locale-aware).
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

const VERIFICATION_STRINGS: Record<
  EmailLocale,
  {
    subject: string;
    heading: string;
    body: (name: string) => string;
    button: string;
    expiryNotice: string;
    ignoreNotice: string;
  }
> = {
  en: {
    subject: 'Verify your email — BugSpotter organization request',
    heading: 'Verify your email',
    body: (name) => `Hi ${name}, please verify your email to complete your organization request.`,
    button: 'Verify Email',
    expiryNotice: 'This link expires in 24 hours.',
    ignoreNotice: "If you didn't request this, you can safely ignore this email.",
  },
  ru: {
    subject: 'Подтвердите email — заявка на организацию BugSpotter',
    heading: 'Подтвердите email',
    body: (name) =>
      `Здравствуйте, ${name}! Пожалуйста, подтвердите email для завершения заявки на создание организации.`,
    button: 'Подтвердить email',
    expiryNotice: 'Ссылка действительна 24 часа.',
    ignoreNotice: 'Если вы не подавали заявку, просто проигнорируйте это письмо.',
  },
  kk: {
    subject: 'Email-ді растаңыз — BugSpotter ұйым сұрауы',
    heading: 'Email-ді растаңыз',
    body: (name) => `Сәлеметсіз бе, ${name}! Ұйым сұрауыңызды аяқтау үшін email-ді растаңыз.`,
    button: 'Email-ді растау',
    expiryNotice: 'Сілтеме 24 сағат бойы жарамды.',
    ignoreNotice: 'Егер сіз сұрау жібермеген болсаңыз, бұл хатты елемей қоюыңызға болады.',
  },
};

const APPROVAL_STRINGS: Record<
  EmailLocale,
  {
    subject: (company: string) => string;
    heading: string;
    body: (company: string) => string;
    button: string;
  }
> = {
  en: {
    subject: (company) => `Your organization "${company}" has been created — BugSpotter`,
    heading: 'Request approved!',
    body: (company) =>
      `Great news! Your organization "${company}" has been approved and created on BugSpotter. You should receive an invitation email shortly to set up your account.`,
    button: 'Go to BugSpotter',
  },
  ru: {
    subject: (company) => `Ваша организация "${company}" создана — BugSpotter`,
    heading: 'Заявка одобрена!',
    body: (company) =>
      `Отличные новости! Ваша организация "${company}" одобрена и создана на BugSpotter. Вскоре вы получите приглашение для настройки аккаунта.`,
    button: 'Перейти в BugSpotter',
  },
  kk: {
    subject: (company) => `Сіздің "${company}" ұйымыңыз жасалды — BugSpotter`,
    heading: 'Сұрау мақұлданды!',
    body: (company) =>
      `Жақсы жаңалық! Сіздің "${company}" ұйымыңыз мақұлданды және BugSpotter-де жасалды. Тіркелгіңізді баптау үшін шақыру хатын жақын арада аласыз.`,
    button: 'BugSpotter-ге өту',
  },
};

const REJECTION_STRINGS: Record<
  EmailLocale,
  {
    subject: (company: string) => string;
    heading: string;
    body: (company: string) => string;
    reasonLabel: string;
  }
> = {
  en: {
    subject: (company) => `Update on your request for "${company}" — BugSpotter`,
    heading: 'Request update',
    body: (company) =>
      `We've reviewed your request for the organization "${company}" and unfortunately we are unable to approve it at this time.`,
    reasonLabel: 'Reason:',
  },
  ru: {
    subject: (company) => `Обновление по заявке на "${company}" — BugSpotter`,
    heading: 'Обновление заявки',
    body: (company) =>
      `Мы рассмотрели вашу заявку на организацию "${company}" и, к сожалению, не можем одобрить её в данный момент.`,
    reasonLabel: 'Причина:',
  },
  kk: {
    subject: (company) => `"${company}" сұрауы бойынша жаңарту — BugSpotter`,
    heading: 'Сұрау жаңартуы',
    body: (company) =>
      `Біз сіздің "${company}" ұйымына сұрауыңызды қарадық және, өкінішке орай, қазіргі уақытта оны мақұлдай алмаймыз.`,
    reasonLabel: 'Себебі:',
  },
};

const ADMIN_NOTIFICATION_STRINGS: Record<
  EmailLocale,
  {
    subject: (company: string) => string;
    heading: string;
    body: string;
    companyLabel: string;
    contactLabel: string;
    emailLabel: string;
    subdomainLabel: string;
    regionLabel: string;
    messageLabel: string;
    button: string;
  }
> = {
  en: {
    subject: (company) => `New organization request: ${company}`,
    heading: 'New organization request',
    body: 'A new organization request has been verified and is awaiting review.',
    companyLabel: 'Company:',
    contactLabel: 'Contact:',
    emailLabel: 'Email:',
    subdomainLabel: 'Subdomain:',
    regionLabel: 'Region:',
    messageLabel: 'Message:',
    button: 'Review in Admin Panel',
  },
  ru: {
    subject: (company) => `Новая заявка на организацию: ${company}`,
    heading: 'Новая заявка на организацию',
    body: 'Новая заявка на организацию подтверждена и ожидает рассмотрения.',
    companyLabel: 'Компания:',
    contactLabel: 'Контакт:',
    emailLabel: 'Email:',
    subdomainLabel: 'Субдомен:',
    regionLabel: 'Регион:',
    messageLabel: 'Сообщение:',
    button: 'Рассмотреть в панели администратора',
  },
  kk: {
    subject: (company) => `Жаңа ұйым сұрауы: ${company}`,
    heading: 'Жаңа ұйым сұрауы',
    body: 'Жаңа ұйым сұрауы расталды және қарауды күтуде.',
    companyLabel: 'Компания:',
    contactLabel: 'Байланыс:',
    emailLabel: 'Email:',
    subdomainLabel: 'Субдомен:',
    regionLabel: 'Аймақ:',
    messageLabel: 'Хабарлама:',
    button: 'Әкімші панелінде қарау',
  },
};

// ============================================================================
// SERVICE
// ============================================================================

interface VerificationEmailParams {
  recipientEmail: string;
  contactName: string;
  companyName: string;
  token: string;
  locale?: EmailLocale;
}

interface AdminNotificationParams {
  companyName: string;
  contactName: string;
  contactEmail: string;
  subdomain: string;
  message: string | null;
  dataResidencyRegion: string;
  locale?: EmailLocale;
}

interface ApprovalEmailParams {
  recipientEmail: string;
  contactName: string;
  companyName: string;
  subdomain: string;
  locale?: EmailLocale;
}

interface RejectionEmailParams {
  recipientEmail: string;
  contactName: string;
  companyName: string;
  rejectionReason: string;
  locale?: EmailLocale;
}

export class OrgRequestEmailService {
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
        'OrgRequestEmailService'
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
   * Send verification email to requester
   */
  async sendVerificationEmail(params: VerificationEmailParams): Promise<boolean> {
    const locale = params.locale ?? 'en';
    const strings = VERIFICATION_STRINGS[locale];
    const frontendUrl = config.frontend.url;

    if (!frontendUrl) {
      logger.warn('FRONTEND_URL not configured — verification email not sent', {
        email: params.recipientEmail,
      });
      return false;
    }

    const verifyUrl = `${frontendUrl}/verify-request?token=${params.token}`;
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

  /**
   * Send notification to admin(s) about a new verified request
   */
  async sendAdminNotification(params: AdminNotificationParams): Promise<boolean> {
    const locale = params.locale ?? 'en';
    const strings = ADMIN_NOTIFICATION_STRINGS[locale];
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;

    if (!adminEmail) {
      logger.warn('ADMIN_NOTIFICATION_EMAIL not configured — admin notification not sent', {
        company: params.companyName,
      });
      return false;
    }

    const frontendUrl = config.frontend.url;
    const adminUrl = frontendUrl ? `${frontendUrl}/organization-requests` : '#';

    const safeCompany = escapeHtml(params.companyName);
    const safeContact = escapeHtml(params.contactName);
    const safeEmail = escapeHtml(params.contactEmail);
    const safeSubdomain = escapeHtml(params.subdomain);
    const safeMessage = params.message ? escapeHtml(params.message) : '—';
    const safeRegion = escapeHtml(params.dataResidencyRegion);

    const html = `
<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="background: #f8f9fa; border-radius: 8px; padding: 32px;">
    <h1 style="color: #1a1a2e; margin: 0 0 16px 0; font-size: 24px;">${strings.heading}</h1>
    <p style="color: #666; margin: 0 0 16px 0; font-size: 16px;">${strings.body}</p>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr><td style="padding: 6px 0; color: #888;">${strings.companyLabel}</td><td style="padding: 6px 0;"><strong>${safeCompany}</strong></td></tr>
      <tr><td style="padding: 6px 0; color: #888;">${strings.contactLabel}</td><td style="padding: 6px 0;">${safeContact}</td></tr>
      <tr><td style="padding: 6px 0; color: #888;">${strings.emailLabel}</td><td style="padding: 6px 0;">${safeEmail}</td></tr>
      <tr><td style="padding: 6px 0; color: #888;">${strings.subdomainLabel}</td><td style="padding: 6px 0;">${safeSubdomain}</td></tr>
      <tr><td style="padding: 6px 0; color: #888;">${strings.regionLabel}</td><td style="padding: 6px 0;">${safeRegion}</td></tr>
      <tr><td style="padding: 6px 0; color: #888;">${strings.messageLabel}</td><td style="padding: 6px 0;">${safeMessage}</td></tr>
    </table>
  </div>
  <div style="text-align: center; margin: 32px 0;">
    <a href="${escapeHtml(adminUrl)}" style="background: #4f46e5; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">
      ${strings.button}
    </a>
  </div>
</body>
</html>`.trim();

    const text = [
      strings.heading,
      '',
      strings.body,
      '',
      `${strings.companyLabel} ${params.companyName}`,
      `${strings.contactLabel} ${params.contactName}`,
      `${strings.emailLabel} ${params.contactEmail}`,
      `${strings.subdomainLabel} ${params.subdomain}`,
      `${strings.regionLabel} ${params.dataResidencyRegion}`,
      `${strings.messageLabel} ${params.message ?? '—'}`,
      '',
      `${strings.button}: ${adminUrl}`,
    ].join('\n');

    return this.send(adminEmail, strings.subject(params.companyName), html, text);
  }

  /**
   * Send approval email to requester
   */
  async sendApprovalEmail(params: ApprovalEmailParams): Promise<boolean> {
    const locale = params.locale ?? 'en';
    const strings = APPROVAL_STRINGS[locale];
    const frontendUrl = config.frontend.url;
    const url = frontendUrl || 'https://bugspotter.io';

    const safeCompany = escapeHtml(params.companyName);

    const html = `
<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="background: #f0fdf4; border-radius: 8px; padding: 32px; text-align: center;">
    <h1 style="color: #166534; margin: 0 0 8px 0; font-size: 24px;">${strings.heading}</h1>
    <p style="color: #666; margin: 0; font-size: 16px;">${strings.body(safeCompany)}</p>
  </div>
  <div style="text-align: center; margin: 32px 0;">
    <a href="${escapeHtml(url)}" style="background: #16a34a; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">
      ${strings.button}
    </a>
  </div>
</body>
</html>`.trim();

    const text = [
      strings.heading,
      '',
      strings.body(params.companyName),
      '',
      `${strings.button}: ${url}`,
    ].join('\n');

    return this.send(params.recipientEmail, strings.subject(params.companyName), html, text);
  }

  /**
   * Send rejection email to requester
   */
  async sendRejectionEmail(params: RejectionEmailParams): Promise<boolean> {
    const locale = params.locale ?? 'en';
    const strings = REJECTION_STRINGS[locale];

    const safeCompany = escapeHtml(params.companyName);
    const safeReason = escapeHtml(params.rejectionReason);

    const html = `
<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="background: #f8f9fa; border-radius: 8px; padding: 32px; text-align: center;">
    <h1 style="color: #1a1a2e; margin: 0 0 8px 0; font-size: 24px;">${strings.heading}</h1>
    <p style="color: #666; margin: 0 0 16px 0; font-size: 16px;">${strings.body(safeCompany)}</p>
    <p style="color: #444; margin: 0; font-size: 14px;"><strong>${strings.reasonLabel}</strong> ${safeReason}</p>
  </div>
</body>
</html>`.trim();

    const text = [
      strings.heading,
      '',
      strings.body(params.companyName),
      '',
      `${strings.reasonLabel} ${params.rejectionReason}`,
    ].join('\n');

    return this.send(params.recipientEmail, strings.subject(params.companyName), html, text);
  }

  /**
   * Send an email. Returns true on success, false on failure (never throws).
   */
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

      logger.info('Organization request email sent', {
        to,
        subject,
        messageId: result.messageId,
      });
      return true;
    } catch (error) {
      if (error instanceof ConfigurationError) {
        logger.warn('SMTP not configured — email not sent', { to, subject });
      } else {
        logger.error('Failed to send organization request email', {
          to,
          subject,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return false;
    }
  }
}
