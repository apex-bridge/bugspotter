/**
 * Invitation Email Service Tests
 * Unit tests for email rendering (i18n, escaping, responsive), SMTP config, and error handling.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import nodemailer from 'nodemailer';
import { InvitationEmailService } from '../../src/saas/services/invitation-email.service.js';

vi.mock('nodemailer');

// Stub config.frontend.url
vi.mock('../../src/config.js', () => ({
  config: {
    frontend: { url: 'https://app.bugspotter.io' },
  },
}));

// Stub logger
vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const BASE_PARAMS = {
  recipientEmail: 'invitee@example.com',
  organizationName: 'Acme Corp',
  inviterEmail: 'admin@acme.com',
  inviterName: 'Jane Admin',
  role: 'member' as const,
  token: 'abc123def456',
  expiresAt: new Date('2026-03-01T00:00:00Z'),
};

function setupSmtpEnv() {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_USER = 'user';
  process.env.SMTP_PASS = 'pass';
}

function clearSmtpEnv() {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_PORT;
  delete process.env.EMAIL_FROM_ADDRESS;
}

describe('InvitationEmailService', () => {
  let service: InvitationEmailService;
  let mockSendMail: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    clearSmtpEnv();

    service = new InvitationEmailService();
    mockSendMail = vi.fn().mockResolvedValue({ messageId: '<msg-1@test>' });
    (nodemailer.createTransport as Mock).mockReturnValue({ sendMail: mockSendMail });
  });

  describe('sendInvitationEmail', () => {
    it('should send email with correct fields', async () => {
      setupSmtpEnv();

      const result = await service.sendInvitationEmail(BASE_PARAMS);

      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledOnce();

      const call = mockSendMail.mock.calls[0][0];
      expect(call.to).toBe('invitee@example.com');
      expect(call.subject).toContain('Acme Corp');
      expect(call.html).toBeDefined();
      expect(call.text).toBeDefined();
    });

    it('should include accept URL with token', async () => {
      setupSmtpEnv();
      await service.sendInvitationEmail(BASE_PARAMS);

      const call = mockSendMail.mock.calls[0][0];
      expect(call.html).toContain(
        'https://app.bugspotter.io/invitations/accept?token=abc123def456'
      );
      expect(call.text).toContain(
        'https://app.bugspotter.io/invitations/accept?token=abc123def456'
      );
    });

    it('should use inviter email as fallback when name is null', async () => {
      setupSmtpEnv();
      await service.sendInvitationEmail({ ...BASE_PARAMS, inviterName: null });

      const call = mockSendMail.mock.calls[0][0];
      expect(call.html).toContain('admin@acme.com');
      expect(call.text).toContain('admin@acme.com');
    });

    it('should return false when FRONTEND_URL is not configured', async () => {
      setupSmtpEnv();

      // Override the config mock for this test
      const { config } = await import('../../src/config.js');
      const original = config.frontend.url;
      (config.frontend as { url: string }).url = '';

      const result = await service.sendInvitationEmail(BASE_PARAMS);

      expect(result).toBe(false);
      expect(mockSendMail).not.toHaveBeenCalled();

      // Restore
      (config.frontend as { url: string }).url = original;
    });

    it('should return false when SMTP is not configured', async () => {
      // SMTP env vars are cleared in beforeEach
      const result = await service.sendInvitationEmail(BASE_PARAMS);

      expect(result).toBe(false);
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should return false on SMTP send failure', async () => {
      setupSmtpEnv();
      mockSendMail.mockRejectedValue(new Error('Connection refused'));

      const result = await service.sendInvitationEmail(BASE_PARAMS);

      expect(result).toBe(false);
    });
  });

  describe('sendForInvitation', () => {
    it('should map domain objects to email params', async () => {
      setupSmtpEnv();

      await service.sendForInvitation({
        organizationName: 'Test Org',
        invitation: {
          email: 'user@test.com',
          role: 'admin',
          token: 'tok123',
          expires_at: new Date('2026-04-01'),
        },
        inviter: { email: 'boss@test.com', name: 'Boss' },
      });

      const call = mockSendMail.mock.calls[0][0];
      expect(call.to).toBe('user@test.com');
      expect(call.subject).toContain('Test Org');
      expect(call.html).toContain('Boss');
    });

    it('should pass locale through to email params', async () => {
      setupSmtpEnv();

      await service.sendForInvitation({
        organizationName: 'Тестовая Орг',
        invitation: {
          email: 'user@test.com',
          role: 'member',
          token: 'tok456',
          expires_at: new Date('2026-04-01'),
        },
        inviter: { email: 'boss@test.com', name: 'Борис' },
        locale: 'ru',
      });

      const call = mockSendMail.mock.calls[0][0];
      expect(call.subject).toContain('Вас пригласили');
      expect(call.html).toContain('Вас пригласили!');
    });
  });

  describe('i18n', () => {
    beforeEach(() => {
      setupSmtpEnv();
    });

    it('should render English email by default', async () => {
      await service.sendInvitationEmail(BASE_PARAMS);

      const call = mockSendMail.mock.calls[0][0];
      expect(call.subject).toBe("You've been invited to join Acme Corp on BugSpotter");
      expect(call.html).toContain("You're invited!");
      expect(call.html).toContain('Accept Invitation');
      expect(call.html).toContain('This invitation expires on');
      expect(call.text).toContain('Accept Invitation');
    });

    it('should render Russian email when locale is ru', async () => {
      await service.sendInvitationEmail({ ...BASE_PARAMS, locale: 'ru' });

      const call = mockSendMail.mock.calls[0][0];
      expect(call.subject).toContain('Вас пригласили в организацию Acme Corp');
      expect(call.html).toContain('Вас пригласили!');
      expect(call.html).toContain('Принять приглашение');
      expect(call.html).toContain('Срок действия приглашения истекает');
      expect(call.text).toContain('Принять приглашение');
    });

    it('should use English role phrase with article', async () => {
      await service.sendInvitationEmail({ ...BASE_PARAMS, role: 'admin' });
      const adminCall = mockSendMail.mock.calls[0][0];
      expect(adminCall.html).toContain('an admin');

      await service.sendInvitationEmail({ ...BASE_PARAMS, role: 'member' });
      const memberCall = mockSendMail.mock.calls[1][0];
      expect(memberCall.html).toContain('a member');
    });

    it('should use English owner role phrase', async () => {
      await service.sendInvitationEmail({ ...BASE_PARAMS, role: 'owner' });
      const call = mockSendMail.mock.calls[0][0];
      expect(call.html).toContain('the owner');
      expect(call.text).toContain('the owner');
    });

    it('should use Russian role phrase without article', async () => {
      await service.sendInvitationEmail({ ...BASE_PARAMS, role: 'admin', locale: 'ru' });
      const adminCall = mockSendMail.mock.calls[0][0];
      expect(adminCall.html).toContain('администратора');

      await service.sendInvitationEmail({ ...BASE_PARAMS, role: 'member', locale: 'ru' });
      const memberCall = mockSendMail.mock.calls[1][0];
      expect(memberCall.html).toContain('участника');
    });

    it('should use Russian owner role phrase', async () => {
      await service.sendInvitationEmail({ ...BASE_PARAMS, role: 'owner', locale: 'ru' });
      const call = mockSendMail.mock.calls[0][0];
      expect(call.html).toContain('владельца');
      expect(call.text).toContain('владельца');
    });

    it('should set html lang attribute to locale', async () => {
      await service.sendInvitationEmail({ ...BASE_PARAMS, locale: 'en' });
      expect(mockSendMail.mock.calls[0][0].html).toContain('<html lang="en">');

      await service.sendInvitationEmail({ ...BASE_PARAMS, locale: 'ru' });
      expect(mockSendMail.mock.calls[1][0].html).toContain('<html lang="ru">');
    });
  });

  describe('HTML escaping', () => {
    beforeEach(() => {
      setupSmtpEnv();
    });

    it('should escape organization name in HTML', async () => {
      await service.sendInvitationEmail({
        ...BASE_PARAMS,
        organizationName: '<script>alert("xss")</script>',
      });

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should escape inviter name in HTML', async () => {
      await service.sendInvitationEmail({
        ...BASE_PARAMS,
        inviterName: 'Bob "The Admin" <admin>',
      });

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).not.toContain('"The Admin"');
      expect(html).toContain('&quot;The Admin&quot;');
      expect(html).toContain('&lt;admin&gt;');
    });

    it('should escape accept URL in href attribute', async () => {
      // Token is hex so normally safe, but test with a crafted frontendUrl scenario
      // The URL goes through escapeHtml which handles & and " in query strings
      await service.sendInvitationEmail({
        ...BASE_PARAMS,
        token: 'tok&param=injected"onclick="alert(1)',
      });

      const html = mockSendMail.mock.calls[0][0].html;
      // The " chars must be escaped to &quot; so they can't break out of the href attribute
      expect(html).toContain('&amp;param=injected&quot;onclick=&quot;alert(1)');
      // Verify the raw " doesn't appear unescaped adjacent to onclick
      expect(html).not.toContain('"onclick=');
    });

    it('should not escape values in plain text', async () => {
      await service.sendInvitationEmail({
        ...BASE_PARAMS,
        organizationName: 'Org & Co',
        inviterName: 'Bob "Admin"',
      });

      const text = mockSendMail.mock.calls[0][0].text;
      expect(text).toContain('Org & Co');
      expect(text).toContain('Bob "Admin"');
    });
  });

  describe('responsive HTML', () => {
    it('should include viewport meta tag', async () => {
      setupSmtpEnv();
      await service.sendInvitationEmail(BASE_PARAMS);

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain(
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
      );
    });

    it('should include DOCTYPE and charset', async () => {
      setupSmtpEnv();
      await service.sendInvitationEmail(BASE_PARAMS);

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<meta charset="utf-8">');
    });
  });

  describe('verifyConnection', () => {
    it('should return true when SMTP connection succeeds', async () => {
      setupSmtpEnv();
      const mockVerify = vi.fn().mockResolvedValue(true);
      const mockClose = vi.fn();
      (nodemailer.createTransport as Mock).mockReturnValue({
        sendMail: mockSendMail,
        verify: mockVerify,
        close: mockClose,
      });

      const result = await service.verifyConnection();

      expect(result).toBe(true);
      expect(mockVerify).toHaveBeenCalledOnce();
      expect(mockClose).toHaveBeenCalledOnce();
    });

    it('should return false when SMTP connection fails', async () => {
      setupSmtpEnv();
      const mockVerify = vi.fn().mockRejectedValue(new Error('Connection refused'));
      const mockClose = vi.fn();
      (nodemailer.createTransport as Mock).mockReturnValue({
        sendMail: mockSendMail,
        verify: mockVerify,
        close: mockClose,
      });

      const result = await service.verifyConnection();

      expect(result).toBe(false);
      expect(mockClose).toHaveBeenCalledOnce();
    });

    it('should return false when SMTP is not configured', async () => {
      // SMTP env vars are cleared in beforeEach
      const result = await service.verifyConnection();

      expect(result).toBe(false);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it('should return false with partial SMTP config (missing user)', async () => {
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_PASS = 'pass';

      const result = await service.verifyConnection();

      expect(result).toBe(false);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });
  });

  describe('SMTP configuration', () => {
    it('should return false when SMTP_HOST is missing', async () => {
      process.env.SMTP_USER = 'user';
      process.env.SMTP_PASS = 'pass';

      const result = await service.sendInvitationEmail(BASE_PARAMS);
      expect(result).toBe(false);
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should return false when SMTP_USER is missing', async () => {
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_PASS = 'pass';

      const result = await service.sendInvitationEmail(BASE_PARAMS);
      expect(result).toBe(false);
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should return false when SMTP_PASS is missing', async () => {
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_USER = 'user';

      const result = await service.sendInvitationEmail(BASE_PARAMS);
      expect(result).toBe(false);
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should cache transporter after first creation', async () => {
      setupSmtpEnv();

      await service.sendInvitationEmail(BASE_PARAMS);
      await service.sendInvitationEmail(BASE_PARAMS);

      expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    });

    it('should use port 587 with STARTTLS by default', async () => {
      setupSmtpEnv();
      await service.sendInvitationEmail(BASE_PARAMS);

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 587,
          secure: false,
          requireTLS: true,
        })
      );
    });

    it('should use secure mode for port 465', async () => {
      setupSmtpEnv();
      process.env.SMTP_PORT = '465';

      await service.sendInvitationEmail(BASE_PARAMS);

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 465,
          secure: true,
          requireTLS: false,
        })
      );
    });
  });
});
