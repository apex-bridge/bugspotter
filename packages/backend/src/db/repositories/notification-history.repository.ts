/**
 * Notification History Repository
 * Handles CRUD operations for notification delivery logs
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import type {
  NotificationHistory,
  NotificationHistoryWithDetails,
  NotificationHistoryFilters,
  NotificationStatus,
  ChannelType,
} from '../../types/notifications.js';
import type { PaginatedResult } from '../types.js';

interface CreateHistoryInput {
  channel_id: string;
  rule_id: string;
  template_id?: string;
  bug_id?: string;
  recipients: string[];
  payload: Record<string, unknown>;
  status: NotificationStatus;
  error?: string;
  attempts?: number;
}

interface UpdateHistoryInput {
  response?: Record<string, unknown>;
  status?: NotificationStatus;
  error?: string;
  attempts?: number;
  delivered_at?: Date;
}

export class NotificationHistoryRepository extends BaseRepository<
  NotificationHistory,
  CreateHistoryInput,
  UpdateHistoryInput
> {
  // Filterable columns for WHERE clause aliasing
  private readonly FILTERABLE_COLUMNS = [
    'channel_id',
    'rule_id',
    'bug_id',
    'status',
    'template_id',
    'created_at',
  ] as const;

  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'notification_history', ['payload', 'response']);
  }

  /**
   * Build SELECT clause with details from joined tables
   */
  private buildDetailsSelect(alias: string = 'h'): string {
    return `
      ${alias}.*,
      c.name as channel_name,
      c.type as channel_type,
      r.name as rule_name,
      b.title as bug_title
    `;
  }

  /**
   * Build LEFT JOIN clauses for related tables
   */
  private buildDetailsJoins(alias: string = 'h'): string {
    return `
      LEFT JOIN ${this.schema}.notification_channels c ON c.id = ${alias}.channel_id
      LEFT JOIN ${this.schema}.notification_rules r ON r.id = ${alias}.rule_id
      LEFT JOIN ${this.schema}.bug_reports b ON b.id = ${alias}.bug_id
    `;
  }

  /**
   * Add table alias to column references in WHERE clause
   * Replaces column references like 'status = $1' with 'h.status = $1'
   */
  private addTableAliasToWhereClause(whereClause: string, alias: string = 'h'): string {
    if (!whereClause) {
      return '';
    }

    const columnPattern = this.FILTERABLE_COLUMNS.join('|');
    return whereClause.replace(
      new RegExp(`\\b(${columnPattern})\\s*(>=|<=|=|<>|!=|<|>)`, 'gi'),
      `${alias}.$1 $2`
    );
  }

  /**
   * Build organization project scoping clause for multi-tenant isolation
   * Uses PostgreSQL's = ANY() syntax with array parameter for efficiency
   *
   * @param projectIds - Array of project IDs belonging to the organization
   * @param startParam - Starting parameter number for SQL placeholders
   * @returns Object with SQL clause, values array (containing the projectIds array), and next available param number
   */
  private buildOrgProjectScope(
    projectIds: string[],
    startParam: number
  ): { clause: string; values: (string | string[])[]; nextParam: number } {
    if (projectIds.length === 0) {
      return { clause: '1=0', values: [], nextParam: startParam };
    }

    // Use = ANY() with single array parameter (more efficient than 3 separate IN clauses)
    const clause = `(
        c.project_id = ANY($${startParam}::uuid[]) OR
        r.project_id = ANY($${startParam}::uuid[]) OR
        b.project_id = ANY($${startParam}::uuid[])
      )`;

    return { clause, values: [projectIds], nextParam: startParam + 1 };
  }

  /**
   * Find history entry by ID
   */
  async findById(id: string): Promise<NotificationHistory | null> {
    return super.findById(id);
  }

  /**
   * Find history entry with details (joined data)
   */
  async findByIdWithDetails(id: string): Promise<NotificationHistoryWithDetails | null> {
    const query = `
      SELECT ${this.buildDetailsSelect('h')}
      FROM ${this.schema}.${this.tableName} h
      ${this.buildDetailsJoins('h')}
      WHERE h.id = $1
    `;
    const result = await this.getClient().query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.deserializeWithDetails(result.rows[0]);
  }

  /**
   * Find all history entries with optional filters and pagination
   */
  async findAll(
    filters?: NotificationHistoryFilters,
    pagination?: { page: number; limit: number }
  ): Promise<PaginatedResult<NotificationHistoryWithDetails>> {
    // Extract standard equality filters (excluding date ranges)
    const {
      created_after: _created_after,
      created_before: _created_before,
      ...baseFilters
    } = filters || {};

    // Use base repository's buildWhereClause for standard fields
    const { whereClause, values, paramCount } = this.buildWhereClause(baseFilters);

    // Add date filters using base repository helper
    const finalValues = [...values];
    const { clause: dateClause, paramCount: finalParamCount } = this.buildDateRangeFilter(
      'created_at',
      filters?.created_after,
      filters?.created_before,
      finalValues,
      paramCount,
      whereClause
    );

    // Combine WHERE clause and date filters (add explicit space)
    const finalWhereClause = whereClause + (dateClause ? ` ${dateClause}` : '');

    // Get total count (no aliases needed for count)
    const countQuery = `SELECT COUNT(*) as total FROM ${this.schema}.${this.tableName} ${finalWhereClause}`;
    const countResult = await this.getClient().query(countQuery, finalValues);
    const total = parseInt(countResult.rows[0].total, 10);

    // Get paginated data with details
    const page = pagination?.page || 1;
    const limit = pagination?.limit || 50;
    const offset = (page - 1) * limit;

    // Add table alias to WHERE clause for joined query
    const whereClauseWithAlias = this.addTableAliasToWhereClause(finalWhereClause, 'h');

    const dataQuery = `
      SELECT ${this.buildDetailsSelect('h')}
      FROM ${this.schema}.${this.tableName} h
      ${this.buildDetailsJoins('h')}
      ${whereClauseWithAlias}
      ORDER BY h.created_at DESC
      LIMIT $${finalParamCount} OFFSET $${finalParamCount + 1}
    `;

    const dataResult = await this.getClient().query(dataQuery, [...finalValues, limit, offset]);

    return {
      data: dataResult.rows.map((row) => this.deserializeWithDetails(row)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find all history entries scoped to an organization's projects
   *
   * SECURITY: This method enforces organization-level tenant isolation by filtering
   * history entries to only those associated with the specified organization's projects.
   * The organization_project_ids filter is REQUIRED for proper tenant scoping.
   */
  async findAllByOrganization(
    filters: NotificationHistoryFilters & { organization_project_ids: string[] },
    pagination?: { page: number; limit: number }
  ): Promise<PaginatedResult<NotificationHistoryWithDetails>> {
    const { organization_project_ids, created_after, created_before, ...baseFilters } = filters;

    // Build base WHERE clause from standard filters (channel_id, rule_id, bug_id, status)
    const { whereClause: baseWhereClause, values, paramCount } = this.buildWhereClause(baseFilters);

    // Build organization project scoping clause
    const {
      clause: orgScopeClause,
      values: orgValues,
      nextParam: currentParamCount,
    } = this.buildOrgProjectScope(organization_project_ids, paramCount);

    // Build WHERE clause with org scope
    let whereClause = baseWhereClause
      ? `${baseWhereClause} AND ${orgScopeClause}`
      : `WHERE ${orgScopeClause}`;

    // Add date filters using base repository helper
    const finalValues = [...values, ...orgValues];
    const { clause: dateClause, paramCount: finalParamCount } = this.buildDateRangeFilter(
      'created_at',
      created_after,
      created_before,
      finalValues,
      currentParamCount,
      whereClause
    );

    // Combine WHERE clause with date filters
    whereClause = whereClause + (dateClause ? ` ${dateClause}` : '');

    // Add table alias to base filter columns in WHERE clause
    const whereClauseWithAlias = this.addTableAliasToWhereClause(whereClause, 'h');

    // Get total count (no DISTINCT needed - LEFT JOINs on FKs don't duplicate rows)
    const countQuery = `
      SELECT COUNT(*) as total
      FROM ${this.schema}.${this.tableName} h
      ${this.buildDetailsJoins('h')}
      ${whereClauseWithAlias}
    `;
    const countResult = await this.getClient().query(countQuery, finalValues);
    const total = parseInt(countResult.rows[0].total, 10);

    // Get paginated data with details
    const page = pagination?.page || 1;
    const limit = pagination?.limit || 50;
    const offset = (page - 1) * limit;

    // Simple query with database-driven sorting (no DISTINCT needed)
    const dataQuery = `
      SELECT ${this.buildDetailsSelect('h')}
      FROM ${this.schema}.${this.tableName} h
      ${this.buildDetailsJoins('h')}
      ${whereClauseWithAlias}
      ORDER BY h.created_at DESC
      LIMIT $${finalParamCount} OFFSET $${finalParamCount + 1}
    `;

    const dataResult = await this.getClient().query(dataQuery, [...finalValues, limit, offset]);

    return {
      data: dataResult.rows.map((row) => this.deserializeWithDetails(row)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Create a new history entry
   */
  async create(data: CreateHistoryInput): Promise<NotificationHistory> {
    return super.create(data);
  }

  /**
   * Update a history entry (typically to record delivery result)
   */
  async update(id: string, data: UpdateHistoryInput): Promise<NotificationHistory | null> {
    return super.update(id, data);
  }

  /**
   * Delete old history entries (for cleanup)
   */
  async deleteOlderThan(date: Date): Promise<number> {
    const result = await this.getClient().query(
      `DELETE FROM ${this.schema}.${this.tableName} WHERE created_at < $1`,
      [date]
    );
    return result.rowCount || 0;
  }

  /**
   * Get notification statistics
   */
  async getStats(days: number = 30): Promise<{
    total_sent: number;
    total_failed: number;
    success_rate: number;
    avg_delivery_time_ms: number;
    by_channel: Array<{ channel_type: string; count: number }>;
    by_status: Array<{ status: string; count: number }>;
  }> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const statsQuery = `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'sent') as total_sent,
        COUNT(*) FILTER (WHERE status = 'failed') as total_failed,
        AVG(EXTRACT(EPOCH FROM (delivered_at - created_at)) * 1000) FILTER (WHERE status = 'sent' AND delivered_at IS NOT NULL) as avg_delivery_time_ms
      FROM ${this.schema}.${this.tableName}
      WHERE created_at >= $1
    `;
    const statsResult = await this.getClient().query(statsQuery, [since]);
    const stats = statsResult.rows[0];

    const totalSent = parseInt(stats.total_sent, 10) || 0;
    const totalFailed = parseInt(stats.total_failed, 10) || 0;
    const successRate = totalSent + totalFailed > 0 ? totalSent / (totalSent + totalFailed) : 0;

    // By channel type
    const channelQuery = `
      SELECT c.type as channel_type, COUNT(h.id) as count
      FROM ${this.schema}.${this.tableName} h
      LEFT JOIN ${this.schema}.notification_channels c ON c.id = h.channel_id
      WHERE h.created_at >= $1
      GROUP BY c.type
      ORDER BY count DESC
    `;
    const channelResult = await this.getClient().query(channelQuery, [since]);

    // By status
    const statusQuery = `
      SELECT status, COUNT(*) as count
      FROM ${this.schema}.${this.tableName}
      WHERE created_at >= $1
      GROUP BY status
      ORDER BY count DESC
    `;
    const statusResult = await this.getClient().query(statusQuery, [since]);

    return {
      total_sent: totalSent,
      total_failed: totalFailed,
      success_rate: successRate,
      avg_delivery_time_ms: parseFloat(stats.avg_delivery_time_ms) || 0,
      by_channel: channelResult.rows.map((row) => ({
        channel_type: row.channel_type,
        count: parseInt(row.count, 10),
      })),
      by_status: statusResult.rows.map((row) => ({
        status: row.status,
        count: parseInt(row.count, 10),
      })),
    };
  }

  /**
   * Serialize data before insert
   */
  protected serializeForInsert(data: CreateHistoryInput): Record<string, unknown> {
    return {
      channel_id: data.channel_id,
      rule_id: data.rule_id,
      template_id: data.template_id || null,
      bug_id: data.bug_id || null,
      recipients: JSON.stringify(data.recipients),
      payload: JSON.stringify(data.payload),
      status: data.status,
      error: data.error || null,
      attempts: data.attempts || 1,
    };
  }

  /**
   * Serialize data before update
   */
  protected serializeForUpdate(data: UpdateHistoryInput): Record<string, unknown> {
    const serialized: Record<string, unknown> = {};

    if (data.response !== undefined) {
      serialized.response = JSON.stringify(data.response);
    }
    if (data.status !== undefined) {
      serialized.status = data.status;
    }
    if (data.error !== undefined) {
      serialized.error = data.error;
    }
    if (data.attempts !== undefined) {
      serialized.attempts = data.attempts;
    }
    if (data.delivered_at !== undefined) {
      serialized.delivered_at = data.delivered_at;
    }

    return serialized;
  }

  /**
   * Deserialize row from database
   */
  protected deserialize(row: Record<string, unknown>): NotificationHistory {
    return {
      id: row.id as string,
      channel_id: row.channel_id as string | null,
      rule_id: row.rule_id as string | null,
      template_id: row.template_id as string | null,
      bug_id: row.bug_id as string | null,
      recipients: row.recipients
        ? typeof row.recipients === 'string'
          ? JSON.parse(row.recipients)
          : row.recipients
        : [],
      payload: row.payload
        ? typeof row.payload === 'string'
          ? JSON.parse(row.payload)
          : row.payload
        : null,
      response: row.response
        ? typeof row.response === 'string'
          ? JSON.parse(row.response)
          : row.response
        : null,
      status: row.status as NotificationStatus,
      error: row.error as string | null,
      attempts: row.attempts as number,
      delivered_at: row.delivered_at as Date | null,
      created_at: row.created_at as Date,
    };
  }

  /**
   * Deserialize row with joined details
   */
  private deserializeWithDetails(row: Record<string, unknown>): NotificationHistoryWithDetails {
    return {
      ...this.deserialize(row),
      channel_name: row.channel_name as string | undefined,
      channel_type: row.channel_type as unknown as ChannelType | undefined,
      rule_name: row.rule_name as string | undefined,
      bug_title: row.bug_title as string | undefined,
    };
  }
}
