/**
 * Email Channel Handler Tests
 * Unit tests for email notification delivery
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { EmailChannelHandler } from '../../../src/services/notifications/email-handler.js';
import type { EmailChannelConfig, NotificationPayload } from '../../../src/types/notifications.js';
import nodemailer from 'nodemailer';

// Mock nodemailer
vi.mock('nodemailer');

describe('EmailChannelHandler', () => {
  let handler: EmailChannelHandler;
  let mockTransporter: {
    sendMail: Mock;
  };
  let config: EmailChannelConfig;

  beforeEach(() => {
    handler = new EmailChannelHandler();

    mockTransporter = {
      sendMail: vi.fn(),
    };

    (nodemailer.createTransport as Mock).mockReturnValue(mockTransporter);

    config = {
      type: 'email',
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_secure: false,
      smtp_user: 'user@example.com',
      smtp_pass: 'password',
      from_address: 'noreply@bugspotter.io',
      from_name: 'BugSpotter',
      tls_reject_unauthorized: true,
    };
  });

  describe('Handler Type', () => {
    it('should have correct type identifier', () => {
      expect(handler.type).toBe('email');
    });
  });

  describe('send()', () => {
    it('should send email successfully with valid config and payload', async () => {
      const payload: NotificationPayload = {
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: '<p>Test email body</p>',
      };

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<msg-123@example.com>',
        accepted: ['recipient@example.com'],
        rejected: [],
        response: '250 OK',
      });

      const result = await handler.send(config, payload);

      expect(result.success).toBe(true);
      expect(result.message_id).toBe('<msg-123@example.com>');
      expect(result.response).toEqual({
        accepted: ['recipient@example.com'],
        rejected: [],
        response: '250 OK',
      });
    });

    it('should create transporter with correct configuration', async () => {
      const payload: NotificationPayload = {
        to: 'test@example.com',
        subject: 'Test',
        body: 'Body',
      };

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<msg-123@example.com>',
        accepted: [],
        rejected: [],
        response: '250 OK',
      });

      await handler.send(config, payload);

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        requireTLS: true, // Port 587 forces STARTTLS
        auth: {
          user: 'user@example.com',
          pass: 'password',
        },
        tls: {
          rejectUnauthorized: true,
        },
      });
    });

    it('should format from address with name', async () => {
      const payload: NotificationPayload = {
        to: 'test@example.com',
        subject: 'Test',
        body: 'Body',
      };

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<msg-123@example.com>',
        accepted: [],
        rejected: [],
        response: '250 OK',
      });

      await handler.send(config, payload);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'BugSpotter <noreply@bugspotter.io>',
        })
      );
    });

    it('should handle single recipient', async () => {
      const payload: NotificationPayload = {
        to: 'single@example.com',
        subject: 'Test',
        body: 'Body',
      };

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<msg-123@example.com>',
        accepted: [],
        rejected: [],
        response: '250 OK',
      });

      await handler.send(config, payload);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'single@example.com',
        })
      );
    });

    it('should handle multiple recipients as array', async () => {
      const payload: NotificationPayload = {
        to: ['user1@example.com', 'user2@example.com', 'user3@example.com'],
        subject: 'Test',
        body: 'Body',
      };

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<msg-123@example.com>',
        accepted: [],
        rejected: [],
        response: '250 OK',
      });

      await handler.send(config, payload);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user1@example.com, user2@example.com, user3@example.com',
        })
      );
    });

    it('should use default subject if not provided', async () => {
      const payload: NotificationPayload = {
        to: 'test@example.com',
        subject: '',
        body: 'Body',
      };

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<msg-123@example.com>',
        accepted: [],
        rejected: [],
        response: '250 OK',
      });

      await handler.send(config, payload);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Notification',
        })
      );
    });

    it('should include both HTML and plain text versions', async () => {
      const payload: NotificationPayload = {
        to: 'test@example.com',
        subject: 'Test',
        body: '<html><body><h1>Title</h1><p>Content</p></body></html>',
      };

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<msg-123@example.com>',
        accepted: [],
        rejected: [],
        response: '250 OK',
      });

      await handler.send(config, payload);

      const call = mockTransporter.sendMail.mock.calls[0][0];
      expect(call.html).toBe('<html><body><h1>Title</h1><p>Content</p></body></html>');
      expect(call.text).toBeDefined();
      expect(call.text).not.toContain('<');
    });

    it('should handle SMTP errors', async () => {
      const payload: NotificationPayload = {
        to: 'test@example.com',
        subject: 'Test',
        body: 'Body',
      };

      const error = new Error('SMTP connection failed');
      mockTransporter.sendMail.mockRejectedValue(error);

      const result = await handler.send(config, payload);

      expect(result.success).toBe(false);
      expect(result.error).toBe('SMTP connection failed');
    });

    it('should handle authentication errors', async () => {
      const payload: NotificationPayload = {
        to: 'test@example.com',
        subject: 'Test',
        body: 'Body',
      };

      mockTransporter.sendMail.mockRejectedValue(
        new Error('Invalid login: 535 Authentication failed')
      );

      const result = await handler.send(config, payload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Authentication failed');
    });

    it('should handle unknown errors', async () => {
      const payload: NotificationPayload = {
        to: 'test@example.com',
        subject: 'Test',
        body: 'Body',
      };

      mockTransporter.sendMail.mockRejectedValue('Unknown error');

      const result = await handler.send(config, payload);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('should default tls_reject_unauthorized to true', async () => {
      const configWithoutTls = {
        ...config,
        tls_reject_unauthorized: undefined,
      } as EmailChannelConfig;

      const payload: NotificationPayload = {
        to: 'test@example.com',
        subject: 'Test',
        body: 'Body',
      };

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<msg-123@example.com>',
        accepted: [],
        rejected: [],
        response: '250 OK',
      });

      await handler.send(configWithoutTls, payload);

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          tls: {
            rejectUnauthorized: true,
          },
        })
      );
    });
  });

  describe('test()', () => {
    it('should send test email to configured from address', async () => {
      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<test-123@example.com>',
        accepted: [config.from_address],
        rejected: [],
        response: '250 OK',
      });

      const result = await handler.test(config);

      expect(result.success).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: config.from_address,
          subject: 'BugSpotter Test Email',
        })
      );
    });

    it('should include configuration details in test email', async () => {
      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<test-123@example.com>',
        accepted: [],
        rejected: [],
        response: '250 OK',
      });

      await handler.test(config);

      const call = mockTransporter.sendMail.mock.calls[0][0];
      expect(call.html).toContain('smtp.example.com');
      expect(call.html).toContain('587');
      expect(call.html).toContain('BugSpotter');
      expect(call.html).toContain('noreply@bugspotter.io');
    });

    it('should show secure status in test email', async () => {
      const secureConfig = { ...config, smtp_secure: true };

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<test-123@example.com>',
        accepted: [],
        rejected: [],
        response: '250 OK',
      });

      await handler.test(secureConfig);

      const call = mockTransporter.sendMail.mock.calls[0][0];
      expect(call.html).toContain('Yes');
    });

    it('should show insecure status in test email', async () => {
      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<test-123@example.com>',
        accepted: [],
        rejected: [],
        response: '250 OK',
      });

      await handler.test(config);

      const call = mockTransporter.sendMail.mock.calls[0][0];
      expect(call.html).toContain('No');
    });

    it('should handle test email failures', async () => {
      mockTransporter.sendMail.mockRejectedValue(new Error('Test failed'));

      const result = await handler.test(config);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Test failed');
    });
  });

  describe('HTML Stripping', () => {
    it('should strip HTML tags for plain text version', async () => {
      const payload: NotificationPayload = {
        to: 'test@example.com',
        subject: 'Test',
        body: '<p><strong>Bold</strong> and <em>italic</em> text</p>',
      };

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<msg-123@example.com>',
        accepted: [],
        rejected: [],
        response: '250 OK',
      });

      await handler.send(config, payload);

      const call = mockTransporter.sendMail.mock.calls[0][0];
      expect(call.text).not.toContain('<');
      expect(call.text).not.toContain('>');
      expect(call.text).toContain('Bold');
      expect(call.text).toContain('italic');
    });

    it('should strip style tags', async () => {
      const payload: NotificationPayload = {
        to: 'test@example.com',
        subject: 'Test',
        body: '<style>body { color: red; }</style><p>Content</p>',
      };

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<msg-123@example.com>',
        accepted: [],
        rejected: [],
        response: '250 OK',
      });

      await handler.send(config, payload);

      const call = mockTransporter.sendMail.mock.calls[0][0];
      expect(call.text).not.toContain('style');
      expect(call.text).not.toContain('color: red');
      expect(call.text).toContain('Content');
    });

    it('should strip script tags', async () => {
      const payload: NotificationPayload = {
        to: 'test@example.com',
        subject: 'Test',
        body: '<script>alert("xss")</script><p>Content</p>',
      };

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<msg-123@example.com>',
        accepted: [],
        rejected: [],
        response: '250 OK',
      });

      await handler.send(config, payload);

      const call = mockTransporter.sendMail.mock.calls[0][0];
      expect(call.text).not.toContain('script');
      expect(call.text).not.toContain('alert');
      expect(call.text).toContain('Content');
    });

    it('should normalize whitespace in plain text', async () => {
      const payload: NotificationPayload = {
        to: 'test@example.com',
        subject: 'Test',
        body: '<p>Line   with    multiple    spaces</p>',
      };

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<msg-123@example.com>',
        accepted: [],
        rejected: [],
        response: '250 OK',
      });

      await handler.send(config, payload);

      const call = mockTransporter.sendMail.mock.calls[0][0];
      expect(call.text).not.toMatch(/\s{2,}/);
    });
  });
});
