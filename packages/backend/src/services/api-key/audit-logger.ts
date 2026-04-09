/**
 * API Key Audit Logger
 * Resilient audit logging with individual error handling
 */

import type { DatabaseClient } from '../../db/client.js';
import { getLogger } from '../../logger.js';
import { API_KEY_AUDIT_ACTION } from '../../db/types.js';
import type { ApiKey } from '../../db/types.js';

const logger = getLogger();

/**
 * Audit log entry data
 */
interface AuditLogEntry {
  api_key_id: string;
  action: (typeof API_KEY_AUDIT_ACTION)[keyof typeof API_KEY_AUDIT_ACTION];
  performed_by: string | null;
  changes?: Record<string, unknown>;
}

/**
 * Batch audit result
 */
interface BatchAuditResult {
  successful: number;
  failed: number;
  errors: Array<{ keyId: string; error: string }>;
}

/**
 * API Key Audit Logger
 * Handles audit logging with resilient error handling
 */
export class ApiKeyAuditLogger {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Log single audit entry with error handling
   * @param entry - Audit log entry
   * @returns True if successful, false if failed
   */
  private async logSingleAudit(entry: AuditLogEntry): Promise<boolean> {
    try {
      await this.db.apiKeys.logAudit(entry);
      return true;
    } catch (error) {
      logger.error('Failed to log audit entry', {
        keyId: entry.api_key_id,
        action: entry.action,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Log creation audit entry
   */
  async logCreation(
    keyId: string,
    actorId: string | null,
    changes: { type: string; permission_scope?: string | null }
  ): Promise<void> {
    await this.logSingleAudit({
      api_key_id: keyId,
      action: API_KEY_AUDIT_ACTION.CREATED,
      performed_by: actorId,
      changes,
    });
  }

  /**
   * Log rotation audit entry
   */
  async logRotation(oldKeyId: string, newKeyId: string, actorId: string): Promise<void> {
    await this.logSingleAudit({
      api_key_id: oldKeyId,
      action: API_KEY_AUDIT_ACTION.ROTATED,
      performed_by: actorId,
      changes: { new_key_id: newKeyId },
    });
  }

  /**
   * Log revocation audit entry
   */
  async logRevocation(keyId: string, actorId: string, reason?: string): Promise<void> {
    await this.logSingleAudit({
      api_key_id: keyId,
      action: API_KEY_AUDIT_ACTION.REVOKED,
      performed_by: actorId,
      changes: reason ? { reason } : undefined,
    });
  }

  /**
   * Log update audit entry
   */
  async logUpdate(keyId: string, actorId: string, fields: string[]): Promise<void> {
    await this.logSingleAudit({
      api_key_id: keyId,
      action: API_KEY_AUDIT_ACTION.UPDATED,
      performed_by: actorId,
      changes: { fields },
    });
  }

  /**
   * Log deletion audit entry
   */
  async logDeletion(keyId: string, actorId: string): Promise<void> {
    await this.logSingleAudit({
      api_key_id: keyId,
      action: API_KEY_AUDIT_ACTION.REVOKED,
      performed_by: actorId,
      changes: { permanent_delete: true },
    });
  }

  /**
   * Batch log revocation audit entries with resilient error handling
   * Each audit log is attempted individually - failures are logged but don't block the operation
   *
   * @param keys - API keys that were revoked
   * @param actorId - User performing the action
   * @param reason - Optional revocation reason
   * @returns Result with success/failure counts
   */
  async logBatchRevocation(
    keys: ApiKey[],
    actorId: string,
    reason?: string
  ): Promise<BatchAuditResult> {
    const results = await Promise.allSettled(
      keys.map((key) =>
        this.logSingleAudit({
          api_key_id: key.id,
          action: API_KEY_AUDIT_ACTION.REVOKED,
          performed_by: actorId,
          changes: reason ? { reason } : undefined,
        })
      )
    );

    const successful = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const failed = results.length - successful;
    const errors = results
      .map((r, idx) => ({
        keyId: keys[idx].id,
        result: r,
      }))
      .filter(({ result }) => result.status === 'rejected' || !result.value)
      .map(({ keyId, result }) => ({
        keyId,
        error: result.status === 'rejected' ? result.reason : 'Unknown error',
      }));

    if (failed > 0) {
      logger.warn('Some audit log entries failed', {
        total: keys.length,
        successful,
        failed,
        errors: errors.slice(0, 5), // Log first 5 errors to avoid spam
      });
    }

    return { successful, failed, errors };
  }

  /**
   * Batch log deletion audit entries with resilient error handling
   * Each audit log is attempted individually - failures are logged but don't block the operation
   *
   * @param keys - API keys that were deleted
   * @param actorId - User performing the action
   * @returns Result with success/failure counts
   */
  async logBatchDeletion(keys: ApiKey[], actorId: string): Promise<BatchAuditResult> {
    const results = await Promise.allSettled(
      keys.map((key) =>
        this.logSingleAudit({
          api_key_id: key.id,
          action: API_KEY_AUDIT_ACTION.REVOKED,
          performed_by: actorId,
          changes: { permanent_delete: true },
        })
      )
    );

    const successful = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const failed = results.length - successful;
    const errors = results
      .map((r, idx) => ({
        keyId: keys[idx].id,
        result: r,
      }))
      .filter(({ result }) => result.status === 'rejected' || !result.value)
      .map(({ keyId, result }) => ({
        keyId,
        error: result.status === 'rejected' ? result.reason : 'Unknown error',
      }));

    if (failed > 0) {
      logger.warn('Some audit log entries failed during batch deletion', {
        total: keys.length,
        successful,
        failed,
        errors: errors.slice(0, 5), // Log first 5 errors to avoid spam
      });
    }

    return { successful, failed, errors };
  }
}

/**
 * Create audit logger instance
 * @param db - Database client
 * @returns Audit logger
 */
export function createAuditLogger(db: DatabaseClient): ApiKeyAuditLogger {
  return new ApiKeyAuditLogger(db);
}
