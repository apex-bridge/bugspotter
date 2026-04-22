/**
 * Bug Report Repository
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import {
  MAX_BATCH_SIZE,
  DEFAULT_BATCH_SIZE,
  MIN_BATCH_SIZE,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  DECIMAL_BASE,
} from '../constants.js';
import type {
  BugReport,
  BugReportInsert,
  BugReportUpdate,
  BugReportFilters,
  BugReportSortOptions,
  PaginatedResult,
  PaginationOptions,
} from '../types.js';
import {
  buildOrderByClause,
  buildPaginationClause,
  buildWhereClause,
  serializeJsonField,
} from '../query-builder.js';
import { ValidationError } from '../../api/middleware/error.js';

export class BugReportRepository extends BaseRepository<
  BugReport,
  BugReportInsert,
  BugReportUpdate
> {
  private static readonly VALID_SORT_COLUMNS = ['created_at', 'updated_at', 'priority'] as const;
  private static readonly VALID_SORT_ORDERS = ['asc', 'desc'] as const;
  private static readonly SIMPLE_FILTERS: Array<{ key: keyof BugReportFilters; column: string }> = [
    { key: 'status', column: 'br.status' },
    { key: 'priority', column: 'br.priority' },
  ];

  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'bug_reports', ['metadata']);
  }

  /**
   * Validate sort column against whitelist
   */
  private validateSortColumn(sortBy: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!BugReportRepository.VALID_SORT_COLUMNS.includes(sortBy as any)) {
      throw new ValidationError(`Invalid sort column: ${sortBy}`, {
        provided: sortBy,
        allowed: BugReportRepository.VALID_SORT_COLUMNS,
      });
    }
  }

  /**
   * Validate sort order against whitelist
   */
  private validateSortOrder(order: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!BugReportRepository.VALID_SORT_ORDERS.includes(order.toLowerCase() as any)) {
      throw new ValidationError(`Invalid sort order: ${order}`, {
        provided: order,
        allowed: BugReportRepository.VALID_SORT_ORDERS,
      });
    }
  }

  /**
   * Build filter clauses for user access queries
   * Simplifies repetitive filter building in listByUserAccess()
   */
  private buildUserAccessFilters(
    filters: BugReportFilters,
    values: unknown[],
    startParamCount: number
  ): { clauses: string[]; paramCount: number } {
    const clauses: string[] = [];
    let paramCount = startParamCount;

    // Simple equality filters
    for (const { key, column } of BugReportRepository.SIMPLE_FILTERS) {
      if (filters[key]) {
        clauses.push(`${column} = $${++paramCount}`);
        values.push(filters[key]);
      }
    }

    // Date range filters
    if (filters.created_after) {
      clauses.push(`br.created_at >= $${++paramCount}::timestamptz`);
      values.push(filters.created_after.toISOString());
    }

    if (filters.created_before) {
      clauses.push(`br.created_at <= $${++paramCount}::timestamptz`);
      values.push(filters.created_before.toISOString());
    }

    return { clauses, paramCount };
  }

  /**
   * Override serialization to handle defaults
   */
  protected serializeForInsert(data: BugReportInsert): Record<string, unknown> {
    return {
      project_id: data.project_id,
      title: data.title,
      description: data.description ?? null,
      screenshot_url: data.screenshot_url ?? null,
      replay_url: data.replay_url ?? null,
      metadata: serializeJsonField(data.metadata),
      status: data.status ?? 'open',
      priority: data.priority ?? 'medium',
      deleted_at: data.deleted_at ?? null,
      deleted_by: data.deleted_by ?? null,
      legal_hold: data.legal_hold ?? false,
      // Presigned URL flow columns
      screenshot_key: data.screenshot_key ?? null,
      upload_status: data.upload_status ?? 'none',
      replay_key: data.replay_key ?? null,
      replay_upload_status: data.replay_upload_status ?? 'none',
      organization_id: data.organization_id ?? null,
      duplicate_of: data.duplicate_of ?? null,
    };
  }

  /**
   * Create multiple bug reports in batch (single query, much faster)
   * @param dataArray - Array of bug reports to create
   * @throws Error if array exceeds maximum batch size (1000)
   * @throws Error if array contains invalid data
   */
  async createBatch(dataArray: BugReportInsert[]): Promise<BugReport[]> {
    if (dataArray.length === 0) {
      return [];
    }

    // Validate batch size to prevent DoS and PostgreSQL parameter limit
    if (dataArray.length > MAX_BATCH_SIZE) {
      throw new Error(
        `Batch size ${dataArray.length} exceeds maximum allowed (${MAX_BATCH_SIZE}). ` +
          `Split into smaller batches.`
      );
    }

    // Serialize all data first
    const serializedData = dataArray.map((data) => {
      return this.serializeForInsert(data);
    });

    // Use first row to determine columns (all rows must have same structure)
    const columns = Object.keys(serializedData[0]);
    const columnCount = columns.length;

    // Validate that we have columns
    if (columnCount === 0) {
      throw new Error('Cannot create batch: serialized data has no columns');
    }

    // Validate all column names to prevent SQL injection
    columns.forEach((col) => {
      if (!/^[a-zA-Z0-9_]+$/.test(col)) {
        throw new Error(`Invalid SQL identifier: ${col}`);
      }
    });

    // Build VALUES placeholders and collect all values
    const valuesPlaceholders: string[] = [];
    const allValues: unknown[] = [];
    let paramCount = 1;

    for (const data of serializedData) {
      const rowPlaceholders = Array.from({ length: columnCount }, () => {
        return `$${paramCount++}`;
      });
      valuesPlaceholders.push(`(${rowPlaceholders.join(', ')})`);
      allValues.push(
        ...columns.map((col) => {
          return data[col];
        })
      );
    }

    const query = `
      INSERT INTO ${this.schema}.${this.tableName} (${columns.join(', ')})
      VALUES ${valuesPlaceholders.join(', ')}
      RETURNING *
    `;

    const result = await this.getClient().query(query, allValues);
    return this.deserializeMany(result.rows);
  }

  /**
   * Create bug reports in batches, automatically splitting large arrays
   * @param dataArray - Array of bug reports to create (any size)
   * @param batchSize - Size of each batch (default: 500, max: 1000)
   * @returns Array of all created bug reports
   * @example
   * // Create 5000 reports in batches of 500
   * const reports = await repo.createBatchAuto(hugeArray);
   */
  async createBatchAuto(
    dataArray: BugReportInsert[],
    batchSize: number = DEFAULT_BATCH_SIZE
  ): Promise<BugReport[]> {
    if (dataArray.length === 0) {
      return [];
    }

    // Validate batch size
    if (batchSize < MIN_BATCH_SIZE || batchSize > MAX_BATCH_SIZE) {
      throw new Error(
        `Batch size must be between ${MIN_BATCH_SIZE} and ${MAX_BATCH_SIZE}, got ${batchSize}`
      );
    }

    // If array fits in one batch, use regular createBatch
    if (dataArray.length <= batchSize) {
      return this.createBatch(dataArray);
    }

    // Split into chunks and process sequentially
    const results: BugReport[] = [];
    for (let i = 0; i < dataArray.length; i += batchSize) {
      const chunk = dataArray.slice(i, i + batchSize);
      const chunkResults = await this.createBatch(chunk);
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Find bug reports older than cutoff date (for retention)
   * Excludes soft-deleted reports and those on legal hold
   */
  async findForRetention(
    projectId: string,
    cutoffDate: Date,
    includeDeleted = false
  ): Promise<BugReport[]> {
    const deletedClause = includeDeleted ? '' : 'AND deleted_at IS NULL';
    const query = `
      SELECT * FROM ${this.schema}.${this.tableName}
      WHERE project_id = $1
        AND created_at < $2
        ${deletedClause}
        AND legal_hold = FALSE
      ORDER BY created_at ASC
    `;

    const result = await this.getClient().query<BugReport>(query, [projectId, cutoffDate]);
    return this.deserializeMany(result.rows);
  }

  /**
   * Soft delete bug reports
   */
  async softDelete(reportIds: string[], userId: string | null = null): Promise<number> {
    if (reportIds.length === 0) {
      return 0;
    }

    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET deleted_at = CURRENT_TIMESTAMP,
          deleted_by = $1
      WHERE id = ANY($2)
        AND deleted_at IS NULL
        AND legal_hold = FALSE
    `;

    const result = await this.getClient().query(query, [userId, reportIds]);
    return result.rowCount ?? 0;
  }

  /**
   * Update screenshot and thumbnail URLs atomically
   * Used by Screenshot worker to ensure both URLs are updated together
   * Also stores image metadata (width, height, format) for efficient retry handling
   * @returns Number of rows affected (0 if ID not found, 1 if updated)
   */
  async updateScreenshotUrls(
    bugReportId: string,
    screenshotUrl: string,
    thumbnailUrl: string,
    screenshotKey: string,
    thumbnailKey: string,
    imageMetadata?: { width?: number; height?: number; format?: string }
  ): Promise<number> {
    const metadataUpdate: Record<string, unknown> = {
      thumbnailUrl,
    };

    // Store image metadata if provided (for efficient retry handling)
    if (imageMetadata) {
      if (imageMetadata.width) {
        metadataUpdate.screenshotWidth = imageMetadata.width;
      }
      if (imageMetadata.height) {
        metadataUpdate.screenshotHeight = imageMetadata.height;
      }
      if (imageMetadata.format) {
        metadataUpdate.screenshotFormat = imageMetadata.format;
      }
    }

    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET 
        screenshot_url = $1,
        screenshot_key = $2,
        thumbnail_key = $3,
        metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
    `;

    const result = await this.getClient().query(query, [
      screenshotUrl,
      screenshotKey,
      thumbnailKey,
      JSON.stringify(metadataUpdate),
      bugReportId,
    ]);
    return result.rowCount ?? 0;
  }

  /**
   * Update bug report metadata with replay manifest URL
   * Used by Replay worker after processing chunks
   * @returns Number of rows affected (0 if ID not found, 1 if updated)
   */
  async updateReplayManifestUrl(bugReportId: string, manifestUrl: string): Promise<number> {
    // Use PostgreSQL's || operator for cleaner JSON merging
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
      WHERE id = $2
    `;

    const result = await this.getClient().query(query, [
      JSON.stringify({ replayManifestUrl: manifestUrl }),
      bugReportId,
    ]);
    return result.rowCount ?? 0;
  }

  /**
   * Update bug report metadata with external integration IDs
   * Used by Integration worker after creating issues on external platforms
   * @returns Number of rows affected (0 if ID not found, 1 if updated)
   */
  async updateExternalIntegration(
    bugReportId: string,
    externalId: string,
    externalUrl: string
  ): Promise<number> {
    // Use PostgreSQL's || operator for cleaner JSON merging
    // This atomically merges the new keys into existing metadata
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
      WHERE id = $2
    `;

    const result = await this.getClient().query(query, [
      JSON.stringify({ externalId, externalUrl }),
      bugReportId,
    ]);
    return result.rowCount ?? 0;
  }

  /**
   * Initiate upload by setting storage key and pending status
   * Used before generating presigned URL to ensure atomicity
   * @returns Number of rows affected (0 if ID not found, 1 if updated)
   */
  async initiateUpload(
    bugReportId: string,
    storageKey: string,
    keyColumn: 'screenshot_key' | 'replay_key',
    statusColumn: 'upload_status' | 'replay_upload_status'
  ): Promise<number> {
    // Validate column names to prevent SQL injection
    const VALID_KEY_COLUMNS = ['screenshot_key', 'replay_key'] as const;
    const VALID_STATUS_COLUMNS = ['upload_status', 'replay_upload_status'] as const;

    if (!VALID_KEY_COLUMNS.includes(keyColumn)) {
      throw new Error(`Invalid key column: ${keyColumn}`);
    }
    if (!VALID_STATUS_COLUMNS.includes(statusColumn)) {
      throw new Error(`Invalid status column: ${statusColumn}`);
    }

    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET ${keyColumn} = $1, ${statusColumn} = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `;

    const result = await this.getClient().query(query, [storageKey, 'pending', bugReportId]);
    return result.rowCount ?? 0;
  }

  /**
   * Initiate screenshot upload by setting storage key and pending status
   * Used before generating presigned URL to ensure atomicity
   * @returns Number of rows affected (0 if ID not found, 1 if updated)
   */
  async initiateScreenshotUpload(bugReportId: string, storageKey: string): Promise<number> {
    return this.initiateUpload(bugReportId, storageKey, 'screenshot_key', 'upload_status');
  }

  /**
   * Initiate replay upload by setting storage key and pending status
   * Used before generating presigned URL to ensure atomicity
   * @returns Number of rows affected (0 if ID not found, 1 if updated)
   */
  async initiateReplayUpload(bugReportId: string, storageKey: string): Promise<number> {
    return this.initiateUpload(bugReportId, storageKey, 'replay_key', 'replay_upload_status');
  }

  /**
   * Restore soft-deleted bug reports
   */
  async restore(reportIds: string[]): Promise<number> {
    if (reportIds.length === 0) {
      return 0;
    }

    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET deleted_at = NULL,
          deleted_by = NULL
      WHERE id = ANY($1)
        AND deleted_at IS NOT NULL
    `;

    const result = await this.getClient().query(query, [reportIds]);
    return result.rowCount ?? 0;
  }

  /**
   * Hard delete bug reports (permanent deletion)
   */
  async hardDelete(reportIds: string[]): Promise<number> {
    if (reportIds.length === 0) {
      return 0;
    }

    const query = `
      DELETE FROM ${this.schema}.${this.tableName}
      WHERE id = ANY($1)
        AND legal_hold = FALSE
    `;

    const result = await this.getClient().query(query, [reportIds]);
    return result.rowCount ?? 0;
  }

  /**
   * Set legal hold status on bug reports
   */
  async setLegalHold(reportIds: string[], hold: boolean): Promise<number> {
    if (reportIds.length === 0) {
      return 0;
    }

    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET legal_hold = $1
      WHERE id = ANY($2)
    `;

    const result = await this.getClient().query(query, [hold, reportIds]);
    return result.rowCount ?? 0;
  }

  /**
   * Override list to exclude soft-deleted by default
   */
  async list(
    filters?: BugReportFilters & { includeDeleted?: boolean },
    sort?: BugReportSortOptions,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<BugReport>> {
    // Use optimized JOIN query for user-based access control
    if (filters?.user_id) {
      return this.listByUserAccess(filters, sort, pagination);
    }

    // Build base WHERE clause from standard filters
    const { clause: whereClause, values, paramCount } = this.buildBaseFilters(filters);

    // Add date range filters
    const { clause: dateClause, paramCount: finalParamCount } = this.buildDateFilters(
      filters,
      values,
      paramCount,
      whereClause
    );

    // Add soft-delete filter
    const softDeleteClause = this.buildSoftDeleteFilter(
      filters?.includeDeleted,
      whereClause,
      dateClause
    );

    // Execute count and data queries (add explicit spaces between clauses)
    const combinedWhereClause =
      whereClause +
      (dateClause ? ` ${dateClause}` : '') +
      (softDeleteClause ? ` ${softDeleteClause}` : '');
    const total = await this.executeCountQuery(combinedWhereClause, values);
    const data = await this.executeDataQuery(
      whereClause,
      dateClause,
      softDeleteClause,
      values,
      sort,
      pagination,
      finalParamCount
    );

    // Build pagination metadata
    const page = pagination?.page ?? DEFAULT_PAGE;
    const limit = pagination?.limit ?? DEFAULT_PAGE_SIZE;

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
   * Optimized list using UNION ALL for user-based access control
   * Performance improvements:
   * - UNION ALL instead of JOIN with OR enables index usage on both paths
   *   (owned projects via idx_projects_created_by_id, member projects via idx_project_members_user_project)
   * - Parallel execution of count + data queries (Promise.all)
   * - DISTINCT ON (id) only in subquery, then final sorting applied
   */
  private async listByUserAccess(
    filters: BugReportFilters & { includeDeleted?: boolean },
    sort?: BugReportSortOptions,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<BugReport>> {
    const values: unknown[] = [filters.user_id];
    let paramCount = 1;

    // Build filter clauses using helper
    const { clauses: filterClauses, paramCount: newParamCount } = this.buildUserAccessFilters(
      filters,
      values,
      paramCount
    );
    paramCount = newParamCount;

    // Build WHERE clause for additional filters
    const whereClauses = [...filterClauses];
    if (!filters.includeDeleted) {
      whereClauses.push('br.deleted_at IS NULL');
    }
    const additionalWhere = whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : '';

    // Data query setup
    const sortBy = sort?.sort_by ?? 'created_at';
    const order = sort?.order ?? 'desc';
    const page = pagination?.page ?? DEFAULT_PAGE;
    const limit = pagination?.limit ?? DEFAULT_PAGE_SIZE;

    // Validate sort column and order
    this.validateSortColumn(sortBy);
    this.validateSortOrder(order);

    // UNION ALL approach: Owned projects + Member projects
    // Benefits: Each branch can use its own optimal index path
    // Use 2 queries for now (count + data) - simpler and reliable
    const countQuery = `
      WITH accessible_reports AS (
        -- Projects owned by user
        SELECT br.id
        FROM ${this.schema}.${this.tableName} br
        WHERE br.project_id IN (
          SELECT id FROM ${this.schema}.projects WHERE created_by = $1
        )
        ${additionalWhere}
        
        UNION ALL
        
        -- Projects where user is member
        SELECT br.id
        FROM ${this.schema}.${this.tableName} br
        WHERE br.project_id IN (
          SELECT project_id FROM ${this.schema}.project_members WHERE user_id = $1
        )
        ${additionalWhere}
      )
      SELECT COUNT(DISTINCT id) as count FROM accessible_reports
    `;

    // Build pagination clause using helper for consistency
    const { clause: paginationClause, values: paginationValues } = buildPaginationClause(
      page,
      limit,
      paramCount + 1
    );

    const dataQuery = `
      WITH accessible_reports AS (
        -- Projects owned by user
        SELECT br.*
        FROM ${this.schema}.${this.tableName} br
        WHERE br.project_id IN (
          SELECT id FROM ${this.schema}.projects WHERE created_by = $1
        )
        ${additionalWhere}
        
        UNION ALL
        
        -- Projects where user is member
        SELECT br.*
        FROM ${this.schema}.${this.tableName} br
        WHERE br.project_id IN (
          SELECT project_id FROM ${this.schema}.project_members WHERE user_id = $1
        )
        ${additionalWhere}
      ),
      distinct_reports AS (
        SELECT DISTINCT ON (id) *
        FROM accessible_reports
        ORDER BY id
      )
      SELECT *
      FROM distinct_reports
      ORDER BY ${sortBy} ${order.toUpperCase()}
      ${paginationClause}
    `;

    // Prepare data query values with pagination parameters
    const dataValues = [...values, ...paginationValues];

    // Execute queries with parameterized pagination values
    const [countResult, dataResult] = await Promise.all([
      this.getClient().query(countQuery, values),
      this.getClient().query(dataQuery, dataValues),
    ]);

    const total = parseInt(countResult.rows[0].count, DECIMAL_BASE);
    const data = this.deserializeMany(dataResult.rows);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        // REST convention: minimum 1 page even for empty results
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /**
   * Build WHERE clause from standard filters (project_id, status, priority)
   */
  private buildBaseFilters(filters?: BugReportFilters): {
    clause: string;
    values: unknown[];
    paramCount: number;
  } {
    const filterData: Record<string, unknown> = {};

    // Handle single project_id or multiple project_ids (but not both)
    if (filters?.project_id) {
      filterData.project_id = filters.project_id;
    } else if (filters?.project_ids && filters.project_ids.length > 0) {
      // Will be handled separately with IN clause
    }

    if (filters?.organization_id) {
      filterData.organization_id = filters.organization_id;
    }
    if (filters?.status) {
      filterData.status = filters.status;
    }
    if (filters?.priority) {
      filterData.priority = filters.priority;
    }

    const result = buildWhereClause(filterData);

    // Add IN clause for project_ids if present
    if (filters?.project_ids && filters.project_ids.length > 0) {
      const placeholders = filters.project_ids
        .map((_, i) => `$${result.paramCount + i}`)
        .join(', ');
      const inClause = `project_id IN (${placeholders})`;

      if (result.clause) {
        result.clause += ` AND ${inClause}`;
      } else {
        result.clause = `WHERE ${inClause}`;
      }

      result.values.push(...filters.project_ids);
      result.paramCount += filters.project_ids.length;
    }

    return result;
  }

  /**
   * Build date range filters (created_after, created_before)
   */
  private buildDateFilters(
    filters: BugReportFilters | undefined,
    values: unknown[],
    startParamCount: number,
    existingWhereClause: string
  ): { clause: string; paramCount: number } {
    return this.buildDateRangeFilter(
      'created_at',
      filters?.created_after,
      filters?.created_before,
      values,
      startParamCount,
      existingWhereClause
    );
  }

  /**
   * Build soft-delete filter clause
   */
  private buildSoftDeleteFilter(
    includeDeleted: boolean | undefined,
    whereClause: string,
    dateClause: string
  ): string {
    if (includeDeleted) {
      return '';
    }

    const hasExistingClauses = whereClause.length > 0 || dateClause.length > 0;
    return hasExistingClauses ? ' AND deleted_at IS NULL' : ' WHERE deleted_at IS NULL';
  }

  /**
   * Execute data query and return deserialized results
   */
  private async executeDataQuery(
    whereClause: string,
    dateClause: string,
    softDeleteClause: string,
    values: unknown[],
    sort: BugReportSortOptions | undefined,
    pagination: PaginationOptions | undefined,
    paramCount: number
  ): Promise<BugReport[]> {
    const sortBy = sort?.sort_by ?? 'created_at';
    const order = sort?.order ?? 'desc';

    // Validate sort column and order (defense in depth)
    this.validateSortColumn(sortBy);
    this.validateSortOrder(order);

    const orderClause = buildOrderByClause(sortBy, order);

    const page = pagination?.page ?? DEFAULT_PAGE;
    const limit = pagination?.limit ?? DEFAULT_PAGE_SIZE;
    const paginationClause = buildPaginationClause(page, limit, paramCount);

    const query = `
      SELECT * FROM ${this.schema}.${this.tableName}
      ${whereClause}${dateClause ? ` ${dateClause}` : ''}${softDeleteClause ? ` ${softDeleteClause}` : ''}
      ${orderClause}
      ${paginationClause.clause}
    `;
    const queryValues = [...values, ...paginationClause.values];

    const result = await this.getClient().query(query, queryValues);
    return this.deserializeMany(result.rows);
  }

  // ============================================================================
  // RETENTION OPERATIONS
  // Consolidated from RetentionRepository to eliminate duplication
  // ============================================================================

  /**
   * Find bug reports eligible for deletion based on retention policy
   * Alias for findForRetention for backward compatibility
   */
  async findEligibleForDeletion(projectId: string, cutoffDate: Date): Promise<BugReport[]> {
    return this.findForRetention(projectId, cutoffDate, false);
  }

  /**
   * Find multiple bug reports by IDs in a single query
   * Used for batch operations to avoid N+1 query problems
   *
   * @param reportIds - Array of bug report IDs to fetch
   * @returns Array of bug reports (may be shorter than input if some IDs don't exist)
   */
  async findByIds(reportIds: string[]): Promise<BugReport[]> {
    if (reportIds.length === 0) {
      return [];
    }

    const query = `
      SELECT * FROM ${this.schema}.${this.tableName}
      WHERE id = ANY($1)
    `;

    const result = await this.getClient().query(query, [reportIds]);
    return this.deserializeMany(result.rows);
  }

  /**
   * Hard delete reports within transaction and return details for certificate generation
   */
  async hardDeleteInTransaction(
    reportIds: string[]
  ): Promise<Array<{ id: string; project_id: string }>> {
    if (reportIds.length === 0) {
      return [];
    }

    // Get report details before deletion
    const reportsQuery = `
      SELECT id, project_id FROM ${this.schema}.${this.tableName}
      WHERE id = ANY($1) AND legal_hold = FALSE
    `;
    const reportsResult = await this.getClient().query<{ id: string; project_id: string }>(
      reportsQuery,
      [reportIds]
    );
    const reports = reportsResult.rows;

    if (reports.length === 0) {
      return [];
    }

    // Delete from database (only reports that passed legal hold check)
    const deletableIds = reports.map((r) => r.id);
    await this.getClient().query(
      `DELETE FROM ${this.schema}.${this.tableName} WHERE id = ANY($1)`,
      [deletableIds]
    );

    return reports;
  }

  /**
   * Count reports currently on legal hold
   */
  async countLegalHoldReports(): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM ${this.schema}.${this.tableName}
      WHERE legal_hold = TRUE AND deleted_at IS NULL
    `;
    const result = await this.getClient().query<{ count: string }>(query);
    return parseInt(result.rows[0]?.count ?? '0', DECIMAL_BASE);
  }

  /**
   * Count bug reports belonging to an organization (includes soft-deleted,
   * since the audit log for a cascade-driven hard-delete wants the total
   * count of rows the cascade is about to destroy — not only the live ones).
   */
  async countByOrganizationId(organizationId: string): Promise<number> {
    const query = `SELECT COUNT(*)::int AS count FROM ${this.schema}.${this.tableName} WHERE organization_id = $1`;
    const result = await this.getClient().query<{ count: number }>(query, [organizationId]);
    return result.rows[0]?.count ?? 0;
  }
}
