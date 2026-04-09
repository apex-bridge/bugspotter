/**
 * Unified Filter Builder
 *
 * Fluent interface for building SQL WHERE clauses with parameterized queries.
 * Consolidates common filtering patterns across repositories:
 * - Simple equality filters
 * - ILIKE/search patterns
 * - Array ANY filters
 * - Date range filters
 * - Comparison operators (>, <, >=, <=)
 * - IN clauses
 * - IS NULL / IS NOT NULL
 *
 * Security: All column names are validated against SQL injection.
 * All values are parameterized to prevent SQL injection.
 *
 * @example
 * ```typescript
 * const builder = new FilterBuilder()
 *   .equals('status', 'active')
 *   .ilike('name', search)
 *   .dateRange('created_at', { after: startDate, before: endDate })
 *   .any('type', types);
 *
 * const { whereClause, values, paramCount } = builder.build();
 * // whereClause: "WHERE status = $1 AND name ILIKE $2 AND created_at >= $3::timestamptz AND type = ANY($4)"
 * // values: ['active', '%search%', '2024-01-01T00:00:00.000Z', ['type1', 'type2']]
 * ```
 */

import { SqlValidationError, validateSqlIdentifier } from './repositories/base-repository.js';

/**
 * Result of building a WHERE clause
 */
export interface FilterResult {
  /** Complete WHERE clause (empty string if no conditions) */
  whereClause: string;
  /** Parameter values in order */
  values: unknown[];
  /** Next parameter number to use */
  paramCount: number;
}

/**
 * Date range filter options
 */
export interface DateRangeOptions {
  /** Start date (inclusive) - uses >= */
  after?: Date;
  /** End date (inclusive) - uses <= */
  before?: Date;
}

/**
 * Comparison operators supported by the filter builder
 */
export type ComparisonOperator = '=' | '!=' | '<' | '>' | '<=' | '>=' | '<>' | 'LIKE' | 'ILIKE';

/**
 * Fluent filter builder for SQL WHERE clauses
 *
 * Not thread-safe: Each instance maintains mutable state.
 * Fluent API pattern: Each method modifies and returns the same instance for chaining.
 */
export class FilterBuilder {
  private conditions: string[] = [];
  private values: unknown[] = [];
  private paramCount: number;

  /**
   * Maximum number of filter conditions allowed (DoS prevention)
   */
  private static readonly MAX_CONDITIONS = 50;

  /**
   * Create a new FilterBuilder
   * @param startParamCount - Starting parameter number (default: 1)
   */
  constructor(startParamCount: number = 1) {
    this.paramCount = startParamCount;
  }

  /**
   * Add a simple equality condition
   *
   * @param column - Column name (validated for SQL injection)
   * @param value - Value to compare (undefined/null values are skipped)
   * @returns this (for chaining)
   *
   * @example
   * builder.equals('status', 'active')
   * // Result: status = $1 with value 'active'
   */
  equals(column: string, value: unknown): this {
    if (value === undefined || value === null) {
      return this;
    }

    validateSqlIdentifier(column);
    this.checkConditionLimit();
    this.conditions.push(`${column} = $${this.paramCount++}`);
    this.values.push(value);
    return this;
  }

  /**
   * Add a not equals condition
   *
   * @param column - Column name
   * @param value - Value to compare
   * @returns this (for chaining)
   */
  notEquals(column: string, value: unknown): this {
    if (value === undefined || value === null) {
      return this;
    }

    validateSqlIdentifier(column);
    this.checkConditionLimit();
    this.conditions.push(`${column} != $${this.paramCount++}`);
    this.values.push(value);
    return this;
  }

  /**
   * Add a comparison condition with custom operator
   *
   * @param column - Column name
   * @param operator - Comparison operator
   * @param value - Value to compare
   * @returns this (for chaining)
   *
   * @example
   * builder.compare('expires_at', '<', new Date())
   */
  compare(column: string, operator: ComparisonOperator, value: unknown): this {
    if (value === undefined || value === null) {
      return this;
    }

    validateSqlIdentifier(column);
    this.checkConditionLimit();
    this.conditions.push(`${column} ${operator} $${this.paramCount++}`);
    this.values.push(value);
    return this;
  }

