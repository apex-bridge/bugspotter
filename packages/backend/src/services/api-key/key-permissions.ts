/**
 * API Key Permission Checker
 * Validates API key permissions and access control
 */

import type { ApiKey } from '../../db/types.js';
import { PERMISSION_SCOPE } from '../../db/types.js';
import type { PermissionScope } from '../../db/types.js';

/**
 * Maps each permission scope to the concrete permissions it grants.
 * Used at key creation time to resolve scope into permissions array.
 * 'custom' maps to empty — user provides their own permissions.
 */
export const SCOPE_PERMISSIONS: Record<PermissionScope, string[]> = {
  full: ['*'],
  read: ['reports:read', 'sessions:read'],
  write: ['reports:read', 'reports:write', 'sessions:read', 'sessions:write'],
  custom: [],
};

/**
 * Resolve a permission scope into concrete permissions.
 * For 'custom' scope, returns the provided permissions array.
 * For predefined scopes, returns the mapped permissions.
 *
 * @param scope - Permission scope (full, read, write, custom)
 * @param customPermissions - Explicit permissions (used only for 'custom' scope)
 * @returns Resolved permissions array
 */
export function resolvePermissions(scope: PermissionScope, customPermissions?: string[]): string[] {
  if (scope === PERMISSION_SCOPE.CUSTOM) {
    return customPermissions ? [...customPermissions] : [];
  }
  const permissions = SCOPE_PERMISSIONS[scope];
  if (!permissions) {
    throw new Error(`Unknown permission scope: ${scope}`);
  }
  return [...permissions];
}

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
 * Check if API key has the required permission.
 *
 * Permissions are resolved at key creation time into the `permissions` array.
 * This function simply checks if the required permission is in that array,
 * or if the key has wildcard access ('*').
 *
 * @param key - API key to check
 * @param requiredPermission - Required permission (e.g., 'reports:read', 'sessions:write')
 * @returns Permission check result
 */
export function checkPermission(key: ApiKey, requiredPermission: string): PermissionCheckResult {
  let permissions = key.permissions ?? [];

  // Defensive fallback: if permissions array is empty but a non-custom scope is set,
  // resolve on the fly. This handles pre-migration keys and cached keys fetched
  // before the backfill migration ran.
  if (permissions.length === 0 && key.permission_scope && key.permission_scope !== 'custom') {
    permissions = resolvePermissions(key.permission_scope);
  }

  if (permissions.includes('*') || permissions.includes(requiredPermission)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Missing permission: ${requiredPermission}`,
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
