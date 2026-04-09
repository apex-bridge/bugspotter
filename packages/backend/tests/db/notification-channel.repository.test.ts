/**
 * Notification Channel Repository Tests
 * Tests for batch loading operations and edge cases
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import type { NotificationChannel } from '../../src/types/notifications.js';
import type { Project } from '../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('NotificationChannelRepository', () => {
  let db: DatabaseClient;
  let testProject: Project;
  const createdChannels: string[] = [];

  beforeAll(async () => {
    db = DatabaseClient.create({
      connectionString: TEST_DATABASE_URL,
    });

    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    // Create test project
    testProject = await db.projects.create({
      name: `Channel Test Project ${Date.now()}`,
    });
  });

  afterAll(async () => {
    // Cleanup created channels
    for (const id of createdChannels) {
      try {
        await db.notificationChannels.delete(id);
      } catch {
        // Ignore errors during cleanup
      }
    }

    // Cleanup test project
    if (testProject?.id) {
      await db.projects.delete(testProject.id);
    }

    await db.close();
  });

  // Helper function to create test channel
  async function createTestChannel(
    name: string,
    type: 'email' | 'slack' | 'webhook' | 'discord' | 'teams' = 'email',
    overrides = {}
  ): Promise<NotificationChannel> {
    const baseConfig =
      type === 'email'
        ? {
            type: 'email' as const,
            smtp_host: 'smtp.example.com',
            smtp_port: 587,
            smtp_secure: false,
            smtp_user: 'test@example.com',
            smtp_pass: 'password',
            from_address: 'test@example.com',
            from_name: 'Test',
          }
        : type === 'slack'
          ? {
              type: 'slack' as const,
              webhook_url: 'https://hooks.slack.com/services/TEST/WEBHOOK',
            }
          : type === 'webhook'
            ? {
                type: 'webhook' as const,
                url: 'https://example.com/webhook',
                method: 'POST' as const,
                auth_type: 'none' as const,
                headers: { 'Content-Type': 'application/json' },
              }
            : type === 'discord'
              ? {
                  type: 'discord' as const,
                  webhook_url: 'https://discord.com/api/webhooks/TEST',
                }
              : {
                  type: 'teams' as const,
                  webhook_url: 'https://outlook.office.com/webhook/TEST',
                };

    const channel = await db.notificationChannels.create({
      project_id: testProject.id,
      name,
      type,
      config: baseConfig,
      active: true,
      ...overrides,
    });

    createdChannels.push(channel.id);
    return channel;
  }

  describe('findByIds() - Batch loading', () => {
    it('should fetch multiple channels by IDs in single query', async () => {
      // Create multiple channels
      const channel1 = await createTestChannel('Channel 1', 'email');
      const channel2 = await createTestChannel('Channel 2', 'slack');
      const channel3 = await createTestChannel('Channel 3', 'webhook');

      // Fetch all three by IDs
      const channels = await db.notificationChannels.findByIds([
        channel1.id,
        channel2.id,
        channel3.id,
      ]);

      expect(channels.size).toBe(3);
      expect(channels.get(channel1.id)?.id).toBe(channel1.id);
      expect(channels.get(channel2.id)?.id).toBe(channel2.id);
      expect(channels.get(channel3.id)?.id).toBe(channel3.id);

      // Verify types
      expect(channels.get(channel1.id)?.type).toBe('email');
      expect(channels.get(channel2.id)?.type).toBe('slack');
      expect(channels.get(channel3.id)?.type).toBe('webhook');
    });

    it('should return empty map when no IDs provided', async () => {
      const channels = await db.notificationChannels.findByIds([]);
      expect(channels.size).toBe(0);
      expect(channels).toBeInstanceOf(Map);
    });

    it('should return only found channels when some IDs do not exist', async () => {
      const channel = await createTestChannel('Existing Channel', 'email');

      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const channels = await db.notificationChannels.findByIds([channel.id, nonExistentId]);

      expect(channels.size).toBe(1);
      expect(channels.get(channel.id)?.id).toBe(channel.id);
      expect(channels.has(nonExistentId)).toBe(false);
    });

    it('should return empty map when all IDs do not exist', async () => {
      const nonExistentIds = [
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
      ];

      const channels = await db.notificationChannels.findByIds(nonExistentIds);
      expect(channels.size).toBe(0);
    });

    it('should handle large batch of IDs efficiently', async () => {
      // Create 20 channels
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) {
        const channel = await createTestChannel(`Batch Channel ${i}`, 'email');
        ids.push(channel.id);
      }

      // Fetch all 20 in single query
      const channels = await db.notificationChannels.findByIds(ids);

      expect(channels.size).toBe(20);
      // Verify all IDs are present
      ids.forEach((id) => {
        expect(channels.has(id)).toBe(true);
        expect(channels.get(id)?.id).toBe(id);
      });
    });

    it('should preserve all channel fields', async () => {
      const channel = await createTestChannel('Complete Channel', 'email', {
        active: true,
      });

      const channels = await db.notificationChannels.findByIds([channel.id]);
      const retrieved = channels.get(channel.id);

      expect(retrieved?.name).toBe('Complete Channel');
      expect(retrieved?.type).toBe('email');
      expect(retrieved?.active).toBe(true);
      expect(retrieved?.config).toBeDefined();
      expect(retrieved?.config.type).toBe('email');
      expect(retrieved?.failure_count).toBe(0);
      expect(retrieved?.created_at).toBeInstanceOf(Date);
      expect(retrieved?.updated_at).toBeInstanceOf(Date);
    });

    it('should handle different channel types in same batch', async () => {
      const emailChannel = await createTestChannel('Email Channel', 'email');
      const slackChannel = await createTestChannel('Slack Channel', 'slack');
      const webhookChannel = await createTestChannel('Webhook Channel', 'webhook');
      const discordChannel = await createTestChannel('Discord Channel', 'discord');
      const teamsChannel = await createTestChannel('Teams Channel', 'teams');

      const channels = await db.notificationChannels.findByIds([
        emailChannel.id,
        slackChannel.id,
        webhookChannel.id,
        discordChannel.id,
        teamsChannel.id,
      ]);

      expect(channels.size).toBe(5);

      // Verify each channel has correct type and config
      expect(channels.get(emailChannel.id)?.config.type).toBe('email');
      expect(channels.get(slackChannel.id)?.config.type).toBe('slack');
      expect(channels.get(webhookChannel.id)?.config.type).toBe('webhook');
      expect(channels.get(discordChannel.id)?.config.type).toBe('discord');
      expect(channels.get(teamsChannel.id)?.config.type).toBe('teams');
    });

    it('should handle channels with different active statuses', async () => {
      const activeChannel = await createTestChannel('Active Channel', 'email', { active: true });
      const inactiveChannel = await createTestChannel('Inactive Channel', 'slack', {
        active: false,
      });

      const channels = await db.notificationChannels.findByIds([
        activeChannel.id,
        inactiveChannel.id,
      ]);

      expect(channels.size).toBe(2);
      expect(channels.get(activeChannel.id)?.active).toBe(true);
      expect(channels.get(inactiveChannel.id)?.active).toBe(false);
    });

    it('should handle channels with different failure counts', async () => {
      const successfulChannel = await createTestChannel('Successful Channel', 'email');
      const failedChannel = await createTestChannel('Failed Channel', 'slack');
      const unknownChannel = await createTestChannel('Unknown Channel', 'webhook');

      // Update failure counts directly in database (no exposed method to set failure_count)
      await db.query('UPDATE notification_channels SET failure_count = $1 WHERE id = $2', [
        5,
        failedChannel.id,
      ]);
      await db.query('UPDATE notification_channels SET failure_count = $1 WHERE id = $2', [
        10,
        unknownChannel.id,
      ]);

      const channels = await db.notificationChannels.findByIds([
        successfulChannel.id,
        failedChannel.id,
        unknownChannel.id,
      ]);

      expect(channels.size).toBe(3);
      expect(channels.get(successfulChannel.id)?.failure_count).toBe(0);
      expect(channels.get(failedChannel.id)?.failure_count).toBe(5);
      expect(channels.get(unknownChannel.id)?.failure_count).toBe(10);
    });

    it('should handle duplicate IDs correctly', async () => {
      const channel = await createTestChannel('Duplicate Test', 'email');

      // Request same ID multiple times
      const channels = await db.notificationChannels.findByIds([
        channel.id,
        channel.id,
        channel.id,
      ]);

      // Should return unique result
      expect(channels.size).toBe(1);
      expect(channels.get(channel.id)?.id).toBe(channel.id);
    });

    it('should preserve config JSONB fields', async () => {
      const complexConfig = {
        type: 'email' as const,
        smtp_host: 'smtp.sendgrid.net',
        smtp_port: 587,
        smtp_secure: true,
        smtp_user: 'apikey',
        smtp_pass: 'SG.test123',
        from_address: 'alerts@example.com',
        from_name: 'Bug Alert System',
        reply_to: 'support@example.com',
        custom_headers: {
          'X-Priority': '1',
          'X-Environment': 'production',
        },
      };

      // Create channel directly with complex config
      const channel = await db.notificationChannels.create({
        project_id: testProject.id,
        name: 'Complex JSONB Channel',
        type: 'email',
        config: complexConfig,
      });
      createdChannels.push(channel.id);

      const channels = await db.notificationChannels.findByIds([channel.id]);
      const retrieved = channels.get(channel.id);

      expect(retrieved?.config).toEqual(complexConfig);
      // Verify webhook-specific config properties
      if (retrieved?.config.type === 'webhook') {
        expect(retrieved.config.headers).toEqual({
          'X-Priority': '1',
          'X-Environment': 'production',
        });
      }
    });

    it('should handle channels from different projects', async () => {
      // Create another project
      const project2 = await db.projects.create({
        name: `Second Project ${Date.now()}`,
      });

      const channel1 = await createTestChannel('Project 1 Channel', 'email');

      const channel2 = await db.notificationChannels.create({
        project_id: project2.id,
        name: 'Project 2 Channel',
        type: 'slack',
        config: {
          type: 'slack',
          webhook_url: 'https://hooks.slack.com/services/PROJECT2',
        },
        active: true,
      });
      createdChannels.push(channel2.id);

      const channels = await db.notificationChannels.findByIds([channel1.id, channel2.id]);

      expect(channels.size).toBe(2);
      expect(channels.get(channel1.id)?.project_id).toBe(testProject.id);
      expect(channels.get(channel2.id)?.project_id).toBe(project2.id);

      // Cleanup
      await db.projects.delete(project2.id);
    });

    it('should handle mixed case: some found, some not found, some duplicates', async () => {
      const channel1 = await createTestChannel('Mixed Test 1', 'email');
      const channel2 = await createTestChannel('Mixed Test 2', 'slack');
      const nonExistentId = '00000000-0000-0000-0000-999999999999';

      // Mix of: existing (twice), non-existing, existing
      const channels = await db.notificationChannels.findByIds([
        channel1.id,
        channel1.id, // duplicate
        nonExistentId,
        channel2.id,
      ]);

      expect(channels.size).toBe(2);
      expect(channels.has(channel1.id)).toBe(true);
      expect(channels.has(channel2.id)).toBe(true);
      expect(channels.has(nonExistentId)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle channel with minimal config', async () => {
      const channel = await db.notificationChannels.create({
        project_id: testProject.id,
        name: 'Minimal Channel',
        type: 'webhook',
        config: {
          type: 'webhook',
          url: 'https://example.com/hook',
          method: 'POST',
          auth_type: 'none',
        },
        active: true,
      });
      createdChannels.push(channel.id);

      const channels = await db.notificationChannels.findByIds([channel.id]);
      const retrieved = channels.get(channel.id);

      expect(retrieved?.config.type).toBe('webhook');
      if (retrieved?.config.type === 'webhook') {
        expect(retrieved.config.url).toBe('https://example.com/hook');
      }
    });

    it('should handle channel with minimal fields', async () => {
      const channel = await createTestChannel('Minimal Channel', 'email');

      const channels = await db.notificationChannels.findByIds([channel.id]);
      expect(channels.get(channel.id)?.name).toBe('Minimal Channel');
      expect(channels.get(channel.id)?.type).toBe('email');
      expect(channels.get(channel.id)?.config).toBeDefined();
    });

    it('should preserve timestamps', async () => {
      const beforeCreation = Date.now();
      const channel = await createTestChannel('Timestamp Test', 'email');

      // Wait a bit to ensure clear separation
      await new Promise((resolve) => setTimeout(resolve, 50));

      const channels = await db.notificationChannels.findByIds([channel.id]);
      const retrieved = channels.get(channel.id);

      expect(retrieved?.created_at).toBeInstanceOf(Date);
      expect(retrieved?.updated_at).toBeInstanceOf(Date);
      // Verify timestamp is reasonable (within 5 seconds of when we started the test)
      expect(retrieved?.created_at.getTime()).toBeGreaterThan(beforeCreation - 1000);
      expect(retrieved?.created_at.getTime()).toBeLessThan(beforeCreation + 5000);
    });
  });
});
