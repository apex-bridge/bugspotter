/**
 * In-Memory Cache Provider
 *
 * Local cache implementation using Map with TTL support.
 * Suitable for single-instance deployments or as L1 cache.
 */

import { getLogger } from '../logger.js';
import type { ICacheProvider, CacheStats } from './types.js';

const logger = getLogger();

/**
 * In-memory cache configuration
 */
export interface MemoryCacheConfig {
  /** Maximum number of entries (LRU eviction when exceeded) */
  maxSize?: number;
  /** Default TTL in seconds */
  defaultTtl?: number;
  /** Enable cache metrics collection */
  enableMetrics?: boolean;
  /** Cleanup interval in milliseconds (default: 60000 = 1 minute) */
  cleanupInterval?: number;
}

/**
 * In-memory cache entry with metadata
 */
interface MemoryCacheEntry<T> {
  value: T;
  expiresAt: number;
  lastAccessed: number;
}

/**
 * In-memory cache provider
 *
 * Features:
 * - TTL-based expiration
 * - LRU eviction when max size reached
 * - Automatic cleanup of expired entries
 * - Pattern-based deletion with glob support
 */
export class MemoryCache implements ICacheProvider {
  private cache: Map<string, MemoryCacheEntry<unknown>>;
  private maxSize: number;
  private defaultTtl: number;
  private enableMetrics: boolean;
  private cleanupTimer: NodeJS.Timeout | null = null;

  // Metrics
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(config: MemoryCacheConfig = {}) {
    this.cache = new Map();
    this.maxSize = config.maxSize || 10000;
    this.defaultTtl = config.defaultTtl || 300; // 5 minutes default
    this.enableMetrics = config.enableMetrics ?? true;

    // Start cleanup timer
    const cleanupInterval = config.cleanupInterval || 60000; // 1 minute
    this.startCleanup(cleanupInterval);
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanup(interval: number): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, interval);

    // Don't prevent Node.js from exiting
    this.cleanupTimer.unref();
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('Memory cache cleanup', { removed, remaining: this.cache.size });
    }
  }

  /**
   * Evict least recently used entries if cache is full
   */
  private evictIfNeeded(): void {
    if (this.cache.size < this.maxSize) {
      return;
    }

    // Find LRU entries to evict (remove 10% of cache)
    const entriesToEvict = Math.ceil(this.maxSize * 0.1);
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)
      .slice(0, entriesToEvict);

    for (const [key] of entries) {
      this.cache.delete(key);
      this.evictions++;
    }

    logger.debug('Memory cache LRU eviction', {
      evicted: entries.length,
      remaining: this.cache.size,
    });
  }

  /**
   * Check if an entry is expired
   */
  private isExpired(entry: MemoryCacheEntry<unknown>): boolean {
    return entry.expiresAt <= Date.now();
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      if (this.enableMetrics) {
        this.misses++;
      }
      return null;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      if (this.enableMetrics) {
        this.misses++;
      }
      return null;
    }

    // Update last accessed time for LRU
    entry.lastAccessed = Date.now();
    if (this.enableMetrics) {
      this.hits++;
    }

    return entry.value as T;
  }

  /**
   * Set a value in cache
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    this.evictIfNeeded();

    const expiry = ttl ?? this.defaultTtl;
    const now = Date.now();

    this.cache.set(key, {
      value,
      expiresAt: expiry > 0 ? now + expiry * 1000 : Number.MAX_SAFE_INTEGER,
      lastAccessed: now,
    });
  }

  /**
   * Delete a specific key from cache
   */
  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  /**
   * Delete all keys matching a pattern
   * Supports * wildcard at the end of pattern
   */
  async deletePattern(pattern: string): Promise<number> {
    let deleted = 0;

    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
      .replace(/\*/g, '.*'); // Convert * to .*

    const regex = new RegExp(`^${regexPattern}$`);

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        deleted++;
      }
    }

    if (deleted > 0) {
      logger.debug('Memory cache pattern deletion', { pattern, deleted });
    }

    return deleted;
  }

  /**
   * Check if a key exists in cache
   */
  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Get multiple values at once
   */
  async getMany<T>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();

    for (const key of keys) {
      const value = await this.get<T>(key);
      if (value !== null) {
        result.set(key, value);
      }
    }

    return result;
  }

  /**
   * Set multiple values at once
   */
  async setMany<T>(entries: Map<string, T>, ttl?: number): Promise<void> {
    for (const [key, value] of entries) {
      await this.set(key, value, ttl);
    }
  }

  /**
   * Clear all entries from cache
   */
  async clear(): Promise<void> {
    const size = this.cache.size;
    this.cache.clear();
    logger.info('Memory cache cleared', { entriesRemoved: size });
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    const total = this.hits + this.misses;

    // Calculate approximate memory usage
    let memoryUsage = 0;
    for (const [key, entry] of this.cache.entries()) {
      memoryUsage += key.length * 2; // String chars (UTF-16)
      memoryUsage += JSON.stringify(entry.value).length * 2;
      memoryUsage += 24; // Metadata overhead (timestamps)
    }

    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRatio: total > 0 ? this.hits / total : 0,
      memoryUsage,
    };
  }

  /**
   * Close cache and cleanup
   */
  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
    logger.debug('Memory cache provider closed');
  }

  /**
   * Always healthy since it's in-memory
   */
  async isHealthy(): Promise<boolean> {
    return true;
  }

  /**
   * Reset metrics counters
   */
  resetMetrics(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Get eviction count
   */
  getEvictionCount(): number {
    return this.evictions;
  }
}

// Singleton instance
let memoryCacheInstance: MemoryCache | null = null;

/**
 * Get the singleton in-memory cache instance
 */
export function getMemoryCache(config?: MemoryCacheConfig): MemoryCache {
  if (!memoryCacheInstance) {
    memoryCacheInstance = new MemoryCache(config);
  }
  return memoryCacheInstance;
}

/**
 * Reset the singleton instance (for testing)
 * Must be awaited to ensure complete cleanup before next test
 */
export async function resetMemoryCache(): Promise<void> {
  if (memoryCacheInstance) {
    await memoryCacheInstance.close();
    memoryCacheInstance = null;
  }
}
