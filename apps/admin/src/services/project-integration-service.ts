/**
 * Project Integration Service
 * Handles project-specific integration configuration (credentials, settings)
 */

import { api, API_ENDPOINTS } from '../lib/api-client';

export interface ProjectIntegrationConfig {
  platform: string;
  enabled: boolean;
  config: Record<string, unknown>;
  credential_hints?: Record<string, string>;
  /** @deprecated Use credential_hints instead */
  credential_keys?: string[];
}

export interface ConfigureProjectIntegrationRequest {
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
  enabled?: boolean;
}

export const projectIntegrationService = {
  /**
   * Configure integration for a specific project
   * Creates or updates project_integrations entry
   */
  configure: async (
    platform: string,
    projectId: string,
    data: ConfigureProjectIntegrationRequest
  ): Promise<{ message: string }> => {
    const response = await api.post<{ success: boolean; data: { message: string } }>(
      API_ENDPOINTS.projectIntegrations.configure(platform, projectId),
      data
    );
    return response.data.data;
  },

  /**
   * Get integration configuration for a project
   */
  get: async (platform: string, projectId: string): Promise<ProjectIntegrationConfig | null> => {
    const response = await api.get<{ success: boolean; data: ProjectIntegrationConfig | null }>(
      API_ENDPOINTS.projectIntegrations.get(platform, projectId)
    );
    return response.data.data;
  },

  /**
   * Update integration enabled status
   */
  updateStatus: async (
    platform: string,
    projectId: string,
    enabled: boolean
  ): Promise<{ message: string }> => {
    const response = await api.patch<{ success: boolean; data: { message: string } }>(
      API_ENDPOINTS.projectIntegrations.update(platform, projectId),
      { enabled }
    );
    return response.data.data;
  },

  /**
   * Delete integration configuration for a project
   */
  delete: async (platform: string, projectId: string): Promise<{ message: string }> => {
    const response = await api.delete<{ success: boolean; data: { message: string } }>(
      API_ENDPOINTS.projectIntegrations.delete(platform, projectId)
    );
    return response.data.data;
  },

  /**
   * Test integration connection with provided config
   */
  testConnection: async (
    platform: string,
    config: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    const response = await api.post<{ success: boolean; data: Record<string, unknown> }>(
      API_ENDPOINTS.projectIntegrations.testConnection(platform),
      config
    );
    return response.data.data;
  },
};

export default projectIntegrationService;
