/**
 * API Key Service (Refactored)
 * Business logic for API key management - delegates to focused modules
 */

import { DatabaseClient } from '../../db/client.js';
import { getLogger } from '../../logger.js';
import { AppError } from '../../api/middleware/error.js';
import { API_KEY_AUDIT_ACTION } from '../../db/types.js';
import type {
  ApiKey,
  ApiKeyInsert,
  ApiKeyUpdate,
  ApiKeyWithUsageStats,
  ApiKeyFilters,
  ApiKeySortOptions,
  ApiKeyUsage,
  ApiKeyAuditLog,
  RateLimitWindow,
  PaginatedResult,
  PaginationOptions,
} from '../../db/types.js';

// Import cache service
import { getCacheService } from '../../cache/index.js';

// Import focused modules
import {
  generatePlaintextKey,
  hashKey,
  verifyKey,
  API_KEY_PREFIX,
  extractKeyMetadata,
} from './key-crypto.js';
import {
  checkPermission,
  checkProjectPermission,
  isExpired,
  isInGracePeriod,
  isKeyUsable,
  type PermissionCheckResult,
} from './key-permissions.js';
import { checkRateLimit, decrementRateLimit, type RateLimitResult } from './rate-limiter.js';
import { createAuditLogger, type ApiKeyAuditLogger } from './audit-logger.js';
import {
  invalidateKeyCache,
  invalidateBatchKeyCache,
  buildRotatedKeyData,
} from './key-lifecycle-helpers.js';
import { formatErrorForLog } from '../../utils/error-formatter.js';

const logger = getLogger();

/**
 * Grace period for key rotation (milliseconds)
 */
const ROTATION_GRACE_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Generated API key result
 */
export interface GeneratedApiKey {
  key: ApiKey; // Database record (with hash)
  plaintext: string; // Plaintext key (show once to user)
}

/**
 * API Key Service Options
 */
export interface ApiKeyServiceOptions {
  rotationGracePeriod?: number; // Override default grace period
}

/**
 * API Key Service
 * Orchestrates API key operations using focused modules
 */
export class ApiKeyService {
  private readonly rotationGracePeriod: number;
  private readonly auditLogger: ApiKeyAuditLogger;

  constructor(
    private readonly db: DatabaseClient,
    options?: ApiKeyServiceOptions
  ) {
    this.rotationGracePeriod = options?.rotationGracePeriod || ROTATION_GRACE_PERIOD;
    this.auditLogger = createAuditLogger(db);
  }

  // ============================================================================
  // CRYPTOGRAPHY (Delegated to key-crypto module)
  // ============================================================================

  hashKey(plaintextKey: string): string {
    return hashKey(plaintextKey);
  }

  verifyKey(plaintextKey: string, hash: string): boolean {
    return verifyKey(plaintextKey, hash);
  }

  // ============================================================================
  // PERMISSIONS (Delegated to key-permissions module)
  // ============================================================================

  isExpired(key: ApiKey): boolean {
    return isExpired(key);
  }

  isInGracePeriod(key: ApiKey): boolean {
    return isInGracePeriod(key, this.rotationGracePeriod);
  }

  isKeyUsable(key: ApiKey): boolean {
    return isKeyUsable(key, this.rotationGracePeriod);
  }

  checkPermission(key: ApiKey, requiredScope: string): PermissionCheckResult {
    return checkPermission(key, requiredScope);
  }

  checkProjectPermission(key: ApiKey, projectId: string): PermissionCheckResult {
    return checkProjectPermission(key, projectId);
  }

  // ============================================================================
  // RATE LIMITING (Delegated to rate-limiter module)
  // ============================================================================

  async checkRateLimit(
    keyId: string,
    window: RateLimitWindow,
    limit: number
  ): Promise<RateLimitResult> {
    return checkRateLimit(this.db, keyId, window, limit);
  }

  async decrementRateLimit(keyId: string, window: RateLimitWindow): Promise<void> {
    return decrementRateLimit(this.db, keyId, window);
  }

