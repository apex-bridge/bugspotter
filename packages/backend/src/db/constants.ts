/**
 * Database Query Constants
 * Centralized configuration for batch operations, pagination, and query limits
 */

// ============================================================================
// BATCH OPERATION LIMITS
// ============================================================================

/**
 * Maximum number of records that can be processed in a single batch operation
 * Conservative limit to prevent DoS and respect PostgreSQL parameter limits
 */
export const MAX_BATCH_SIZE = 1000;

/**
 * Default batch size for auto-batching operations
 * Balances performance and memory usage
 */
export const DEFAULT_BATCH_SIZE = 500;

/**
 * Minimum valid batch size
 */
export const MIN_BATCH_SIZE = 1;

// ============================================================================
// POSTGRESQL LIMITS
// ============================================================================

/**
 * PostgreSQL maximum number of parameters in a single query
 * Actual limit is 65,535 but we use conservative batch sizes well below this
 */
export const POSTGRES_MAX_PARAMETERS = 65535;

// ============================================================================
// PAGINATION DEFAULTS
// ============================================================================

/**
 * Default page number for paginated queries
 */
export const DEFAULT_PAGE = 1;

/**
 * Default number of records per page
 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Maximum number of records per page (prevents excessive memory usage)
 */
export const MAX_PAGE_SIZE = 1000;

// ============================================================================
// QUERY OPTIMIZATION
// ============================================================================

/**
 * LIMIT value for queries that should return at most one row
 * Used for existence checks and single-record lookups
 */
export const SINGLE_ROW_LIMIT = 1;

/**
 * Base for parseInt operations (decimal)
 */
export const DECIMAL_BASE = 10;

// ============================================================================
// REPOSITORY-SPECIFIC LIMITS
// ============================================================================

/**
 * Default pagination limit for audit log list operations
 */
export const AUDIT_LOG_DEFAULT_LIST_LIMIT = 50;

/**
 * Default limit for audit log single-purpose queries (findByUserId, etc.)
 */
export const AUDIT_LOG_DEFAULT_QUERY_LIMIT = 100;

/**
 * Number of top results to return in audit log statistics
 * Used for action breakdown, user activity breakdown, etc.
 */
export const AUDIT_LOG_STATISTICS_TOP_N = 10;
