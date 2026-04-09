/**
 * Unified Pagination Builder
 *
 * Consolidates pagination logic including:
 * - LIMIT/OFFSET clause generation
 * - ORDER BY clause with SQL injection protection
 * - Pagination metadata calculation
 *
 * Security: All column names are validated against SQL injection.
 *
 * @example
 * ```typescript
 * const builder = new PaginationBuilder()
 *   .page(2, 20)
 *   .orderBy('created_at', 'desc')
 *   .orderBy('name', 'asc');
 *
 * const { orderByClause, limitClause, values, metadata } = builder.build(100, 5); // paramCount=5
 * // orderByClause: "ORDER BY created_at DESC, name ASC"
 * // limitClause: "LIMIT $5 OFFSET $6"
 * // values: [20, 20]  // limit, offset
 * // metadata: { page: 2, limit: 20, total: 100, totalPages: 5 }
 * ```
 */

import { SqlValidationError, validateSqlIdentifier } from './repositories/base-repository.js';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './constants.js';

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc' | 'ASC' | 'DESC';

/**
 * Sort column configuration
 */
export interface SortColumn {
  column: string;
  direction: SortDirection;
}

/**
 * Pagination metadata returned in responses
 */
export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Result of building pagination clauses
 */
export interface PaginationResult {
  /** ORDER BY clause (e.g., "ORDER BY created_at DESC") */
  orderByClause: string;
  /** LIMIT/OFFSET clause with parameters (e.g., "LIMIT $5 OFFSET $6") */
  limitClause: string;
  /** Parameter values [limit, offset] */
  values: [number, number];
  /** Next parameter count after pagination params */
  paramCount: number;
}

/**
 * SQL keywords that should never appear as column names in ORDER BY
 */
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

/**
 * Maximum number of ORDER BY columns (DoS prevention)
 */
const MAX_ORDER_BY_COLUMNS = 10;

/**
 * Fluent pagination builder
 */
export class PaginationBuilder {
  private _page: number = DEFAULT_PAGE;
  private _limit: number = DEFAULT_PAGE_SIZE;
  private sortColumns: SortColumn[] = [];

  /**
   * Set pagination parameters
   *
   * @param page - Page number (minimum: 1)
   * @param limit - Items per page (1-1000)
   * @returns this (for chaining)
   */
  page(page: number = DEFAULT_PAGE, limit: number = DEFAULT_PAGE_SIZE): this {
    // Validate page
    if (!Number.isInteger(page) || page < 1) {
      throw new SqlValidationError(
        `Invalid page number: ${page}. Must be an integer >= 1`,
        String(page),
        'pagination'
      );
    }

    // Validate limit
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new SqlValidationError(
        `Invalid limit: ${limit}. Must be an integer between 1 and ${MAX_PAGE_SIZE}`,
        String(limit),
        'pagination'
      );
    }

