/**
 * Cache Service
 *
 * High-level caching service that provides:
 * - Two-tier caching (L1: in-memory, L2: Redis)
 * - Automatic cache invalidation
 * - Type-safe caching for common entities
 * - Cache-aside pattern implementation
 */

import { getLogger } from '../logger.js';
import { RedisCache, getRedisCache } from './redis-cache.js';
import { MemoryCache, getMemoryCache } from './memory-cache.js';
import { CacheKeys } from './cache-keys.js';
import { CacheTTL, type CacheStats } from './types.js';

const logger = getLogger();

/**
 * Cache service configuration
 */
export interface CacheServiceConfig {
  /** Enable L1 in-memory cache (default: true) */
  enableMemoryCache?: boolean;
  /** Enable L2 Redis cache (default: true) */
  enableRedisCache?: boolean;
  /** L1 cache TTL multiplier (default: 0.5 - half of L2 TTL) */
  memoryTtlMultiplier?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * Cache fetch options
 */
export interface CacheFetchOptions<T> {
  /** Cache key */
  key: string;
  /** Time-to-live in seconds */
  ttl: number;
  /** Function to fetch data on cache miss */
  fetch: () => Promise<T>;
  /** Skip L1 cache (go directly to L2/source) */
  skipMemoryCache?: boolean;
}

/**
 * Main cache service
 *
 * Provides a two-tier caching strategy:
 * - L1: In-memory cache (fast, limited size, per-instance)
 * - L2: Redis cache (distributed, larger capacity)
 *
 * Flow:
 * 1. Check L1 (memory) -> hit? return
 * 2. Check L2 (Redis) -> hit? populate L1, return
 * 3. Fetch from source -> populate L1 + L2, return
 */
export class CacheService {
  private memoryCache: MemoryCache | null;
  private redisCache: RedisCache | null;
  private memoryTtlMultiplier: number;
  private debug: boolean;

  constructor(config: CacheServiceConfig = {}) {
    this.memoryCache = config.enableMemoryCache !== false ? getMemoryCache() : null;
    this.redisCache = config.enableRedisCache !== false ? getRedisCache() : null;
    this.memoryTtlMultiplier = config.memoryTtlMultiplier ?? 0.5;
    this.debug = config.debug ?? false;

    logger.info('Cache service initialized', {
      memoryCache: !!this.memoryCache,
      redisCache: !!this.redisCache,
      memoryTtlMultiplier: this.memoryTtlMultiplier,
    });
  }

  /**
   * Get a value from cache (L1 -> L2)
   */
  async get<T>(key: string): Promise<T | null> {
    // Try L1 first
    if (this.memoryCache) {
      const value = await this.memoryCache.get<T>(key);
      if (value !== null) {
        if (this.debug) {
          logger.debug('Cache L1 hit', { key });
        }
        return value;
      }
    }

    // Try L2
    if (this.redisCache) {
      const value = await this.redisCache.get<T>(key);
      if (value !== null) {
        if (this.debug) {
          logger.debug('Cache L2 hit', { key });
        }
        // Populate L1 for next access
        if (this.memoryCache) {
          // Use default SHORT TTL with multiplier for consistency
          // TODO: Consider querying Redis TTL for exact remaining time
          const memoryTtl = Math.ceil(CacheTTL.SHORT * this.memoryTtlMultiplier);
          await this.memoryCache.set(key, value, memoryTtl);
        }
        return value;
      }
    }

    if (this.debug) {
      logger.debug('Cache miss', { key });
    }
    return null;
  }

  /**
   * Set a value in cache (L1 + L2)
   */
  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    const promises: Promise<void>[] = [];

    // Set in L1 with shorter TTL
    if (this.memoryCache) {
      const memoryTtl = Math.ceil(ttl * this.memoryTtlMultiplier);
      promises.push(this.memoryCache.set(key, value, memoryTtl));
    }

    // Set in L2
    if (this.redisCache) {
      promises.push(this.redisCache.set(key, value, ttl));
    }

    await Promise.all(promises);

    if (this.debug) {
      logger.debug('Cache set', { key, ttl });
    }
  }

  /**
   * Delete a key from all cache tiers
   */
  async delete(key: string): Promise<void> {
    const promises: Promise<boolean>[] = [];

    if (this.memoryCache) {
      promises.push(this.memoryCache.delete(key));
    }

    if (this.redisCache) {
      promises.push(this.redisCache.delete(key));
    }

    await Promise.all(promises);

    if (this.debug) {
      logger.debug('Cache delete', { key });
    }
  }

  /**
   * Delete all keys matching a pattern from all cache tiers
   */
  async deletePattern(pattern: string): Promise<number> {
    let totalDeleted = 0;

    if (this.memoryCache) {
      totalDeleted += await this.memoryCache.deletePattern(pattern);
    }

    if (this.redisCache) {
      totalDeleted += await this.redisCache.deletePattern(pattern);
    }

    logger.debug('Cache pattern delete', { pattern, deleted: totalDeleted });
    return totalDeleted;
  }

