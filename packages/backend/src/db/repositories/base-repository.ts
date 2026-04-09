/**
 * Base Repository
 * Abstract base class for all entity repositories
 * Provides common CRUD operations following DRY and SOLID principles
 */

import type { Pool, PoolClient } from 'pg';
import { getLogger } from '../../logger.js';
import { deserializeRow, serializeJsonField, buildPaginationClause } from '../query-builder.js';
import type { PaginationOptions, PaginatedResult } from '../types.js';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from '../constants.js';

/**
 * SQL Validation Error
 * Thrown when SQL input validation fails (identifiers, ORDER BY, pagination, limits, etc.)
 * Helps distinguish validation errors from other database errors
 */
export class SqlValidationError extends Error {
  constructor(
    message: string,
    public readonly invalidInput: string,
    public readonly validationType: 'identifier' | 'orderby' | 'pagination' | 'limit'
  ) {
    super(message);
    this.name = 'SqlValidationError';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SqlValidationError);
    }
  }
}

/**
 * Validate SQL identifier to prevent SQL injection
 * Only allows alphanumeric characters and underscores
 * Enforces PostgreSQL's 63-character limit to prevent truncation attacks
 */
export function validateSqlIdentifier(identifier: string): void {
  // Check length (PostgreSQL max identifier length is 63)
  if (identifier.length === 0 || identifier.length > 63) {
    throw new SqlValidationError(
      `SQL identifier length must be 1-63 characters, got ${identifier.length}`,
      identifier,
      'identifier'
    );
  }

  // Check character pattern
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
    throw new SqlValidationError(`Invalid SQL identifier: ${identifier}`, identifier, 'identifier');
  }
}

/**
 * Validate ORDER BY clause to prevent SQL injection
 * Allows column names, ASC/DESC, commas, and spaces
 * Does NOT allow semicolons, comments, or other SQL syntax
 * Limits number of ORDER BY columns to prevent query complexity attacks
 */
function validateOrderByClause(orderBy: string): void {
  // Trim and normalize spaces, then check for empty
  const normalized = orderBy.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0) {
    throw new SqlValidationError('ORDER BY clause cannot be empty', orderBy, 'orderby');
  }

  // Allow: column names (alphanumeric + underscore), ASC, DESC, comma, space
  // Example: "name ASC", "priority DESC, created_at ASC"
  if (!/^[a-zA-Z0-9_\s,]+$/.test(normalized)) {
    throw new SqlValidationError(`Invalid ORDER BY clause: ${orderBy}`, orderBy, 'orderby');
  }

  // Additional validation: ensure each part is a valid column [ASC|DESC]? pattern
  // Split by comma to validate each ORDER BY clause individually
  const clauses = normalized.split(',').map((c) => c.trim());

  // Security: Limit number of ORDER BY columns to prevent DoS via complexity
  const MAX_ORDER_BY_COLUMNS = 10;
  if (clauses.length > MAX_ORDER_BY_COLUMNS) {
    throw new SqlValidationError(
      `Too many ORDER BY columns: ${clauses.length}. Maximum allowed: ${MAX_ORDER_BY_COLUMNS}`,
      orderBy,
      'orderby'
    );
  }

  // SQL keywords that should never appear as column names
  const SQL_KEYWORDS = new Set([
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'CREATE',
    'ALTER',
    'UNION',
    'WHERE',
    'FROM',
    'JOIN',
    'INNER',
    'OUTER',
    'LEFT',
    'RIGHT',
    'ON',
    'AND',
    'OR',
    'NOT',
    'IN',
    'EXISTS',
    'LIKE',
    'BETWEEN',
    'TABLE',
    'DATABASE',
    'INDEX',
    'VIEW',
    'TRIGGER',
    'PROCEDURE',
    'FUNCTION',
    'GRANT',
    'REVOKE',
    'TRUNCATE',
    'EXEC',
    'EXECUTE',
  ]);

  const validClausePattern = /^[a-zA-Z_][a-zA-Z0-9_]*(\s+(ASC|DESC))?$/i;

  for (const clause of clauses) {
    if (!validClausePattern.test(clause)) {
      throw new SqlValidationError(
        `Invalid ORDER BY clause part: "${clause}". Expected format: "column_name" or "column_name ASC/DESC"`,
        orderBy,
        'orderby'
      );
    }

    // Extract column name (part before ASC/DESC if present)
    const parts = clause.split(/\s+/);
    const columnName = parts[0].toUpperCase();

    // Check if column name is exactly a reserved SQL keyword
    // Note: We don't check for keywords concatenated with column names (e.g., "nameUNION")
    // because that creates false positives (e.g., "description" contains "DESC").
    // The validClausePattern already prevents most SQL injection attempts.
    // TODO: Full migration to Kysely will eliminate need for manual validation.
    if (SQL_KEYWORDS.has(columnName)) {
      throw new SqlValidationError(
        `Invalid ORDER BY clause part: "${clause}". Column name "${parts[0]}" is a reserved SQL keyword`,
        orderBy,
        'orderby'
      );
    }

    // Reject standalone ASC/DESC without column name
    if (columnName === 'ASC' || columnName === 'DESC') {
      throw new SqlValidationError(
        `Invalid ORDER BY clause part: "${clause}". ASC/DESC must follow a column name`,
        orderBy,
        'orderby'
      );
    }
  }
}

