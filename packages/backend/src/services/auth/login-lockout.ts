/**
 * Login Lockout Service
 *
 * Implements account lockout after multiple failed login attempts to prevent
 * brute force attacks. Uses Redis for distributed state tracking.
 *
 * Security features:
 * - Locks accounts after MAX_FAILED_ATTEMPTS (default: 5) failed attempts
 * - Lockout duration: LOCKOUT_DURATION_SECONDS (default: 15 minutes)
 * - Returns remaining attempts in error responses
 * - Automatically clears lockout after duration expires (via Redis TTL)
 * - Clears failed attempts on successful login
 */

import { getConnectionPool } from '../../queue/redis-connection-pool.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum failed login attempts before lockout */
export const MAX_FAILED_ATTEMPTS = 5;

/** Lockout duration in seconds (15 minutes) */
export const LOCKOUT_DURATION_SECONDS = 15 * 60;

/** Redis key prefix for failed login attempts */
const REDIS_KEY_PREFIX = 'login:attempts:';

/** Redis key prefix for account lockout */
const REDIS_LOCKOUT_PREFIX = 'login:lockout:';

/**
 * Lua script for atomic increment with TTL
 * Ensures the key always has a TTL to prevent memory leaks
 */
const INCR_WITH_EXPIRE_SCRIPT = `
  local key = KEYS[1]
  local ttl = ARGV[1]
  local count = redis.call('INCR', key)
  redis.call('EXPIRE', key, ttl)
  return count
`;

// ============================================================================
// TYPES
// ============================================================================

export interface LockoutStatus {
  /** Whether the account is currently locked */
  isLocked: boolean;
  /** Number of failed attempts (0 if locked or no attempts) */
  failedAttempts: number;
  /** Remaining attempts before lockout (0 if locked) */
  remainingAttempts: number;
  /** Seconds until lockout expires (0 if not locked) */
  lockoutSecondsRemaining: number;
}

export interface LoginAttemptResult {
  /** Whether login should proceed (false if locked) */
  canAttempt: boolean;
  /** Current lockout status */
  status: LockoutStatus;
}

// ============================================================================
// KEY GENERATION
// ============================================================================

/**
 * Generate Redis key for tracking failed attempts
 * Uses email as identifier (case-insensitive)
 */
function getAttemptsKey(email: string): string {
  return `${REDIS_KEY_PREFIX}${email.toLowerCase()}`;
}

/**
 * Generate Redis key for lockout status
 */
function getLockoutKey(email: string): string {
  return `${REDIS_LOCKOUT_PREFIX}${email.toLowerCase()}`;
}

// ============================================================================
// LOCKOUT SERVICE
// ============================================================================

/**
 * Check if an account is locked out before attempting login
 *
 * @param email - User email to check
 * @returns LoginAttemptResult with canAttempt flag and status
 */
