/**
 * API Key Lifecycle Helpers
 * Extracted helpers for API key operations
 */

import type { DatabaseClient } from '../../db/client.js';
import type { ApiKey, ApiKeyInsert } from '../../db/types.js';
import { getCacheService } from '../../cache/index.js';
import { getLogger } from '../../logger.js';
import { resolvePermissions } from './key-permissions.js';

const logger = getLogger();

/**
 * Invalidate cache for an API key
 * Fetches the key to get its hash, then invalidates cache
 *
 * @param db - Database client
 * @param keyId - API key ID
 */
export async function invalidateKeyCache(db: DatabaseClient, keyId: string): Promise<void> {
  try {
    const key = await db.apiKeys.findById(keyId);
    if (key) {
      const cache = getCacheService();
      await cache.invalidateApiKey(key.key_hash);
    }
  } catch (error) {
    logger.error('Failed to invalidate key cache', {
      keyId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - cache invalidation failure shouldn't block operations
  }
}

/**
 * Invalidate cache for multiple API keys in batch
 *
 * @param keys - Array of API keys with hashes
 */
export async function invalidateBatchKeyCache(keys: ApiKey[]): Promise<void> {
  if (keys.length === 0) {
    return;
  }

  try {
    const cache = getCacheService();
    await Promise.all(keys.map((key) => cache.invalidateApiKey(key.key_hash)));
  } catch (error) {
    logger.error('Failed to invalidate batch key cache', {
      keyCount: keys.length,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - cache invalidation failure shouldn't block operations
  }
}

/**
 * Calculate new expiration date for rotated key
 * Preserves the same duration from the original key
 *
 * @param oldKey - Original API key being rotated
 * @returns New expiration date or null if original had no expiration
 */
export function calculateNewExpiration(oldKey: ApiKey): Date | null {
  if (!oldKey.expires_at) {
    return null;
  }

  const originalDuration = oldKey.expires_at.getTime() - oldKey.created_at.getTime();
  return new Date(Date.now() + originalDuration);
}

/**
 * Build data for rotated key based on original key configuration
 *
 * @param oldKey - Original API key being rotated
 * @param actorId - User performing the rotation
 * @returns Key data for creating the new rotated key
 */
export function buildRotatedKeyData(
  oldKey: ApiKey,
  actorId: string
): Omit<ApiKeyInsert, 'key_hash' | 'key_prefix' | 'key_suffix'> {
  const effectiveScope = oldKey.permission_scope ?? 'full';
  return {
    name: `${oldKey.name} (rotated)`,
    type: oldKey.type,
    permission_scope: effectiveScope,
    // Re-resolve permissions to ensure rotated key is consistent,
    // especially for pre-migration keys with stale/empty permissions
    permissions: resolvePermissions(effectiveScope, oldKey.permissions),
    created_by: actorId,
    allowed_projects: oldKey.allowed_projects,
    allowed_origins: oldKey.allowed_origins,
    allowed_environments: oldKey.allowed_environments,
    rate_limit_per_minute: oldKey.rate_limit_per_minute,
    rate_limit_per_hour: oldKey.rate_limit_per_hour,
    rate_limit_per_day: oldKey.rate_limit_per_day,
    burst_limit: oldKey.burst_limit,
    expires_at: calculateNewExpiration(oldKey),
  };
}
