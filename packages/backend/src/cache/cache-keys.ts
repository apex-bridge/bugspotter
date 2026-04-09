/**
 * Cache Key Builder
 *
 * Provides consistent key generation for cache operations.
 * Keys follow the pattern: prefix:entity:identifier[:subkey]
 */

import { CachePrefix } from './types.js';

/**
 * Separator for cache key parts
 */
const KEY_SEPARATOR = ':';

/**
 * Wildcard for pattern matching
 */
const WILDCARD = '*';

/**
 * Build a cache key from parts
 * @param parts - Key parts to join with separator
 * @returns Formatted cache key
 */
export function buildCacheKey(...parts: (string | number)[]): string {
  return parts.filter((p) => p !== undefined && p !== null && p !== '').join(KEY_SEPARATOR);
}

/**
 * Build a pattern for matching multiple keys
 * @param prefix - Key prefix to match
 * @returns Pattern with wildcard suffix
 */
export function buildCachePattern(prefix: string): string {
  return `${prefix}${KEY_SEPARATOR}${WILDCARD}`;
}

/**
 * Cache key generators for specific entities
 */
export const CacheKeys = {
  /**
   * API key validation cache key
   * @param keyHash - SHA256 hash of the API key
   */
  apiKey(keyHash: string): string {
    return buildCacheKey(CachePrefix.API_KEY, keyHash);
  },

  /**
   * Pattern to invalidate all API keys
   */
  apiKeyPattern(): string {
    return buildCachePattern(CachePrefix.API_KEY);
  },

  /**
   * Integration rules cache key
   * @param projectId - Project ID
   * @param integrationId - Optional integration ID for specific rules
   */
  integrationRules(projectId: string, integrationId?: string): string {
    if (integrationId) {
      return buildCacheKey(CachePrefix.INTEGRATION_RULES, projectId, integrationId);
    }
    return buildCacheKey(CachePrefix.INTEGRATION_RULES, projectId);
  },

  /**
   * Auto-create rules cache key
   * @param projectId - Project ID
   * @param integrationId - Integration ID
   */
  autoCreateRules(projectId: string, integrationId: string): string {
    return buildCacheKey(CachePrefix.INTEGRATION_RULES, 'auto', projectId, integrationId);
  },

  /**
   * Pattern to invalidate all rules for a project
   * @param projectId - Project ID
   */
  integrationRulesPattern(projectId: string): string {
    return buildCachePattern(buildCacheKey(CachePrefix.INTEGRATION_RULES, projectId));
  },

  /**
   * Pattern to invalidate all integration rules
   */
  allIntegrationRulesPattern(): string {
    return buildCachePattern(CachePrefix.INTEGRATION_RULES);
  },

  /**
   * Project settings cache key
   * @param projectId - Project ID
   */
  projectSettings(projectId: string): string {
    return buildCacheKey(CachePrefix.PROJECT_SETTINGS, projectId);
  },

  /**
   * Pattern to invalidate all project settings
   */
  projectSettingsPattern(): string {
    return buildCachePattern(CachePrefix.PROJECT_SETTINGS);
  },

  /**
   * System configuration cache key
   * @param configKey - Configuration key name
   */
  systemConfig(configKey: string): string {
    return buildCacheKey(CachePrefix.SYSTEM_CONFIG, configKey);
  },

  /**
   * Pattern to invalidate all system configuration
   */
  systemConfigPattern(): string {
    return buildCachePattern(CachePrefix.SYSTEM_CONFIG);
  },

  /**
   * Project integration cache key
   * @param projectId - Project ID
   * @param platform - Integration platform (e.g., 'jira', 'linear')
   */
  projectIntegration(projectId: string, platform: string): string {
    return buildCacheKey(CachePrefix.PROJECT_INTEGRATIONS, projectId, platform);
  },

  /**
   * Pattern to invalidate all integrations for a project
   * @param projectId - Project ID
   */
  projectIntegrationPattern(projectId: string): string {
    return buildCachePattern(buildCacheKey(CachePrefix.PROJECT_INTEGRATIONS, projectId));
  },

  /**
   * Rate limit counter cache key
   * @param keyId - API key ID
   * @param window - Rate limit window identifier
   */
  rateLimit(keyId: string, window: string): string {
    return buildCacheKey(CachePrefix.RATE_LIMIT, keyId, window);
  },

  /**
   * Pattern to invalidate rate limits for a key
   * @param keyId - API key ID
   */
  rateLimitPattern(keyId: string): string {
    return buildCachePattern(buildCacheKey(CachePrefix.RATE_LIMIT, keyId));
  },
};

/**
 * Parse a cache key into its component parts
 * @param key - Cache key to parse
 * @returns Array of key parts
 */
export function parseCacheKey(key: string): string[] {
  return key.split(KEY_SEPARATOR);
}

/**
 * Get the prefix from a cache key
 * @param key - Cache key
 * @returns First part of the key (prefix)
 */
export function getCacheKeyPrefix(key: string): string {
  const parts = parseCacheKey(key);
  return parts[0] || '';
}
