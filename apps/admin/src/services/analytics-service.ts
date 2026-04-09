/**
 * Analytics Service
 * Handles analytics and reporting operations
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type { AnalyticsDashboard, ReportTrend, ProjectStats } from '../types';

export const analyticsService = {
  getDashboard: async (): Promise<AnalyticsDashboard> => {
    const response = await api.get<{ success: boolean; data: AnalyticsDashboard }>(
      API_ENDPOINTS.analytics.dashboard()
    );
    return response.data.data;
  },

  getReportTrend: async (days: number = 30): Promise<ReportTrend> => {
    const response = await api.get<{ success: boolean; data: ReportTrend }>(
      API_ENDPOINTS.analytics.reportsTrend(),
      { params: { days } }
    );
    return response.data.data;
  },

  getProjectStats: async (): Promise<ProjectStats[]> => {
    const response = await api.get<{ success: boolean; data: ProjectStats[] }>(
      API_ENDPOINTS.analytics.projectsStats()
    );
    return response.data.data;
  },
};