  /**
   * Add an ILIKE condition for case-insensitive search
   *
   * @param column - Column name
   * @param value - Search value (will be wrapped in %)
   * @param mode - Search mode: 'contains' (default), 'startsWith', 'endsWith', 'exact'
   * @returns this (for chaining)
   *
   * @example
   * builder.ilike('email', 'test')
   * // Result: email ILIKE $1 with value '%test%'
   */
  ilike(
    column: string,
    value: string | undefined | null,
    mode: 'contains' | 'startsWith' | 'endsWith' | 'exact' = 'contains'
  ): this {
    if (value === undefined || value === null || value === '') {
      return this;
    }

    validateSqlIdentifier(column);
    this.checkConditionLimit();

    // Escape special LIKE characters to prevent pattern injection
    const escapedValue = value.replace(/[%_\\]/g, '\\$&');

    let pattern: string;
    switch (mode) {
      case 'startsWith':
        pattern = `${escapedValue}%`;
        break;
      case 'endsWith':
        pattern = `%${escapedValue}`;
        break;
      case 'exact':
        pattern = escapedValue;
        break;
      case 'contains':
      default:
        pattern = `%${escapedValue}%`;
    }

    this.conditions.push(`${column} ILIKE $${this.paramCount++}`);
    this.values.push(pattern);
    return this;
  }

  /**
   * Add a LIKE condition for case-sensitive pattern matching
   *
   * @param column - Column name
   * @param value - Search value (will be wrapped in %)
   * @param mode - Search mode: 'contains' (default), 'startsWith', 'endsWith', 'exact'
   * @returns this (for chaining)
   */
  like(
    column: string,
    value: string | undefined | null,
    mode: 'contains' | 'startsWith' | 'endsWith' | 'exact' = 'contains'
  ): this {
    if (value === undefined || value === null || value === '') {
      return this;
    }

    validateSqlIdentifier(column);
    this.checkConditionLimit();

    // Escape special LIKE characters
    const escapedValue = value.replace(/[%_\\]/g, '\\$&');

    let pattern: string;
    switch (mode) {
      case 'startsWith':
        pattern = `${escapedValue}%`;
        break;
      case 'endsWith':
        pattern = `%${escapedValue}`;
        break;
      case 'exact':
        pattern = escapedValue;
        break;
      case 'contains':
      default:
        pattern = `%${escapedValue}%`;
    }

    this.conditions.push(`${column} LIKE $${this.paramCount++}`);
    this.values.push(pattern);
    return this;
  }

  /**
   * Add multi-column search with ILIKE (OR between columns)
   *
   * @param columns - Array of column names to search
   * @param value - Search value
   * @param mode - Search mode: 'contains' (default), 'startsWith', 'endsWith', 'exact'
   * @returns this (for chaining)
   *
   * @example
   * builder.ilikeAny(['name', 'description'], 'test')
   * // Result: (name ILIKE $1 OR description ILIKE $1) with value '%test%'
   *
   * @example
   * builder.ilikeAny(['first_name', 'last_name'], 'john', 'startsWith')
   * // Result: (first_name ILIKE $1 OR last_name ILIKE $1) with value 'john%'
   */
  ilikeAny(
    columns: string[],
    value: string | undefined | null,
    mode: 'contains' | 'startsWith' | 'endsWith' | 'exact' = 'contains'
  ): this {
    if (value === undefined || value === null || value === '' || columns.length === 0) {
      return this;
    }

    columns.forEach(validateSqlIdentifier);
    this.checkConditionLimit();

    // Escape special LIKE characters to prevent pattern injection
    const escapedValue = value.replace(/[%_\\]/g, '\\$&');

    let pattern: string;
    switch (mode) {
      case 'startsWith':
        pattern = `${escapedValue}%`;
        break;
      case 'endsWith':
        pattern = `%${escapedValue}`;
        break;
      case 'exact':
        pattern = escapedValue;
        break;
      case 'contains':
      default:
        pattern = `%${escapedValue}%`;
    }

    const orConditions = columns.map((col) => `${col} ILIKE $${this.paramCount}`).join(' OR ');
    this.conditions.push(`(${orConditions})`);
    this.values.push(pattern);
    this.paramCount++;
    return this;
  }

