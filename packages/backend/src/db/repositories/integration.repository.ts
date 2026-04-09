/**
 * Integration Repository
 * Handles CRUD operations for third-party integration configurations
 */

import type { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';
import { BaseRepository } from './base-repository.js';
import type { PaginationOptions, PaginatedResult } from '../types.js';
import { createFilter } from '../filter-builder.js';
import { createPagination } from '../pagination-builder.js';

export type IntegrationStatus = 'not_configured' | 'active' | 'error' | 'disabled';
export type PluginSource = 'builtin' | 'npm' | 'filesystem' | 'generic_http';
export type TrustLevel = 'builtin' | 'custom';

export interface Integration {
  id: string;
  type: string;
  name: string;
  description: string | null;
  status: IntegrationStatus;
  config: Record<string, unknown> | null;
  field_mappings: Record<string, unknown> | null;
  sync_rules: Record<string, unknown> | null;
  oauth_tokens: Record<string, unknown> | null;
  webhook_secret: string | null;
  last_sync_at: Date | null;
  is_custom: boolean;
  plugin_source: PluginSource;
  trust_level: TrustLevel;
  code_hash: string | null;
  plugin_code: string | null;
  allow_code_execution: boolean;
  has_rules: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateIntegrationInput {
  type: string;
  name: string;
  description?: string;
  status?: IntegrationStatus;
  config?: Record<string, unknown>;
  field_mappings?: Record<string, unknown>;
  sync_rules?: Record<string, unknown>;
  oauth_tokens?: Record<string, unknown>;
  webhook_secret?: string;
  is_custom?: boolean;
  plugin_source?: PluginSource;
  trust_level?: TrustLevel;
  code_hash?: string;
  plugin_code?: string;
  allow_code_execution?: boolean;
  has_rules?: boolean;
}

export interface UpdateIntegrationInput {
  name?: string;
  description?: string;
  status?: IntegrationStatus;
  config?: Record<string, unknown> | null;
  field_mappings?: Record<string, unknown> | null;
  sync_rules?: Record<string, unknown> | null;
  oauth_tokens?: Record<string, unknown> | null;
  webhook_secret?: string | null;
  last_sync_at?: Date;
  plugin_source?: PluginSource;
  trust_level?: TrustLevel;
  code_hash?: string;
  plugin_code?: string;
  allow_code_execution?: boolean;
  has_rules?: boolean;
}

export class IntegrationRepository extends BaseRepository<
  Integration,
  CreateIntegrationInput,
  UpdateIntegrationInput
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'integrations', [
      'config',
      'field_mappings',
      'sync_rules',
      'oauth_tokens',
    ]);
  }

  /**
   * Override create to compute code_hash if plugin_code is provided
   */
  async create(input: CreateIntegrationInput): Promise<Integration> {
    // Compute hash if plugin_code is provided
    const data = { ...input };
    if (data.plugin_code && !data.code_hash) {
      data.code_hash = this.computeHash(data.plugin_code);
    }

    return super.create(data);
  }

  /**
   * Compute SHA-256 hash of plugin code
   */
  private computeHash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /**
   * Find integration by type (unique)
   */
  async findByType(type: string): Promise<Integration | null> {
    const result = await this.getClient().query(
      `SELECT * FROM ${this.schema}.${this.tableName} WHERE type = $1`,
      [type]
    );
    return result.rows.length > 0 ? this.deserialize(result.rows[0]) : null;
  }

  /**
   * Find all integrations
   * Note: Excludes plugin_code (can be large) for performance
   */
  async findAll(): Promise<Integration[]> {
    const result = await this.getClient().query(
      `SELECT 
        id, type, name, description, status, config, field_mappings, 
        sync_rules, oauth_tokens, webhook_secret, last_sync_at, 
        is_custom, plugin_source, trust_level, code_hash, 
        NULL as plugin_code, allow_code_execution, has_rules,
        created_at, updated_at
      FROM ${this.schema}.${this.tableName} 
      ORDER BY name ASC`
    );
    return result.rows.map((row) => this.deserialize(row));
  }

  /**
   * List all integrations with pagination and optional filtering
   * @param filters - Optional filters for status and type
   * @param pagination - Pagination options (page, limit)
   * @returns Paginated result with integrations and pagination metadata
   */
  async list(
    filters?: {
      status?: IntegrationStatus;
      type?: string;
    },
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<Integration>> {
    const { page = 1, limit = 20 } = pagination || {};

    // Build WHERE clause using unified FilterBuilder
    const filter = createFilter().equals('status', filters?.status).equals('type', filters?.type);

    const { whereClause, values, paramCount } = filter.build();

    // Get total count
    const countResult = await this.getClient().query(
      `SELECT COUNT(*) FROM ${this.schema}.${this.tableName} ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Build pagination using unified PaginationBuilder
    const paginationBuilder = createPagination().page(page, limit).orderBy('name', 'asc');

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

    const result = await this.getClient().query(dataQuery, [...values, ...paginationValues]);
    const data = result.rows.map((row) => this.deserialize(row));

    return {
      data,
      pagination: metadata,
    };
  }

  /**
   * Get active integrations
   */
  async getActive(): Promise<Integration[]> {
    const result = await this.getClient().query(
      `SELECT * FROM ${this.schema}.${this.tableName} WHERE status = 'active' ORDER BY name ASC`
    );
    return result.rows.map((row) => this.deserialize(row));
  }

  /**
   * Count total number of integrations
   */
  async count(): Promise<number> {
    const result = await this.getClient().query(
      `SELECT COUNT(*) FROM ${this.schema}.${this.tableName}`
    );
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Update last sync timestamp
   * @returns Number of rows affected (0 if ID not found, 1 if updated)
   */
  async updateLastSync(id: string): Promise<number> {
    const result = await this.getClient().query(
      `UPDATE ${this.schema}.${this.tableName} SET last_sync_at = NOW() WHERE id = $1`,
      [id]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Update integration status
   * @returns Number of rows affected (0 if ID not found, 1 if updated)
   */
  async updateStatus(id: string, status: IntegrationStatus): Promise<number> {
    const result = await this.getClient().query(
      `UPDATE ${this.schema}.${this.tableName} SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, id]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Get custom plugins grouped by platform
   * Returns unique platform identifiers (integrations.type) for all custom plugins,
   * along with their active status.
   * @returns Array of platforms with enabled flag (true if any integration has status='active')
   */
  async getCustomPluginsPlatforms(): Promise<Array<{ platform: string; enabled: boolean }>> {
    const result = await this.getClient().query<{ platform: string; enabled: boolean }>(
      `SELECT
         type as platform,
         bool_or(status = 'active') as enabled
       FROM ${this.schema}.${this.tableName}
       WHERE plugin_code IS NOT NULL 
       GROUP BY type`
    );
    return result.rows;
  }
}
