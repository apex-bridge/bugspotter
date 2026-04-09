/**
 * Audit Log API Service
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type {
  AuditLogsResponse,
  AuditLogResponse,
  AuditStatisticsResponse,
  AuditLogsSimpleResponse,
  AuditLogFilters,
} from '../types/audit';

export const auditLogService = {
  /**
   * Get audit logs with optional filters, sorting, and pagination
   */
  async getAuditLogs(
    filters: AuditLogFilters = {},
    sortBy: string = 'timestamp',
    sortOrder: 'asc' | 'desc' = 'desc',
    page: number = 1,
    limit: number = 50
  ): Promise<AuditLogsResponse> {
    const params = new URLSearchParams({
      sort_by: sortBy,
      sort_order: sortOrder,
      page: page.toString(),
      limit: limit.toString(),
    });

    if (filters.user_id) {
      params.append('user_id', filters.user_id);
    }
    if (filters.action) {
      params.append('action', filters.action);
    }
    if (filters.resource) {
      params.append('resource', filters.resource);
    }
    if (filters.success !== undefined) {
      params.append('success', filters.success.toString());
    }
    if (filters.start_date) {
      params.append('start_date', filters.start_date);
    }
    if (filters.end_date) {
      params.append('end_date', filters.end_date);
    }

    const response = await api.get(`${API_ENDPOINTS.auditLogs.list()}?${params.toString()}`);
    return response.data;
  },

  /**
   * Get a specific audit log by ID
   */
  async getAuditLogById(id: string): Promise<AuditLogResponse> {
    const response = await api.get(API_ENDPOINTS.auditLogs.get(id));
    return response.data;
  },

  /**
   * Get audit log statistics
   */
  async getStatistics(): Promise<AuditStatisticsResponse> {
    const response = await api.get(API_ENDPOINTS.auditLogs.statistics());
    return response.data;
  },

  /**
   * Get recent audit logs
   */
  async getRecent(limit: number = 100): Promise<AuditLogsSimpleResponse> {
    const response = await api.get(`${API_ENDPOINTS.auditLogs.recent()}?limit=${limit}`);
    return response.data;
  },

  /**
   * Get audit logs for a specific user
   */
  async getByUserId(userId: string, limit: number = 100): Promise<AuditLogsSimpleResponse> {
    const response = await api.get(`${API_ENDPOINTS.auditLogs.byUser(userId)}?limit=${limit}`);
    return response.data;
  },
};