  /**
   * Add a date range filter with optional start/end dates
   *
   * @param column - Timestamp column name
   * @param options - Date range options
   * @returns this (for chaining)
   *
   * @example
   * builder.dateRange('created_at', { after: startDate, before: endDate })
   */
  dateRange(column: string, options: DateRangeOptions): this {
    validateSqlIdentifier(column);

    // Count how many conditions we're about to add
    const conditionsToAdd = (options.after ? 1 : 0) + (options.before ? 1 : 0);

    // Early return if no conditions to add
    if (conditionsToAdd === 0) {
      return this;
    }

    // ATOMIC CHECK: Verify ALL conditions can be added before adding ANY
    // This prevents partial application if limit would be exceeded
    if (this.conditions.length + conditionsToAdd > FilterBuilder.MAX_CONDITIONS) {
      throw new SqlValidationError(
        `Too many filter conditions: ${this.conditions.length + conditionsToAdd}. Maximum allowed: ${FilterBuilder.MAX_CONDITIONS}`,
        String(this.conditions.length + conditionsToAdd),
        'limit'
      );
    }

    // Now add all conditions (we've verified they'll all fit)
    if (options.after) {
      this.conditions.push(`${column} >= $${this.paramCount++}::timestamptz`);
      this.values.push(options.after.toISOString());
    }

    if (options.before) {
      this.conditions.push(`${column} <= $${this.paramCount++}::timestamptz`);
      this.values.push(options.before.toISOString());
    }

    return this;
  }

  /**
   * Add a timestamp comparison with explicit casting
   *
   * @param column - Timestamp column name
   * @param operator - Comparison operator
   * @param value - Date value
   * @returns this (for chaining)
   */
  timestamp(
    column: string,
    operator: '<' | '>' | '<=' | '>=',
    value: Date | undefined | null
  ): this {
    if (value === undefined || value === null) {
      return this;
    }

    validateSqlIdentifier(column);
    this.checkConditionLimit();
    this.conditions.push(`${column} ${operator} $${this.paramCount++}::timestamptz`);
    this.values.push(value.toISOString());
    return this;
  }

  /**
   * Add an IN clause for array of values
   *
   * @param column - Column name
   * @param values - Array of values
   * @returns this (for chaining)
   *
   * @example
   * builder.in('status', ['active', 'pending'])
   * // Result: status IN ($1, $2) with values ['active', 'pending']
   */
  in(column: string, values: unknown[] | undefined | null): this {
    if (!values || values.length === 0) {
      return this;
    }

    validateSqlIdentifier(column);
    this.checkConditionLimit();

    const placeholders = values.map(() => `$${this.paramCount++}`).join(', ');
    this.conditions.push(`${column} IN (${placeholders})`);
    this.values.push(...values);
    return this;
  }

  /**
   * Add an ANY clause for PostgreSQL array comparison (more efficient than IN for large arrays)
   *
   * @param column - Column name
   * @param values - Array of values
   * @returns this (for chaining)
   *
   * @example
   * builder.any('id', ['uuid1', 'uuid2'])
   * // Result: id = ANY($1) with value ['uuid1', 'uuid2']
   */
  any(column: string, values: unknown[] | undefined | null): this {
    if (!values || values.length === 0) {
      return this;
    }

    validateSqlIdentifier(column);
    this.checkConditionLimit();
    this.conditions.push(`${column} = ANY($${this.paramCount++})`);
    this.values.push(values);
    return this;
  }

  /**
   * Add an ANY clause for checking if value is in an array column
   *
   * @param value - Value to check
   * @param column - Array column name
   * @returns this (for chaining)
   *
   * @example
   * builder.inArrayColumn('admin', 'tags')
   * // Result: $1 = ANY(tags) with value 'admin'
   */
  inArrayColumn(value: unknown, column: string): this {
    if (value === undefined || value === null) {
      return this;
    }

    validateSqlIdentifier(column);
    this.checkConditionLimit();
    this.conditions.push(`$${this.paramCount++} = ANY(${column})`);
    this.values.push(value);
    return this;
  }

