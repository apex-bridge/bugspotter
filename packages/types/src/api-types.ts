/**
 * API-related types shared between backend and admin
 */

// ============================================================================
// INTEGRATION RULE TYPES
// ============================================================================

/**
 * Field mappings for integration platform tickets (Jira, GitHub, Linear, etc.)
 * Maps integration field IDs to their values
 * Values can be strings, objects, arrays, or any JSON-serializable type
 */
export interface FieldMappings {
  [fieldId: string]: unknown; // Integration field ID -> value (string, object, array, etc.)
}

/**
 * Attachment configuration for integration platform tickets (Jira, GitHub, Linear, etc.)
 * Supports granular control over what data to attach and how to format it
 */
export interface AttachmentConfig {
  screenshot?: {
    enabled: boolean;
  };
  console?: {
    enabled: boolean;
    levels?: ('error' | 'warn' | 'info' | 'debug' | 'log')[];
    maxEntries?: number;
  };
  network?: {
    enabled: boolean;
    failedOnly?: boolean;
    includeBodies?: boolean;
    maxEntries?: number;
    redactHeaders?: string[];
  };
  replay?: {
    enabled: boolean;
    mode?: 'link' | 'attach' | 'both';
    expiryHours?: number;
  };
}

// ============================================================================
// API KEY MANAGEMENT TYPES
// ============================================================================

export const API_KEY_TYPE = {
  PRODUCTION: 'production',
  DEVELOPMENT: 'development',
  TEST: 'test',
} as const;

export type ApiKeyType = (typeof API_KEY_TYPE)[keyof typeof API_KEY_TYPE];

export const API_KEY_STATUS = {
  ACTIVE: 'active',
  EXPIRING: 'expiring',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
} as const;

export type ApiKeyStatus = (typeof API_KEY_STATUS)[keyof typeof API_KEY_STATUS];

export const PERMISSION_SCOPE = {
  FULL: 'full',
  READ: 'read',
  WRITE: 'write',
  CUSTOM: 'custom',
} as const;

export type PermissionScope = (typeof PERMISSION_SCOPE)[keyof typeof PERMISSION_SCOPE];

export const RATE_LIMIT_WINDOW = {
  MINUTE: 'minute',
  HOUR: 'hour',
  DAY: 'day',
  BURST: 'burst',
} as const;

export type RateLimitWindow = (typeof RATE_LIMIT_WINDOW)[keyof typeof RATE_LIMIT_WINDOW];

export const API_KEY_AUDIT_ACTION = {
  CREATED: 'created',
  UPDATED: 'updated',
  ROTATED: 'rotated',
  REVOKED: 'revoked',
  PERMISSIONS_CHANGED: 'permissions_changed',
  RATE_LIMIT_CHANGED: 'rate_limit_changed',
  ACCESSED: 'accessed',
  FAILED_AUTH: 'failed_auth',
  RATE_LIMITED: 'rate_limited',
} as const;

export type ApiKeyAuditAction = (typeof API_KEY_AUDIT_ACTION)[keyof typeof API_KEY_AUDIT_ACTION];
