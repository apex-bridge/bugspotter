/**
 * Shared threshold validation utilities for intelligence routes.
 * Both /similar and /mitigations accept an optional ?threshold query param
 * that overrides the per-org or service-level SIMILARITY_THRESHOLD default.
 */

import { AppError } from '../errors.js';

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
    throw new AppError('threshold must be a number between 0.5 and 1.0', 422);
  }

  if (queryValue < THRESHOLD_MIN || queryValue > THRESHOLD_MAX) {
    throw new AppError(`threshold must be between ${THRESHOLD_MIN} and ${THRESHOLD_MAX}`, 422);
  }

  return queryValue;
}
