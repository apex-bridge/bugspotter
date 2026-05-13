/**
 * Password Reset Token Service
 *
 * One-shot opaque tokens for password reset. Mirrors the signup
 * verify-email flow's "token IS the auth" pattern, but stored in
 * Redis with TTL rather than a DB column — no migration needed.
 *
 * Security:
 * - 32 bytes of CSPRNG entropy (base64url, ~43 chars).
 * - Token hash (SHA-256) is the Redis key, plaintext never stored.
 *   If the Redis snapshot leaks, captured keys aren't directly usable.
 * - One-shot: `consumePasswordResetToken` deletes the key atomically
 *   via GETDEL; a replayed token returns null on the second attempt.
 * - Token value pins `{userId, organizationId}` so the reset handler
 *   can re-check the org's `password_reset_enabled` flag and the
 *   user's membership at redemption time. Without that pin, a token
 *   minted from an enabled tenant could outlive a flag flip or be
 *   redeemed regardless of which tenant context the request lands on.
 * - TTL: 1 hour.
 */

import crypto from 'node:crypto';
import { getConnectionPool } from '../../queue/redis-connection-pool.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

const REDIS_KEY_PREFIX = 'password_reset:';

export interface PasswordResetTokenPayload {
  userId: string;
  organizationId: string;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getTokenKey(token: string): string {
  return `${REDIS_KEY_PREFIX}${hashToken(token)}`;
}

function decodePayload(raw: string | null): PasswordResetTokenPayload | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { userId?: unknown }).userId === 'string' &&
      typeof (parsed as { organizationId?: unknown }).organizationId === 'string'
    ) {
      return parsed as PasswordResetTokenPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Issue a fresh reset token bound to the given user + organization.
 * Returns the plaintext token — the caller is responsible for
 * delivering it via email (never logged, never returned in HTTP
 * responses).
 */
export async function issuePasswordResetToken(
  userId: string,
  organizationId: string
): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const pool = getConnectionPool();
  const redis = await pool.getMainConnection();
  const value = JSON.stringify({ userId, organizationId } satisfies PasswordResetTokenPayload);
  await redis.setex(getTokenKey(token), PASSWORD_RESET_TTL_SECONDS, value);
  return token;
}

/**
 * Consume a reset token. Returns the bound `{userId, organizationId}`
 * on success, null if the token is unknown, expired, malformed, or
 * already used. Atomic via GETDEL — a concurrent second consume sees
 * null.
 */
export async function consumePasswordResetToken(
  token: string
): Promise<PasswordResetTokenPayload | null> {
  try {
    const pool = getConnectionPool();
    const redis = await pool.getMainConnection();
    // ioredis exposes GETDEL as `getdel`. On older Redis (< 6.2)
    // where the command isn't available, fall back to an atomic Lua
    // eval — a plain GET+DEL pipeline isn't safe under concurrency
    // (two consumers can both read before either DELs, breaking the
    // one-shot invariant that backs replay protection).
    const raw =
      typeof (redis as { getdel?: unknown }).getdel === 'function'
        ? await (redis as { getdel: (key: string) => Promise<string | null> }).getdel(
            getTokenKey(token)
          )
        : ((await redis.eval(
            "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v",
            1,
            getTokenKey(token)
          )) as string | null);
    return decodePayload(raw);
  } catch (error) {
    logger.error('Failed to consume password reset token', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
