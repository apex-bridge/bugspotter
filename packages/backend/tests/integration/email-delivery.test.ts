/**
 * Email Notification Integration Tests
 *
 * Tests email delivery via SMTP with real mail server.
 * Only runs when RUN_INTEGRATION_TESTS=true and SMTP credentials are configured.
 *
 * SMTP Configuration:
 * - Port 465: Direct SSL connection (smtp_secure=true)
 * - Port 587: STARTTLS upgrade (smtp_secure=false, but still encrypted)
 * - Port 25: Plain SMTP (not recommended, smtp_secure=false)
 *
 * Most modern SMTP services use port 587 with STARTTLS.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { EmailChannelHandler } from '../../src/services/notifications/email-handler.js';
import { generateTestId, getTimestamp } from './test-helpers.js';

const shouldRunIntegrationTests = process.env.RUN_INTEGRATION_TESTS === 'true';

describe('Email Delivery Integration', () => {
  if (!shouldRunIntegrationTests) {
    it.skip('Integration tests disabled (set RUN_INTEGRATION_TESTS=true to enable)', () => {});
    return;
  }

  let handler: EmailChannelHandler;

  beforeAll(() => {
    if (!process.env.SMTP_HOST) {
      throw new Error(
        'SMTP_HOST not configured. Set environment variables for email integration tests.'
      );
    }
    handler = new EmailChannelHandler();
  });

  it('should send real email via SMTP and verify acceptance', async () => {
    const smtpPort = parseInt(process.env.SMTP_PORT || '587');
    const config = {
      type: 'email' as const,
      smtp_host: process.env.SMTP_HOST!,
      smtp_port: smtpPort,
      // Only use smtp_secure=true for port 465 (direct SSL)
      // Port 587 uses STARTTLS (secure=false but still encrypted)
      smtp_secure: smtpPort === 465 && process.env.SMTP_SECURE === 'true',
      smtp_user: process.env.SMTP_USER!,
      smtp_pass: process.env.SMTP_PASS!,
      from_address: process.env.EMAIL_FROM_ADDRESS!,
      from_name: 'BugSpotter Integration Test',
      tls_reject_unauthorized: true,
    };

    const timestamp = getTimestamp();
    const testId = generateTestId();

    const result = await handler.send(config, {
      to: process.env.EMAIL_RECIPIENTS?.split(',')[0]?.trim() || config.from_address,
      subject: `[Integration Test ${testId}] Email Delivery - ${timestamp}`,
      body: `
        <html>
          <body>
            <h1>✅ Email Integration Test</h1>
            <p>This is an automated integration test for BugSpotter notifications.</p>
            <p><strong>Test ID:</strong> ${testId}</p>
            <p><strong>Timestamp:</strong> ${timestamp}</p>
            <p><strong>SMTP Host:</strong> ${config.smtp_host}</p>
            <p>If you received this email, the email notification system is working correctly.</p>
            <hr>
            <small>To verify automated delivery, check your inbox for this test ID: ${testId}</small>
          </body>
        </html>
      `,
    });

    // Verify SMTP server accepted the email
    expect(result.success).toBe(true);
    expect(result.message_id).toBeDefined();
    expect(result.error).toBeUndefined();

    // Message ID format verification (proves SMTP server processed it)
    expect(result.message_id).toMatch(/<.+@.+>/);

    console.log(`✅ Email sent successfully. Message ID: ${result.message_id}`);
    console.log(`📧 Check inbox for test ID: ${testId}`);
  }, 30000);

  it('should send test email using test method', async () => {
    const smtpPort = parseInt(process.env.SMTP_PORT || '587');
    const config = {
      type: 'email' as const,
      smtp_host: process.env.SMTP_HOST!,
      smtp_port: smtpPort,
      smtp_secure: smtpPort === 465 && process.env.SMTP_SECURE === 'true',
      smtp_user: process.env.SMTP_USER!,
      smtp_pass: process.env.SMTP_PASS!,
      from_address: process.env.EMAIL_FROM_ADDRESS!,
      from_name: 'BugSpotter Test',
      tls_reject_unauthorized: true,
    };

    const result = await handler.test(config, 'Integration test - verify SMTP configuration');

    expect(result.success).toBe(true);
    expect(result.message_id).toBeDefined();
  }, 30000);

  it('should fail with invalid credentials', async () => {
    const config = {
      type: 'email' as const,
      smtp_host: process.env.SMTP_HOST!,
      smtp_port: parseInt(process.env.SMTP_PORT || '587'),
      smtp_secure: false,
      smtp_user: 'invalid-user@example.com',
      smtp_pass: 'wrong-password',
      from_address: 'test@example.com',
      from_name: 'Test',
      tls_reject_unauthorized: true,
    };

    const result = await handler.send(config, {
      to: 'test@example.com',
      subject: 'This should fail',
      body: 'Test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  }, 30000);

  it('should handle multiple recipients', async () => {
    const smtpPort = parseInt(process.env.SMTP_PORT || '587');
    const config = {
      type: 'email' as const,
      smtp_host: process.env.SMTP_HOST!,
      smtp_port: smtpPort,
      smtp_secure: smtpPort === 465 && process.env.SMTP_SECURE === 'true',
      smtp_user: process.env.SMTP_USER!,
      smtp_pass: process.env.SMTP_PASS!,
      from_address: process.env.EMAIL_FROM_ADDRESS!,
      from_name: 'BugSpotter Test',
      tls_reject_unauthorized: true,
    };

    const recipients = [
      process.env.EMAIL_RECIPIENTS?.split(',')[0]?.trim() || config.from_address,
      config.from_address, // Send to same address twice to test multiple recipients
    ];

    const result = await handler.send(config, {
      to: recipients.join(','),
      subject: '[Test] Multiple Recipients',
      body: 'Testing multiple recipient delivery',
    });

    expect(result.success).toBe(true);
  }, 30000);
});