  /**
   * Get or fetch value using cache-aside pattern
   *
   * @example
   * const user = await cacheService.getOrFetch({
   *   key: CacheKeys.user(userId),
   *   ttl: CacheTTL.MEDIUM,
   *   fetch: () => db.users.findById(userId),
   * });
   */
  async getOrFetch<T>(options: CacheFetchOptions<T>): Promise<T> {
    const { key, ttl, fetch, skipMemoryCache } = options;

    // Try L1 first (unless skipped)
    if (this.memoryCache && !skipMemoryCache) {
      const value = await this.memoryCache.get<T>(key);
      if (value !== null) {
        if (this.debug) {
          logger.debug('Cache getOrFetch L1 hit', { key });
        }
        return value;
      }
    }

    // Try L2
    if (this.redisCache) {
      const value = await this.redisCache.get<T>(key);
      if (value !== null) {
        if (this.debug) {
          logger.debug('Cache getOrFetch L2 hit', { key });
        }
        // Populate L1
        if (this.memoryCache && !skipMemoryCache) {
          const memoryTtl = Math.ceil(ttl * this.memoryTtlMultiplier);
          await this.memoryCache.set(key, value, memoryTtl);
        }
        return value;
      }
    }

    // Cache miss - fetch from source
    if (this.debug) {
      logger.debug('Cache getOrFetch miss, fetching', { key });
    }
    const value = await fetch();

    // Populate caches
    await this.set(key, value, ttl);

    return value;
  }

  // ============================================================================
  // Entity-Specific Cache Methods
  // ============================================================================

  /**
   * Get or fetch API key by hash
   */
  async getApiKey<T>(keyHash: string, fetch: () => Promise<T | null>): Promise<T | null> {
    const cacheKey = CacheKeys.apiKey(keyHash);

    // Check cache
    const cached = await this.get<T | 'NOT_FOUND'>(cacheKey);
    if (cached !== null) {
      // Return null for cached "not found" results
      return cached === 'NOT_FOUND' ? null : cached;
    }

    // Fetch from source
    const value = await fetch();

    // Cache the result (including null as 'NOT_FOUND')
    await this.set(cacheKey, value ?? 'NOT_FOUND', CacheTTL.VERY_SHORT);

    return value;
  }

  /**
   * Invalidate API key cache
   */
  async invalidateApiKey(keyHash: string): Promise<void> {
    await this.delete(CacheKeys.apiKey(keyHash));
    logger.debug('Invalidated API key cache', { keyHash: keyHash.substring(0, 8) + '...' });
  }

  /**
   * Get or fetch integration rules for a project
   */
  async getIntegrationRules<T>(
    projectId: string,
    integrationId: string | undefined,
    fetch: () => Promise<T>
  ): Promise<T> {
    const cacheKey = CacheKeys.integrationRules(projectId, integrationId);

    return this.getOrFetch({
      key: cacheKey,
      ttl: CacheTTL.SHORT,
      fetch,
    });
  }

  /**
   * Get or fetch auto-create rules
   */
  async getAutoCreateRules<T>(
    projectId: string,
    integrationId: string,
    fetch: () => Promise<T>
  ): Promise<T> {
    const cacheKey = CacheKeys.autoCreateRules(projectId, integrationId);

    return this.getOrFetch({
      key: cacheKey,
      ttl: CacheTTL.SHORT,
      fetch,
    });
  }

  /**
   * Invalidate all integration rules for a project. Three deletes are
   * required because the rules cache has three key shapes:
   *
   *   1. `<prefix>:<projectId>`                       — bare project key
   *      written by `CacheKeys.integrationRules(projectId)` when the
   *      caller wants the full rule list for a project, no integration
   *      filter. This is an EXACT key, not a pattern — wildcards can't
   *      match it (no trailing colon segment for `:*` to land on).
   *
   *   2. `<prefix>:<projectId>:<integrationId>`        — per-integration
   *      key written by `CacheKeys.integrationRules(projectId, integ)`.
   *      Caught by the general pattern `<prefix>:<projectId>:*`.
   *
   *   3. `<prefix>:auto:<projectId>:<integrationId>`   — auto-create
   *      variant. `auto` precedes `<projectId>`, so a wildcard rooted
   *      at `<projectId>` can't reach it — needs its own pattern.
   *
   * Production route handlers call this after every rule create/update/
   * delete; missing any of the three shapes leaves stale rules in the
   * cache for up to `CacheTTL.SHORT` (60s) after a rule change.
   */
  async invalidateIntegrationRules(projectId: string): Promise<void> {
    const baseKey = CacheKeys.integrationRules(projectId);
    const generalPattern = CacheKeys.integrationRulesPattern(projectId);
    const autoCreatePattern = CacheKeys.autoCreateRulesPattern(projectId);
    const [, deletedGeneral, deletedAutoCreate] = await Promise.all([
      this.delete(baseKey),
      this.deletePattern(generalPattern),
      this.deletePattern(autoCreatePattern),
    ]);
    logger.debug('Invalidated integration rules cache', {
      projectId,
      deletedGeneral,
      deletedAutoCreate,
    });
  }

