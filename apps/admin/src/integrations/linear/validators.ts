/**
 * Linear config validation — parallels `utils/type-guards.ts`'s
 * `isJiraConfig` / `validateJiraConfig` so `useIntegrationConfig` can
 * pick the right validator based on platform.
 */

import type { LinearConfig } from './types';

/**
 * Structural guard. Lenient on values (allows empty strings during
 * progressive form entry) — use `validateLinearConfig` for the strict
 * pre-save check that requires non-empty values.
 */
export function isLinearConfig(config: unknown): config is LinearConfig {
  if (typeof config !== 'object' || config === null) {
    return false;
  }
  const c = config as Record<string, unknown>;

  // apiKey must exist as a string (may be empty during form entry).
  if (typeof c.apiKey !== 'string') {
    return false;
  }

  // teamId and teamKey may be empty during form entry but must be
  // strings if present.
  if (c.teamId !== undefined && typeof c.teamId !== 'string') {
    return false;
  }
  if (c.teamKey !== undefined && typeof c.teamKey !== 'string') {
    return false;
  }

  return true;
}

/**
 * Strict pre-save check — returns error message if invalid, null if OK.
 * Run this from the save path so a half-filled form can't be persisted.
 */
export function validateLinearConfig(config: LinearConfig): string | null {
  if (!config.apiKey?.trim()) {
    return 'Linear API key is required';
  }
  if (!config.teamId?.trim()) {
    return 'Linear team is required (pick one from the list)';
  }
  if (!config.teamKey?.trim()) {
    return 'Linear team key is required';
  }
  return null;
}
