/**
 * Notification Service
 * Handles notification channels, rules, and history
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type {
  NotificationChannelListResponse,
  NotificationRuleListResponse,
  NotificationHistoryListResponse,
  NotificationChannel,
  NotificationRule,
  TriggerCondition,
  FilterCondition,
  ThrottleConfig,
  ScheduleConfig,
} from '../types';

export const notificationService = {
  // Channels
  getChannels: async (
    params: {
      project_id?: string;
      type?: string;
      active?: boolean;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<NotificationChannelListResponse> => {
    const response = await api.get<{ success: boolean; data: NotificationChannelListResponse }>(
      API_ENDPOINTS.notifications.channels.list(),
      { params }
    );
    return response.data.data;
  },

  createChannel: async (data: {
    project_id: string;
    name: string;
    type: string;
    config: Record<string, unknown>;
    active?: boolean;
  }): Promise<NotificationChannel> => {
    const response = await api.post<{ success: boolean; data: NotificationChannel }>(
      API_ENDPOINTS.notifications.channels.create(),
      data
    );
    return response.data.data;
  },

  updateChannel: async (
    id: string,
    data: {
      name?: string;
      config?: Record<string, unknown>;
      active?: boolean;
    }
  ): Promise<NotificationChannel> => {
    const response = await api.patch<{ success: boolean; data: NotificationChannel }>(
      API_ENDPOINTS.notifications.channels.update(id),
      data
    );
    return response.data.data;
  },

  deleteChannel: async (id: string): Promise<void> => {
    await api.delete(API_ENDPOINTS.notifications.channels.delete(id));
  },

  testChannel: async (
    id: string,
    test_message?: string
  ): Promise<{ delivered: boolean; message: string; response?: unknown; error?: string }> => {
    const response = await api.post<{
      success: boolean;
      data: { delivered: boolean; message: string; response?: unknown; error?: string };
    }>(API_ENDPOINTS.notifications.channels.test(id), { test_message });
    return response.data.data;
  },

  // Rules
  getRules: async (
    params: {
      project_id?: string;
      enabled?: boolean;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<NotificationRuleListResponse> => {
    const response = await api.get<{ success: boolean; data: NotificationRuleListResponse }>(
      API_ENDPOINTS.notifications.rules.list(),
      { params }
    );
    return response.data.data;
  },

  createRule: async (data: {
    project_id: string;
    name: string;
    enabled?: boolean;
    triggers: TriggerCondition[];
    filters?: FilterCondition[];
    throttle?: ThrottleConfig;
    schedule?: ScheduleConfig;
    priority?: number;
    channel_ids: string[];
  }): Promise<NotificationRule> => {
    const response = await api.post<{ success: boolean; data: NotificationRule }>(
      API_ENDPOINTS.notifications.rules.create(),
      data
    );
    return response.data.data;
  },

  updateRule: async (
    id: string,
    data: {
      name?: string;
      enabled?: boolean;
      triggers?: TriggerCondition[];
      filters?: FilterCondition[];
      throttle?: ThrottleConfig;
      schedule?: ScheduleConfig;
      priority?: number;
      channel_ids?: string[];
    }
  ): Promise<NotificationRule> => {
    const response = await api.patch<{ success: boolean; data: NotificationRule }>(
      API_ENDPOINTS.notifications.rules.update(id),
      data
    );
    return response.data.data;
  },

  deleteRule: async (id: string): Promise<void> => {
    await api.delete(API_ENDPOINTS.notifications.rules.delete(id));
  },

  // History
  getHistory: async (
    params: {
      channel_id?: string;
      rule_id?: string;
      bug_id?: string;
      status?: string;
      created_after?: string;
      created_before?: string;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<NotificationHistoryListResponse> => {
    const response = await api.get<{ success: boolean; data: NotificationHistoryListResponse }>(
      API_ENDPOINTS.notifications.history.list(),
      { params }
    );
    return response.data.data;
  },
};
