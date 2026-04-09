import { api, API_ENDPOINTS } from '../lib/api-client';
import type {
  IntegrationRule,
  CreateIntegrationRuleRequest,
  UpdateIntegrationRuleRequest,
} from '../types';

export const integrationRulesService = {
  /**
   * List all rules for a specific integration
   */
  list: async (platform: string, projectId: string) => {
    const res = await api.get<{ success: boolean; data: IntegrationRule[] }>(
      API_ENDPOINTS.integrations.rules.list(platform, projectId)
    );
    return res.data.data;
  },

  /**
   * Create a new integration rule
   */
  create: async (platform: string, projectId: string, payload: CreateIntegrationRuleRequest) => {
    const res = await api.post<{ success: boolean; data: IntegrationRule }>(
      API_ENDPOINTS.integrations.rules.create(platform, projectId),
      payload
    );
    return res.data.data;
  },

  /**
   * Update an existing integration rule
   */
  update: async (
    platform: string,
    projectId: string,
    ruleId: string,
    payload: UpdateIntegrationRuleRequest
  ) => {
    const res = await api.patch<{ success: boolean; data: IntegrationRule }>(
      API_ENDPOINTS.integrations.rules.update(platform, projectId, ruleId),
      payload
    );
    return res.data.data;
  },

  /**
   * Delete an integration rule
   */
  delete: async (platform: string, projectId: string, ruleId: string) => {
    const res = await api.delete<{ success: boolean; message: string }>(
      API_ENDPOINTS.integrations.rules.delete(platform, projectId, ruleId)
    );
    return res.data;
  },

  /**
   * Toggle rule enabled status
   */
  toggleEnabled: async (platform: string, projectId: string, ruleId: string, enabled: boolean) => {
    const res = await api.patch<{ success: boolean; data: IntegrationRule }>(
      API_ENDPOINTS.integrations.rules.update(platform, projectId, ruleId),
      { enabled }
    );
    return res.data.data;
  },

  /**
   * Copy rule to another project
   */
  copy: async (
    platform: string,
    projectId: string,
    ruleId: string,
    payload: { targetProjectId: string; targetIntegrationId?: string }
  ) => {
    const res = await api.post<{
      success: boolean;
      data: { message: string; rule: IntegrationRule };
    }>(API_ENDPOINTS.integrations.rules.copy(platform, projectId, ruleId), payload);
    return res.data.data;
  },
};

export default integrationRulesService;
