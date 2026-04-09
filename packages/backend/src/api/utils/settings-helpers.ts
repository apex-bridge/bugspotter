/**
 * Settings utility functions
 * Shared helpers for extracting typed values from settings objects
 */

/**
 * Safely extract a boolean value from settings object
 * @param settings - Settings object from database
 * @param key - Setting key to extract
 * @param defaultValue - Default value if not found or not boolean
 * @returns Boolean value or default
 */
export function getBooleanSetting(
  settings: Record<string, unknown>,
  key: string,
  defaultValue: boolean
): boolean {
  const value = settings[key];
  if (typeof value === 'boolean') {
    return value;
  }
  return defaultValue;
}

/**
 * Safely extract a boolean value with optional environment variable fallback
 * @param settings - Settings object from database
 * @param key - Setting key to extract
 * @param envKey - Optional environment variable key for fallback
 * @param defaultValue - Default value if not found
 * @returns Boolean value, env var, or default
 */
export function getBooleanSettingWithEnv(
  settings: Record<string, unknown>,
  key: string,
  envKey: string | null,
  defaultValue: boolean
): boolean {
  // Priority 1: Database setting (explicit boolean value)
  const value = settings[key];
  if (typeof value === 'boolean') {
    return value;
  }

  // Priority 2: Environment variable (if envKey provided)
  if (envKey !== null) {
    const envValue = process.env[envKey];
    if (envValue !== undefined) {
      // Only 'true' (case-insensitive) returns true, everything else is false
      // This handles: 'false', '', '0', 'disabled', etc. all as false
      return envValue.toLowerCase() === 'true';
    }
  }

  // Priority 3: Default value
  return defaultValue;
}

/**
 * Safely extract a number value from settings object
 * @param settings - Settings object from database
 * @param key - Setting key to extract
 * @param defaultValue - Default value if not found or not a number
 * @returns Number value or default
 */
export function getNumberSetting(
  settings: Record<string, unknown>,
  key: string,
  defaultValue: number
): number {
  const value = settings[key];
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

/**
 * Safely extract a number value with optional environment variable fallback
 * @param settings - Settings object from database
 * @param key - Setting key to extract
 * @param envKey - Optional environment variable key for fallback
 * @param defaultValue - Default value if not found
 * @returns Number value, env var parsed as int, or default
 */
export function getNumberSettingWithEnv(
  settings: Record<string, unknown>,
  key: string,
  envKey: string | null,
  defaultValue: number
): number {
  // Priority 1: Database setting (explicit number value)
  const value = settings[key];
  if (typeof value === 'number') {
    return value;
  }

  // Priority 2: Environment variable (if envKey provided)
  if (envKey !== null) {
    const envValue = process.env[envKey];
    if (envValue !== undefined) {
      const parsed = parseInt(envValue, 10);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
  }

  // Priority 3: Default value
  return defaultValue;
}
