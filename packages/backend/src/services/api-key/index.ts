/**
 * API Key Service Module
 * Exports service, types, and utilities for API key management
 */

export { ApiKeyService, createApiKeyService } from './api-key-service.js';
export type {
  GeneratedApiKey,
  ApiKeyServiceOptions,
  PermissionCheckResult,
  RateLimitResult,
} from './api-key-service.js';

// Re-export constants and utilities
export { API_KEY_PREFIX } from './key-crypto.js';
export { WINDOW_DURATIONS } from './rate-limiter.js';
export { PERMISSION_SCOPE, API_KEY_AUDIT_ACTION } from '../../db/types.js';
