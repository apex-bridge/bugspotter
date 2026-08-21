/**
 * In-Memory Cache Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryCache, resetMemoryCache } from '../../src/cache/memory-cache.js';

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(async () => {
    await resetMemoryCache();
    cache = new MemoryCache({
      maxSize: 100,
      defaultTtl: 60,
      cleanupInterval: 60000, // Don't run cleanup during tests
    });
  });

  afterEach(async () => {
    await cache.close();
    await resetMemoryCache();
  });

  describe('basic operations', () => {
    it('should set and get a value', async () => {
      await cache.set('key1', { foo: 'bar' }, 60);
      const result = await cache.get<{ foo: string }>('key1');
      expect(result).toEqual({ foo: 'bar' });
    });

    it('should return null for non-existent key', async () => {
      const result = await cache.get('non-existent');
      expect(result).toBeNull();
    });

    it('should delete a key', async () => {
      await cache.set('key1', 'value1', 60);
      const deleted = await cache.delete('key1');
      expect(deleted).toBe(true);
      expect(await cache.get('key1')).toBeNull();
    });

    it('should return false when deleting non-existent key', async () => {
      const deleted = await cache.delete('non-existent');
      expect(deleted).toBe(false);
    });

    it('should check if key exists', async () => {
      await cache.set('key1', 'value1', 60);
      expect(await cache.has('key1')).toBe(true);
      expect(await cache.has('non-existent')).toBe(false);
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      vi.useFakeTimers();

      await cache.set('expiring', 'value', 1); // 1 second TTL
      expect(await cache.get('expiring')).toBe('value');

      // Advance time by 2 seconds
      vi.advanceTimersByTime(2000);

      expect(await cache.get('expiring')).toBeNull();

      vi.useRealTimers();
    });

    it('should not expire entries before TTL', async () => {
      vi.useFakeTimers();

      await cache.set('not-expiring', 'value', 60); // 60 second TTL

      // Advance time by 30 seconds
      vi.advanceTimersByTime(30000);

      expect(await cache.get('not-expiring')).toBe('value');

      vi.useRealTimers();
    });
  });

  describe('batch operations', () => {
    it('should get multiple values at once', async () => {
      await cache.set('key1', 'value1', 60);
      await cache.set('key2', 'value2', 60);
      await cache.set('key3', 'value3', 60);

      const results = await cache.getMany<string>(['key1', 'key2', 'key4']);

      expect(results.size).toBe(2);
      expect(results.get('key1')).toBe('value1');
      expect(results.get('key2')).toBe('value2');
      expect(results.has('key4')).toBe(false);
    });

    it('should set multiple values at once', async () => {
      const entries = new Map<string, string>([
        ['batch1', 'value1'],
        ['batch2', 'value2'],
      ]);

      await cache.setMany(entries, 60);

      expect(await cache.get('batch1')).toBe('value1');
      expect(await cache.get('batch2')).toBe('value2');
    });
  });

  describe('pattern deletion', () => {
    it('should delete keys matching a pattern', async () => {
      await cache.set('user:1', 'user1', 60);
      await cache.set('user:2', 'user2', 60);
      await cache.set('project:1', 'project1', 60);

      const deleted = await cache.deletePattern('user:*');

      expect(deleted).toBe(2);
      expect(await cache.get('user:1')).toBeNull();
      expect(await cache.get('user:2')).toBeNull();
      expect(await cache.get('project:1')).toBe('project1');
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used entries when max size reached', async () => {
      // Create cache with small max size
      const smallCache = new MemoryCache({
        maxSize: 5,
        defaultTtl: 60,
        cleanupInterval: 60000,
      });

      // Fill cache beyond capacity
      for (let i = 0; i < 10; i++) {
        await smallCache.set(`key${i}`, `value${i}`, 60);
      }

      // Cache should have evicted some entries
      const stats = await smallCache.getStats();
      expect(stats.size).toBeLessThanOrEqual(5);

      await smallCache.close();
    });
  });

  describe('statistics', () => {
    it('should track hits and misses', async () => {
      await cache.set('exists', 'value', 60);

      // 2 hits
      await cache.get('exists');
      await cache.get('exists');

      // 3 misses
      await cache.get('missing1');
      await cache.get('missing2');
      await cache.get('missing3');

      const stats = await cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(3);
      expect(stats.hitRatio).toBeCloseTo(0.4, 2);
    });

    it('should report cache size', async () => {
      await cache.set('key1', 'value1', 60);
      await cache.set('key2', 'value2', 60);
      await cache.set('key3', 'value3', 60);

      const stats = await cache.getStats();
      expect(stats.size).toBe(3);
    });
  });

  describe('clear', () => {
    it('should clear all entries', async () => {
      await cache.set('key1', 'value1', 60);
      await cache.set('key2', 'value2', 60);

      await cache.clear();

      const stats = await cache.getStats();
      expect(stats.size).toBe(0);
      expect(await cache.get('key1')).toBeNull();
    });
  });

  describe('health check', () => {
    it('should always return healthy for in-memory cache', async () => {
      expect(await cache.isHealthy()).toBe(true);
    });
  });
});
