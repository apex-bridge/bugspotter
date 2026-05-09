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
    order: 'asc' | 'desc' = 'desc',
    organizationId?: string | null
  ): Promise<BugReportListResponse> => {
    // Use the `params` option so axios handles serialization +
    // url-encoding for us. Matches the call shape in `project-service`,
    // `user-service`, and the api-key service. Conditional spreads
    // drop falsy fields cleanly. Backend ignores `organization_id`
    // for non-admins per PR #115's security boundary.
    const params: Record<string, string | number> = {
      page,
      limit,
      sort_by: sortBy,
      order,
      ...(filters?.project_id && { project_id: filters.project_id }),
      ...(filters?.status && { status: filters.status }),
      ...(filters?.priority && { priority: filters.priority }),
      ...(filters?.created_after && { created_after: filters.created_after }),
      ...(filters?.created_before && { created_before: filters.created_before }),
      ...(organizationId && { organization_id: organizationId }),
    };

    const response = await api.get<{
      success: boolean;
      data: BugReport[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(API_ENDPOINTS.bugReports.list(), { params });
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
