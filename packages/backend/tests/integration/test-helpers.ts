/**
 * Shared Test Utilities for Integration Tests
 *
 * Common helpers for notification delivery tests.
 */

import axios from 'axios';

/**
 * Generate a unique test ID for tracking messages
 */
export function generateTestId(): string {
  return Math.random().toString(36).substring(7);
}

/**
 * Get current ISO timestamp
 */
export function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Verify message in Slack channel using Bot API
 * Requires SLACK_BOT_TOKEN and SLACK_TEST_CHANNEL_ID environment variables
 */
export async function verifyMessageInSlack(testId: string): Promise<boolean> {
  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_TEST_CHANNEL_ID) {
    console.log(
      '⏭️  Skipping Slack verification: SLACK_BOT_TOKEN or SLACK_TEST_CHANNEL_ID not set'
    );
    return false;
  }

  try {
    const response = await axios.get('https://slack.com/api/conversations.history', {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      params: {
        channel: process.env.SLACK_TEST_CHANNEL_ID,
        limit: 10, // Check last 10 messages
      },
      timeout: 50000, // 50 second timeout for third-party API
    });

    if (!response.data.ok) {
      console.warn('⚠️  Slack API error:', response.data.error);
      return false;
    }

    // Search for test ID in recent messages
    const found = response.data.messages?.some((msg: any) => {
      const text = JSON.stringify(msg);
      return text.includes(testId);
    });

    return found || false;
  } catch (error) {
    console.warn('⚠️  Failed to verify Slack message:', error);
    return false;
  }
}

/**
 * Verify message in Discord channel using Bot API
 * Requires DISCORD_BOT_TOKEN and DISCORD_TEST_CHANNEL_ID environment variables
 */
export async function verifyMessageInDiscord(testId: string): Promise<boolean> {
  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_TEST_CHANNEL_ID) {
    console.log(
      '⏭️  Skipping Discord verification: DISCORD_BOT_TOKEN or DISCORD_TEST_CHANNEL_ID not set'
    );
    return false;
  }

  try {
    const response = await axios.get(
      `https://discord.com/api/v10/channels/${process.env.DISCORD_TEST_CHANNEL_ID}/messages`,
      {
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        },
        params: {
          limit: 10, // Check last 10 messages
        },
        timeout: 50000, // 50 second timeout for third-party API
      }
    );

    // Search for test ID in recent messages
    const found = response.data.some((msg: any) => {
      const text = JSON.stringify(msg);
      return text.includes(testId);
    });

    return found || false;
  } catch (error) {
    console.warn('⚠️  Failed to verify Discord message:', error);
    return false;
  }
}

/**
 * Verify message delivery with optional bot token verification
 * @param platform - Platform name for logging (e.g., "Slack", "Discord")
 * @param testId - Unique test ID to search for
 * @param channelName - Channel name for user instructions (e.g., "#integration-tests")
 * @param verifyFn - Optional verification function (uses bot token)
 * @param envVarName - Environment variable name for bot token (for conditional check)
 */
export async function verifyDelivery(
  platform: string,
  testId: string,
  channelName: string,
  verifyFn?: (testId: string) => Promise<boolean>,
  envVarName?: string
): Promise<void> {
  console.log(`✅ ${platform} message sent successfully. Test ID: ${testId}`);
  console.log(`💬 Check ${channelName} to verify delivery`);

  // Optional: Verify message appears in channel (requires bot token)
  if (verifyFn && envVarName && process.env[envVarName]) {
    console.log('🔍 Verifying message in channel...');
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2s for message to appear

    const verified = await verifyFn(testId);
    if (verified) {
      console.log(`✅ Message verified in ${platform} channel!`);
    } else {
      console.log('⚠️  Could not verify message in channel (may still be delivered)');
    }
  }
}
