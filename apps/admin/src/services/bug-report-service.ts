/**
 * Bug Report Service
 * Handles bug report operations and session management
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type {
  BugReport,
  BugReportFilters,
  BugReportListResponse,
  BugStatus,
  BugPriority,
  Session,
} from '../types';

export const bugReportService = {
  getAll: async (
    filters?: BugReportFilters,
    page = 1,
    limit = 20,
    sortBy = 'created_at',
    order: 'asc' | 'desc' = 'desc'
  ): Promise<BugReportListResponse> => {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    params.append('sort_by', sortBy);
    params.append('order', order);

    if (filters?.project_id) {
      params.append('project_id', filters.project_id);
    }
    if (filters?.status) {
      params.append('status', filters.status);
    }
    if (filters?.priority) {
      params.append('priority', filters.priority);
    }
    if (filters?.created_after) {
      params.append('created_after', filters.created_after);
    }
    if (filters?.created_before) {
      params.append('created_before', filters.created_before);
    }

    const response = await api.get<{
      success: boolean;
      data: BugReport[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`${API_ENDPOINTS.bugReports.list()}?${params.toString()}`);
    // Paginated responses have data and pagination at the root level after unwrapping
    return { data: response.data.data, pagination: response.data.pagination };
  },

  getById: async (id: string): Promise<BugReport> => {
    const response = await api.get<{ success: boolean; data: BugReport }>(
      API_ENDPOINTS.bugReports.get(id)
    );
    return response.data.data;
  },

  update: async (
    id: string,
    data: { status?: BugStatus; priority?: BugPriority; description?: string }
  ): Promise<BugReport> => {
    const response = await api.patch<{ success: boolean; data: BugReport }>(
      API_ENDPOINTS.bugReports.update(id),
      data
    );
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(API_ENDPOINTS.bugReports.delete(id));
  },

  bulkDelete: async (ids: string[]): Promise<void> => {
    await api.post(API_ENDPOINTS.bugReports.bulkDelete(), { ids });
  },

  getSessions: async (bugReportId: string): Promise<Session[]> => {
    const response = await api.get<{ success: boolean; data: Session[] }>(
      `${API_ENDPOINTS.bugReports.get(bugReportId)}/sessions`
    );
    return response.data.data;
  },
};