  // ============================================================================
  // VALIDATION (Business Logic)
  // ============================================================================

  /**
   * Validate permissions for the given scope
   * @param scope - Permission scope
   * @param permissions - Permissions array
   * @throws AppError if validation fails
   */
  private validatePermissions(scope: string, permissions?: string[]): void {
    if (scope === 'custom' && (!permissions || permissions.length === 0)) {
      throw new AppError(
        'Permissions array required for custom permission scope',
        400,
        'ValidationError'
      );
    }
  }

  /**
   * Sanitize string input (trim whitespace)
   */
  private sanitizeString(value: string | undefined | null): string | undefined {
    return value?.trim() || undefined;
  }

  // ============================================================================
  // KEY LIFECYCLE
  // ============================================================================

  /**
   * Create new API key
   * Generates plaintext key (bgs_...), hashes it (bcrypt), stores hash in DB,
   * and creates an audit log entry.
   *
   * Returns plaintext ONCE - user must save it (never shown again)
   *
   * @param data - API key creation data
   * @returns Generated API key with plaintext (show to user immediately)
   */
  async createKey(
    data: Omit<ApiKeyInsert, 'key_hash' | 'key_prefix' | 'key_suffix'>
  ): Promise<GeneratedApiKey> {
    try {
      // Validate permissions if permission_scope is provided
      if (data.permission_scope) {
        this.validatePermissions(data.permission_scope, data.permissions);
      }

      // Sanitize name
      const sanitizedName = this.sanitizeString(data.name);
      if (!sanitizedName) {
        throw new Error('Name is required');
      }

      // Generate plaintext key and hash
      const plaintextKey = generatePlaintextKey();
      const keyHash = hashKey(plaintextKey);

      // Extract prefix and suffix for indexing
      const { prefix, suffix } = extractKeyMetadata(plaintextKey);

      // Create key in database
      const key = await this.db.apiKeys.create({
        ...data,
        name: sanitizedName,
        key_hash: keyHash,
        key_prefix: prefix,
        key_suffix: suffix,
      });

      logger.info('API key created', {
        keyId: key.id,
        type: key.type,
        createdBy: key.created_by,
      });

      // Log creation in audit log
      await this.db.apiKeys.logAudit({
        api_key_id: key.id,
        action: API_KEY_AUDIT_ACTION.CREATED,
        performed_by: data.created_by || null,
        changes: {
          type: data.type,
          permission_scope: data.permission_scope,
        },
      });

      return {
        key,
        plaintext: plaintextKey,
      };
    } catch (error) {
      logger.error('Failed to create API key', {
        error: formatErrorForLog(error),
      });
      throw error;
    }
  }

