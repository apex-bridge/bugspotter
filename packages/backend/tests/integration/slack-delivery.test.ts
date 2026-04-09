/**
 * Slack Notification Integration Tests
 *
 * Tests Slack webhook delivery with real Slack workspace.
 * Only runs when RUN_INTEGRATION_TESTS=true and SLACK_TEST_WEBHOOK_URL is configured.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SlackChannelHandler } from '../../src/services/notifications/slack-handler.js';
import {
  generateTestId,
  getTimestamp,
  verifyMessageInSlack,
  verifyDelivery,
} from './test-helpers.js';

const shouldRunIntegrationTests = process.env.RUN_INTEGRATION_TESTS === 'true';

describe('Slack Delivery Integration', () => {
  if (!shouldRunIntegrationTests) {
    it.skip('Integration tests disabled (set RUN_INTEGRATION_TESTS=true to enable)', () => {});
    return;
  }

  let handler: SlackChannelHandler;

  beforeAll(() => {
    if (!process.env.SLACK_TEST_WEBHOOK_URL) {
      throw new Error(
        'SLACK_TEST_WEBHOOK_URL not configured. Create a Slack webhook for integration tests.'
      );
    }
    handler = new SlackChannelHandler();
  });

  it('should send message to Slack channel and verify delivery', async () => {
    const config = {
      type: 'slack' as const,
      webhook_url: process.env.SLACK_TEST_WEBHOOK_URL!,
      channel: process.env.SLACK_TEST_CHANNEL,
    };

    const timestamp = getTimestamp();
    const testId = generateTestId();

    const result = await handler.send(config, {
      to: '',
      subject: 'Integration Test',
      body: JSON.stringify({
        text: `✅ Slack Integration Test - ${testId}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `✅ Slack Integration Test`,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Test ID:* \`${testId}\`\n*Timestamp:* ${timestamp}\n\nThis message confirms Slack integration is working correctly.\n\n_Check your Slack channel to verify this message was delivered._`,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `🤖 Automated integration test | Test ID: ${testId}`,
              },
            ],
          },
        ],
      }),
    });

    // Slack webhook returns 200 OK when message is successfully posted
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    await verifyDelivery(
      'Slack',
      testId,
      config.channel || 'your Slack channel',
      verifyMessageInSlack,
      'SLACK_BOT_TOKEN'
    );
  }, 60000); // 60 second timeout for third-party API verification

  it('should use test method successfully', async () => {
    const config = {
      type: 'slack' as const,
      webhook_url: process.env.SLACK_TEST_WEBHOOK_URL!,
      channel: process.env.SLACK_TEST_CHANNEL,
    };

    const result = await handler.test(config, 'Integration test - verify Slack webhook');

    expect(result.success).toBe(true);
  }, 30000);

  it('should send message with attachments', async () => {
    const config = {
      type: 'slack' as const,
      webhook_url: process.env.SLACK_TEST_WEBHOOK_URL!,
      channel: process.env.SLACK_TEST_CHANNEL,
    };

    const result = await handler.send(config, {
      to: '',
      subject: 'Test with Attachments',
      body: JSON.stringify({
        text: 'Bug Report Notification',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*New Bug Report*\nA new bug has been reported.',
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '*Status:*\nOpen' },
              { type: 'mrkdwn', text: '*Priority:*\nHigh' },
            ],
          },
        ],
      }),
    });

    expect(result.success).toBe(true);
  }, 30000);

  it('should fail with invalid webhook URL', async () => {
    const config = {
      type: 'slack' as const,
      webhook_url: 'https://hooks.slack.com/services/INVALID/WEBHOOK/URL',
      channel: process.env.SLACK_TEST_CHANNEL,
    };

    const result = await handler.send(config, {
      to: '',
      subject: 'Should Fail',
      body: JSON.stringify({ text: 'This should fail' }),
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  }, 30000);
});
