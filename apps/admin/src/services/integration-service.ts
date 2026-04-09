import { api, API_ENDPOINTS } from '../lib/api-client';
import type { Integration, CreateIntegrationRequest, SecurityAnalysisResult } from '../types';

export const integrationService = {
  list: async () => {
    const res = await api.get<{ success: boolean; data: Integration[] }>(
      API_ENDPOINTS.integrations.list()
    );
    return res.data.data;
  },

  create: async (payload: CreateIntegrationRequest) => {
    const res = await api.post<{ success: boolean; data: Integration }>(
      API_ENDPOINTS.integrations.create(),
      payload
    );
    return res.data.data;
  },

  getDetails: async (type: string) => {
    const res = await api.get<{ success: boolean; data: Integration }>(
      API_ENDPOINTS.integrations.getDetails(type)
    );
    return res.data.data;
  },

  update: async (type: string, data: Partial<CreateIntegrationRequest>) => {
    const res = await api.patch<{ success: boolean; data: Integration }>(
      API_ENDPOINTS.integrations.update(type),
      data
    );
    return res.data.data;
  },

  parsePluginCode: async (type: string) => {
    const res = await api.get<{
      success: boolean;
      data: {
        metadata: {
          name: string;
          platform: string;
          version: string;
          description?: string;
          author?: string;
        };
        authType: 'basic' | 'bearer' | 'api_key' | 'custom';
        createTicketCode: string;
        testConnectionCode?: string;
        validateConfigCode?: string;
      } | null;
    }>(`/api/v1/admin/integrations/${type}/parse`);
    return res.data.data;
  },

  analyzeCode: async (code: string) => {
    const res = await api.post<{ success: boolean; data: SecurityAnalysisResult }>(
      API_ENDPOINTS.integrations.analyzeCode(),
      { code }
    );
    return res.data.data;
  },

  getStatus: async (type: string) => {
    const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
      API_ENDPOINTS.integrations.getStatus(type)
    );
    return res.data.data;
  },

  getConfig: async (type: string) => {
    const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
      API_ENDPOINTS.integrations.getConfig(type)
    );
    return res.data.data;
  },

  updateConfig: async (type: string, config: Record<string, unknown>) => {
    const res = await api.put<{ success: boolean; data: Record<string, unknown> }>(
      API_ENDPOINTS.integrations.updateConfig(type),
      config
    );
    return res.data.data;
  },

  deleteConfig: async (type: string) => {
    const res = await api.delete<{ success: boolean }>(
      API_ENDPOINTS.integrations.deleteConfig(type)
    );
    return res.data;
  },

  delete: async (type: string) => {
    const res = await api.delete<{ success: boolean }>(API_ENDPOINTS.integrations.delete(type));
    return res.data;
  },

  testConnection: async (type: string, config?: Record<string, unknown>) => {
    const res = await api.post<{ success: boolean; data: Record<string, unknown> }>(
      API_ENDPOINTS.integrations.testConnection(type),
      { config: config || {} }
    );
    return res.data.data;
  },

  oauthAuthorizeUrl: async (type: string) => {
    const res = await api.get<{ success: boolean; data: { url: string } }>(
      API_ENDPOINTS.integrations.oauthAuthorize(type)
    );
    return res.data.data;
  },
};

export default integrationService;
