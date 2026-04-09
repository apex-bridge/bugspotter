/**
 * Slack Channel Handler Tests
 * Unit tests for Slack webhook notification delivery
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { SlackChannelHandler } from '../../../src/services/notifications/slack-handler.js';
import type { SlackChannelConfig, NotificationPayload } from '../../../src/types/notifications.js';
import axios from 'axios';

// Mock axios
vi.mock('axios');

describe('SlackChannelHandler', () => {
  let handler: SlackChannelHandler;
  let config: SlackChannelConfig;

  beforeEach(() => {
    handler = new SlackChannelHandler();

    config = {
      type: 'slack',
      webhook_url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX',
      channel: '#engineering',
      username: 'BugSpotter',
      icon_emoji: ':bug:',
    };

    vi.clearAllMocks();
  });

  describe('Handler Type', () => {
    it('should have correct type identifier', () => {
      expect(handler.type).toBe('slack');
    });
  });

  describe('send()', () => {
    it('should send Slack message successfully with JSON payload', async () => {
      const payload: NotificationPayload = {
        to: '#engineering',
        subject: '',
        body: JSON.stringify({
          text: 'New bug reported',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*Bug Title*: Critical issue',
              },
            },
          ],
        }),
      };

      (axios.post as Mock).mockResolvedValue({
        status: 200,
        data: 'ok',
      });

      const result = await handler.send(config, payload);

      expect(result.success).toBe(true);
      expect(result.response?.status).toBe(200);
    });

    it('should send plain text as fallback when body is not JSON', async () => {
      const payload: NotificationPayload = {
        to: '#engineering',
        subject: '',
        body: 'Plain text message',
      };

      (axios.post as Mock).mockResolvedValue({
        status: 200,
        data: 'ok',
      });

      await handler.send(config, payload);

      expect(axios.post).toHaveBeenCalledWith(
        config.webhook_url,
        expect.objectContaining({
          text: 'Plain text message',
        }),
        expect.any(Object)
      );
    });

    it('should apply channel override from config', async () => {
      const payload: NotificationPayload = {
        to: 'test',
        subject: '',
        body: JSON.stringify({ text: 'Test message' }),
      };

      (axios.post as Mock).mockResolvedValue({
        status: 200,
        data: 'ok',
      });

      await handler.send(config, payload);

      expect(axios.post).toHaveBeenCalledWith(
        config.webhook_url,
        expect.objectContaining({
          channel: '#engineering',
        }),
        expect.any(Object)
      );
    });

    it('should apply username override from config', async () => {
      const payload: NotificationPayload = {
        to: 'test',
        subject: '',
        body: JSON.stringify({ text: 'Test message' }),
      };

      (axios.post as Mock).mockResolvedValue({
        status: 200,
        data: 'ok',
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

    it('should apply icon_emoji override from config', async () => {
      const payload: NotificationPayload = {
        to: 'test',
        subject: '',
        body: JSON.stringify({ text: 'Test message' }),
      };

      (axios.post as Mock).mockResolvedValue({
        status: 200,
        data: 'ok',
      });

      await handler.send(config, payload);

      expect(axios.post).toHaveBeenCalledWith(
        config.webhook_url,
        expect.objectContaining({
          icon_emoji: ':bug:',
        }),
        expect.any(Object)
      );
    });

    it('should not add config fields if not provided', async () => {
      const minimalConfig: SlackChannelConfig = {
        type: 'slack',
        webhook_url: 'https://hooks.slack.com/services/TEST',
      };

      const payload: NotificationPayload = {
        to: 'test',
        subject: '',
        body: JSON.stringify({ text: 'Test message' }),
      };

      (axios.post as Mock).mockResolvedValue({
        status: 200,
        data: 'ok',
      });

      await handler.send(minimalConfig, payload);

      const callArgs = (axios.post as Mock).mock.calls[0][1];
      expect(callArgs).not.toHaveProperty('channel');
      expect(callArgs).not.toHaveProperty('username');
      expect(callArgs).not.toHaveProperty('icon_emoji');
    });

    it('should use correct content type header', async () => {
      const payload: NotificationPayload = {
        to: 'test',
        subject: '',
        body: 'Test',
      };

      (axios.post as Mock).mockResolvedValue({
        status: 200,
        data: 'ok',
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
          data: 'invalid_payload',
        },
        message: 'Request failed with status code 400',
      };

      (axios.post as Mock).mockRejectedValue(axiosError);
      (axios.isAxiosError as unknown as Mock).mockReturnValue(true);

      const result = await handler.send(config, payload);

      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_payload');
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
    it('should send test message with Block Kit format', async () => {
      (axios.post as Mock).mockResolvedValue({
        status: 200,
        data: 'ok',
      });

      const result = await handler.test(config);

      expect(result.success).toBe(true);
      expect(axios.post).toHaveBeenCalled();

      const callArgs = (axios.post as Mock).mock.calls[0][1];
      expect(callArgs.text).toContain('BugSpotter Test Message');
    });

    it('should include channel configuration in test message', async () => {
      (axios.post as Mock).mockResolvedValue({
        status: 200,
        data: 'ok',
      });

      await handler.test(config);

      const payload = (axios.post as Mock).mock.calls[0][1];
      const bodyStr = JSON.stringify(payload);
      expect(bodyStr).toContain('#engineering');
    });

    it('should include username configuration in test message', async () => {
      (axios.post as Mock).mockResolvedValue({
        status: 200,
        data: 'ok',
      });

      await handler.test(config);

      const payload = (axios.post as Mock).mock.calls[0][1];
      const bodyStr = JSON.stringify(payload);
      expect(bodyStr).toContain('BugSpotter');
    });

    it('should use default values when config fields are missing', async () => {
      const minimalConfig: SlackChannelConfig = {
        type: 'slack',
        webhook_url: 'https://hooks.slack.com/services/TEST',
      };

      (axios.post as Mock).mockResolvedValue({
        status: 200,
        data: 'ok',
      });

      await handler.test(minimalConfig);

      const payload = (axios.post as Mock).mock.calls[0][1];
      const bodyStr = JSON.stringify(payload);
      expect(bodyStr).toContain('Default');
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
    it('should preserve complex Block Kit structures', async () => {
      const payload: NotificationPayload = {
        to: 'test',
        subject: '',
        body: JSON.stringify({
          text: 'Fallback text',
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: 'Header',
              },
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: '*Field 1*' },
                { type: 'mrkdwn', text: '*Field 2*' },
              ],
            },
          ],
          attachments: [
            {
              color: '#ff0000',
              text: 'Attachment text',
            },
          ],
        }),
      };

      (axios.post as Mock).mockResolvedValue({
        status: 200,
        data: 'ok',
      });

      await handler.send(config, payload);

      const sentPayload = (axios.post as Mock).mock.calls[0][1];
      expect(sentPayload.blocks).toBeDefined();
      expect(sentPayload.blocks).toHaveLength(2);
      expect(sentPayload.attachments).toBeDefined();
    });
  });
});