  /**
   * Get or fetch project settings
   */
  async getProjectSettings<T>(projectId: string, fetch: () => Promise<T>): Promise<T> {
    const cacheKey = CacheKeys.projectSettings(projectId);

    return this.getOrFetch({
      key: cacheKey,
      ttl: CacheTTL.MEDIUM,
      fetch,
    });
  }

  /**
   * Invalidate project settings cache
   */
  async invalidateProjectSettings(projectId: string): Promise<void> {
    await this.delete(CacheKeys.projectSettings(projectId));
    logger.debug('Invalidated project settings cache', { projectId });
  }

  /**
   * Get or fetch system configuration
   */
  async getSystemConfig<T>(configKey: string, fetch: () => Promise<T>): Promise<T> {
    const cacheKey = CacheKeys.systemConfig(configKey);

    return this.getOrFetch({
      key: cacheKey,
      ttl: CacheTTL.MEDIUM,
      fetch,
    });
  }

  /**
   * Invalidate system configuration cache
   */
  async invalidateSystemConfig(configKey: string): Promise<void> {
    await this.delete(CacheKeys.systemConfig(configKey));
    logger.debug('Invalidated system config cache', { configKey });
  }

  /**
   * Get or fetch project integration
   */
  async getProjectIntegration<T>(
    projectId: string,
    platform: string,
    fetch: () => Promise<T>
  ): Promise<T> {
    const cacheKey = CacheKeys.projectIntegration(projectId, platform);

    return this.getOrFetch({
      key: cacheKey,
      ttl: CacheTTL.LONG,
      fetch,
    });
  }

  /**
   * Invalidate project integration cache
   */
  async invalidateProjectIntegration(projectId: string, platform?: string): Promise<void> {
    if (platform) {
      await this.delete(CacheKeys.projectIntegration(projectId, platform));
      logger.debug('Invalidated project integration cache', { projectId, platform });
    } else {
      const pattern = CacheKeys.projectIntegrationPattern(projectId);
      const deleted = await this.deletePattern(pattern);
      logger.debug('Invalidated all project integrations cache', { projectId, deleted });
    }
  }

  // ============================================================================
  // Statistics and Health
  // ============================================================================

  /**
   * Get combined cache statistics
   */
  async getStats(): Promise<{ memory: CacheStats | null; redis: CacheStats | null }> {
    const [memoryStats, redisStats] = await Promise.all([
      this.memoryCache ? this.memoryCache.getStats() : Promise.resolve(null),
      this.redisCache ? this.redisCache.getStats() : Promise.resolve(null),
    ]);

    return {
      memory: memoryStats,
      redis: redisStats,
    };
  }

  /**
   * Check if cache is healthy
   */
  async isHealthy(): Promise<{ memory: boolean; redis: boolean }> {
    const [memoryHealthy, redisHealthy] = await Promise.all([
      this.memoryCache ? this.memoryCache.isHealthy() : Promise.resolve(false),
      this.redisCache ? this.redisCache.isHealthy() : Promise.resolve(false),
    ]);

    return {
      memory: memoryHealthy,
      redis: redisHealthy,
    };
  }

  /**
   * Clear all caches
   * Warning: Use with caution in production
   */
  async clear(): Promise<void> {
    const promises: Promise<void>[] = [];
    if (this.memoryCache) {
      promises.push(this.memoryCache.clear());
    }
    if (this.redisCache) {
      promises.push(this.redisCache.clear());
    }
    await Promise.all(promises);
    logger.info('All caches cleared');
  }

  /**
   * Close cache connections
   */
  async close(): Promise<void> {
    const promises: Promise<void>[] = [];
    if (this.memoryCache) {
      promises.push(this.memoryCache.close());
    }
    if (this.redisCache) {
      promises.push(this.redisCache.close());
    }
    await Promise.all(promises);
    logger.info('Cache service closed');
  }
}

// Singleton instance
let cacheServiceInstance: CacheService | null = null;

/**
 * Get the singleton cache service instance
 */
export function getCacheService(config?: CacheServiceConfig): CacheService {
  if (!cacheServiceInstance) {
    cacheServiceInstance = new CacheService(config);
  }
  return cacheServiceInstance;
}

/**
 * Reset the singleton instance (for testing)
 * Must be awaited to ensure complete cleanup before next test
 */
export async function resetCacheService(): Promise<void> {
  if (cacheServiceInstance) {
    await cacheServiceInstance.close();
    cacheServiceInstance = null;
  }
}
