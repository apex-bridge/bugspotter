/**
 * API Key Repository
 * Database operations for API key management
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import type {
  ApiKey,
  ApiKeyInsert,
  ApiKeyUpdate,
  ApiKeyUsage,
  ApiKeyUsageInsert,
  ApiKeyAuditLog,
  ApiKeyAuditLogInsert,
  ApiKeyWithUsageStats,
  ApiKeyFilters,
  ApiKeySortOptions,
  PaginatedResult,
  PaginationOptions,
  RateLimitWindow,
} from '../types.js';
import { API_KEY_SORT_FIELDS } from '../types.js';
import { createFilter } from '../filter-builder.js';
import { createPagination } from '../pagination-builder.js';

/**
 * API Key Repository
 * Handles all database operations for API keys, usage tracking, and rate limiting
 */
export class ApiKeyRepository extends BaseRepository<ApiKey, ApiKeyInsert, ApiKeyUpdate> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'api_keys', ['permissions', 'per_endpoint_limits']);
  }

  /**
   * Find API key by hash (for authentication)
   */
  async findByHash(keyHash: string): Promise<ApiKey | null> {
    return this.findBy('key_hash', keyHash);
  }

  /**
   * List API keys with optional filters, sorting, and pagination
   */
  async list(
    filters: ApiKeyFilters = {},
    sort: ApiKeySortOptions = {},
    pagination: PaginationOptions = {}
  ): Promise<PaginatedResult<ApiKey>> {
    const {
      status,
      type,
      team_id,
      created_by,
      accessible_by_user_id,
      tag,
      expires_before,
      expires_after,
      search,
    } = filters;
    const { sort_by = 'created_at', order = 'desc' } = sort;
    const { page = 1, limit = 20 } = pagination;

    // Build WHERE clause using unified FilterBuilder
    const filter = createFilter()
      .equals('status', status)
      .equals('type', type)
      .equals('team_id', team_id)
      .inArrayColumn(tag, 'tags')
      .timestamp('expires_at', '<', expires_before)
      .timestamp('expires_at', '>', expires_after)
      .ilikeAny(['name', 'description'], search);

    // If accessible_by_user_id is set, show keys the user created OR keys
    // scoped to projects in the user's organization (via org membership)
    if (accessible_by_user_id) {
      const p1 = filter.getParamCount();
      filter.raw(
        `(created_by = $${p1} OR EXISTS (
          SELECT 1 FROM ${this.schema}.projects p
          JOIN saas.organization_members om ON om.organization_id = p.organization_id
          WHERE om.user_id = $${p1} AND p.id = ANY(allowed_projects)
        ))`,
        [accessible_by_user_id]
      );
    } else if (created_by) {
      filter.equals('created_by', created_by);
    }

    const { whereClause, values, paramCount } = filter.build();

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM ${this.schema}.${this.tableName} ${whereClause}`;
    const countResult = await this.pool.query(countQuery, values);
    const total = parseInt(countResult.rows[0].count, 10);

    // Build pagination using unified PaginationBuilder
    const paginationBuilder = createPagination()
      .page(page, limit)
      .orderByValidated(sort_by, order, API_KEY_SORT_FIELDS, 'created_at', 'desc');

    const {
      orderByClause,
      limitClause,
      values: paginationValues,
      metadata,
    } = paginationBuilder.build(total, paramCount);

    // Get paginated results
    const query = `
      SELECT * FROM ${this.schema}.${this.tableName} ${whereClause}
      ${orderByClause}
      ${limitClause}
    `;

    const result = await this.pool.query(query, [...values, ...paginationValues]);

    return {
      data: result.rows.map((row) => this.mapRow(row)),
      pagination: metadata,
    };
  }

  /**
   * Get API key with usage statistics
   */
  async findByIdWithStats(id: string): Promise<ApiKeyWithUsageStats | null> {
    const query = `
      SELECT 
        k.*,
        COALESCE(u.total_requests, 0) as total_requests,
        COALESCE(u.requests_today, 0) as requests_today,
        COALESCE(u.requests_this_month, 0) as requests_this_month,
        u.last_request_at,
        COALESCE(u.unique_ips, 0) as unique_ips,
        COALESCE(u.client_error_rate, 0) as client_error_rate,
        COALESCE(u.server_error_rate, 0) as server_error_rate
      FROM ${this.schema}.${this.tableName} k
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) as total_requests,
          COUNT(*) FILTER (WHERE timestamp >= CURRENT_DATE) as requests_today,
          COUNT(*) FILTER (WHERE timestamp >= DATE_TRUNC('month', CURRENT_DATE)) as requests_this_month,
          MAX(timestamp) as last_request_at,
          COUNT(DISTINCT ip_address) as unique_ips,
          ROUND(
            (COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::decimal / NULLIF(COUNT(*), 0)::decimal) * 100.0, 
            2
          ) as client_error_rate,
          ROUND(
            (COUNT(*) FILTER (WHERE status_code >= 500)::decimal / NULLIF(COUNT(*), 0)::decimal) * 100.0, 
            2
          ) as server_error_rate
        FROM api_key_usage
        WHERE api_key_id = k.id
      ) u ON true
      WHERE k.id = $1
    `;

    const result = await this.pool.query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const apiKey = this.mapRow(row);

    return {
      ...apiKey,
      usage_stats: {
        total_requests: parseInt(row.total_requests, 10) || 0,
        requests_today: parseInt(row.requests_today, 10) || 0,
        requests_this_month: parseInt(row.requests_this_month, 10) || 0,
        last_request_at: row.last_request_at || null,
        unique_ips: parseInt(row.unique_ips, 10) || 0,
        client_error_rate: parseFloat(row.client_error_rate) || 0,
        server_error_rate: parseFloat(row.server_error_rate) || 0,
      },
    };
  }

  /**
   * Update last used timestamp
   */
  async updateLastUsed(id: string): Promise<void> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET last_used_at = CURRENT_TIMESTAMP 
      WHERE id = $1
    `;
    await this.pool.query(query, [id]);
  }

  /**
   * Revoke API key
   */
  async revoke(id: string): Promise<ApiKey | null> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET
        status = 'revoked',
        revoked_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;
    const result = await this.pool.query(query, [id]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * Batch revoke API keys (single query instead of N queries)
   * @param ids - Array of API key IDs to revoke
   * @returns Array of revoked API keys
   */
  async revokeBatch(ids: string[]): Promise<ApiKey[]> {
    if (ids.length === 0) {
      return [];
    }

    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET
        status = 'revoked',
        revoked_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ANY($1) AND status != 'revoked'
      RETURNING *
    `;
    const result = await this.pool.query(query, [ids]);
    return result.rows.map((row) => this.mapRow(row));
  }

  /**
   * Find multiple API keys by IDs (batch loading)
   * @param ids - Array of API key IDs to fetch
   * @returns Map of key ID to key (missing IDs not included)
   */
  async findByIds(ids: string[]): Promise<Map<string, ApiKey>> {
    if (ids.length === 0) {
      return new Map();
    }

    const query = `SELECT * FROM ${this.schema}.${this.tableName} WHERE id = ANY($1)`;
    const result = await this.pool.query(query, [ids]);

    const keyMap = new Map<string, ApiKey>();
    for (const row of result.rows) {
      const key = this.mapRow(row);
      keyMap.set(key.id, key);
    }

    return keyMap;
  }

  /**
   * Batch delete API keys (single query instead of N queries)
   * @param ids - Array of API key IDs to delete
   * @returns Number of deleted keys
   */
  async deleteBatch(ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    const query = `DELETE FROM ${this.schema}.${this.tableName} WHERE id = ANY($1)`;
    const result = await this.pool.query(query, [ids]);
    return result.rowCount || 0;
  }

  /**
   * Check if key has expired and update status
   */
  async checkAndUpdateExpired(): Promise<number> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE status IN ('active', 'expiring')
        AND expires_at IS NOT NULL
        AND expires_at < CURRENT_TIMESTAMP
      RETURNING id
    `;
    const result = await this.pool.query(query);
    return result.rowCount || 0;
  }

  /**
   * Mark keys approaching expiration
   */
  async markExpiring(daysBeforeExpiry: number = 7): Promise<number> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET status = 'expiring', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at > CURRENT_TIMESTAMP
        AND expires_at < CURRENT_TIMESTAMP + $1::interval
      RETURNING id
    `;
    const result = await this.pool.query(query, [`${daysBeforeExpiry} days`]);
    return result.rowCount || 0;
  }

  // ============================================================================
  // USAGE TRACKING
  // ============================================================================

  /**
   * Track API key usage
   */
  async trackUsage(usage: ApiKeyUsageInsert): Promise<void> {
    const query = `
      INSERT INTO application.api_key_usage (
        api_key_id, endpoint, method, status_code, response_time_ms,
        ip_address, user_agent, error_message, error_type, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, CURRENT_TIMESTAMP))
    `;

    const values = [
      usage.api_key_id,
      usage.endpoint,
      usage.method,
      usage.status_code || null,
      usage.response_time_ms || null,
      usage.ip_address || null,
      usage.user_agent || null,
      usage.error_message || null,
      usage.error_type || null,
      usage.timestamp || null,
    ];

    await this.pool.query(query, values);
  }

  /**
   * Get usage logs for an API key
   */
  async getUsageLogs(
    apiKeyId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<ApiKeyUsage[]> {
    const query = `
      SELECT * FROM ${this.schema}.api_key_usage
      WHERE api_key_id = $1
      ORDER BY timestamp DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await this.pool.query(query, [apiKeyId, limit, offset]);
    return result.rows;
  }

  /**
   * Get top endpoints for an API key
   */
  async getTopEndpoints(
    apiKeyId: string,
    limit: number = 10
  ): Promise<Array<{ endpoint: string; count: number; avg_response_time: number }>> {
    const query = `
      SELECT 
        endpoint,
        COUNT(*) as count,
        ROUND(AVG(response_time_ms)::numeric, 2) as avg_response_time
      FROM ${this.schema}.api_key_usage
      WHERE api_key_id = $1
      GROUP BY endpoint
      ORDER BY count DESC
      LIMIT $2
    `;

    const result = await this.pool.query(query, [apiKeyId, limit]);
    return result.rows.map((row) => ({
      endpoint: row.endpoint,
      count: parseInt(row.count, 10),
      avg_response_time: parseFloat(row.avg_response_time) || 0,
    }));
  }

  // ============================================================================
  // RATE LIMITING
  // ============================================================================

  /**
   * Get current request count for a time window
   */
  async getRateLimitCount(
    apiKeyId: string,
    windowType: RateLimitWindow,
    windowStart: Date
  ): Promise<number> {
    const query = `
      SELECT request_count
      FROM ${this.schema}.api_key_rate_limits
      WHERE api_key_id = $1 AND window_type = $2 AND window_start = $3
    `;

    const result = await this.pool.query(query, [apiKeyId, windowType, windowStart]);
    return result.rows.length > 0 ? result.rows[0].request_count : 0;
  }

  /**
   * Increment rate limit counter
   */
  async incrementRateLimit(
    apiKeyId: string,
    windowType: RateLimitWindow,
    windowStart: Date
  ): Promise<number> {
    const query = `
      INSERT INTO ${this.schema}.api_key_rate_limits (api_key_id, window_type, window_start, request_count)
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (api_key_id, window_type, window_start)
      DO UPDATE SET request_count = ${this.schema}.api_key_rate_limits.request_count + 1
      RETURNING request_count
    `;

    const result = await this.pool.query(query, [apiKeyId, windowType, windowStart]);
    return result.rows[0].request_count;
  }

  /**
   * Clean up old rate limit windows
   */
  async cleanupOldRateLimits(): Promise<number> {
    const result = await this.pool.query('SELECT cleanup_old_rate_limits()');
    return result.rowCount || 0;
  }

  // ============================================================================
  // AUDIT LOGGING
  // ============================================================================

  /**
   * Log API key audit event
   */
  async logAudit(log: ApiKeyAuditLogInsert): Promise<void> {
    const query = `
      INSERT INTO ${this.schema}.api_key_audit_log (
        api_key_id, action, performed_by, ip_address, changes, timestamp
      ) VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_TIMESTAMP))
    `;

    const values = [
      log.api_key_id || null,
      log.action,
      log.performed_by || null,
      log.ip_address || null,
      log.changes ? JSON.stringify(log.changes) : null,
      log.timestamp || null,
    ];

    await this.pool.query(query, values);
  }

  /**
   * Get audit logs for an API key
   */
  async getAuditLogs(
    apiKeyId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<ApiKeyAuditLog[]> {
    const query = `
      SELECT * FROM ${this.schema}.api_key_audit_log
      WHERE api_key_id = $1
      ORDER BY timestamp DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await this.pool.query(query, [apiKeyId, limit, offset]);
    return result.rows;
  }

  /**
   * Override mapRow to handle array and JSON columns
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected mapRow(row: any): ApiKey {
    return {
      ...row,
      permissions: row.permissions || [],
      allowed_projects: row.allowed_projects || null,
      allowed_environments: row.allowed_environments || null,
      ip_whitelist: row.ip_whitelist || null,
      allowed_origins: row.allowed_origins || null,
      tags: row.tags || null,
      per_endpoint_limits: row.per_endpoint_limits || null,
    };
  }
}
