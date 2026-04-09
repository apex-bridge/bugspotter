/**
 * Admin Service
 * Handles admin-specific operations (health, settings)
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type { HealthStatus } from '../types';

type Settings = {
  [key: string]: unknown;
};

export const adminService = {
  getHealth: async (): Promise<HealthStatus> => {
    const response = await api.get<{ success: boolean; data: HealthStatus }>(
      API_ENDPOINTS.admin.health()
    );
    return response.data.data;
  },

  getSettings: async (): Promise<Settings> => {
    const response = await api.get<{ success: boolean; data: Settings }>(
      API_ENDPOINTS.admin.settings()
    );
    return response.data.data;
  },

  updateSettings: async (data: Settings): Promise<Settings> => {
    const response = await api.patch<{ success: boolean; data: Settings }>(
      API_ENDPOINTS.admin.settings(),
      data
    );
    return response.data.data;
  },
};
