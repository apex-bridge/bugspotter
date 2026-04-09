/**
 * API Key Permission Checker
 * Validates API key permissions and access control
 */

import type { ApiKey } from '../../db/types.js';
import { PERMISSION_SCOPE } from '../../db/types.js';

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if API key is expired
 * @param key - API key to check
 * @returns True if key is expired
 */
export function isExpired(key: ApiKey): boolean {
  if (!key.expires_at) {
    return false; // Keys without expiry never expire
  }

  return new Date() > new Date(key.expires_at);
}

/**
 * Check if API key is in grace period after rotation
 *
 * Grace period only applies to keys that were rotated (replaced with a new key),
 * NOT to keys that expired naturally (time-based expiry). The presence of rotate_at
 * distinguishes rotated keys from time-expired keys.
 *
 * @param key - API key to check
 * @param gracePeriodMs - Grace period in milliseconds
 * @returns True if key is within grace period after being rotated
 */
export function isInGracePeriod(key: ApiKey, gracePeriodMs: number): boolean {
  // Only keys marked as 'expired' can be in grace period
  if (key.status !== 'expired') {
    return false;
  }

  // Must have rotate_at to indicate this was a ROTATION, not natural expiry
  if (!key.rotate_at) {
    return false;
  }

  // Must have been actually revoked (rotated keys get revoked_at timestamp)
  if (!key.revoked_at) {
    return false;
  }

  // Check if within grace period from revocation time
  const revokedTime = key.revoked_at.getTime();
  const now = Date.now();
  return now - revokedTime < gracePeriodMs;
}

/**
 * Check if API key is usable (not expired, or in grace period)
 * @param key - API key to check
 * @param gracePeriodMs - Grace period in milliseconds
 * @returns True if key can be used
 */
export function isKeyUsable(key: ApiKey, gracePeriodMs: number): boolean {
  // CRITICAL: Time expiration (expires_at) takes absolute precedence
  // If the key has passed its expiry time, it cannot be used, period.
  // Grace period only applies to rotation, not time expiration.
  if (isExpired(key)) {
    return false; // Time-expired keys are never usable
  }

  // Active and expiring keys can be used (as long as not time-expired)
  if (key.status === 'active' || key.status === 'expiring') {
    return true;
  }

  // Expired status keys can be used if in grace period (and not time-expired)
  if (key.status === 'expired' && isInGracePeriod(key, gracePeriodMs)) {
    return true;
  }

  return false;
}

/**
 * Check if API key has required permission scope
 *
 * Permission scopes:
 * - PERMISSION_SCOPE.FULL: Allows all operations
 * - PERMISSION_SCOPE.CUSTOM: Requires explicit permission in permissions array
 * - PERMISSION_SCOPE.READ: Allows all read operations (permissions ending with ':read')
 * - PERMISSION_SCOPE.WRITE: Allows all write operations (permissions ending with ':write')
 *
 * @param key - API key to check
 * @param requiredScope - Required permission (e.g., 'bugs:read', 'projects:write')
 * @returns Permission check result
 */
export function checkPermission(key: ApiKey, requiredScope: string): PermissionCheckResult {
  // Full access keys can do anything
  if (key.permission_scope === PERMISSION_SCOPE.FULL) {
    return { allowed: true };
  }

  // For custom scope, check if permission is in the allowed list
  if (key.permission_scope === PERMISSION_SCOPE.CUSTOM) {
    if (key.permissions && key.permissions.includes(requiredScope)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Missing required permission: ${requiredScope}`,
    };
  }

  // For read/write scopes, check if permission matches the scope pattern
  if (
    key.permission_scope === PERMISSION_SCOPE.READ ||
    key.permission_scope === PERMISSION_SCOPE.WRITE
  ) {
    // First check explicit permissions array (if provided)
    if (key.permissions && key.permissions.includes(requiredScope)) {
      return { allowed: true };
    }

    // Then check if required permission matches the scope pattern
    // E.g., permission_scope 'read' allows 'bugs:read', 'projects:read', etc.
    const scopePattern = `:${key.permission_scope}`;
    if (requiredScope.endsWith(scopePattern) || requiredScope === key.permission_scope) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Required permission: ${requiredScope}, key scope: ${key.permission_scope} (allows *:${key.permission_scope})`,
    };
  }

  return {
    allowed: false,
    reason: `Unknown permission scope: ${key.permission_scope}`,
  };
}

/**
 * Check if API key has access to specific project
 * @param key - API key to check
 * @param projectId - Project ID to check access for
 * @returns Permission check result
 */
export function checkProjectPermission(key: ApiKey, projectId: string): PermissionCheckResult {
  // If no project restrictions, allow all
  if (!key.allowed_projects || key.allowed_projects.length === 0) {
    return { allowed: true };
  }

  // Check if project is in allowed list
  if (key.allowed_projects.includes(projectId)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Access denied. Allowed projects: ${key.allowed_projects.join(', ')}`,
  };
}