  /**
   * Rotate API key (create new key, mark old as replaced)
   * @param oldKeyId - ID of key to rotate
   * @param actorId - User performing rotation
   * @returns New API key with plaintext
   */
  async rotateKey(oldKeyId: string, actorId: string): Promise<GeneratedApiKey> {
    try {
      const oldKey = await this.db.apiKeys.findById(oldKeyId);

      if (!oldKey) {
        throw new Error(`API key not found: ${oldKeyId}`);
      }

      // Execute rotation in a transaction to ensure atomicity
      const result = await this.db.transaction(async (tx) => {
        // Build new key data with same configuration as old key
        const newKeyData = buildRotatedKeyData(oldKey, actorId);

        // Generate plaintext key and hash (within transaction)
        const plaintextKey = generatePlaintextKey();
        const keyHash = hashKey(plaintextKey);
        const { prefix, suffix } = extractKeyMetadata(plaintextKey);

        const newKey = await tx.apiKeys.create({
          ...newKeyData,
          key_hash: keyHash,
          key_prefix: prefix,
          key_suffix: suffix,
        });

        const now = new Date();

        // Update old key to mark as rotated (set both rotate_at and revoked_at)
        await tx.apiKeys.update(oldKeyId, {
          status: 'expired',
          rotate_at: now,
          revoked_at: now,
        });

        // Update new key to reference old key
        await tx.apiKeys.update(newKey.id, {
          rotated_from: oldKeyId,
        });

        // Log rotation (within transaction)
        await tx.apiKeys.logAudit({
          api_key_id: oldKeyId,
          action: API_KEY_AUDIT_ACTION.ROTATED,
          performed_by: actorId,
          changes: {
            new_key_id: newKey.id,
          },
        });

        // Log new key creation (within transaction)
        await tx.apiKeys.logAudit({
          api_key_id: newKey.id,
          action: API_KEY_AUDIT_ACTION.CREATED,
          performed_by: actorId,
          changes: {
            rotated_from: oldKeyId,
            type: newKey.type,
            permission_scope: newKey.permission_scope,
          },
        });

        return { key: newKey, plaintext: plaintextKey };
      });

      // Invalidate cache for the old key
      await invalidateKeyCache(this.db, oldKeyId);

      logger.info('API key rotated', {
        oldKeyId,
        newKeyId: result.key.id,
        actorId,
      });

      return result;
    } catch (error) {
      logger.error('Failed to rotate API key', {
        keyId: oldKeyId,
        error: formatErrorForLog(error),
      });
      throw error;
    }
  }

  /**
   * Revoke API key
   * @param keyId - API key ID to revoke
   * @param actorId - User performing revocation
   * @param reason - Reason for revocation
   */
  async revokeKey(keyId: string, actorId: string, reason?: string): Promise<void> {
    try {
      await this.db.apiKeys.revoke(keyId);

      // Invalidate cache
      await invalidateKeyCache(this.db, keyId);

      // Log revocation
      await this.db.apiKeys.logAudit({
        api_key_id: keyId,
        action: API_KEY_AUDIT_ACTION.REVOKED,
        performed_by: actorId,
        changes: reason ? { reason } : undefined,
      });

      logger.info('API key revoked', { keyId, actorId, reason });
    } catch (error) {
      logger.error('Failed to revoke API key', {
        keyId,
        error: formatErrorForLog(error),
      });
      throw error;
    }
  }

  /**
   * Update API key
   * @param keyId - API key ID to update
   * @param data - Update data
   * @param actorId - User performing update
   * @returns Updated API key or null if not found
   */
  async updateKey(keyId: string, data: ApiKeyUpdate, actorId: string): Promise<ApiKey | null> {
    try {
      const updated = await this.db.apiKeys.update(keyId, data);

      if (updated) {
        // Invalidate cache for updated key
        await invalidateKeyCache(this.db, keyId);

        // Log update
        await this.db.apiKeys.logAudit({
          api_key_id: keyId,
          action: API_KEY_AUDIT_ACTION.UPDATED,
          performed_by: actorId,
          changes: {
            fields: Object.keys(data),
          },
        });

        logger.info('API key updated', { keyId, actorId });
      }

      return updated;
    } catch (error) {
      logger.error('Failed to update API key', {
        keyId,
        error: formatErrorForLog(error),
      });
      throw error;
    }
  }

