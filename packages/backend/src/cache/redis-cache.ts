/**
 * Redis Cache Provider
 *
 * Distributed cache implementation using Redis.
 * Integrates with existing Redis connection pool.
 */

import { Redis } from 'ioredis';
import { getLogger } from '../logger.js';
import { getConnectionPool } from '../queue/redis-connection-pool.js';
import type { ICacheProvider, CacheStats } from './types.js';

const logger = getLogger();

/**
 * Redis cache provider configuration
 */
export interface RedisCacheConfig {
  /** Key prefix for all cache entries */
  keyPrefix?: string;
  /** Default TTL in seconds */
  defaultTtl?: number;
  /** Enable cache metrics collection */
  enableMetrics?: boolean;
}

/**
 * Redis-based cache provider
 *
 * Uses the existing Redis connection pool to avoid creating additional connections.
 * Supports TTL, pattern deletion, and batch operations.
 */
export class RedisCache implements ICacheProvider {
  private redis: Redis | null = null;
  private keyPrefix: string;
  private defaultTtl: number;
  private enableMetrics: boolean;

  // Metrics
  private hits = 0;
  private misses = 0;

  constructor(config: RedisCacheConfig = {}) {
    this.keyPrefix = config.keyPrefix || 'cache';
    this.defaultTtl = config.defaultTtl || 300; // 5 minutes default
    this.enableMetrics = config.enableMetrics ?? true;
  }

  /**
   * Get Redis connection from pool
   */
  private async getConnection(): Promise<Redis> {
    if (!this.redis || this.redis.status !== 'ready') {
      const pool = getConnectionPool();
      this.redis = await pool.getMainConnection();
    }
    return this.redis;
  }

  /**
   * Build full cache key with prefix
   */
  private buildKey(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const redis = await this.getConnection();
      const fullKey = this.buildKey(key);
      const data = await redis.get(fullKey);

      if (data === null) {
        if (this.enableMetrics) {
          this.misses++;
        }
        return null;
      }

      if (this.enableMetrics) {
        this.hits++;
      }

      try {
        return JSON.parse(data) as T;
      } catch (parseError) {
        logger.error('Redis cache JSON parse error', {
          key,
          rawValue: data.substring(0, 100), // Log first 100 chars for debugging
          error: parseError instanceof Error ? parseError.message : 'Unknown error',
        });
        return null; // Safer than type assertion
      }
    } catch (error) {
      logger.error('Redis cache get error', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      if (this.enableMetrics) {
        this.misses++;
      }
      return null;
    }
  }

