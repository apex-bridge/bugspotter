/**
 * @bugspotter/types
 * Shared TypeScript types for BugSpotter SDK and API
 *
 * This package ensures type safety between SDK and API by providing
 * a single source of truth for all shared interfaces.
 */

// Capture types
export type {
  ConsoleLog,
  NetworkRequest,
  BrowserMetadata,
  CapturedReport,
  RRWebEvent,
} from './capture.js';

// API Contract types and constants
export {
  BugPriority,
  BugStatus,
  type CreateBugReportRequest,
  type BugReportData,
  type CreateBugReportResponse,
  type ApiErrorResponse,
  type ApiResponse,
  type PaginatedResponse,
  type ListBugReportsQuery,
} from './api-contract.js';

// API Key and Authentication types
export {
  API_KEY_TYPE,
  API_KEY_STATUS,
  PERMISSION_SCOPE,
  RATE_LIMIT_WINDOW,
  API_KEY_AUDIT_ACTION,
  type ApiKeyType,
  type ApiKeyStatus,
  type PermissionScope,
  type RateLimitWindow,
  type ApiKeyAuditAction,
  type FieldMappings,
  type AttachmentConfig,
} from './api-types.js';

// Share Token constants
export {
  MIN_SHARE_TOKEN_EXPIRATION_HOURS,
  MAX_SHARE_TOKEN_EXPIRATION_HOURS,
  DEFAULT_SHARE_TOKEN_EXPIRATION_HOURS,
  MIN_SHARE_TOKEN_PASSWORD_LENGTH,
  MAX_SHARE_TOKEN_PASSWORD_LENGTH,
} from './share-token-constants.js';

// System Health types
export type {
  WorkerHealth,
  QueueHealth,
  PluginHealth,
  ServiceHealth,
  HealthStatus,
} from './health.js';