  /**
   * Delete API key (soft delete)
   * @param keyId - API key ID to delete
   * @param actorId - User performing deletion
   * @returns True if deleted, false if not found
   */
  async deleteKey(keyId: string, actorId: string): Promise<boolean> {
    try {
      // Log deletion before removing
      await this.auditLogger.logDeletion(keyId, actorId);

      const deleted = await this.db.apiKeys.delete(keyId);

      if (deleted) {
        // Invalidate cache
        await invalidateKeyCache(this.db, keyId);

        logger.info('API key deleted', { keyId, actorId });
      }

      return deleted;
    } catch (error) {
      logger.error('Failed to delete API key', {
        keyId,
        error: formatErrorForLog(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // VERIFICATION & TRACKING
  // ============================================================================

  /**
   * Verify API key and check if usable
   * @param plaintextKey - Plaintext key from request
   * @returns API key if valid and usable, null otherwise
   */
  /**
   * Determine why a key is not usable
   */
  private getKeyFailureReason(key: ApiKey): 'revoked' | 'expired' | 'inactive' {
    if (key.status === 'revoked') {
      return 'revoked';
    }
    if (this.isExpired(key) || key.status === 'expired') {
      return 'expired';
    }
    return 'inactive';
  }

  /**
   * Verify and retrieve API key
   * Returns the key if valid and usable, or detailed failure reason
   *
   * Uses caching to avoid database lookups on every request.
   * Cache is invalidated when keys are rotated, revoked, or updated.
   *
   * @param plaintextKey - Plaintext API key to verify
   * @returns Object with key (if valid) or failure details
   */
  async verifyAndGetKey(plaintextKey: string): Promise<{
    key: ApiKey | null;
    failureReason?: 'not_found' | 'revoked' | 'expired' | 'inactive';
    existingKey?: ApiKey;
  }> {
    try {
      // Hash key for lookup
      const keyHash = hashKey(plaintextKey);

      // Try to get from cache first
      const cache = getCacheService();
      const cachedKey = await cache.getApiKey<ApiKey>(keyHash, async () => {
        // Cache miss - fetch from database
        return this.db.apiKeys.findByHash(keyHash);
      });

      if (!cachedKey) {
        logger.warn('API key not found', { keyPrefix: plaintextKey.substring(0, 10) });
        return { key: null, failureReason: 'not_found' };
      }

      // Check if key is usable
      if (!this.isKeyUsable(cachedKey)) {
        const failureReason = this.getKeyFailureReason(cachedKey);

        logger.warn('API key not usable', {
          keyId: cachedKey.id,
          status: cachedKey.status,
          reason: failureReason,
        });

        return { key: null, failureReason, existingKey: cachedKey };
      }

      // Update last used timestamp (non-blocking, don't await)
      this.db.apiKeys.updateLastUsed(cachedKey.id).catch((error) => {
        logger.error('Failed to update API key last used timestamp', {
          keyId: cachedKey.id,
          error: formatErrorForLog(error),
        });
      });

      return { key: cachedKey };
    } catch (error) {
      logger.error('Failed to verify API key', {
        error: formatErrorForLog(error),
      });
      throw error; // Re-throw instead of masking as 'not_found'
    }
  }

  /**
   * Track API key usage
   * @param keyId - API key ID
   * @param endpoint - Endpoint accessed
   * @param method - HTTP method
   * @param statusCode - Response status code
   * @param responseTimeMs - Response time in milliseconds
   * @param userAgent - User agent string
   * @param ipAddress - IP address
   */
  async trackUsage(
    keyId: string,
    endpoint: string,
    method: string,
    statusCode: number,
    responseTimeMs: number,
    userAgent?: string,
    ipAddress?: string
  ): Promise<void> {
    try {
      await this.db.apiKeys.trackUsage({
        api_key_id: keyId,
        endpoint,
        method,
        status_code: statusCode,
        response_time_ms: responseTimeMs,
        user_agent: userAgent,
        ip_address: ipAddress,
      });
    } catch (error) {
      logger.error('Failed to track API key usage', {
        keyId,
        error: formatErrorForLog(error),
      });
      // Don't throw - usage tracking is not critical
    }
  }

  // ============================================================================
  // QUERY OPERATIONS
  // ============================================================================

  async getUsageLogs(
    keyId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<ApiKeyUsage[]> {
    return this.db.apiKeys.getUsageLogs(keyId, limit, offset);
  }

  async getKeyWithStats(keyId: string): Promise<ApiKeyWithUsageStats | null> {
    return this.db.apiKeys.findByIdWithStats(keyId);
  }

  async listKeys(
    filter?: ApiKeyFilters,
    sort?: ApiKeySortOptions,
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<ApiKey>> {
    return this.db.apiKeys.list(filter, sort, pagination);
  }

  async getKeyById(keyId: string): Promise<ApiKey | null> {
    return this.db.apiKeys.findById(keyId);
  }

  async getAuditLogs(
    keyId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<ApiKeyAuditLog[]> {
    return this.db.apiKeys.getAuditLogs(keyId, limit, offset);
  }

  // ============================================================================
  // MAINTENANCE OPERATIONS
  // ============================================================================

  /**
   * Update expired keys status
   * @returns Number of keys updated
   */
  async updateExpiredKeys(): Promise<number> {
    try {
      const count = await this.db.apiKeys.checkAndUpdateExpired();
      logger.info('Updated expired keys', { count });
      return count;
    } catch (error) {
      logger.error('Failed to update expired keys', {
        error: formatErrorForLog(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // BATCH OPERATIONS
  // ============================================================================

  /**
   * Batch revoke API keys
   * OPTIMIZED: Uses single database query instead of N queries
   * @param keyIds - API key IDs to revoke
   * @param actorId - ID of user performing the action
   * @param reason - Optional revocation reason
   * @returns Number of successfully revoked keys
   */
  async revokeBatch(keyIds: string[], actorId: string, reason?: string): Promise<number> {
    if (keyIds.length === 0) {
      return 0;
    }

    try {
      // Batch revoke in single query
      const revokedKeys = await this.db.apiKeys.revokeBatch(keyIds);
      const count = revokedKeys.length;

      // Invalidate cache for all revoked keys
      await invalidateBatchKeyCache(revokedKeys);

      // Batch audit log entries with resilient error handling
      // Each audit log is attempted individually - failures are logged but don't block the operation
      const auditResult = await this.auditLogger.logBatchRevocation(revokedKeys, actorId, reason);

      logger.info('Batch revoke completed', {
        auditLogs: { successful: auditResult.successful, failed: auditResult.failed },
        total: keyIds.length,
        successful: count,
        failed: keyIds.length - count,
      });

      return count;
    } catch (error) {
      logger.error('Failed to batch revoke API keys', {
        keyIds,
        error: formatErrorForLog(error),
      });
      throw error;
    }
  }

  /**
   * Batch delete API keys
   * OPTIMIZED: Uses single database query instead of N queries
   * @param keyIds - API key IDs to delete
   * @param actorId - ID of user performing the action
   * @returns Number of successfully deleted keys
   */
  async deleteBatch(keyIds: string[], actorId: string): Promise<number> {
    if (keyIds.length === 0) {
      return 0;
    }

    try {
      // Batch load all keys for cache invalidation and audit
      const keysMap = await this.db.apiKeys.findByIds(keyIds);
      const existingKeys = [...keysMap.values()];

      // Invalidate cache before deletion
      await invalidateBatchKeyCache(existingKeys);

      // Batch audit log entries before deletion with resilient error handling
      // Each audit log is attempted individually - failures are logged but don't block the operation
      const auditResult = await this.auditLogger.logBatchDeletion(existingKeys, actorId);

      // Batch delete in single query
      const count = await this.db.apiKeys.deleteBatch(keyIds);

      logger.info('Batch delete completed', {
        auditLogs: { successful: auditResult.successful, failed: auditResult.failed },
        total: keyIds.length,
        successful: count,
        failed: keyIds.length - count,
      });

      return count;
    } catch (error) {
      logger.error('Failed to batch delete API keys', {
        keyIds,
        error: formatErrorForLog(error),
      });
      throw error;
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create API key service instance
 * @param db - Database client
 * @param options - Service options
 * @returns API key service
 */
export function createApiKeyService(
  db: DatabaseClient,
  options?: ApiKeyServiceOptions
): ApiKeyService {
  return new ApiKeyService(db, options);
}

// Re-export types and utilities
export { PermissionCheckResult, RateLimitResult };
export { API_KEY_PREFIX };