type DatabaseSchemas = 'application' | 'saas';

/**
 * Base repository with common CRUD operations
 */
export abstract class BaseRepository<T, TInsert = Partial<T>, TUpdate = Partial<T>> {
  constructor(
    protected pool: Pool | PoolClient,
    protected schema: DatabaseSchemas = 'application',
    protected tableName: string,
    protected jsonFields: string[] = []
  ) {
    // Security: Validate table name as defense-in-depth
    // Even though table names are hardcoded in repository constructors,
    // this prevents future bugs if dynamic table names are introduced
    validateSqlIdentifier(tableName);
  }

  /**
   * Get the pool or client for queries
   * Allows using a transaction client when provided
   */
  protected getClient(): Pool | PoolClient {
    return this.pool;
  }

  /**
   * Find a single record by ID
   */
  async findById(id: string): Promise<T | null> {
    const query = `SELECT * FROM ${this.schema}.${this.tableName} WHERE id = $1`;
    const result = await this.getClient().query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.deserialize(result.rows[0]);
  }

  /**
   * Find multiple records by their IDs in a single query.
   * Subclasses may override with a different return type (e.g., Map).
   */
  async findByIds(ids: string[]): Promise<T[] | Map<string, T>> {
    if (ids.length === 0) {
      return [];
    }
    const query = `SELECT * FROM ${this.schema}.${this.tableName} WHERE id = ANY($1)`;
    const result = await this.getClient().query(query, [ids]);
    return result.rows.map((row: Record<string, unknown>) => this.deserialize(row));
  }

  /**
   * Create a new record
   */
  async create(data: TInsert): Promise<T> {
    const serialized = this.serializeForInsert(data);
    const columns = Object.keys(serialized);

    // Validate all column names to prevent SQL injection
    columns.forEach(validateSqlIdentifier);

    const placeholders = columns
      .map((_, i) => {
        return `$${i + 1}`;
      })
      .join(', ');
    const values = Object.values(serialized);

    const query = `
      INSERT INTO ${this.schema}.${this.tableName} (${columns.join(', ')})
      VALUES (${placeholders})
      RETURNING *
    `;

    const result = await this.getClient().query(query, values);
    return this.deserialize(result.rows[0]);
  }