export async function checkLockoutStatus(email: string): Promise<LoginAttemptResult> {
  try {
    const pool = getConnectionPool();
    const redis = await pool.getMainConnection();

    const lockoutKey = getLockoutKey(email);
    const attemptsKey = getAttemptsKey(email);

    // Check if account is locked
    const lockoutTTL = await redis.ttl(lockoutKey);
    if (lockoutTTL > 0) {
      logger.warn('Login attempt blocked - account locked', {
        email: maskEmail(email),
        lockoutSecondsRemaining: lockoutTTL,
      });

      return {
        canAttempt: false,
        status: {
          isLocked: true,
          failedAttempts: MAX_FAILED_ATTEMPTS,
          remainingAttempts: 0,
          lockoutSecondsRemaining: lockoutTTL,
        },
      };
    }

    // Get current failed attempts count
    const attemptsStr = await redis.get(attemptsKey);
    const failedAttempts = attemptsStr ? parseInt(attemptsStr, 10) : 0;
    const remainingAttempts = Math.max(0, MAX_FAILED_ATTEMPTS - failedAttempts);

    return {
      canAttempt: true,
      status: {
        isLocked: false,
        failedAttempts,
        remainingAttempts,
        lockoutSecondsRemaining: 0,
      },
    };
  } catch (error) {
    // On Redis error, allow login attempt (fail open for availability)
    logger.error('Failed to check lockout status', {
      email: maskEmail(email),
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      canAttempt: true,
      status: {
        isLocked: false,
        failedAttempts: 0,
        remainingAttempts: MAX_FAILED_ATTEMPTS,
        lockoutSecondsRemaining: 0,
      },
    };
  }
}

/**
 * Record a failed login attempt
 * Increments the counter and locks the account if threshold is reached
 *
 * @param email - User email that failed login
 * @returns Updated lockout status
 */
export async function recordFailedAttempt(email: string): Promise<LockoutStatus> {
  try {
    const pool = getConnectionPool();
    const redis = await pool.getMainConnection();

    const attemptsKey = getAttemptsKey(email);
    const lockoutKey = getLockoutKey(email);

    // Atomically increment attempts and set TTL using Lua script
    // This prevents memory leaks from orphaned keys without TTL
    const attempts = (await redis.eval(
      INCR_WITH_EXPIRE_SCRIPT,
      1,
      attemptsKey,
      LOCKOUT_DURATION_SECONDS
    )) as number;

    logger.info('Failed login attempt recorded', {
      email: maskEmail(email),
      attempts,
      maxAttempts: MAX_FAILED_ATTEMPTS,
    });

    // Check if lockout threshold reached
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      // Set lockout flag with TTL
      await redis.setex(lockoutKey, LOCKOUT_DURATION_SECONDS, '1');

      logger.warn('Account locked due to too many failed attempts', {
        email: maskEmail(email),
        attempts,
        lockoutDurationSeconds: LOCKOUT_DURATION_SECONDS,
      });

      return {
        isLocked: true,
        failedAttempts: attempts,
        remainingAttempts: 0,
        lockoutSecondsRemaining: LOCKOUT_DURATION_SECONDS,
      };
    }

    return {
      isLocked: false,
      failedAttempts: attempts,
      remainingAttempts: MAX_FAILED_ATTEMPTS - attempts,
      lockoutSecondsRemaining: 0,
    };
  } catch (error) {
    logger.error('Failed to record failed attempt', {
      email: maskEmail(email),
      error: error instanceof Error ? error.message : String(error),
    });

    // Return safe default on error
    return {
      isLocked: false,
      failedAttempts: 0,
      remainingAttempts: MAX_FAILED_ATTEMPTS,
      lockoutSecondsRemaining: 0,
    };
  }
}

/**
 * Clear failed attempts after successful login
 *
 * @param email - User email that successfully logged in
 */
export async function clearFailedAttempts(email: string): Promise<void> {
  try {
    const pool = getConnectionPool();
    const redis = await pool.getMainConnection();

    const attemptsKey = getAttemptsKey(email);
    const lockoutKey = getLockoutKey(email);

    // Delete both keys
    await redis.del(attemptsKey, lockoutKey);

    logger.debug('Cleared failed login attempts after successful login', {
      email: maskEmail(email),
    });
  } catch (error) {
    // Non-critical error - log but don't fail login
    logger.error('Failed to clear login attempts', {
      email: maskEmail(email),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get current lockout status without modifying state
 * Useful for admin dashboards
 *
 * @param email - User email to check
 * @returns Current lockout status
 */
export async function getLockoutStatus(email: string): Promise<LockoutStatus> {
  const result = await checkLockoutStatus(email);
  return result.status;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Mask email for logging (privacy protection)
 * user@example.com -> u***@e***.com
 * user@localhost -> u***@l***
 *
 * Handles malformed emails gracefully:
 * - @example.com -> ***@e***.com
 * - user@.com -> u***@***.com
 * - user@ -> ***
 * - no @ sign -> ***
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');

  // Handle missing domain part
  if (!domain) {
    return '***';
  }

  // Mask local part (handle empty or missing local)
  const maskedLocal = local && local.length >= 1 ? `${local[0]}***` : '***';

  // Mask domain part
  const domainParts = domain.split('.');
  let maskedDomain: string;

  if (domainParts.length > 1) {
    // Multi-part domain: get first and last part
    const firstPart = domainParts[0];
    const lastPart = domainParts[domainParts.length - 1];

    // Handle empty parts (e.g., @.com, @example.)
    const firstChar = firstPart && firstPart.length > 0 ? firstPart[0] : '';
    maskedDomain = firstChar ? `${firstChar}***.${lastPart}` : `***.${lastPart}`;
  } else {
    // Single-part domain (e.g., localhost)
    const firstChar = domainParts[0] && domainParts[0].length > 0 ? domainParts[0][0] : '';
    maskedDomain = firstChar ? `${firstChar}***` : '***';
  }

  return `${maskedLocal}@${maskedDomain}`;
}
