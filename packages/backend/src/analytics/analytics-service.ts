/**
 * Analytics Service
 * Handles complex cross-entity analytics queries for dashboard and reporting
 */

import type { Pool } from 'pg';

export interface DashboardMetrics {
  bug_reports: {
    by_status: {
      open: number;
      in_progress: number;
      resolved: number;
      closed: number;
      total: number;
    };
    by_priority: {
      low: number;
      medium: number;
      high: number;
      critical: number;
    };
  };
  projects: {
    total: number;
    total_reports: number;
    avg_reports_per_project: number;
  };
  users: {
    total: number;
  };
  time_series: Array<{
    date: string;
    count: number;
  }>;
  top_projects: Array<{
    id: string;
    name: string;
    report_count: number;
  }>;
}

export interface ReportTrendData {
  days: number;
  trend: Array<{
    date: string;
    total: number;
    open: number;
    in_progress: number;
    resolved: number;
    closed: number;
  }>;
}

export interface ProjectStats {
  id: string;
  name: string;
  created_at: Date;
  total_reports: number;
  open_reports: number;
  in_progress_reports: number;
  resolved_reports: number;
  closed_reports: number;
  critical_reports: number;
  last_report_at: Date | null;
}

export class AnalyticsService {
  constructor(private pool: Pool) {}

  /**
   * Get dashboard overview metrics
   * Optimized with CTE to reduce round trips from 6 queries to 1
   *
   * SECURITY: When organizationIds is non-null, all queries are scoped to the
   * specified organizations to prevent cross-tenant data leaks.
   * When null (self-hosted mode), all data is returned.
   *
   * @param organizationIds - Array of org UUIDs to scope to, or null for no filter (self-hosted)
   */
  async getDashboardMetrics(organizationIds: string[] | null): Promise<DashboardMetrics> {
    const result = await this.pool.query(
      `
      WITH report_stats AS (
        SELECT
          COUNT(*) FILTER (WHERE status = 'open') as open,
          COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
          COUNT(*) FILTER (WHERE status = 'closed') as closed,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE priority = 'low') as low,
          COUNT(*) FILTER (WHERE priority = 'medium') as medium,
          COUNT(*) FILTER (WHERE priority = 'high') as high,
          COUNT(*) FILTER (WHERE priority = 'critical') as critical
        FROM bug_reports
        WHERE deleted_at IS NULL
          AND ($1::uuid[] IS NULL OR organization_id = ANY($1))
      ),
      project_stats AS (
        SELECT
          COUNT(DISTINCT p.id) as total_projects,
          COALESCE(SUM(subq.report_count), 0) as total_reports,
          COALESCE(AVG(subq.report_count), 0) as avg_reports_per_project
        FROM projects p
        LEFT JOIN (
          SELECT project_id, COUNT(*) as report_count
          FROM bug_reports
          WHERE deleted_at IS NULL
            AND ($1::uuid[] IS NULL OR organization_id = ANY($1))
          GROUP BY project_id
        ) subq ON p.id = subq.project_id
        WHERE ($1::uuid[] IS NULL OR p.organization_id = ANY($1))
      ),
      user_stats AS (
        SELECT CASE
          WHEN $1::uuid[] IS NULL THEN (SELECT COUNT(*) FROM application.users)
          ELSE (SELECT COUNT(DISTINCT om.user_id) FROM saas.organization_members om
                WHERE om.organization_id = ANY($1))
        END as total_users
      ),
      time_series AS (
        SELECT
          DATE(created_at) as date,
          COUNT(*) as count
        FROM bug_reports
        WHERE created_at >= NOW() - INTERVAL '30 days'
          AND deleted_at IS NULL
          AND ($1::uuid[] IS NULL OR organization_id = ANY($1))
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      ),
      top_projects AS (
        SELECT
          p.id,
          p.name,
          COUNT(br.id) as report_count
        FROM projects p
        LEFT JOIN bug_reports br ON p.id = br.project_id AND br.deleted_at IS NULL
          AND ($1::uuid[] IS NULL OR br.organization_id = ANY($1))
        WHERE ($1::uuid[] IS NULL OR p.organization_id = ANY($1))
        GROUP BY p.id, p.name
        ORDER BY report_count DESC
        LIMIT 5
      )
      SELECT
        json_build_object(
          'status', row_to_json(rs.*),
          'priority', json_build_object(
            'low', rs.low,
            'medium', rs.medium,
            'high', rs.high,
            'critical', rs.critical
          ),
          'projects', row_to_json(ps.*),
          'users', row_to_json(us.*),
          'time_series', (SELECT json_agg(row_to_json(ts.*)) FROM time_series ts),
          'top_projects', (SELECT json_agg(row_to_json(tp.*)) FROM top_projects tp)
        ) as metrics
      FROM report_stats rs, project_stats ps, user_stats us
    `,
      [organizationIds]
    );

    const metrics = result.rows[0].metrics;

    return {
      bug_reports: {
        by_status: {
          open: parseInt(metrics.status.open),
          in_progress: parseInt(metrics.status.in_progress),
          resolved: parseInt(metrics.status.resolved),
          closed: parseInt(metrics.status.closed),
          total: parseInt(metrics.status.total),
        },
        by_priority: {
          low: parseInt(metrics.priority.low),
          medium: parseInt(metrics.priority.medium),
          high: parseInt(metrics.priority.high),
          critical: parseInt(metrics.priority.critical),
        },
      },
      projects: {
        total: parseInt(metrics.projects.total_projects),
        total_reports: parseInt(metrics.projects.total_reports),
        avg_reports_per_project: parseFloat(metrics.projects.avg_reports_per_project),
      },
      users: {
        total: parseInt(metrics.users.total_users),
      },
      time_series: (metrics.time_series || []).map((row: { date: string; count: number }) => ({
        date: row.date,
        count: parseInt(String(row.count)),
      })),
      top_projects: (metrics.top_projects || []).map(
        (row: { id: string; name: string; report_count: number }) => ({
          id: row.id,
          name: row.name,
          report_count: parseInt(String(row.report_count)),
        })
      ),
    };
  }

