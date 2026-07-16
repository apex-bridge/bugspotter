/**
 * Shared threshold validation utilities for intelligence routes.
 * Both /similar and /mitigations accept an optional ?threshold query param
 * that overrides the service-level SIMILARITY_THRESHOLD env default.
 */

// TODO: import AppError from your actual middleware once the package is wired up
// import { AppError } from '../middleware/error.js';

export const THRESHOLD_MIN = 0.5;
export const THRESHOLD_MAX = 1.0;
const THRESHOLD_ENV_DEFAULT = 0.85;

/**
 * Resolve the effective similarity threshold.
 * - Query param present and valid  → use it
 * - Query param absent             → fall back to SIMILARITY_THRESHOLD env var
 * - Env var missing / invalid      → fall back to hardcoded default (0.85)
 * - Query param out of range       → throw 422
 */
export function resolveThreshold(rawQueryThreshold: number | undefined): number {
  const envRaw = Number(process.env.SIMILARITY_THRESHOLD ?? String(THRESHOLD_ENV_DEFAULT));
  const envDefault =
    isNaN(envRaw) || envRaw < THRESHOLD_MIN || envRaw > THRESHOLD_MAX
      ? THRESHOLD_ENV_DEFAULT
      : envRaw;

  if (rawQueryThreshold === undefined) {
    return envDefault;
  }

  if (isNaN(rawQueryThreshold)) {
    // TODO: replace with `throw new AppError(...)` once AppError is available
    const err = new Error('threshold must be a number between 0.5 and 1.0') as Error & {
      statusCode: number;
    };
    err.statusCode = 422;
    throw err;
  }

  if (rawQueryThreshold < THRESHOLD_MIN || rawQueryThreshold > THRESHOLD_MAX) {
    const err = new Error(
      `threshold must be between ${THRESHOLD_MIN} and ${THRESHOLD_MAX}`
    ) as Error & { statusCode: number };
    err.statusCode = 422;
    throw err;
  }

  return rawQueryThreshold;
}
