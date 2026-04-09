/**
 * Cache Module
 *
 * Provides a two-tier caching layer:
 * - L1: In-memory cache (fast, per-instance)
 * - L2: Redis cache (distributed, shared across instances)
 *
 * Usage:
 * ```typescript
 * import { getCacheService, CacheKeys, CacheTTL } from './cache';
 *
 * const cache = getCacheService();
 *
 * // Simple get/set
 * await cache.set('key', value, CacheTTL.MEDIUM);
 * const value = await cache.get<MyType>('key');
 *
 * // Get or fetch pattern
 * const settings = await cache.getOrFetch({
 *   key: CacheKeys.projectSettings(projectId),
 *   ttl: CacheTTL.MEDIUM,
 *   fetch: () => db.projects.getSettings(projectId),
 * });
 *
 * // Entity-specific methods
 * const apiKey = await cache.getApiKey(keyHash, () => db.apiKeys.findByHash(keyHash));
 * await cache.invalidateApiKey(keyHash);
 * ```
 */

// Types
export type {
  ICacheProvider,
  CacheOptions,
  CacheEntry,
  CacheStats,
  CacheInvalidationEvent,
  ICacheKeyBuilder,
  CacheLayerConfig,
} from './types.js';

export { CacheTTL, CachePrefix } from './types.js';

// Cache Keys
export {
  CacheKeys,
  buildCacheKey,
  buildCachePattern,
  parseCacheKey,
  getCacheKeyPrefix,
} from './cache-keys.js';

// Redis Cache Provider
export {
  RedisCache,
  getRedisCache,
  resetRedisCache,
  type RedisCacheConfig,
} from './redis-cache.js';

// Memory Cache Provider
export {
  MemoryCache,
  getMemoryCache,
  resetMemoryCache,
  type MemoryCacheConfig,
} from './memory-cache.js';

// Cache Service
export {
  CacheService,
  getCacheService,
  resetCacheService,
  type CacheServiceConfig,
  type CacheFetchOptions,
} from './cache-service.js';
