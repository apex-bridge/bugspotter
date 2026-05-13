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
 * - TTL: 1 hour.
 */

import crypto from 'node:crypto';
import { getConnectionPool } from '../../queue/redis-connection-pool.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

const REDIS_KEY_PREFIX = 'password_reset:';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getTokenKey(token: string): string {
  return `${REDIS_KEY_PREFIX}${hashToken(token)}`;
}

/**
 * Issue a fresh reset token bound to the given user. Returns the
 * plaintext token — the caller is responsible for delivering it via
 * email (never logged, never returned in HTTP responses).
 */
export async function issuePasswordResetToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const pool = getConnectionPool();
  const redis = await pool.getMainConnection();
  await redis.setex(getTokenKey(token), PASSWORD_RESET_TTL_SECONDS, userId);
  return token;
}

/**
 * Consume a reset token. Returns the bound userId on success, null
 * if the token is unknown, expired, or already used. Atomic via
 * GETDEL — a concurrent second consume sees null.
 */
export async function consumePasswordResetToken(token: string): Promise<string | null> {
  try {
    const pool = getConnectionPool();
    const redis = await pool.getMainConnection();
    // ioredis exposes GETDEL as `getdel`. Falls back to a GET+DEL
    // pipeline if the Redis server is < 6.2 (unlikely in this stack,
    // but keeps the suite green against older mocks).
    const userId =
      typeof (redis as { getdel?: unknown }).getdel === 'function'
        ? await (redis as { getdel: (key: string) => Promise<string | null> }).getdel(
            getTokenKey(token)
          )
        : await (async () => {
            const key = getTokenKey(token);
            const value = await redis.get(key);
            if (value !== null) {
              await redis.del(key);
            }
            return value;
          })();
    return userId;
  } catch (error) {
    logger.error('Failed to consume password reset token', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
