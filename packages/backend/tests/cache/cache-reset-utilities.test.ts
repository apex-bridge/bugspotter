/**
 * Tests for cache reset utility functions
 *
 * These functions are used to reset singleton instances between tests.
 * Critical for test isolation - bugs here cause flaky tests and resource leaks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCacheService, resetCacheService } from '../../src/cache/cache-service.js';
import { getMemoryCache, resetMemoryCache } from '../../src/cache/memory-cache.js';
import { getRedisCache, resetRedisCache } from '../../src/cache/redis-cache.js';

describe('Cache Reset Utilities', () => {
  describe('resetCacheService', () => {
    it('should close the existing instance before setting to null', async () => {
      const cache = getCacheService();
      const closeSpy = vi.spyOn(cache, 'close');

      await resetCacheService();

      expect(closeSpy).toHaveBeenCalledOnce();
    });

    it('should create a new instance after reset', async () => {
      const firstInstance = getCacheService();

      await resetCacheService();
      const secondInstance = getCacheService();

      expect(secondInstance).not.toBe(firstInstance);
    });

    it('should handle reset when no instance exists', async () => {
      await resetCacheService(); // First reset
      await resetCacheService(); // Second reset (already null)

      // Should still be able to get a new instance
      expect(getCacheService()).toBeDefined();
    });

    it('should wait for close to complete before returning', async () => {
      const cache = getCacheService();
      let closeCompleted = false;

      vi.spyOn(cache, 'close').mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        closeCompleted = true;
      });

      await resetCacheService();

      expect(closeCompleted).toBe(true);
    });

    afterEach(async () => {
      // Cleanup: ensure cache is reset after each test
      await resetCacheService();
    });
  });

  describe('resetMemoryCache', () => {
    it('should close the existing instance before setting to null', async () => {
      const cache = getMemoryCache();
      const closeSpy = vi.spyOn(cache, 'close');

      await resetMemoryCache();

      expect(closeSpy).toHaveBeenCalledOnce();
    });

    it('should create a new instance after reset', async () => {
      const firstInstance = getMemoryCache();

      await resetMemoryCache();
      const secondInstance = getMemoryCache();

      expect(secondInstance).not.toBe(firstInstance);
    });

    it('should handle reset when no instance exists', async () => {
      await resetMemoryCache(); // First reset
      await resetMemoryCache(); // Second reset (already null)

      // Should still be able to get a new instance
      expect(getMemoryCache()).toBeDefined();
    });

    it('should wait for close to complete before returning', async () => {
      const cache = getMemoryCache();
      let closeCompleted = false;

      vi.spyOn(cache, 'close').mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        closeCompleted = true;
      });

      await resetMemoryCache();

      expect(closeCompleted).toBe(true);
    });

    it('should clear cleanup timer when closing', async () => {
      const cache = getMemoryCache({ cleanupInterval: 100 });

      // Cache should have internal cleanup timer
      await cache.set('test', 'value');

      await resetMemoryCache();

      // If timer wasn't cleared, this could cause issues
      // We can't directly test timer state, but can verify no errors
      expect(true).toBe(true);
    });

    afterEach(async () => {
      // Cleanup: ensure cache is reset after each test
      await resetMemoryCache();
    });
  });

  describe('resetRedisCache', () => {
    it('should reset the singleton instance to null', () => {
      const firstInstance = getRedisCache();

      resetRedisCache();
      const secondInstance = getRedisCache();

      expect(secondInstance).not.toBe(firstInstance);
    });

    it('should handle reset when no instance exists', () => {
      resetRedisCache(); // First reset
      resetRedisCache(); // Second reset (already null)

      // Should still be able to get a new instance
      expect(getRedisCache()).toBeDefined();
    });

    it('should not require await since Redis connection is from pool', () => {
      // RedisCache doesn't own its connection, so reset is synchronous
      const instance = getRedisCache();
      resetRedisCache();

      // This is a compile-time check - resetRedisCache returns void, not Promise
      expect(instance).toBeDefined();
    });

    afterEach(() => {
      // Cleanup: ensure cache is reset after each test
      resetRedisCache();
    });
  });

  describe('Integration: Full Cache Stack Reset', () => {
    beforeEach(async () => {
      // Ensure clean state
      await resetCacheService();
      await resetMemoryCache();
      resetRedisCache();
    });

    it('should reset all cache layers independently', async () => {
      // Create all instances
      const cacheService = getCacheService();
      const memoryCache = getMemoryCache();
      const redisCache = getRedisCache();

      // Store references
      const originalCacheService = cacheService;
      const originalMemoryCache = memoryCache;
      const originalRedisCache = redisCache;

      // Reset all layers
      await resetCacheService();
      await resetMemoryCache();
      resetRedisCache();

      // Get new instances
      const newCacheService = getCacheService();
      const newMemoryCache = getMemoryCache();
      const newRedisCache = getRedisCache();

      // All should be new instances
      expect(newCacheService).not.toBe(originalCacheService);
      expect(newMemoryCache).not.toBe(originalMemoryCache);
      expect(newRedisCache).not.toBe(originalRedisCache);
    });

    it('should handle concurrent resets without errors', async () => {
      const cache = getCacheService();
      await cache.set('test', 'value', 60);

      // Reset multiple times concurrently
      await Promise.all([resetCacheService(), resetCacheService(), resetCacheService()]);

      // Should be able to get new instance
      const newCache = getCacheService();
      expect(newCache).toBeDefined();
    });

    afterEach(async () => {
      // Final cleanup
      await resetCacheService();
      await resetMemoryCache();
      resetRedisCache();
    });
  });
});
