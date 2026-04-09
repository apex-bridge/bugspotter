/**
 * Query Builder Utility
 * Consolidates WHERE clause, UPDATE clause, and pagination logic
 */

/** Generic result for clause builders with parameter tracking */
export interface ClauseResult {
  clause: string;
  values: unknown[];
  paramCount: number;
}

/** Result for pagination clause (no paramCount needed in return) */
export interface PaginationClause {
  clause: string;
  values: unknown[];
}

/**
 * Validate SQL identifier to prevent SQL injection
 * Only allows alphanumeric characters and underscores
 */
function validateSqlIdentifier(identifier: string): void {
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
}

/**
 * Helper to build parameterized clauses with consistent logic
 */
function buildParameterizedClause(
  entries: Array<{ key: string; value: unknown; operator?: string }>,
  startParamCount: number,
  separator: string
): ClauseResult {
  const clauses: string[] = [];
  const values: unknown[] = [];
  let paramCount = startParamCount;

  for (const { key, value, operator = '=' } of entries) {
    if (value !== undefined && value !== null) {
      // Validate column name to prevent SQL injection
      validateSqlIdentifier(key);
      clauses.push(`${key} ${operator} $${paramCount++}`);
      values.push(value);
    }
  }

  const clause = clauses.join(separator);
  return { clause, values, paramCount };
}

/**
 * Build WHERE clause from filters
 * Supports both simple equality filters and custom operators
 */
export function buildWhereClause(
  filters: Record<string, unknown | { value: unknown; operator?: string }>,
  startParamCount: number = 1
): ClauseResult {
  // Normalize filters to { key, value, operator } format
  const entries = Object.entries(filters).map(([key, filter]) => {
    if (filter && typeof filter === 'object' && 'value' in filter) {
      const f = filter as { value: unknown; operator?: string };
      return { key, value: f.value, operator: f.operator };
    }
    return { key, value: filter, operator: '=' };
  });

  const result = buildParameterizedClause(entries, startParamCount, ' AND ');
  const clause = result.clause ? `WHERE ${result.clause}` : '';

  return { ...result, clause };
}

/**
 * Build UPDATE SET clause from data
 */
export function buildUpdateClause(
  data: Record<string, unknown>,
  startParamCount: number = 1
): ClauseResult {
  const entries = Object.entries(data)
    .filter(([, value]) => {
      return value !== undefined;
    })
    .map(([key, value]) => {
      return { key, value };
    });

  return buildParameterizedClause(entries, startParamCount, ', ');
}

/**
 * Build LIMIT and OFFSET clause with validation
 * @param page - Page number (must be >= 1)
 * @param limit - Items per page (must be 1-1000)
 * @param startParamCount - Starting parameter count
 * @throws Error if page or limit are invalid
 */
export function buildPaginationClause(
  page: number = 1,
  limit: number = 20,
  startParamCount: number = 1
): PaginationClause {
  // Validate page number
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`Invalid page number: ${page}. Must be an integer >= 1`);
  }

  // Validate limit (reasonable maximum to prevent DoS)
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error(`Invalid limit: ${limit}. Must be an integer between 1 and 1000`);
  }

  const offset = (page - 1) * limit;
  const clause = `LIMIT $${startParamCount} OFFSET $${startParamCount + 1}`;
  const values = [limit, offset];

  return { clause, values };
}

/**
 * Build ORDER BY clause with SQL injection protection
 * @param sortBy - Column name (validated against whitelist pattern)
 * @param order - Sort direction
 */
export function buildOrderByClause(
  sortBy: string = 'created_at',
  order: 'asc' | 'desc' = 'desc'
): string {
  validateSqlIdentifier(sortBy);
  return `ORDER BY ${sortBy} ${order.toUpperCase()}`;
}

/**
 * Serialize JSON fields for database storage
 * @param data - Data to serialize to JSON string
 * @returns JSON string representation or null for SQL NULL
 * @note null values are preserved as JavaScript null (pg driver converts to SQL NULL)
 *       undefined values are converted to empty objects ({})
 *       This ensures type safety matches TypeScript definitions (e.g., FieldMappings | null)
 */
export function serializeJsonField(data: unknown): string | null {
  if (data === null) {
    // Preserve null as null - pg driver will convert to SQL NULL
    return null;
  }
  // Convert undefined to empty object (backward compatibility)
  // Ensures all JSONB columns have valid JSON even if value is missing
  return JSON.stringify(data ?? {});
}

/**
 * Deserialize JSON fields from database
 */
export function deserializeJsonField<T = Record<string, unknown>>(data: unknown): T {
  if (typeof data === 'string') {
    return JSON.parse(data) as T;
  }
  return data as T;
}

/**
 * Deserialize multiple JSON fields in a row
 */
export function deserializeRow<T>(row: unknown, jsonFields: string[]): T {
  const r = row as Record<string, unknown>;
  const result = { ...r };

  for (const field of jsonFields) {
    if (r[field] !== undefined && r[field] !== null) {
      result[field] = deserializeJsonField(r[field]);
    }
  }

  return result as T;
}
