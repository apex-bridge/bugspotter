/**
 * Analytics Service
 * Handles analytics and reporting operations
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type { AnalyticsDashboard, ReportTrend, ProjectStats } from '../types';

// Platform admin can narrow the cross-org view via `?organization_id=`.
// Backend ignores the param for non-admins (security boundary lives in
// resolveAnalyticsScope). Matches the call shape used by project-service,
// bug-report-service, user-service, and api-key-service.
export const analyticsService = {
  getDashboard: async (organizationId?: string | null): Promise<AnalyticsDashboard> => {
    const response = await api.get<{ success: boolean; data: AnalyticsDashboard }>(
      API_ENDPOINTS.analytics.dashboard(),
      { params: organizationId ? { organization_id: organizationId } : undefined }
    );
    return response.data.data;
  },

  getReportTrend: async (
    days: number = 30,
    organizationId?: string | null
  ): Promise<ReportTrend> => {
    const response = await api.get<{ success: boolean; data: ReportTrend }>(
      API_ENDPOINTS.analytics.reportsTrend(),
      { params: { days, ...(organizationId && { organization_id: organizationId }) } }
    );
    return response.data.data;
  },

  getProjectStats: async (organizationId?: string | null): Promise<ProjectStats[]> => {
    const response = await api.get<{ success: boolean; data: ProjectStats[] }>(
      API_ENDPOINTS.analytics.projectsStats(),
      { params: organizationId ? { organization_id: organizationId } : undefined }
    );
    return response.data.data;
  },
};