  /**
   * Update a record by ID
   */
  async update(id: string, data: TUpdate): Promise<T | null> {
    const serialized = this.serializeForUpdate(data);
    const entries = Object.entries(serialized);

    if (entries.length === 0) {
      return this.findById(id);
    }

    // Validate all column names to prevent SQL injection
    entries.forEach(([key]) => {
      return validateSqlIdentifier(key);
    });

    const setClauses = entries
      .map(([key], i) => {
        return `${key} = $${i + 1}`;
      })
      .join(', ');
    const values = [
      ...entries.map(([, value]) => {
        return value;
      }),
      id,
    ];

    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET ${setClauses}
      WHERE id = $${entries.length + 1}
      RETURNING *
    `;

    const result = await this.getClient().query(query, values);

    if (result.rows.length === 0) {
      return null;
    }

    return this.deserialize(result.rows[0]);
  }

  /**
   * Delete a record by ID
   */
  async delete(id: string): Promise<boolean> {
    const query = `DELETE FROM ${this.schema}.${this.tableName} WHERE id = $1`;
    const result = await this.getClient().query(query, [id]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Deserialize a database row
   * Override in subclasses for custom deserialization
   */
  protected deserialize(row: unknown): T {
    return deserializeRow<T>(row, this.jsonFields);
  }

  /**
   * Serialize data for database operations (shared logic for insert/update)
   * Handles JSON field serialization and filters out undefined values
   */
  protected serialize(data: Record<string, unknown>): Record<string, unknown> {
    const serialized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        serialized[key] = this.jsonFields.includes(key) ? serializeJsonField(value) : value;
      }
    }

    return serialized;
  }

  /**
   * Serialize data for insert
   * Override in subclasses for custom serialization
   */
  protected serializeForInsert(data: TInsert): Record<string, unknown> {
    return this.serialize(data as Record<string, unknown>);
  }

  /**
   * Serialize data for update
   * Override in subclasses for custom serialization
   */
  protected serializeForUpdate(data: TUpdate): Record<string, unknown> {
    return this.serialize(data as Record<string, unknown>);
  }

  /**
   * Log repository actions
   */
  protected log(message: string, meta?: Record<string, unknown>): void {
    getLogger().debug(message, { schema: this.schema, table: this.tableName, ...meta });
  }

  /**
   * Find records by a single column value
   * Generic helper to eliminate repeated query patterns
   */
  protected async findBy(column: string, value: unknown): Promise<T | null> {
    validateSqlIdentifier(column);
    const query = `SELECT * FROM ${this.schema}.${this.tableName} WHERE ${column} = $1`;
    const result = await this.getClient().query(query, [value]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.deserialize(result.rows[0]);
  }

  /**
   * Find multiple records by a single column value
   * Generic helper for foreign key lookups
   */
  protected async findManyBy(column: string, value: unknown): Promise<T[]> {
    validateSqlIdentifier(column);
    const query = `SELECT * FROM ${this.schema}.${this.tableName} WHERE ${column} = $1`;
    const result = await this.getClient().query(query, [value]);
    return this.deserializeMany(result.rows);
  }

  /**
   * Deserialize multiple rows
   * Eliminates repeated map patterns
   */
  protected deserializeMany(rows: unknown[]): T[] {
    return rows.map((row) => {
      return this.deserialize(row);
    });
  }

  /**
   * Find a record matching multiple column conditions
   * Useful for composite lookups like OAuth (provider + id)
   */
  protected async findByMultiple(conditions: Record<string, unknown>): Promise<T | null> {
    const entries = Object.entries(conditions);

    // Validate all column names to prevent SQL injection
    entries.forEach(([key]) => {
      return validateSqlIdentifier(key);
    });

    const whereClauses = entries.map(([key], i) => {
      return `${key} = $${i + 1}`;
    });
    const values = entries.map(([, value]) => {
      return value;
    });

    const query = `SELECT * FROM ${this.schema}.${this.tableName} WHERE ${whereClauses.join(' AND ')}`;
    const result = await this.getClient().query(query, values);

    if (result.rows.length === 0) {
      return null;
    }

    return this.deserialize(result.rows[0]);
  }

  /**
   * Build date range filter clause
   * Reusable helper for created_at, updated_at, or any timestamp column
   *
   * **Automatic WHERE/AND Detection**: Examines existingWhereClause to determine
   * whether to use 'WHERE' (if no WHERE exists) or 'AND' (if WHERE already present).
   * This eliminates the error-prone manual boolean parameter.
   *
   * @param fieldName - Database column name (e.g., 'created_at', 'timestamp')
   * @param afterDate - Start date (inclusive)
   * @param beforeDate - End date (inclusive)
   * @param values - Array to push parameter values into
   * @param startParamCount - Starting parameter number
   * @param existingWhereClause - Current WHERE clause to check (empty string if none)
   * @returns Object with SQL clause fragment and next parameter count
   *
   * @example
   * ```typescript
   * // No existing WHERE clause
   * const { clause } = buildDateRangeFilter('created_at', startDate, endDate, values, 1, '');
   * // Returns: 'WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz'
   * const query = `SELECT * FROM table ${clause}`; // Add space explicitly
   *
   * // Existing WHERE clause
   * const { clause } = buildDateRangeFilter('created_at', startDate, endDate, values, 3, 'WHERE project_id = $1');
   * // Returns: 'AND created_at >= $3::timestamptz AND created_at <= $4::timestamptz'
   * const query = `SELECT * FROM table ${whereClause} ${clause}`; // Add space explicitly
   * ```
   */
  protected buildDateRangeFilter(
    fieldName: string,
    afterDate: Date | undefined,
    beforeDate: Date | undefined,
    values: unknown[],
    startParamCount: number,
    existingWhereClause = ''
  ): { clause: string; paramCount: number } {
    validateSqlIdentifier(fieldName);

    const conditions: string[] = [];
    let paramCount = startParamCount;

    if (afterDate) {
      conditions.push(`${fieldName} >= $${paramCount}::timestamptz`);
      values.push(afterDate.toISOString());
      paramCount++;
    }

    if (beforeDate) {
      conditions.push(`${fieldName} <= $${paramCount}::timestamptz`);
      values.push(beforeDate.toISOString());
      paramCount++;
    }

    if (conditions.length === 0) {
      return { clause: '', paramCount };
    }

    // Automatically detect: use AND if WHERE already exists, otherwise use WHERE
    // Returns without leading space - callers must add space explicitly when concatenating
    const hasWhere = existingWhereClause.trim().toUpperCase().includes('WHERE');
    const prefix = hasWhere ? 'AND ' : 'WHERE ';
    const clause = prefix + conditions.join(' AND ');
    return { clause, paramCount };
  }

  /**
   * Execute count query for pagination
   * Reusable helper to eliminate duplicate count query patterns
   * @param whereClause - Complete WHERE clause with all filters
   * @param values - Array of parameter values
   * @returns Total count of matching records
   */
  protected async executeCountQuery(whereClause: string, values: unknown[]): Promise<number> {
    const query = `SELECT COUNT(*) FROM ${this.schema}.${this.tableName} ${whereClause}`;
    const result = await this.getClient().query<{ count: string }>(query, values);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Generic list method with pagination support
   * Eliminates duplication across all repositories that need paginated lists
   *
   * **Limitations:**
   * - Only supports simple equality filters (WHERE column = value)
   * - For complex queries (LIKE, IN, joins), implement custom list methods
   * - orderBy parameter must be a validated constant, never pass user input directly
   *
   * @template F - Filter object type extending Record<string, unknown>
   *               Keys must be valid database column names
   * @param filters - Object with filter conditions (e.g., { project_id: 'xxx', active: true })
   *                  Only undefined values are ignored; null is treated as NULL in SQL
   * @param orderBy - SQL ORDER BY clause WITHOUT the 'ORDER BY' keywords
   *                  (e.g., 'name ASC', 'priority DESC, name ASC')
   *                  ⚠️ Must be a hardcoded string or validated constant - never user input
   * @param pagination - Optional pagination parameters (page, limit)
   * @returns Paginated result with data and pagination metadata
   *
   * @example
   * ```typescript
   * // Simple usage
   * return this.listWithPagination({ project_id: '123' }, 'name ASC', pagination);
   *
   * // Multiple filters
   * return this.listWithPagination(
   *   { project_id: '123', active: true, type: 'email' },
   *   'created_at DESC',
   *   { page: 1, limit: 20 }
   * );
   * ```
   */
  protected async listWithPagination<F extends Record<string, unknown>>(
    filters: F,
    orderBy: string,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<T>> {
    // Validate ORDER BY clause to prevent SQL injection
    validateOrderByClause(orderBy);

    const { whereClause, values, paramCount } = this.buildWhereClause(filters);

    // Get total count
    const total = await this.executeCountQuery(whereClause, values);

    // Get paginated data
    const page = pagination?.page ?? DEFAULT_PAGE;
    const limit = pagination?.limit ?? DEFAULT_PAGE_SIZE;
    const { clause: paginationClause, values: paginationValues } = buildPaginationClause(
      page,
      limit,
      paramCount
    );

    const dataQuery = `SELECT * FROM ${this.schema}.${this.tableName}${whereClause} ORDER BY ${orderBy} ${paginationClause}`;
    const dataValues = [...values, ...paginationValues];
    const dataResult = await this.getClient().query(dataQuery, dataValues);

    return {
      data: this.deserializeMany(dataResult.rows),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Build WHERE clause from filter object
   * Generic helper to eliminate filter building duplication
   *
   * **Behavior:**
   * - Only supports simple equality filters (WHERE column = value)
   * - Undefined values are skipped (not included in WHERE clause)
   * - Null values are included as IS NULL checks
   * - All column names are validated to prevent SQL injection
   *
   * @template F - Filter object type extending Record<string, unknown>
   *               Keys must be valid database column names
   * @param filters - Object with filter conditions (keys = column names, values = filter values)
   * @returns Object with WHERE clause, values array, and next parameter count
   *
   * @example
   * ```typescript
   * const { whereClause, values, paramCount } = this.buildWhereClause({
   *   project_id: '123',
   *   active: true,
   *   archived: undefined  // This will be skipped
   * });
   * // Result: whereClause = " WHERE project_id = $1 AND active = $2"
   * //         values = ['123', true]
   * //         paramCount = 3
   * ```
   */
  protected buildWhereClause<F extends Record<string, unknown>>(
    filters: F
  ): {
    whereClause: string;
    values: unknown[];
    paramCount: number;
  } {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    // Security: Limit number of filter conditions to prevent resource exhaustion
    const entries = Object.entries(filters).filter(([, v]) => v !== undefined);
    const MAX_FILTER_CONDITIONS = 50;
    if (entries.length > MAX_FILTER_CONDITIONS) {
      throw new SqlValidationError(
        `Too many filter conditions: ${entries.length}. Maximum allowed: ${MAX_FILTER_CONDITIONS}`,
        JSON.stringify(Object.keys(filters)),
        'identifier'
      );
    }

    for (const [key, value] of entries) {
      validateSqlIdentifier(key);
      conditions.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    return { whereClause, values, paramCount };
  }
}
