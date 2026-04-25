/**
 * Email Verification Token Repository
 *
 * Manages one-time verification tokens for self-service signup. Tokens are
 * single-use: `consumed_at` flips to NOW() when /auth/verify-email succeeds.
 * Resend invalidates prior unconsumed tokens for the same user before
 * issuing a new row, which is enforced in the service layer (the table
 * has no unique-active constraint to keep the resend path simple).
 *
 * Distinct from `share_tokens` (no soft delete here — verification is
 * single-use and users.email_verified_at is the durable state).
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import type {
  EmailVerificationToken,
  EmailVerificationTokenInsert,
  EmailVerificationTokenUpdate,
} from '../types.js';

export class EmailVerificationTokenRepository extends BaseRepository<
  EmailVerificationToken,
  EmailVerificationTokenInsert,
  EmailVerificationTokenUpdate
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'email_verification_tokens', []);
  }

  /**
   * Find a verification token row by token string. Returns null when:
   *  - the token doesn't exist,
   *  - the token has already been consumed (single-use), OR
   *  - the token has expired.
   *
   * The combined check lets the route caller produce a single
   * "invalid or expired" 400 without having to disambiguate.
   */
  async findActiveByToken(token: string): Promise<EmailVerificationToken | null> {
    const query = `
      SELECT *
      FROM application.email_verification_tokens
      WHERE token = $1
        AND consumed_at IS NULL
        AND expires_at > NOW()
    `;
    const result = await this.getClient().query<EmailVerificationToken>(query, [token]);
    return result.rows[0] || null;
  }

  /**
   * Mark a token consumed. Returns true on success. Idempotent — a second
   * call with the same id returns false because consumed_at is already set.
   * The route layer treats false as "already used" and produces 400.
   */
  async consume(id: string): Promise<boolean> {
    const query = `
      UPDATE application.email_verification_tokens
      SET consumed_at = NOW()
      WHERE id = $1
        AND consumed_at IS NULL
    `;
    const result = await this.getClient().query(query, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Invalidate all unconsumed tokens for a user by stamping consumed_at.
   * Called from the resend flow before issuing a new token so a user
   * who lost the email can always trust the latest link to be the only
   * one that works. Returns the number of invalidated rows.
   */
  async invalidateUnconsumedForUser(userId: string): Promise<number> {
    const query = `
      UPDATE application.email_verification_tokens
      SET consumed_at = NOW()
      WHERE user_id = $1
        AND consumed_at IS NULL
    `;
    const result = await this.getClient().query(query, [userId]);
    return result.rowCount ?? 0;
  }
}