    this._page = page;
    this._limit = limit;
    return this;
  }

  /**
   * Add a sort column
   *
   * @param column - Column name (validated for SQL injection)
   * @param direction - Sort direction ('asc' or 'desc')
   * @returns this (for chaining)
   *
   * @example
   * builder.orderBy('created_at', 'desc').orderBy('name', 'asc')
   */
  orderBy(column: string, direction: SortDirection = 'desc'): this {
    if (this.sortColumns.length >= MAX_ORDER_BY_COLUMNS) {
      throw new SqlValidationError(
        `Too many ORDER BY columns: ${this.sortColumns.length + 1}. Maximum allowed: ${MAX_ORDER_BY_COLUMNS}`,
        column,
        'orderby'
      );
    }

    validateSqlIdentifier(column);

    // Check for SQL keywords
    const upperColumn = column.toUpperCase();
    if (SQL_KEYWORDS.has(upperColumn)) {
      throw new SqlValidationError(
        `Invalid ORDER BY column: "${column}" is a reserved SQL keyword`,
        column,
        'orderby'
      );
    }

    // Normalize direction
    const normalizedDirection = direction.toLowerCase() as 'asc' | 'desc';
    if (normalizedDirection !== 'asc' && normalizedDirection !== 'desc') {
      throw new SqlValidationError(
        `Invalid sort direction: "${direction}". Must be 'asc' or 'desc'`,
        direction,
        'orderby'
      );
    }

    this.sortColumns.push({ column, direction: normalizedDirection });
    return this;
  }

  /**
   * Add a validated sort column from a whitelist
   *
   * @param column - Column name from user input
   * @param direction - Sort direction from user input
   * @param allowedColumns - Whitelist of allowed column names
   * @param defaultColumn - Default column if input is invalid
   * @param defaultDirection - Default direction if input is invalid
   * @returns this (for chaining)
   *
   * @example
   * const allowedSort = ['created_at', 'name', 'status'] as const;
   * builder.orderByValidated(
   *   userSortBy,
   *   userOrder,
   *   allowedSort,
   *   'created_at',
   *   'desc'
   * );
   */
  orderByValidated(
    column: string | undefined,
    direction: string | undefined,
    allowedColumns: readonly string[],
    defaultColumn: string,
    defaultDirection: SortDirection = 'desc'
  ): this {
    const safeColumn = column && allowedColumns.includes(column) ? column : defaultColumn;
    const safeDirection =
      direction && (direction.toLowerCase() === 'asc' || direction.toLowerCase() === 'desc')
        ? (direction.toLowerCase() as SortDirection)
        : defaultDirection;

    return this.orderBy(safeColumn, safeDirection);
  }

  /**
   * Build pagination clauses
   *
   * @param total - Total count of items (for metadata)
   * @param startParamCount - Starting parameter number
   * @returns PaginationResult with clauses and metadata
   */
  build(
    total: number,
    startParamCount: number = 1
  ): PaginationResult & { metadata: PaginationMetadata } {
    const offset = (this._page - 1) * this._limit;

    // Build ORDER BY clause
    let orderByClause = '';
    if (this.sortColumns.length > 0) {
      const sortParts = this.sortColumns.map(
        ({ column, direction }) => `${column} ${direction.toUpperCase()}`
      );
      orderByClause = `ORDER BY ${sortParts.join(', ')}`;
    }

    // Build LIMIT/OFFSET clause
    const limitClause = `LIMIT $${startParamCount} OFFSET $${startParamCount + 1}`;

    return {
      orderByClause,
      limitClause,
      values: [this._limit, offset],
      paramCount: startParamCount + 2,
      metadata: {
        page: this._page,
        limit: this._limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / this._limit)),
      },
    };
  }

  /**
   * Build just the ORDER BY clause (without pagination)
   */
  buildOrderBy(): string {
    if (this.sortColumns.length === 0) {
      return '';
    }

    const sortParts = this.sortColumns.map(
      ({ column, direction }) => `${column} ${direction.toUpperCase()}`
    );
    return `ORDER BY ${sortParts.join(', ')}`;
  }

  /**
   * Get current page number
   */
  getPage(): number {
    return this._page;
  }

  /**
   * Get current limit
   */
  getLimit(): number {
    return this._limit;
  }

  /**
   * Get offset
   */
  getOffset(): number {
    return (this._page - 1) * this._limit;
  }

  /**
   * Check if any sort columns have been added
   */
  hasSorting(): boolean {
    return this.sortColumns.length > 0;
  }
}

/**
 * Create a new PaginationBuilder instance
 *
 * @example
 * const pagination = createPagination()
 *   .page(1, 20)
 *   .orderBy('created_at', 'desc')
 *   .build(100, 3);
 */
export function createPagination(): PaginationBuilder {
  return new PaginationBuilder();
}

/**
 * Calculate pagination metadata from total count
 */
export function calculatePaginationMetadata(
  page: number,
  limit: number,
  total: number
): PaginationMetadata {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
