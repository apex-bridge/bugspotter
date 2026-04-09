/**
 * Setup Service
 * Handles initial system setup and configuration
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type { SetupStatus, SetupRequest, AuthResponse } from '../types';

export const setupService = {
  getStatus: async (): Promise<SetupStatus> => {
    const response = await api.get<{ success: boolean; data: SetupStatus }>(
      API_ENDPOINTS.setup.status()
    );
    return response.data.data;
  },

  initialize: async (data: SetupRequest): Promise<AuthResponse> => {
    const response = await api.post<{ success: boolean; data: AuthResponse }>(
      API_ENDPOINTS.setup.initialize(),
      data
    );
    return response.data.data;
  },

  testStorageConnection: async (data: {
    storage_type?: string;
    storage_endpoint?: string;
    storage_access_key?: string;
    storage_secret_key?: string;
    storage_bucket?: string;
    storage_region?: string;
  }): Promise<{ success: boolean; error?: string }> => {
    const response = await api.post(API_ENDPOINTS.setup.testStorage(), data);
    return response.data;
  },
};
