/**
 * API Key Service
 * Handles API key CRUD operations
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type {
  ApiKey,
  CreateApiKeyData,
  ApiKeyResponse,
  ApiKeyUsage,
  ApiKeyListResponse,
} from '../types/api-keys';

export const apiKeyService = {
  getAll: async (
    page = 1,
    limit = 20,
    status?: 'active' | 'expiring' | 'expired' | 'revoked'
  ): Promise<ApiKeyListResponse> => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });
    if (status) {
      params.append('status', status);
    }
    const response = await api.get<{
      success: boolean;
      data: ApiKey[];
      pagination: ApiKeyListResponse['pagination'];
    }>(`${API_ENDPOINTS.apiKeys.list()}?${params.toString()}`);
    return {
      data: response.data.data,
      pagination: response.data.pagination,
    };
  },

  create: async (data: CreateApiKeyData): Promise<ApiKeyResponse> => {
    const response = await api.post<{
      success: boolean;
      data: { api_key: string; key_details: Omit<ApiKeyResponse, 'api_key'> };
    }>(API_ENDPOINTS.apiKeys.create(), data);

    // Backend returns { api_key, key_details }, flatten to ApiKeyResponse
    const { api_key, key_details } = response.data.data;
    return {
      ...key_details,
      api_key,
    };
  },

  revoke: async (id: string): Promise<void> => {
    await api.delete(API_ENDPOINTS.apiKeys.delete(id));
  },

  rotate: async (id: string): Promise<ApiKeyResponse> => {
    const response = await api.post<{
      success: boolean;
      data: { new_api_key: string; key_details: Omit<ApiKeyResponse, 'api_key'> };
    }>(API_ENDPOINTS.apiKeys.rotate(id));

    // Backend returns { new_api_key, key_details }, flatten to ApiKeyResponse
    const { new_api_key, key_details } = response.data.data;
    return {
      ...key_details,
      api_key: new_api_key,
    };
  },

  getUsage: async (id: string): Promise<ApiKeyUsage> => {
    const response = await api.get<{ success: boolean; data: ApiKeyUsage }>(
      API_ENDPOINTS.apiKeys.usage(id)
    );
    return response.data.data;
  },
};
