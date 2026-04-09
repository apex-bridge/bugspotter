/**
 * Notification Service Tests
 * Tests for notification channels, rules, and history API
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notificationService } from '../../services/api';
import { api } from '../../lib/api-client';
import type { NotificationChannel, NotificationRule, TriggerCondition } from '../../types';

// Mock the api client
vi.mock('../../lib/api-client', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    handleApiError: vi.fn((error) => error.message),
  };
});

describe('notificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Channel operations', () => {
    describe('getChannels', () => {
      it('fetches channels with default parameters', async () => {
        const mockResponse = {
          data: {
            data: {
              channels: [],
              pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
            },
          },
        };
        vi.mocked(api.get).mockResolvedValue(mockResponse);

        const result = await notificationService.getChannels();

        expect(api.get).toHaveBeenCalledWith('/api/v1/notifications/channels', {
          params: {},
        });
        expect(result.channels).toEqual([]);
      });

      it('includes filters in query params', async () => {
        const mockResponse = {
          data: {
            data: {
              channels: [],
              pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
            },
          },
        };
        vi.mocked(api.get).mockResolvedValue(mockResponse);

        await notificationService.getChannels({
          project_id: 'project-123',
          type: 'email',
          active: true,
          page: 1,
          limit: 50,
        });

        expect(api.get).toHaveBeenCalledWith('/api/v1/notifications/channels', {
          params: {
            project_id: 'project-123',
            type: 'email',
            active: true,
            page: 1,
            limit: 50,
          },
        });
      });
    });

    describe('createChannel', () => {
      it('creates a new notification channel', async () => {
        const mockChannel: NotificationChannel = {
          id: 'channel-123',
          project_id: 'project-123',
          name: 'Email Alerts',
          type: 'email',
          config: { smtp: { host: 'smtp.example.com' }, from: 'test@example.com' },
          active: true,
          last_success_at: null,
          last_failure_at: null,
          failure_count: 0,
          created_at: '2025-10-22T00:00:00Z',
          updated_at: '2025-10-22T00:00:00Z',
        };

        const mockResponse = {
          data: { data: mockChannel },
        };
        vi.mocked(api.post).mockResolvedValue(mockResponse);

        const result = await notificationService.createChannel({
          project_id: 'project-123',
          name: 'Email Alerts',
          type: 'email',
          config: { smtp: { host: 'smtp.example.com' }, from: 'test@example.com' },
          active: true,
        });

        expect(api.post).toHaveBeenCalledWith('/api/v1/notifications/channels', {
          project_id: 'project-123',
          name: 'Email Alerts',
          type: 'email',
          config: { smtp: { host: 'smtp.example.com' }, from: 'test@example.com' },
          active: true,
        });
        expect(result).toEqual(mockChannel);
      });
    });

    describe('updateChannel', () => {
      it('updates an existing channel', async () => {
        const mockChannel: NotificationChannel = {
          id: 'channel-123',
          project_id: 'project-123',
          name: 'Updated Email Alerts',
          type: 'email',
          config: { smtp: { host: 'smtp.example.com' }, from: 'test@example.com' },
          active: false,
          last_success_at: null,
          last_failure_at: null,
          failure_count: 0,
          created_at: '2025-10-22T00:00:00Z',
          updated_at: '2025-10-22T01:00:00Z',
        };

        const mockResponse = {
          data: { data: mockChannel },
        };
        vi.mocked(api.patch).mockResolvedValue(mockResponse);

        const result = await notificationService.updateChannel('channel-123', {
          name: 'Updated Email Alerts',
          active: false,
        });

        expect(api.patch).toHaveBeenCalledWith('/api/v1/notifications/channels/channel-123', {
          name: 'Updated Email Alerts',
          active: false,
        });
        expect(result).toEqual(mockChannel);
      });
    });

    describe('deleteChannel', () => {
      it('deletes a channel', async () => {
        vi.mocked(api.delete).mockResolvedValue({ data: {} });

        await notificationService.deleteChannel('channel-123');

        expect(api.delete).toHaveBeenCalledWith('/api/v1/notifications/channels/channel-123');
      });
    });

    describe('testChannel', () => {
      it('tests channel delivery successfully', async () => {
        const mockResponse = {
          data: {
            data: {
              delivered: true,
              message: 'Test notification sent successfully',
              response: { message_id: 'msg-123' },
            },
          },
        };
        vi.mocked(api.post).mockResolvedValue(mockResponse);

        const result = await notificationService.testChannel('channel-123', 'Test message');

        expect(api.post).toHaveBeenCalledWith('/api/v1/notifications/channels/channel-123/test', {
          test_message: 'Test message',
        });
        expect(result.delivered).toBe(true);
        expect(result.message).toBe('Test notification sent successfully');
      });

      it('handles test failure', async () => {
        const mockResponse = {
          data: {
            data: {
              delivered: false,
              message: 'Test notification failed',
              error: 'SMTP connection refused',
            },
          },
        };
        vi.mocked(api.post).mockResolvedValue(mockResponse);

        const result = await notificationService.testChannel('channel-123');

        expect(result.delivered).toBe(false);
        expect(result.error).toBe('SMTP connection refused');
      });
    });
  });

  describe('Rule operations', () => {
    describe('getRules', () => {
      it('fetches rules with default parameters', async () => {
        const mockResponse = {
          data: {
            data: {
              rules: [],
              pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
            },
          },
        };
        vi.mocked(api.get).mockResolvedValue(mockResponse);

        const result = await notificationService.getRules();

        expect(api.get).toHaveBeenCalledWith('/api/v1/notifications/rules', {
          params: {},
        });
        expect(result.rules).toEqual([]);
      });

      it('includes filters in query params', async () => {
        const mockResponse = {
          data: {
            data: {
              rules: [],
              pagination: { page: 2, limit: 50, total: 0, totalPages: 0 },
            },
          },
        };
        vi.mocked(api.get).mockResolvedValue(mockResponse);

        await notificationService.getRules({
          project_id: 'project-123',
          enabled: true,
          page: 2,
          limit: 50,
        });

        expect(api.get).toHaveBeenCalledWith('/api/v1/notifications/rules', {
          params: {
            project_id: 'project-123',
            enabled: true,
            page: 2,
            limit: 50,
          },
        });
      });
    });

    describe('createRule', () => {
      it('creates a new notification rule', async () => {
        const triggers: TriggerCondition[] = [
          {
            event: 'new_bug',
            params: { priority: 'critical' },
          },
        ];

        const mockRule: NotificationRule = {
          id: 'rule-123',
          project_id: 'project-123',
          name: 'Critical Bug Alert',
          enabled: true,
          triggers,
          filters: null,
          throttle: null,
          schedule: null,
          priority: 9,
          created_at: '2025-10-22T00:00:00Z',
          updated_at: '2025-10-22T00:00:00Z',
        };

        const mockResponse = {
          data: { data: mockRule },
        };
        vi.mocked(api.post).mockResolvedValue(mockResponse);

        const result = await notificationService.createRule({
          project_id: 'project-123',
          name: 'Critical Bug Alert',
          enabled: true,
          triggers,
          priority: 9,
          channel_ids: ['channel-123'],
        });

        expect(api.post).toHaveBeenCalledWith('/api/v1/notifications/rules', {
          project_id: 'project-123',
          name: 'Critical Bug Alert',
          enabled: true,
          triggers,
          priority: 9,
          channel_ids: ['channel-123'],
        });
        expect(result).toEqual(mockRule);
      });
    });

    describe('updateRule', () => {
      it('updates an existing rule', async () => {
        const mockRule: NotificationRule = {
          id: 'rule-123',
          project_id: 'project-123',
          name: 'Updated Alert',
          enabled: false,
          triggers: [{ event: 'new_bug' }],
          filters: null,
          throttle: null,
          schedule: null,
          priority: 5,
          created_at: '2025-10-22T00:00:00Z',
          updated_at: '2025-10-22T01:00:00Z',
        };

        const mockResponse = {
          data: { data: mockRule },
        };
        vi.mocked(api.patch).mockResolvedValue(mockResponse);

        const result = await notificationService.updateRule('rule-123', {
          name: 'Updated Alert',
          enabled: false,
        });

        expect(api.patch).toHaveBeenCalledWith('/api/v1/notifications/rules/rule-123', {
          name: 'Updated Alert',
          enabled: false,
        });
        expect(result).toEqual(mockRule);
      });
    });

    describe('deleteRule', () => {
      it('deletes a rule', async () => {
        vi.mocked(api.delete).mockResolvedValue({ data: {} });

        await notificationService.deleteRule('rule-123');

        expect(api.delete).toHaveBeenCalledWith('/api/v1/notifications/rules/rule-123');
      });
    });
  });

  describe('History operations', () => {
    describe('getHistory', () => {
      it('fetches notification history with default parameters', async () => {
        const mockResponse = {
          data: {
            data: {
              history: [],
              pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
            },
          },
        };
        vi.mocked(api.get).mockResolvedValue(mockResponse);

        const result = await notificationService.getHistory();

        expect(api.get).toHaveBeenCalledWith('/api/v1/notifications/history', {
          params: {},
        });
        expect(result.history).toEqual([]);
      });

      it('includes all filters in query params', async () => {
        const mockResponse = {
          data: {
            data: {
              history: [],
              pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
            },
          },
        };
        vi.mocked(api.get).mockResolvedValue(mockResponse);

        await notificationService.getHistory({
          channel_id: 'channel-123',
          rule_id: 'rule-123',
          bug_id: 'bug-123',
          status: 'sent',
          created_after: '2025-10-01T00:00:00Z',
          created_before: '2025-10-31T23:59:59Z',
          page: 1,
          limit: 20,
        });

        expect(api.get).toHaveBeenCalledWith('/api/v1/notifications/history', {
          params: {
            channel_id: 'channel-123',
            rule_id: 'rule-123',
            bug_id: 'bug-123',
            status: 'sent',
            created_after: '2025-10-01T00:00:00Z',
            created_before: '2025-10-31T23:59:59Z',
            page: 1,
            limit: 20,
          },
        });
      });
    });
  });
});
