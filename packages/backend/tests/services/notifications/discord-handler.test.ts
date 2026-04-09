/**
 * Discord Channel Handler Tests
 * Unit tests for Discord webhook notification delivery
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { DiscordChannelHandler } from '../../../src/services/notifications/discord-handler.js';
import type {
  DiscordChannelConfig,
  NotificationPayload,
} from '../../../src/types/notifications.js';
import axios from 'axios';

// Mock axios
vi.mock('axios');

describe('DiscordChannelHandler', () => {
  let handler: DiscordChannelHandler;
  let config: DiscordChannelConfig;

  beforeEach(() => {
    handler = new DiscordChannelHandler();

    config = {
      type: 'discord',
      webhook_url: 'https://discord.com/api/webhooks/123456/abcdef',
      username: 'BugSpotter',
      avatar_url: 'https://example.com/avatar.png',
    };

    vi.clearAllMocks();
  });

  describe('Handler Type', () => {
    it('should have correct type identifier', () => {
      expect(handler.type).toBe('discord');
    });
  });

  describe('send()', () => {
    it('should send Discord message successfully with JSON payload', async () => {
      const payload: NotificationPayload = {
        to: 'general',
        subject: '',
        body: JSON.stringify({
          content: 'New bug reported',
          embeds: [
            {
              title: 'Bug Title',
              description: 'Bug description',
              color: 15158332,
            },
          ],
        }),
      };

      (axios.post as Mock).mockResolvedValue({
        status: 204,
        data: '',
      });

      const result = await handler.send(config, payload);

      expect(result.success).toBe(true);
      expect(result.response?.status).toBe(204);
    });

    it('should send plain text as content when body is not JSON', async () => {
      const payload: NotificationPayload = {
        to: 'general',
        subject: '',
        body: 'Plain text message',
      };

      (axios.post as Mock).mockResolvedValue({
        status: 204,
        data: '',
      });

      await handler.send(config, payload);

      expect(axios.post).toHaveBeenCalledWith(
        config.webhook_url,
        expect.objectContaining({
          content: 'Plain text message',
        }),
        expect.any(Object)
      );
    });

    it('should apply username override from config', async () => {
      const payload: NotificationPayload = {
        to: 'test',
        subject: '',
        body: JSON.stringify({ content: 'Test message' }),
      };

      (axios.post as Mock).mockResolvedValue({
        status: 204,
        data: '',
      });

      await handler.send(config, payload);

      expect(axios.post).toHaveBeenCalledWith(
        config.webhook_url,
        expect.objectContaining({
          username: 'BugSpotter',
        }),
        expect.any(Object)
      );
    });

    it('should apply avatar_url override from config', async () => {
      const payload: NotificationPayload = {
        to: 'test',
        subject: '',
        body: JSON.stringify({ content: 'Test message' }),
      };

      (axios.post as Mock).mockResolvedValue({
        status: 204,
        data: '',
      });

      await handler.send(config, payload);

      expect(axios.post).toHaveBeenCalledWith(
        config.webhook_url,
        expect.objectContaining({
          avatar_url: 'https://example.com/avatar.png',
        }),
        expect.any(Object)
      );
    });

    it('should not add config fields if not provided', async () => {
      const minimalConfig: DiscordChannelConfig = {
        type: 'discord',
        webhook_url: 'https://discord.com/api/webhooks/123/abc',
      };

      const payload: NotificationPayload = {
        to: 'test',
        subject: '',
        body: JSON.stringify({ content: 'Test message' }),
      };

      (axios.post as Mock).mockResolvedValue({
        status: 204,
        data: '',
      });

      await handler.send(minimalConfig, payload);

      const callArgs = (axios.post as Mock).mock.calls[0][1];
      expect(callArgs).not.toHaveProperty('username');
      expect(callArgs).not.toHaveProperty('avatar_url');
    });

    it('should use correct content type header', async () => {
      const payload: NotificationPayload = {
        to: 'test',
        subject: '',
        body: 'Test',
      };

      (axios.post as Mock).mockResolvedValue({
        status: 204,
        data: '',
      });

      await handler.send(config, payload);

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 50000,
        })
      );
    });

    it('should handle axios errors with response', async () => {
      const payload: NotificationPayload = {
        to: 'test',
        subject: '',
        body: 'Test',
      };

      const axiosError = {
        isAxiosError: true,
        response: {
          status: 400,
          data: { message: 'Invalid payload' },
        },
        message: 'Request failed with status code 400',
      };

      (axios.post as Mock).mockRejectedValue(axiosError);
      (axios.isAxiosError as unknown as Mock).mockReturnValue(true);

      const result = await handler.send(config, payload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid payload');
      expect(result.response?.status).toBe(400);
    });

    it('should handle axios errors without response', async () => {
      const payload: NotificationPayload = {
        to: 'test',
        subject: '',
        body: 'Test',
      };

      const axiosError = {
        isAxiosError: true,
        message: 'Network error',
      };

      (axios.post as Mock).mockRejectedValue(axiosError);
      (axios.isAxiosError as unknown as Mock).mockReturnValue(true);

      const result = await handler.send(config, payload);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('should handle non-axios errors', async () => {
      const payload: NotificationPayload = {
        to: 'test',
        subject: '',
        body: 'Test',
      };

      (axios.post as Mock).mockRejectedValue(new Error('Unknown error'));
      (axios.isAxiosError as unknown as Mock).mockReturnValue(false);

      const result = await handler.send(config, payload);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('should handle unknown error types', async () => {
      const payload: NotificationPayload = {
        to: 'test',
        subject: '',
        body: 'Test',
      };

      (axios.post as Mock).mockRejectedValue('String error');
      (axios.isAxiosError as unknown as Mock).mockReturnValue(false);

      const result = await handler.send(config, payload);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('test()', () => {
    it('should send test message with embed format', async () => {
      (axios.post as Mock).mockResolvedValue({
        status: 204,
        data: '',
      });

      const result = await handler.test(config);

      expect(result.success).toBe(true);
      expect(axios.post).toHaveBeenCalled();

      const callArgs = (axios.post as Mock).mock.calls[0][1];
      expect(callArgs.embeds).toBeDefined();
      expect(callArgs.embeds).toHaveLength(1);
    });

    it('should include configuration details in test embed', async () => {
      (axios.post as Mock).mockResolvedValue({
        status: 204,
        data: '',
      });

      await handler.test(config);

      const payload = (axios.post as Mock).mock.calls[0][1];
      const embed = payload.embeds[0];
      expect(embed.title).toContain('Test');
      expect(embed.fields).toBeDefined();
    });

    it('should include username in test message', async () => {
      (axios.post as Mock).mockResolvedValue({
        status: 204,
        data: '',
      });

      await handler.test(config);

      const payload = (axios.post as Mock).mock.calls[0][1];
      const bodyStr = JSON.stringify(payload);
      expect(bodyStr).toContain('BugSpotter');
    });

    it('should use default values when config fields are missing', async () => {
      const minimalConfig: DiscordChannelConfig = {
        type: 'discord',
        webhook_url: 'https://discord.com/api/webhooks/123/abc',
      };

      (axios.post as Mock).mockResolvedValue({
        status: 204,
        data: '',
      });

      await handler.test(minimalConfig);

      const payload = (axios.post as Mock).mock.calls[0][1];
      const bodyStr = JSON.stringify(payload);
      expect(bodyStr).toContain('BugSpotter');
    });

    it('should handle test failures', async () => {
      (axios.post as Mock).mockRejectedValue(new Error('Test failed'));
      (axios.isAxiosError as unknown as Mock).mockReturnValue(false);

      const result = await handler.test(config);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Test failed');
    });
  });

  describe('JSON Parsing', () => {
    it('should preserve complex embed structures', async () => {
      const payload: NotificationPayload = {
        to: 'test',
        subject: '',
        body: JSON.stringify({
          content: 'Main content',
          embeds: [
            {
              title: 'Embed Title',
              description: 'Embed description',
              color: 0xff0000,
              fields: [
                { name: 'Field 1', value: 'Value 1', inline: true },
                { name: 'Field 2', value: 'Value 2', inline: true },
              ],
              footer: { text: 'Footer text' },
              timestamp: '2024-01-01T00:00:00.000Z',
            },
          ],
        }),
      };

      (axios.post as Mock).mockResolvedValue({
        status: 204,
        data: '',
      });

      await handler.send(config, payload);

      const sentPayload = (axios.post as Mock).mock.calls[0][1];
      expect(sentPayload.embeds).toBeDefined();
      expect(sentPayload.embeds).toHaveLength(1);
      expect(sentPayload.embeds[0].fields).toHaveLength(2);
      expect(sentPayload.embeds[0].footer).toBeDefined();
    });
  });
});
