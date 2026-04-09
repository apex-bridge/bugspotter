/**
 * Audit Log Repository
 * Handles database operations for audit logs
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import type { AuditLog, AuditLogInsert, PaginatedResult } from '../types.js';
import { createFilter } from '../filter-builder.js';
import { createPagination } from '../pagination-builder.js';
import {
  AUDIT_LOG_DEFAULT_LIST_LIMIT,
  AUDIT_LOG_DEFAULT_QUERY_LIMIT,
  AUDIT_LOG_STATISTICS_TOP_N,
} from '../constants.js';
import { ValidationError } from '../../api/middleware/error.js';

/** Valid sort columns for audit logs */
const AUDIT_LOG_SORT_FIELDS = ['timestamp', 'action', 'resource'] as const;

export interface AuditLogFilters {
  user_id?: string;
  organization_id?: string;
  action?: string;
  resource?: string;
  success?: boolean;
  start_date?: Date;
  end_date?: Date;
}

export interface AuditLogSortOptions {
  sort_by?: 'timestamp' | 'action' | 'resource';
  order?: 'asc' | 'desc';
}

export class AuditLogRepository extends BaseRepository<AuditLog, AuditLogInsert> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'audit_logs', ['details']);
  }

  /**
   * Create a new audit log entry
   */
  async create(data: AuditLogInsert): Promise<AuditLog> {
    const query = `
      INSERT INTO ${this.schema}.${this.tableName} (
        user_id, organization_id, action, resource, resource_id,
        ip_address, user_agent, details, success, error_message
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      data.user_id ?? null,
      data.organization_id ?? null,
      data.action,
      data.resource,
      data.resource_id ?? null,
      data.ip_address ?? null,
      data.user_agent ?? null,
      data.details ? JSON.stringify(data.details) : null,
      data.success ?? true,
      data.error_message ?? null,
    ];

    const result = await this.getClient().query(query, values);
    return result.rows[0];
  }

  /**
   * List audit logs with filters, sorting, and pagination
   */
  async list(
    filters: AuditLogFilters = {},
    sortOptions: AuditLogSortOptions = {},
    page = 1,
    limit = AUDIT_LOG_DEFAULT_LIST_LIMIT
  ): Promise<PaginatedResult<AuditLog>> {
    // Validate sort parameters explicitly
    if (sortOptions.sort_by && !AUDIT_LOG_SORT_FIELDS.includes(sortOptions.sort_by)) {
      throw new ValidationError(`Invalid sort column: ${sortOptions.sort_by}`, {
        provided: sortOptions.sort_by,
        allowed: [...AUDIT_LOG_SORT_FIELDS],
      });
    }

    if (sortOptions.order && sortOptions.order !== 'asc' && sortOptions.order !== 'desc') {
      throw new ValidationError(`Invalid sort order: ${sortOptions.order}`, {
        provided: sortOptions.order,
        allowed: ['asc', 'desc'],
      });
    }

    // Build WHERE clause using unified FilterBuilder
    const filter = createFilter()
      .equals('user_id', filters.user_id)
      .equals('organization_id', filters.organization_id)
      .equals('action', filters.action)
      .like('resource', filters.resource, 'startsWith')
      .equals('success', filters.success)
      .dateRange('timestamp', { after: filters.start_date, before: filters.end_date });

    const { whereClause, values, paramCount } = filter.build();

    // Get total count using base class helper
    const total = await this.executeCountQuery(whereClause, values);

    // Build pagination using unified PaginationBuilder
    const paginationBuilder = createPagination()
      .page(page, limit)
      .orderByValidated(
        sortOptions.sort_by,
        sortOptions.order,
        AUDIT_LOG_SORT_FIELDS,
        'timestamp',
        'desc'
      );

    const {
      orderByClause,
      limitClause,
      values: paginationValues,
      metadata,
    } = paginationBuilder.build(total, paramCount);

    // Get paginated data
    const dataQuery = `
      SELECT * FROM ${this.schema}.${this.tableName} ${whereClause}
      ${orderByClause}
      ${limitClause}
    `;

    const dataResult = await this.getClient().query(dataQuery, [...values, ...paginationValues]);

    return {
      data: dataResult.rows,
      pagination: metadata,
    };
  }

  /**
   * Get audit log by ID
   */
  async findById(id: string): Promise<AuditLog | null> {
    const query = `SELECT * FROM ${this.schema}.${this.tableName} WHERE id = $1`;
    const result = await this.getClient().query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Get audit logs for a specific user
   */
  async findByUserId(
    userId: string,
    limit = AUDIT_LOG_DEFAULT_QUERY_LIMIT,
    organizationId?: string
  ): Promise<AuditLog[]> {
    const conditions = ['user_id = $1'];
    const values: unknown[] = [userId];

    if (organizationId) {
      conditions.push(`organization_id = $${values.length + 1}`);
      values.push(organizationId);
    }

    values.push(limit);
    const query = `
      SELECT * FROM ${this.schema}.${this.tableName}
      WHERE ${conditions.join(' AND ')}
      ORDER BY timestamp DESC
      LIMIT $${values.length}
    `;
    const result = await this.getClient().query(query, values);
    return result.rows;
  }

  /**
   * Get audit logs for a specific resource
   */
  async findByResource(
    resource: string,
    resourceId?: string,
    limit = AUDIT_LOG_DEFAULT_QUERY_LIMIT
  ): Promise<AuditLog[]> {
    let query = `
      SELECT * FROM ${this.schema}.${this.tableName}
      WHERE resource = $1
    `;
    const values: unknown[] = [resource];

    if (resourceId) {
      query += ` AND resource_id = $2`;
      values.push(resourceId);
    }

    query += ` ORDER BY timestamp DESC LIMIT $${values.length + 1}`;
    values.push(limit);

    const result = await this.getClient().query(query, values);
    return result.rows;
  }

  /**
   * Get recent audit logs
   */
  async getRecent(
    limit = AUDIT_LOG_DEFAULT_QUERY_LIMIT,
    organizationId?: string
  ): Promise<AuditLog[]> {
    if (organizationId) {
      const query = `
        SELECT * FROM ${this.schema}.${this.tableName}
        WHERE organization_id = $1
        ORDER BY timestamp DESC
        LIMIT $2
      `;
      const result = await this.getClient().query(query, [organizationId, limit]);
      return result.rows;
    }

    const query = `
      SELECT * FROM ${this.schema}.${this.tableName}
      ORDER BY timestamp DESC
      LIMIT $1
    `;
    const result = await this.getClient().query(query, [limit]);
    return result.rows;
  }

  /**
   * Delete old audit logs (for retention/cleanup)
   */
  async deleteOlderThan(date: Date): Promise<number> {
    const query = `DELETE FROM ${this.schema}.${this.tableName} WHERE timestamp < $1`;
    const result = await this.getClient().query(query, [date]);
    return result.rowCount || 0;
  }

  /**
   * Get audit log statistics
   */
  async getStatistics(
    startDate?: Date,
    endDate?: Date,
    organizationId?: string
  ): Promise<{
    total: number;
    success: number;
    failures: number;
    by_action: Array<{ action: string; count: number }>;
    by_user: Array<{ user_id: string; count: number }>;
  }> {
    const filter = createFilter()
      .equals('organization_id', organizationId)
      .dateRange('timestamp', { after: startDate, before: endDate });
    const { conditions, values } = filter.buildConditions();

    // Run all queries in parallel for better performance
    const [basics, by_action, by_user] = await Promise.all([
      this.getStatsBasics(conditions, values),
      this.getActionBreakdown(conditions, values),
      this.getUserBreakdown(conditions, values),
    ]);

    return { ...basics, by_action, by_user };
  }

  /**
   * Get basic statistics (total, success, failures)
   */
  private async getStatsBasics(
    conditions: string,
    values: unknown[]
  ): Promise<{ total: number; success: number; failures: number }> {
    const whereClause = conditions ? `WHERE ${conditions}` : '';

    const query = `
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN success = true THEN 1 ELSE 0 END), 0) as success,
        COALESCE(SUM(CASE WHEN success = false THEN 1 ELSE 0 END), 0) as failures
      FROM ${this.schema}.${this.tableName} ${whereClause}
    `;

    const result = await this.getClient().query(query, values);
    const stats = result.rows[0];

    return {
      total: parseInt(stats.total, 10),
      success: parseInt(stats.success, 10),
      failures: parseInt(stats.failures, 10),
    };
  }

  /**
   * Get action breakdown statistics
   */
  private async getActionBreakdown(
    conditions: string,
    values: unknown[]
  ): Promise<Array<{ action: string; count: number }>> {
    const whereClause = conditions ? `WHERE ${conditions}` : '';

    // Note: LIMIT uses constant interpolation (not parameterized) because
    // AUDIT_LOG_STATISTICS_TOP_N is a compile-time constant (not user input),
    // making it safe from SQL injection by definition.
    const query = `
      SELECT action, COUNT(*) as count
      FROM ${this.schema}.${this.tableName} ${whereClause}
      GROUP BY action
      ORDER BY count DESC
      LIMIT ${AUDIT_LOG_STATISTICS_TOP_N}
    `;

    const result = await this.getClient().query(query, values);
    return result.rows.map((row: { action: string; count: string }) => ({
      action: row.action,
      count: parseInt(row.count, 10),
    }));
  }

  /**
   * Get user breakdown statistics (excludes null user_id)
   */
  private async getUserBreakdown(
    conditions: string,
    values: unknown[]
  ): Promise<Array<{ user_id: string; count: number }>> {
    // Compose conditions cleanly before adding WHERE keyword
    const allConditions = conditions
      ? `${conditions} AND user_id IS NOT NULL`
      : 'user_id IS NOT NULL';

    // Note: LIMIT uses constant interpolation (not parameterized) because
    // AUDIT_LOG_STATISTICS_TOP_N is a compile-time constant (not user input),
    // making it safe from SQL injection by definition.
    const query = `
      SELECT user_id, COUNT(*) as count
      FROM ${this.schema}.${this.tableName} WHERE ${allConditions}
      GROUP BY user_id
      ORDER BY count DESC
      LIMIT ${AUDIT_LOG_STATISTICS_TOP_N}
    `;

    const result = await this.getClient().query(query, values);
    return result.rows.map((row: { user_id: string; count: string }) => ({
      user_id: row.user_id,
      count: parseInt(row.count, 10),
    }));
  }
}