  /**
   * Get report trend data for specified time period
   *
   * @param organizationIds - Array of org UUIDs to scope to, or null for no filter (self-hosted)
   * @param days - Number of days to look back (1-365)
   */
  async getReportTrend(organizationIds: string[] | null, days: number): Promise<ReportTrendData> {
    // Validate days parameter (1-365)
    const validDays = Math.min(Math.max(days, 1), 365);

    const trendResult = await this.pool.query(
      `
      SELECT
        DATE(created_at) as date,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE status = 'open') as open,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
        COUNT(*) FILTER (WHERE status = 'closed') as closed
      FROM bug_reports
      WHERE created_at >= NOW() - make_interval(days => $1::int)
        AND deleted_at IS NULL
        AND ($2::uuid[] IS NULL OR organization_id = ANY($2))
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `,
      [validDays, organizationIds]
    );

    return {
      days: validDays,
      trend: trendResult.rows.map((row) => ({
        date: row.date,
        total: parseInt(row.count),
        open: parseInt(row.open),
        in_progress: parseInt(row.in_progress),
        resolved: parseInt(row.resolved),
        closed: parseInt(row.closed),
      })),
    };
  }

  /**
   * Get per-project statistics
   *
   * @param organizationIds - Array of org UUIDs to scope to, or null for no filter (self-hosted)
   */
  async getProjectStats(organizationIds: string[] | null): Promise<ProjectStats[]> {
    const statsResult = await this.pool.query(
      `
      SELECT
        p.id,
        p.name,
        p.created_at,
        COUNT(br.id) as total_reports,
        COUNT(*) FILTER (WHERE br.status = 'open') as open_reports,
        COUNT(*) FILTER (WHERE br.status = 'in_progress') as in_progress_reports,
        COUNT(*) FILTER (WHERE br.status = 'resolved') as resolved_reports,
        COUNT(*) FILTER (WHERE br.status = 'closed') as closed_reports,
        COUNT(*) FILTER (WHERE br.priority = 'critical') as critical_reports,
        MAX(br.created_at) as last_report_at
      FROM projects p
      LEFT JOIN bug_reports br ON p.id = br.project_id AND br.deleted_at IS NULL
        AND ($1::uuid[] IS NULL OR br.organization_id = ANY($1))
      WHERE ($1::uuid[] IS NULL OR p.organization_id = ANY($1))
      GROUP BY p.id, p.name, p.created_at
      ORDER BY total_reports DESC
    `,
      [organizationIds]
    );

    return statsResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      created_at: row.created_at,
      total_reports: parseInt(row.total_reports),
      open_reports: parseInt(row.open_reports),
      in_progress_reports: parseInt(row.in_progress_reports),
      resolved_reports: parseInt(row.resolved_reports),
      closed_reports: parseInt(row.closed_reports),
      critical_reports: parseInt(row.critical_reports),
      last_report_at: row.last_report_at,
    }));
  }
}
