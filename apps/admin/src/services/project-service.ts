/**
 * Project Service
 * Handles project CRUD operations
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type { Project } from '../types';
import type { ProjectIntegration } from '../types/integration';

export const projectService = {
  getAll: async (): Promise<Project[]> => {
    const response = await api.get<{ success: boolean; data: Project[] }>(
      API_ENDPOINTS.projects.list()
    );
    return response.data.data;
  },

  getById: async (id: string): Promise<Project> => {
    const response = await api.get<{ success: boolean; data: Project }>(
      API_ENDPOINTS.projects.get(id)
    );
    return response.data.data;
  },

  create: async (name: string, organizationId?: string): Promise<Project> => {
    const response = await api.post<{ success: boolean; data: Project }>(
      API_ENDPOINTS.projects.create(),
      { name, organization_id: organizationId }
    );
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(API_ENDPOINTS.projects.delete(id));
  },

  regenerateApiKey: async (id: string): Promise<Project> => {
    const response = await api.post<{ success: boolean; data: Project }>(
      `${API_ENDPOINTS.projects.get(id)}/regenerate-key`
    );
    return response.data.data;
  },

  listIntegrations: async (projectId: string): Promise<ProjectIntegration[]> => {
    const response = await api.get<{
      success: boolean;
      data: ProjectIntegration[];
    }>(API_ENDPOINTS.projects.integrations(projectId));
    return response.data.data;
  },
};
