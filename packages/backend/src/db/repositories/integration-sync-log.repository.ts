/**
 * Integration Sync Log Repository
 * Handles activity logging for integration sync operations
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import type { PaginationOptions, PaginatedResult } from '../types.js';

export interface IntegrationSyncLog {
  id: string;
  integration_type: string;
  action: 'create' | 'update' | 'sync' | 'error' | 'test';
  bug_id: string | null;
  external_id: string | null;
  external_url: string | null;
  status: 'pending' | 'success' | 'failed' | 'skipped';
  error: string | null;
  request: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
  duration_ms: number | null;
  created_at: Date;
}

export interface CreateSyncLogInput {
  integration_type: string;
  action: 'create' | 'update' | 'sync' | 'error' | 'test';
  bug_id?: string;
  external_id?: string;
  external_url?: string;
  status: 'pending' | 'success' | 'failed' | 'skipped';
  error?: string;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  duration_ms?: number;
}

export class IntegrationSyncLogRepository extends BaseRepository<
  IntegrationSyncLog,
  CreateSyncLogInput,
  Partial<CreateSyncLogInput>
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'integration_sync_log', ['request', 'response']);
  }

  /**
   * List sync logs with advanced filtering and pagination
   * @param filters - Optional filters for integration_type, bug_id, status, action, date range
   * @param pagination - Pagination options (page, limit)
   * @returns Paginated result with sync logs and pagination metadata
   */
  async list(
    filters?: {
      integration_type?: string;
      bug_id?: string;
      status?: 'pending' | 'success' | 'failed' | 'skipped';
      action?: 'create' | 'update' | 'sync' | 'error' | 'test';
      created_after?: Date;
      created_before?: Date;
    },
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<IntegrationSyncLog>> {
    const { page = 1, limit = 50 } = pagination || {};
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (filters?.integration_type) {
      conditions.push(`integration_type = $${paramCount}`);
      values.push(filters.integration_type);
      paramCount++;
    }

    if (filters?.bug_id) {
      conditions.push(`bug_id = $${paramCount}`);
      values.push(filters.bug_id);
      paramCount++;
    }

    if (filters?.status) {
      conditions.push(`status = $${paramCount}`);
      values.push(filters.status);
      paramCount++;
    }

    if (filters?.action) {
      conditions.push(`action = $${paramCount}`);
      values.push(filters.action);
      paramCount++;
    }

    if (filters?.created_after) {
      conditions.push(`created_at >= $${paramCount}::timestamptz`);
      values.push(filters.created_after.toISOString());
      paramCount++;
    }

    if (filters?.created_before) {
      conditions.push(`created_at <= $${paramCount}::timestamptz`);
      values.push(filters.created_before.toISOString());
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await this.getClient().query(
      `SELECT COUNT(*) FROM ${this.schema}.${this.tableName}${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Get paginated data
    const dataQuery = `
      SELECT * FROM ${this.schema}.${this.tableName}${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;
    values.push(limit, offset);

    const result = await this.getClient().query(dataQuery, values);
    const data = result.rows.map((row) => this.deserialize(row));

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get recent logs for an integration
   */
  async getRecentByType(type: string, limit: number = 100): Promise<IntegrationSyncLog[]> {
    const result = await this.getClient().query(
      `SELECT * FROM ${this.schema}.${this.tableName} 
       WHERE integration_type = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [type, limit]
    );
    return result.rows.map((row) => this.deserialize(row));
  }

  /**
   * Get sync statistics for an integration
   */
  async getStats(
    type: string,
    since?: Date
  ): Promise<{
    total: number;
    success: number;
    failed: number;
    avg_duration_ms: number;
  }> {
    const values: unknown[] = [type];
    let whereClause = 'WHERE integration_type = $1';

    if (since) {
      whereClause += ' AND created_at >= $2::timestamptz';
      values.push(since.toISOString());
    }

    const result = await this.getClient().query(
      `SELECT 
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE status = 'success') as success,
         COUNT(*) FILTER (WHERE status = 'failed') as failed,
         AVG(duration_ms)::int as avg_duration_ms
       FROM ${this.schema}.${this.tableName}
       ${whereClause}`,
      values
    );

    const row = result.rows[0];
    return {
      total: parseInt(row.total, 10),
      success: parseInt(row.success, 10),
      failed: parseInt(row.failed, 10),
      avg_duration_ms: row.avg_duration_ms || 0,
    };
  }

  /**
   * Get logs for a specific bug
   */
  async getByBugId(bugId: string): Promise<IntegrationSyncLog[]> {
    const result = await this.getClient().query(
      `SELECT * FROM ${this.schema}.${this.tableName} WHERE bug_id = $1 ORDER BY created_at DESC`,
      [bugId]
    );
    return result.rows.map((row) => this.deserialize(row));
  }
}
