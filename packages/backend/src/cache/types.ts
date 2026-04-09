/**
 * Cache Provider Types
 *
 * Defines interfaces and types for the caching layer.
 * Supports both Redis (distributed) and in-memory (local) caching.
 */

/**
 * Cache configuration options
 */
export interface CacheOptions {
  /** Time-to-live in seconds (default: 300 = 5 minutes) */
  ttl?: number;
  /** Cache key prefix for namespacing */
  prefix?: string;
  /** Enable stale-while-revalidate pattern */
  staleWhileRevalidate?: boolean;
  /** Additional TTL for stale data when revalidating (seconds) */
  staleTtl?: number;
}

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T> {
  /** Cached value */
  value: T;
  /** Timestamp when entry was created */
  createdAt: number;
  /** Timestamp when entry expires */
  expiresAt: number;
  /** Whether the entry is stale (past TTL but within stale TTL) */
  isStale?: boolean;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  /** Total number of cache hits */
  hits: number;
  /** Total number of cache misses */
  misses: number;
  /** Total number of entries currently in cache */
  size: number;
  /** Cache hit ratio (hits / total requests) */
  hitRatio: number;
  /** Total bytes used (if available) */
  memoryUsage?: number;
}

/**
 * Cache invalidation event
 */
export interface CacheInvalidationEvent {
  /** Cache key pattern to invalidate */
  pattern: string;
  /** Reason for invalidation */
  reason: string;
  /** Timestamp of invalidation */
  timestamp: number;
}

/**
 * Cache provider interface
 *
 * Implemented by Redis and in-memory cache providers.
 * All methods are async to support both sync and async backends.
 */
export interface ICacheProvider {
  /**
   * Get a value from cache
   * @param key - Cache key
   * @returns Cached value or null if not found/expired
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set a value in cache
   * @param key - Cache key
   * @param value - Value to cache (must be JSON-serializable)
   * @param ttl - Time-to-live in seconds (optional, uses default if not provided)
   */
  set<T>(key: string, value: T, ttl?: number): Promise<void>;

  /**
   * Delete a specific key from cache
   * @param key - Cache key to delete
   * @returns true if key existed and was deleted
   */
  delete(key: string): Promise<boolean>;

  /**
   * Delete all keys matching a pattern
   * @param pattern - Pattern to match (supports * wildcard)
   * @returns Number of keys deleted
   */
  deletePattern(pattern: string): Promise<number>;

  /**
   * Check if a key exists in cache
   * @param key - Cache key
   * @returns true if key exists and is not expired
   */
  has(key: string): Promise<boolean>;

  /**
   * Get multiple values at once
   * @param keys - Array of cache keys
   * @returns Map of key -> value (missing/expired keys omitted)
   */
  getMany<T>(keys: string[]): Promise<Map<string, T>>;

  /**
   * Set multiple values at once
   * @param entries - Map of key -> value
   * @param ttl - Time-to-live in seconds (applies to all entries)
   */
  setMany<T>(entries: Map<string, T>, ttl?: number): Promise<void>;

  /**
   * Clear all entries from cache
   * Warning: Use with caution in production
   */
  clear(): Promise<void>;

  /**
   * Get cache statistics
   */
  getStats(): Promise<CacheStats>;

  /**
   * Close cache connection (for cleanup)
   */
  close(): Promise<void>;

  /**
   * Check if cache is connected and healthy
   */
  isHealthy(): Promise<boolean>;
}

/**
 * Cache key builder for consistent key generation
 */
export interface ICacheKeyBuilder {
  /**
   * Build a cache key from parts
   * @param parts - Key parts to join
   */
  build(...parts: string[]): string;

  /**
   * Build a pattern for key matching
   * @param prefix - Key prefix
   */
  pattern(prefix: string): string;
}

/**
 * Cache layer configuration
 */
export interface CacheLayerConfig {
  /** Primary cache provider (usually Redis) */
  primary: ICacheProvider;
  /** Optional secondary/fallback cache provider (usually in-memory) */
  secondary?: ICacheProvider;
  /** Default TTL in seconds */
  defaultTtl: number;
  /** Key prefix for all cache entries */
  keyPrefix: string;
  /** Enable cache metrics collection */
  enableMetrics: boolean;
  /** Log cache operations at debug level */
  enableDebugLogs: boolean;
}

/**
 * Predefined TTL values (in seconds)
 */
export const CacheTTL = {
  /** Very short TTL for highly volatile data (30 seconds) */
  VERY_SHORT: 30,
  /** Short TTL for frequently changing data (60 seconds) */
  SHORT: 60,
  /** Medium TTL for moderately stable data (5 minutes) */
  MEDIUM: 300,
  /** Long TTL for stable data (15 minutes) */
  LONG: 900,
  /** Very long TTL for rarely changing data (1 hour) */
  VERY_LONG: 3600,
  /** Extended TTL for static configuration (24 hours) */
  EXTENDED: 86400,
} as const;

/**
 * Cache key prefixes for different data types
 */
export const CachePrefix = {
  /** API key validations */
  API_KEY: 'apikey',
  /** Integration rules */
  INTEGRATION_RULES: 'rules',
  /** Project settings */
  PROJECT_SETTINGS: 'project',
  /** System configuration */
  SYSTEM_CONFIG: 'sysconfig',
  /** Project integrations */
  PROJECT_INTEGRATIONS: 'integrations',
  /** Rate limiting */
  RATE_LIMIT: 'ratelimit',
} as const;
