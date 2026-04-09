/**
 * Audit Log Types
 */

export interface AuditLog {
  id: string;
  timestamp: string;
  user_id: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  details: Record<string, unknown> | null;
  success: boolean;
  error_message: string | null;
}

export interface AuditLogFilters {
  user_id?: string;
  action?: string;
  resource?: string;
  success?: boolean;
  start_date?: string;
  end_date?: string;
}

export interface AuditLogStatistics {
  total: number;
  success: number;
  failures: number;
  by_action: Array<{
    action: string;
    count: number;
  }>;
  by_user: Array<{
    user_id: string;
    count: number;
  }>;
}
export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AuditLogsResponse {
  success: boolean;
  data: AuditLog[];
  pagination: PaginationInfo;
}

export interface AuditLogResponse {
  success: boolean;
  data: AuditLog;
}

export interface AuditStatisticsResponse {
  success: boolean;
  data: AuditLogStatistics;
}

export interface AuditLogsSimpleResponse {
  success: boolean;
  data: AuditLog[];
  count: number;
}