  /**
   * Add an IS NULL condition
   *
   * @param column - Column name
   * @returns this (for chaining)
   */
  isNull(column: string): this {
    validateSqlIdentifier(column);
    this.checkConditionLimit();
    this.conditions.push(`${column} IS NULL`);
    return this;
  }

  /**
   * Add an IS NOT NULL condition
   *
   * @param column - Column name
   * @returns this (for chaining)
   */
  isNotNull(column: string): this {
    validateSqlIdentifier(column);
    this.checkConditionLimit();
    this.conditions.push(`${column} IS NOT NULL`);
    return this;
  }

  /**
   * Add a raw SQL condition (use with caution!)
   *
   * WARNING: Only use with static SQL strings, never with user input.
   * The condition string is NOT validated - only the values are parameterized.
   *
   * @param condition - SQL condition with placeholders (e.g., "column1 > $1 AND column2 < $2")
   * @param conditionValues - Values for the placeholders
   * @returns this (for chaining)
   *
   * @example
   * // Safe: Using for complex expressions not supported by builder methods
   * builder.raw(
   *   `EXTRACT(YEAR FROM created_at) = $${builder.getParamCount()}`,
   *   [2024]
   * );
   */
  raw(condition: string, conditionValues: unknown[] = []): this {
    this.checkConditionLimit();
    this.conditions.push(condition);
    this.values.push(...conditionValues);
    this.paramCount += conditionValues.length;
    return this;
  }

  /**
   * Conditionally add a filter
   *
   * @param condition - Boolean condition to check
   * @param buildFn - Function to call if condition is true
   * @returns this (for chaining)
   *
   * @example
   * builder
   *   .equals('status', 'active')
   *   .when(isAdmin, (b) => b.equals('team_id', teamId))
   */
  when(condition: boolean, buildFn: (builder: this) => this): this {
    if (condition) {
      buildFn(this);
    }
    return this;
  }

  /**
   * Get current parameter count (useful for raw conditions)
   */
  getParamCount(): number {
    return this.paramCount;
  }

  /**
   * Get current values array (useful for debugging)
   */
  getValues(): unknown[] {
    return [...this.values];
  }

  /**
   * Check if any conditions have been added
   */
  hasConditions(): boolean {
    return this.conditions.length > 0;
  }

  /**
   * Build the final WHERE clause and values
   * Returns WHERE clause WITHOUT leading space - callers must add space explicitly
   *
   * @returns FilterResult with whereClause, values, and next paramCount
   */
  build(): FilterResult {
    const whereClause = this.conditions.length > 0 ? `WHERE ${this.conditions.join(' AND ')}` : '';

    return {
      whereClause,
      values: [...this.values],
      paramCount: this.paramCount,
    };
  }

  /**
   * Build without WHERE keyword (just the conditions)
   * Useful when appending to existing clauses
   */
  buildConditions(): { conditions: string; values: unknown[]; paramCount: number } {
    return {
      conditions: this.conditions.join(' AND '),
      values: [...this.values],
      paramCount: this.paramCount,
    };
  }

  /**
   * Check if condition limit has been exceeded (DoS prevention)
   */
  private checkConditionLimit(): void {
    if (this.conditions.length >= FilterBuilder.MAX_CONDITIONS) {
      throw new SqlValidationError(
        `Too many filter conditions: ${this.conditions.length}. Maximum allowed: ${FilterBuilder.MAX_CONDITIONS}`,
        String(this.conditions.length),
        'limit'
      );
    }
  }
}

/**
 * Create a new FilterBuilder instance
 * Factory function for cleaner syntax
 *
 * @param startParamCount - Starting parameter number (default: 1)
 * @returns New FilterBuilder instance
 *
 * @example
 * const { whereClause, values } = createFilter()
 *   .equals('status', 'active')
 *   .ilike('name', search)
 *   .build();
 */
export function createFilter(startParamCount: number = 1): FilterBuilder {
  return new FilterBuilder(startParamCount);
}
