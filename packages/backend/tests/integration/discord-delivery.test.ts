/**
 * Discord Notification Integration Tests
 *
 * Tests Discord webhook delivery with real Discord server.
 * Only runs when RUN_INTEGRATION_TESTS=true and DISCORD_TEST_WEBHOOK_URL is configured.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { DiscordChannelHandler } from '../../src/services/notifications/discord-handler.js';
import {
  generateTestId,
  getTimestamp,
  verifyMessageInDiscord,
  verifyDelivery,
} from './test-helpers.js';

const shouldRunIntegrationTests = process.env.RUN_INTEGRATION_TESTS === 'true';

describe('Discord Delivery Integration', () => {
  if (!shouldRunIntegrationTests) {
    it.skip('Integration tests disabled (set RUN_INTEGRATION_TESTS=true to enable)', () => {});
    return;
  }

  let handler: DiscordChannelHandler;

  beforeAll(() => {
    if (!process.env.DISCORD_TEST_WEBHOOK_URL) {
      throw new Error(
        'DISCORD_TEST_WEBHOOK_URL not configured. Create a Discord webhook for integration tests.'
      );
    }
    handler = new DiscordChannelHandler();
  });

  it('should send message to Discord channel and verify delivery', async () => {
    const config = {
      type: 'discord' as const,
      webhook_url: process.env.DISCORD_TEST_WEBHOOK_URL!,
    };

    const timestamp = getTimestamp();
    const testId = generateTestId();

    const result = await handler.send(config, {
      to: '',
      subject: 'Integration Test',
      body: JSON.stringify({
        content: `✅ Discord Integration Test - ${testId}`,
        embeds: [
          {
            title: 'BugSpotter Integration Test',
            description: 'This message confirms Discord integration is working correctly.',
            color: 0x00ff00,
            fields: [
              {
                name: '🆔 Test ID',
                value: `\`${testId}\``,
                inline: true,
              },
              {
                name: '🕐 Timestamp',
                value: timestamp,
                inline: true,
              },
              {
                name: '✅ Status',
                value: 'Delivery Confirmed',
                inline: false,
              },
            ],
            footer: {
              text: 'Automated Integration Test',
            },
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    // Discord webhook returns 204 No Content on success
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    await verifyDelivery(
      'Discord',
      testId,
      'your Discord channel',
      verifyMessageInDiscord,
      'DISCORD_BOT_TOKEN'
    );
  }, 30000);

  it('should use test method successfully', async () => {
    const config = {
      type: 'discord' as const,
      webhook_url: process.env.DISCORD_TEST_WEBHOOK_URL!,
    };

    const result = await handler.test(config, 'Integration test - verify Discord webhook');

    expect(result.success).toBe(true);
  }, 30000);

  it('should send message with rich embeds', async () => {
    const config = {
      type: 'discord' as const,
      webhook_url: process.env.DISCORD_TEST_WEBHOOK_URL!,
    };

    const result = await handler.send(config, {
      to: '',
      subject: 'Bug Report',
      body: JSON.stringify({
        content: '🐛 New Bug Report',
        embeds: [
          {
            title: 'Critical Bug Detected',
            description: 'A critical bug has been reported in production.',
            color: 0xff0000,
            fields: [
              { name: 'Status', value: 'Open', inline: true },
              { name: 'Priority', value: 'High', inline: true },
              { name: 'Reporter', value: 'Integration Test', inline: true },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    expect(result.success).toBe(true);
  }, 30000);

  it('should fail with invalid webhook URL', async () => {
    const config = {
      type: 'discord' as const,
      webhook_url: 'https://discord.com/api/webhooks/123456789/invalid',
    };

    const result = await handler.send(config, {
      to: '',
      subject: 'Should Fail',
      body: JSON.stringify({ content: 'This should fail' }),
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  }, 30000);
});