  /**
   * Set a value in cache
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const redis = await this.getConnection();
      const fullKey = this.buildKey(key);
      const serialized = JSON.stringify(value);
      const expiry = ttl ?? this.defaultTtl;

      if (expiry > 0) {
        await redis.setex(fullKey, expiry, serialized);
      } else {
        await redis.set(fullKey, serialized);
      }
    } catch (error) {
      logger.error('Redis cache set error', {
        key,
        ttl: ttl ?? this.defaultTtl,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw - cache failures shouldn't break the application
    }
  }

  /**
   * Delete a specific key from cache
   */
  async delete(key: string): Promise<boolean> {
    try {
      const redis = await this.getConnection();
      const fullKey = this.buildKey(key);
      const deleted = await redis.del(fullKey);
      return deleted > 0;
    } catch (error) {
      logger.error('Redis cache delete error', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Delete all keys matching a pattern
   * Uses batch deletion to avoid memory issues with large key sets
   */
  async deletePattern(pattern: string): Promise<number> {
    try {
      const redis = await this.getConnection();
      const fullPattern = this.buildKey(pattern);

      // Use SCAN to avoid blocking with KEYS
      // Delete in batches to prevent memory issues and Redis argument limits
      let cursor = '0';
      let totalDeleted = 0;

      do {
        const [newCursor, keys] = await redis.scan(cursor, 'MATCH', fullPattern, 'COUNT', 100);
        cursor = newCursor;

        // Delete batch immediately instead of accumulating in memory
        if (keys.length > 0) {
          try {
            const deleted = await redis.del(...keys);
            totalDeleted += deleted;
          } catch (delError) {
            // Log DEL errors but continue processing other batches
            logger.error('Redis cache deletePattern error', {
              pattern,
              batchSize: keys.length,
              error: delError instanceof Error ? delError.message : 'Unknown error',
            });
            // Continue to next batch even if this one failed
          }
        }
      } while (cursor !== '0');

      if (totalDeleted > 0) {
        logger.debug('Cache pattern deletion', {
          pattern,
          keysDeleted: totalDeleted,
        });
      }

      return totalDeleted;
    } catch (error) {
      // Only catch SCAN errors here - DEL errors are caught per-batch above
      logger.error('Redis cache deletePattern error', {
        pattern,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  /**
   * Check if a key exists in cache
   */
  async has(key: string): Promise<boolean> {
    try {
      const redis = await this.getConnection();
      const fullKey = this.buildKey(key);
      const exists = await redis.exists(fullKey);
      return exists > 0;
    } catch (error) {
      logger.error('Redis cache has error', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Get multiple values at once
   */
  async getMany<T>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();

    if (keys.length === 0) {
      return result;
    }

    try {
      const redis = await this.getConnection();
      const fullKeys = keys.map((k) => this.buildKey(k));
      const values = await redis.mget(...fullKeys);

      for (let i = 0; i < keys.length; i++) {
        const value = values[i];
        if (value !== null) {
          try {
            result.set(keys[i], JSON.parse(value) as T);
            if (this.enableMetrics) {
              this.hits++;
            }
          } catch (parseError) {
            logger.error('Redis cache JSON parse error in getMany', {
              key: keys[i],
              rawValue: value.substring(0, 100),
              error: parseError instanceof Error ? parseError.message : 'Unknown error',
            });
            // Skip this entry instead of unsafe type assertion
            if (this.enableMetrics) {
              this.misses++;
            }
          }
        } else {
          if (this.enableMetrics) {
            this.misses++;
          }
        }
      }
    } catch (error) {
      logger.error('Redis cache getMany error', {
        keyCount: keys.length,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Return empty map on error
      if (this.enableMetrics) {
        this.misses += keys.length;
      }
    }

    return result;
  }

  /**
   * Set multiple values at once
   */
  async setMany<T>(entries: Map<string, T>, ttl?: number): Promise<void> {
    if (entries.size === 0) {
      return;
    }

    try {
      const redis = await this.getConnection();
      const expiry = ttl ?? this.defaultTtl;
      const pipeline = redis.pipeline();

      for (const [key, value] of entries) {
        const fullKey = this.buildKey(key);
        const serialized = JSON.stringify(value);

        if (expiry > 0) {
          pipeline.setex(fullKey, expiry, serialized);
        } else {
          pipeline.set(fullKey, serialized);
        }
      }

      await pipeline.exec();
    } catch (error) {
      logger.error('Redis cache setMany error', {
        entryCount: entries.size,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Clear all cache entries with the configured prefix
   */
  async clear(): Promise<void> {
    try {
      const deleted = await this.deletePattern('*');
      logger.info('Cache cleared', { keysDeleted: deleted });
    } catch (error) {
      logger.error('Redis cache clear error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    const total = this.hits + this.misses;

    try {
      const redis = await this.getConnection();

      // Count keys with our prefix using SCAN
      let cursor = '0';
      let size = 0;

      do {
        const [newCursor, keys] = await redis.scan(
          cursor,
          'MATCH',
          this.buildKey('*'),
          'COUNT',
          1000
        );
        cursor = newCursor;
        size += keys.length;
      } while (cursor !== '0');

      return {
        hits: this.hits,
        misses: this.misses,
        size,
        hitRatio: total > 0 ? this.hits / total : 0,
      };
    } catch (error) {
      logger.error('Redis cache getStats error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        hits: this.hits,
        misses: this.misses,
        size: 0,
        hitRatio: total > 0 ? this.hits / total : 0,
      };
    }
  }

  /**
   * Close cache connection
   * Note: We don't actually close the connection since it's managed by the pool
   */
  async close(): Promise<void> {
    // Connection is managed by RedisConnectionPool, don't close it here
    this.redis = null;
    logger.debug('Redis cache provider closed (connection returned to pool)');
  }

  /**
   * Check if cache is connected and healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const redis = await this.getConnection();
      const pong = await redis.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Reset metrics counters
   */
  resetMetrics(): void {
    this.hits = 0;
    this.misses = 0;
  }
}

// Singleton instance
let redisCacheInstance: RedisCache | null = null;

/**
 * Get the singleton Redis cache instance
 */
export function getRedisCache(config?: RedisCacheConfig): RedisCache {
  if (!redisCacheInstance) {
    redisCacheInstance = new RedisCache(config);
  }
  return redisCacheInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetRedisCache(): void {
  redisCacheInstance = null;
}
