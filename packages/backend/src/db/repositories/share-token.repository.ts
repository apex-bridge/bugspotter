/**
 * Share Token Repository
 * Manages public replay sharing tokens with time-limited access
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import type { ShareToken, ShareTokenInsert, ShareTokenUpdate } from '../types.js';
import { verifyPassword } from '../../utils/token-generator.js';
import { AppError } from '../../api/middleware/error.js';

export class ShareTokenRepository extends BaseRepository<
  ShareToken,
  ShareTokenInsert,
  ShareTokenUpdate
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'share_tokens', []);
  }

  /**
   * Override findById to respect soft delete pattern
   * Returns null if token is soft-deleted
   *
   * @param id - The share token ID (UUID)
   * @returns ShareToken or null if not found/deleted
   */
  async findById(id: string): Promise<ShareToken | null> {
    const query = `
      SELECT *
      FROM share_tokens
      WHERE id = $1
        AND deleted_at IS NULL
    `;

    const result = await this.pool.query<ShareToken>(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Override delete to perform soft delete instead of hard delete
   * Sets deleted_at timestamp rather than removing the record
   *
   * @param id - The share token ID (UUID)
   * @returns true if deleted, false if not found or already deleted
   */
  async delete(id: string): Promise<boolean> {
    const query = `
      UPDATE share_tokens
      SET deleted_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL
    `;

    const result = await this.pool.query(query, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Find a share token by its token string
   * Returns null if token doesn't exist or has expired
   *
   * @param token - The share token string to look up
   * @returns ShareToken or null if not found/expired
   */
  async findByToken(token: string): Promise<ShareToken | null> {
    const query = `
      SELECT *
      FROM share_tokens
      WHERE token = $1
        AND expires_at > NOW()
        AND deleted_at IS NULL
    `;

    const result = await this.pool.query<ShareToken>(query, [token]);
    return result.rows[0] || null;
  }

  /**
   * Find all share tokens for a specific bug report
   * Optionally filter to only active (non-expired) tokens
   *
   * @param bugReportId - The bug report ID to find tokens for
   * @param activeOnly - If true, only return non-expired tokens (default: false)
   * @returns Array of ShareToken objects
   */
  async findByBugReportId(bugReportId: string, activeOnly = false): Promise<ShareToken[]> {
    let query = `
      SELECT *
      FROM share_tokens
      WHERE bug_report_id = $1
        AND deleted_at IS NULL
    `;

    if (activeOnly) {
      query += ' AND expires_at > NOW()';
    }

    query += ' ORDER BY created_at DESC';

    const result = await this.pool.query<ShareToken>(query, [bugReportId]);
    return result.rows;
  }

  /**
   * Increment the view count for a token
   * Used to track how many times a shared replay has been accessed
   *
   * @param token - The share token string
   * @returns Updated view count
   * @throws AppError (404) if token doesn't exist or is not active (expired/deleted)
   */
  async incrementViewCount(token: string): Promise<number> {
    const query = `
      UPDATE share_tokens
      SET view_count = view_count + 1
      WHERE token = $1
        AND expires_at > NOW()
        AND deleted_at IS NULL
      RETURNING view_count
    `;

    const result = await this.pool.query<{ view_count: number }>(query, [token]);

    if (result.rowCount === 0) {
      throw new AppError('Share token not found or is no longer valid', 404, 'ShareTokenNotFound');
    }

    return result.rows[0].view_count;
  }

  /**
   * Soft delete a share token by marking it as deleted
   * Does not physically remove the record (audit trail)
   *
   * @param token - The share token string to delete
   * @returns true if deleted, false if not found
   */
  async deleteByToken(token: string): Promise<boolean> {
    const query = `
      UPDATE share_tokens
      SET deleted_at = NOW()
      WHERE token = $1
        AND deleted_at IS NULL
    `;

    const result = await this.pool.query(query, [token]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Delete all share tokens for a specific bug report (soft delete)
   * Used when a bug report is deleted or access should be revoked
   *
   * @param bugReportId - The bug report ID
   * @returns Number of tokens deleted
   */
  async deleteByBugReportId(bugReportId: string): Promise<number> {
    const query = `
      UPDATE share_tokens
      SET deleted_at = NOW()
      WHERE bug_report_id = $1
        AND deleted_at IS NULL
    `;

    const result = await this.pool.query(query, [bugReportId]);
    return result.rowCount ?? 0;
  }

  /**
   * Clean up expired tokens (soft delete)
   * Should be run periodically via cron/scheduled job
   *
   * @returns Number of tokens deleted
   */
  async deleteExpired(): Promise<number> {
    const query = `
      UPDATE share_tokens
      SET deleted_at = NOW()
      WHERE expires_at <= NOW()
        AND deleted_at IS NULL
    `;

    const result = await this.pool.query(query);
    return result.rowCount ?? 0;
  }

  /**
   * Verify a token and optional password
   * Returns the token data if valid and password matches (if protected)
   *
   * @param token - The share token string
   * @param password - Optional plaintext password to verify (if token is password-protected)
   * @returns ShareToken or null if invalid/password mismatch
   */
  async verifyToken(token: string, password?: string): Promise<ShareToken | null> {
    const shareToken = await this.findByToken(token);

    if (!shareToken) {
      return null;
    }

    // If token is password-protected, verify the password using bcrypt
    if (shareToken.password_hash) {
      if (!password) {
        return null;
      }

      // Use bcrypt.compare() which handles salt extraction and constant-time comparison
      const isValid = await verifyPassword(password, shareToken.password_hash);

      if (!isValid) {
        return null;
      }
    }

    return shareToken;
  }

  /**
   * Check if a token exists and is valid (not expired, not deleted)
   * Lighter weight than findByToken() for existence checks
   *
   * @param token - The share token string
   * @returns true if token exists and is valid
   */
  async exists(token: string): Promise<boolean> {
    const query = `
      SELECT 1
      FROM share_tokens
      WHERE token = $1
        AND expires_at > NOW()
        AND deleted_at IS NULL
      LIMIT 1
    `;

    const result = await this.pool.query(query, [token]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Find active (non-expired, non-deleted) share tokens for a bug report
   * Alias for findByBugReportId(bugReportId, true) with clearer naming
   *
   * @param bugReportId - The bug report ID
   * @returns Array of active ShareToken objects
   */
  async findActiveByBugReport(bugReportId: string): Promise<ShareToken[]> {
    return this.findByBugReportId(bugReportId, true);
  }

  /**
   * Delete all share tokens for a bug report (soft delete)
   * Alias for deleteByBugReportId() with consistent naming
   *
   * @param bugReportId - The bug report ID
   * @returns Number of tokens deleted
   */
  async deleteByBugReport(bugReportId: string): Promise<number> {
    return this.deleteByBugReportId(bugReportId);
  }

  /**
   * Get statistics for a bug report's share tokens
   * Returns total tokens, active tokens, and total views
   *
   * @param bugReportId - The bug report ID
   * @returns Object with count, active_count, and total_views
   */
  async getStats(
    bugReportId: string
  ): Promise<{ count: number; active_count: number; total_views: number }> {
    const query = `
      SELECT
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE expires_at > NOW())::int AS active_count,
        COALESCE(SUM(view_count), 0)::int AS total_views
      FROM share_tokens
      WHERE bug_report_id = $1
        AND deleted_at IS NULL
    `;

    const result = await this.pool.query<{
      count: number;
      active_count: number;
      total_views: number;
    }>(query, [bugReportId]);

    return result.rows[0] || { count: 0, active_count: 0, total_views: 0 };
  }
}
