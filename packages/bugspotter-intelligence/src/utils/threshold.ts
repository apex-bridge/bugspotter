/**
 * Shared threshold validation utilities for intelligence routes.
 * Both /similar and /mitigations accept an optional ?threshold query param
 * that overrides the per-org or service-level SIMILARITY_THRESHOLD default.
 */

// TODO: import AppError from your actual middleware once the package is wired up
// import { AppError } from '../middleware/error.js';

export const THRESHOLD_MIN = 0.5;
export const THRESHOLD_MAX = 1.0;
const THRESHOLD_ENV_DEFAULT = 0.85;

/**
 * Resolve the effective similarity threshold.
 *
 * Priority chain:
 * 1. `queryValue`  — per-request override (must be valid or throws 422)
 * 2. `orgDefault`  — per-org setting loaded from `intelligence_settings`
 * 3. `SIMILARITY_THRESHOLD` env var — service-level default
 * 4. 0.85          — hardcoded last resort
 *
 * `orgDefault` values that are NaN or outside [THRESHOLD_MIN, THRESHOLD_MAX]
 * are silently ignored and the next fallback is used.
 */
export function resolveThreshold(queryValue: number | undefined, orgDefault?: number): number {
  const envRaw = Number(process.env.SIMILARITY_THRESHOLD ?? String(THRESHOLD_ENV_DEFAULT));
  const envDefault =
    isNaN(envRaw) || envRaw < THRESHOLD_MIN || envRaw > THRESHOLD_MAX
      ? THRESHOLD_ENV_DEFAULT
      : envRaw;

  const validOrgDefault =
    orgDefault !== undefined &&
    !isNaN(orgDefault) &&
    orgDefault >= THRESHOLD_MIN &&
    orgDefault <= THRESHOLD_MAX
      ? orgDefault
      : undefined;

  const fallback = validOrgDefault ?? envDefault;

  if (queryValue === undefined) {
    return fallback;
  }

  if (isNaN(queryValue)) {
    // TODO: replace with `throw new AppError(...)` once AppError is available
    const err = new Error('threshold must be a number between 0.5 and 1.0') as Error & {
      statusCode: number;
    };
    err.statusCode = 422;
    throw err;
  }

  if (queryValue < THRESHOLD_MIN || queryValue > THRESHOLD_MAX) {
    const err = new Error(
      `threshold must be between ${THRESHOLD_MIN} and ${THRESHOLD_MAX}`
    ) as Error & { statusCode: number };
    err.statusCode = 422;
    throw err;
  }

  return queryValue;
}
