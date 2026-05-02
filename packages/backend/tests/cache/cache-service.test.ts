/**
 * CacheService Unit Tests
 *
 * Comprehensive tests for the two-tier caching system.
 * Tests L1 (memory) and L2 (Redis) interaction, cache-aside pattern,
 * TTL handling, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CacheService, resetCacheService } from '../../src/cache/cache-service.js';
import { MemoryCache } from '../../src/cache/memory-cache.js';
import { RedisCache } from '../../src/cache/redis-cache.js';
import { CacheTTL } from '../../src/cache/types.js';
import { CacheKeys } from '../../src/cache/cache-keys.js';

describe('CacheService', () => {
  let cacheService: CacheService;
  let mockMemoryCache: MemoryCache;
  let mockRedisCache: RedisCache;

  beforeEach(() => {
    // Create mock instances
    mockMemoryCache = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      deletePattern: vi.fn(),
      has: vi.fn(),
      getMany: vi.fn(),
      setMany: vi.fn(),
      clear: vi.fn(),
      getStats: vi.fn(),
      close: vi.fn(),
      isHealthy: vi.fn(),
    } as unknown as MemoryCache;

    mockRedisCache = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      deletePattern: vi.fn(),
      has: vi.fn(),
      getMany: vi.fn(),
      setMany: vi.fn(),
      clear: vi.fn(),
      getStats: vi.fn(),
      close: vi.fn(),
      isHealthy: vi.fn(),
    } as unknown as RedisCache;
  });

  afterEach(async () => {
    await resetCacheService();
  });

  describe('Configuration', () => {
    it('should initialize with both caches enabled by default', () => {
      cacheService = new CacheService();
      expect(cacheService).toBeDefined();
    });

    it('should allow disabling memory cache', () => {
      cacheService = new CacheService({ enableMemoryCache: false });
      expect(cacheService).toBeDefined();
    });

    it('should allow disabling Redis cache', () => {
      cacheService = new CacheService({ enableRedisCache: false });
      expect(cacheService).toBeDefined();
    });

    it('should use custom memory TTL multiplier', async () => {
      // We'll verify this through behavior in other tests
      cacheService = new CacheService({ memoryTtlMultiplier: 0.3 });
      expect(cacheService).toBeDefined();
    });

    it('should enable debug logging when configured', () => {
      cacheService = new CacheService({ debug: true });
      expect(cacheService).toBeDefined();
    });
  });

  describe('Two-Tier Caching (get)', () => {
    beforeEach(() => {
      // Create service with mocked caches
      cacheService = new CacheService();
      // @ts-expect-error - Accessing private property for testing
      cacheService.memoryCache = mockMemoryCache;
      // @ts-expect-error - Accessing private property for testing
      cacheService.redisCache = mockRedisCache;
    });

    it('should return value from L1 cache on hit', async () => {
      const testValue = { id: '123', name: 'Test' };
      vi.mocked(mockMemoryCache.get).mockResolvedValue(testValue);

      const result = await cacheService.get('test-key');

      expect(result).toEqual(testValue);
      expect(mockMemoryCache.get).toHaveBeenCalledWith('test-key');
      expect(mockRedisCache.get).not.toHaveBeenCalled();
    });

    it('should check L2 on L1 miss and populate L1', async () => {
      const testValue = { id: '456', name: 'Redis Value' };
      vi.mocked(mockMemoryCache.get).mockResolvedValue(null);
      vi.mocked(mockRedisCache.get).mockResolvedValue(testValue);

      const result = await cacheService.get('test-key');

      expect(result).toEqual(testValue);
      expect(mockMemoryCache.get).toHaveBeenCalledWith('test-key');
      expect(mockRedisCache.get).toHaveBeenCalledWith('test-key');
      expect(mockMemoryCache.set).toHaveBeenCalledWith('test-key', testValue, expect.any(Number));
    });

    it('should use memoryTtlMultiplier when populating L1 from L2', async () => {
      const customService = new CacheService({ memoryTtlMultiplier: 0.25 });
      // @ts-expect-error - Accessing private property for testing
      customService.memoryCache = mockMemoryCache;
      // @ts-expect-error - Accessing private property for testing
      customService.redisCache = mockRedisCache;

      const testValue = { data: 'test' };
      vi.mocked(mockMemoryCache.get).mockResolvedValue(null);
      vi.mocked(mockRedisCache.get).mockResolvedValue(testValue);

      await customService.get('test-key');

      // Should use SHORT (60s) * 0.25 = 15s
      expect(mockMemoryCache.set).toHaveBeenCalledWith('test-key', testValue, 15);
    });

    it('should return null on complete cache miss', async () => {
      vi.mocked(mockMemoryCache.get).mockResolvedValue(null);
      vi.mocked(mockRedisCache.get).mockResolvedValue(null);

      const result = await cacheService.get('missing-key');

      expect(result).toBeNull();
      expect(mockMemoryCache.get).toHaveBeenCalled();
      expect(mockRedisCache.get).toHaveBeenCalled();
    });

    it('should work with only L2 enabled', async () => {
      const service = new CacheService({ enableMemoryCache: false });
      // @ts-expect-error - Accessing private property for testing
      service.redisCache = mockRedisCache;

      const testValue = { data: 'redis-only' };
      vi.mocked(mockRedisCache.get).mockResolvedValue(testValue);

      const result = await service.get('test-key');

      expect(result).toEqual(testValue);
      expect(mockRedisCache.get).toHaveBeenCalledWith('test-key');
    });

    it('should work with only L1 enabled', async () => {
      const service = new CacheService({ enableRedisCache: false });
      // @ts-expect-error - Accessing private property for testing
      service.memoryCache = mockMemoryCache;

      const testValue = { data: 'memory-only' };
      vi.mocked(mockMemoryCache.get).mockResolvedValue(testValue);

      const result = await service.get('test-key');

      expect(result).toEqual(testValue);
      expect(mockMemoryCache.get).toHaveBeenCalledWith('test-key');
    });
  });

  describe('Set Operation', () => {
    beforeEach(() => {
      cacheService = new CacheService();
      // @ts-expect-error - Accessing private property for testing
      cacheService.memoryCache = mockMemoryCache;
      // @ts-expect-error - Accessing private property for testing
      cacheService.redisCache = mockRedisCache;
    });

    it('should set value in both L1 and L2', async () => {
      const testValue = { id: '789', data: 'test' };
      const ttl = 300;

      await cacheService.set('test-key', testValue, ttl);

      // L1 should use multiplied TTL (300 * 0.5 = 150)
      expect(mockMemoryCache.set).toHaveBeenCalledWith('test-key', testValue, 150);
      // L2 should use full TTL
      expect(mockRedisCache.set).toHaveBeenCalledWith('test-key', testValue, 300);
    });

    it('should apply custom memoryTtlMultiplier', async () => {
      const service = new CacheService({ memoryTtlMultiplier: 0.75 });
      // @ts-expect-error - Accessing private property for testing
      service.memoryCache = mockMemoryCache;
      // @ts-expect-error - Accessing private property for testing
      service.redisCache = mockRedisCache;

      await service.set('test-key', { data: 'test' }, 400);

      // 400 * 0.75 = 300
      expect(mockMemoryCache.set).toHaveBeenCalledWith('test-key', expect.any(Object), 300);
    });

    it('should round up fractional TTL values', async () => {
      const service = new CacheService({ memoryTtlMultiplier: 0.33 });
      // @ts-expect-error - Accessing private property for testing
      service.memoryCache = mockMemoryCache;
      // @ts-expect-error - Accessing private property for testing
      service.redisCache = mockRedisCache;

      await service.set('test-key', { data: 'test' }, 100);

      // 100 * 0.33 = 33, should ceil to 33
      expect(mockMemoryCache.set).toHaveBeenCalledWith('test-key', expect.any(Object), 33);
    });

    it('should work with only L2 enabled', async () => {
      const service = new CacheService({ enableMemoryCache: false });
      // @ts-expect-error - Accessing private property for testing
      service.redisCache = mockRedisCache;

      await service.set('test-key', { data: 'test' }, 300);

      expect(mockRedisCache.set).toHaveBeenCalledWith('test-key', expect.any(Object), 300);
    });
  });

  describe('Delete Operation', () => {
    beforeEach(() => {
      cacheService = new CacheService();
      // @ts-expect-error - Accessing private property for testing
      cacheService.memoryCache = mockMemoryCache;
      // @ts-expect-error - Accessing private property for testing
      cacheService.redisCache = mockRedisCache;
    });

    it('should delete from both cache tiers', async () => {
      vi.mocked(mockMemoryCache.delete).mockResolvedValue(true);
      vi.mocked(mockRedisCache.delete).mockResolvedValue(true);

      await cacheService.delete('test-key');

      expect(mockMemoryCache.delete).toHaveBeenCalledWith('test-key');
      expect(mockRedisCache.delete).toHaveBeenCalledWith('test-key');
    });

    it('should delete even if key does not exist', async () => {
      vi.mocked(mockMemoryCache.delete).mockResolvedValue(false);
      vi.mocked(mockRedisCache.delete).mockResolvedValue(false);

      await cacheService.delete('missing-key');

      expect(mockMemoryCache.delete).toHaveBeenCalled();
      expect(mockRedisCache.delete).toHaveBeenCalled();
    });
  });

  describe('Pattern Deletion', () => {
    beforeEach(() => {
      cacheService = new CacheService();
      // @ts-expect-error - Accessing private property for testing
      cacheService.memoryCache = mockMemoryCache;
      // @ts-expect-error - Accessing private property for testing
      cacheService.redisCache = mockRedisCache;
    });

    it('should delete matching keys from both tiers', async () => {
      vi.mocked(mockMemoryCache.deletePattern).mockResolvedValue(5);
      vi.mocked(mockRedisCache.deletePattern).mockResolvedValue(3);

      const totalDeleted = await cacheService.deletePattern('user:*');

      expect(totalDeleted).toBe(8);
      expect(mockMemoryCache.deletePattern).toHaveBeenCalledWith('user:*');
      expect(mockRedisCache.deletePattern).toHaveBeenCalledWith('user:*');
    });

    it('should return 0 when no keys match pattern', async () => {
      vi.mocked(mockMemoryCache.deletePattern).mockResolvedValue(0);
      vi.mocked(mockRedisCache.deletePattern).mockResolvedValue(0);

      const totalDeleted = await cacheService.deletePattern('nonexistent:*');

      expect(totalDeleted).toBe(0);
    });
  });

  describe('Cache-Aside Pattern (getOrFetch)', () => {
    beforeEach(() => {
      cacheService = new CacheService();
      // @ts-expect-error - Accessing private property for testing
      cacheService.memoryCache = mockMemoryCache;
      // @ts-expect-error - Accessing private property for testing
      cacheService.redisCache = mockRedisCache;
    });

    it('should return from L1 without calling fetch', async () => {
      const cachedValue = { id: '1', name: 'Cached' };
      const fetchFn = vi.fn().mockResolvedValue({ id: '1', name: 'Fresh' });

      vi.mocked(mockMemoryCache.get).mockResolvedValue(cachedValue);

      const result = await cacheService.getOrFetch({
        key: 'test-key',
        ttl: CacheTTL.MEDIUM,
        fetch: fetchFn,
      });

      expect(result).toEqual(cachedValue);
      expect(fetchFn).not.toHaveBeenCalled();
      expect(mockRedisCache.get).not.toHaveBeenCalled();
    });

    it('should return from L2 and populate L1 without calling fetch', async () => {
      const l2Value = { id: '2', name: 'From Redis' };
      const fetchFn = vi.fn();

      vi.mocked(mockMemoryCache.get).mockResolvedValue(null);
      vi.mocked(mockRedisCache.get).mockResolvedValue(l2Value);

      const result = await cacheService.getOrFetch({
        key: 'test-key',
        ttl: CacheTTL.MEDIUM,
        fetch: fetchFn,
      });

      expect(result).toEqual(l2Value);
      expect(fetchFn).not.toHaveBeenCalled();
      expect(mockMemoryCache.set).toHaveBeenCalledWith('test-key', l2Value, expect.any(Number));
    });

    it('should fetch from source on complete miss and populate both caches', async () => {
      const freshValue = { id: '3', name: 'Fresh from DB' };
      const fetchFn = vi.fn().mockResolvedValue(freshValue);

      vi.mocked(mockMemoryCache.get).mockResolvedValue(null);
      vi.mocked(mockRedisCache.get).mockResolvedValue(null);

      const result = await cacheService.getOrFetch({
        key: 'test-key',
        ttl: CacheTTL.LONG,
        fetch: fetchFn,
      });

      expect(result).toEqual(freshValue);
      expect(fetchFn).toHaveBeenCalledOnce();
      // Should populate both caches
      expect(mockMemoryCache.set).toHaveBeenCalledWith(
        'test-key',
        freshValue,
        Math.ceil(CacheTTL.LONG * 0.5)
      );
      expect(mockRedisCache.set).toHaveBeenCalledWith('test-key', freshValue, CacheTTL.LONG);
    });

    it('should skip L1 when skipMemoryCache is true', async () => {
      const l2Value = { id: '4', name: 'Direct from Redis' };
      const fetchFn = vi.fn();

      vi.mocked(mockRedisCache.get).mockResolvedValue(l2Value);

      const result = await cacheService.getOrFetch({
        key: 'test-key',
        ttl: CacheTTL.SHORT,
        fetch: fetchFn,
        skipMemoryCache: true,
      });

      expect(result).toEqual(l2Value);
      expect(mockMemoryCache.get).not.toHaveBeenCalled();
      expect(mockRedisCache.get).toHaveBeenCalledWith('test-key');
    });

    it('should not populate L1 on L2 hit when skipMemoryCache is true', async () => {
      const l2Value = { id: '5', data: 'test' };
      const fetchFn = vi.fn();

      vi.mocked(mockRedisCache.get).mockResolvedValue(l2Value);

      await cacheService.getOrFetch({
        key: 'test-key',
        ttl: CacheTTL.SHORT,
        fetch: fetchFn,
        skipMemoryCache: true,
      });

      expect(mockMemoryCache.set).not.toHaveBeenCalled();
    });
  });

  describe('Entity-Specific Methods', () => {
    beforeEach(() => {
      cacheService = new CacheService();
      // @ts-expect-error - Accessing private property for testing
      cacheService.memoryCache = mockMemoryCache;
      // @ts-expect-error - Accessing private property for testing
      cacheService.redisCache = mockRedisCache;
    });

    describe('getApiKey', () => {
      it('should return cached API key', async () => {
        const apiKey = { id: 'key-1', key: 'bgs_test' };
        vi.mocked(mockMemoryCache.get).mockResolvedValue(apiKey);

        const fetchFn = vi.fn();
        const result = await cacheService.getApiKey('hash123', fetchFn);

        expect(result).toEqual(apiKey);
        expect(fetchFn).not.toHaveBeenCalled();
      });

      it('should return null for cached "not found" result', async () => {
        vi.mocked(mockMemoryCache.get).mockResolvedValue('NOT_FOUND');

        const fetchFn = vi.fn();
        const result = await cacheService.getApiKey('hash123', fetchFn);

        expect(result).toBeNull();
        expect(fetchFn).not.toHaveBeenCalled();
      });

      it('should fetch and cache API key on miss', async () => {
        const apiKey = { id: 'key-2', key: 'bgs_new' };
        const fetchFn = vi.fn().mockResolvedValue(apiKey);

        vi.mocked(mockMemoryCache.get).mockResolvedValue(null);
        vi.mocked(mockRedisCache.get).mockResolvedValue(null);

        const result = await cacheService.getApiKey('hash456', fetchFn);

        expect(result).toEqual(apiKey);
        expect(fetchFn).toHaveBeenCalledOnce();
        expect(mockMemoryCache.set).toHaveBeenCalled();
        expect(mockRedisCache.set).toHaveBeenCalled();
      });

      it('should cache "not found" result to prevent repeated DB queries', async () => {
        const fetchFn = vi.fn().mockResolvedValue(null);

        vi.mocked(mockMemoryCache.get).mockResolvedValue(null);
        vi.mocked(mockRedisCache.get).mockResolvedValue(null);

        const result = await cacheService.getApiKey('nonexistent', fetchFn);

        expect(result).toBeNull();
        expect(fetchFn).toHaveBeenCalledOnce();
        // Should cache 'NOT_FOUND' sentinel
        expect(mockMemoryCache.set).toHaveBeenCalledWith(
          CacheKeys.apiKey('nonexistent'),
          'NOT_FOUND',
          expect.any(Number)
        );
      });
    });

    describe('invalidateApiKey', () => {
      it('should delete API key from both cache tiers', async () => {
        vi.mocked(mockMemoryCache.delete).mockResolvedValue(true);
        vi.mocked(mockRedisCache.delete).mockResolvedValue(true);

        await cacheService.invalidateApiKey('hash789');

        const expectedKey = CacheKeys.apiKey('hash789');
        expect(mockMemoryCache.delete).toHaveBeenCalledWith(expectedKey);
        expect(mockRedisCache.delete).toHaveBeenCalledWith(expectedKey);
      });
    });

    describe('invalidateIntegrationRules', () => {
      // Regression: prior implementation called only the general
      // `integrationRulesPattern` (`<prefix>:<projectId>:*`) which does
      // NOT match the auto-create cache key shape
      // (`<prefix>:auto:<projectId>:<integrationId>` — `auto` precedes
      // `<projectId>`). Production route handlers thought they were
      // invalidating after rule mutations but the auto-create cache
      // stayed stale until TTL expired.
      it('should delete BOTH the general rules pattern and the auto-create rules pattern', async () => {
        vi.mocked(mockMemoryCache.deletePattern).mockResolvedValue(2);
        vi.mocked(mockRedisCache.deletePattern).mockResolvedValue(1);

        await cacheService.invalidateIntegrationRules('proj-1');

        const generalPattern = CacheKeys.integrationRulesPattern('proj-1');
        const autoCreatePattern = CacheKeys.autoCreateRulesPattern('proj-1');

        expect(mockMemoryCache.deletePattern).toHaveBeenCalledWith(generalPattern);
        expect(mockMemoryCache.deletePattern).toHaveBeenCalledWith(autoCreatePattern);
        expect(mockRedisCache.deletePattern).toHaveBeenCalledWith(generalPattern);
        expect(mockRedisCache.deletePattern).toHaveBeenCalledWith(autoCreatePattern);
      });

      it('should clear the auto-create cache key written by getAutoCreateRules', async () => {
        // End-to-end shape check: an entry written by getAutoCreateRules
        // must be removed by invalidateIntegrationRules. This is the
        // invariant that route handlers depend on.
        const autoCreateKey = CacheKeys.autoCreateRules('proj-1', 'integ-1');
        const autoCreatePattern = CacheKeys.autoCreateRulesPattern('proj-1');

        // The pattern's wildcard suffix must match the actual key.
        // (Strip the trailing `*` and confirm the key starts with the prefix.)
        const prefix = autoCreatePattern.replace(/\*$/, '');
        expect(autoCreateKey.startsWith(prefix)).toBe(true);

        // And the OLD general pattern (the buggy one) must NOT match.
        const generalPattern = CacheKeys.integrationRulesPattern('proj-1');
        const generalPrefix = generalPattern.replace(/\*$/, '');
        expect(autoCreateKey.startsWith(generalPrefix)).toBe(false);
      });
    });

    describe('getSystemConfig', () => {
      it('should return cached system config', async () => {
        const config = { maxUploadSize: 1024000 };
        vi.mocked(mockMemoryCache.get).mockResolvedValue(config);

        const fetchFn = vi.fn();
        const result = await cacheService.getSystemConfig('upload.maxSize', fetchFn);

        expect(result).toEqual(config);
        expect(fetchFn).not.toHaveBeenCalled();
      });

      it('should fetch and cache config on miss', async () => {
        const config = { sessionTimeout: 3600 };
        const fetchFn = vi.fn().mockResolvedValue(config);

        vi.mocked(mockMemoryCache.get).mockResolvedValue(null);
        vi.mocked(mockRedisCache.get).mockResolvedValue(null);

        const result = await cacheService.getSystemConfig('auth.timeout', fetchFn);

        expect(result).toEqual(config);
        expect(fetchFn).toHaveBeenCalledOnce();
      });
    });

    describe('getAutoCreateRules', () => {
      it('should return cached rules', async () => {
        const rules = [{ id: 'rule-1', name: 'Auto ticket' }];
        vi.mocked(mockMemoryCache.get).mockResolvedValue(rules);

        const fetchFn = vi.fn();
        const result = await cacheService.getAutoCreateRules('proj-1', 'int-1', fetchFn);

        expect(result).toEqual(rules);
        expect(fetchFn).not.toHaveBeenCalled();
      });

      it('should fetch and cache rules on miss', async () => {
        const rules = [{ id: 'rule-2', name: 'New rule' }];
        const fetchFn = vi.fn().mockResolvedValue(rules);

        vi.mocked(mockMemoryCache.get).mockResolvedValue(null);
        vi.mocked(mockRedisCache.get).mockResolvedValue(null);

        const result = await cacheService.getAutoCreateRules('proj-2', 'int-2', fetchFn);

        expect(result).toEqual(rules);
        expect(fetchFn).toHaveBeenCalledOnce();
      });
    });
  });

  describe('Clear Operation', () => {
    beforeEach(() => {
      cacheService = new CacheService();
      // @ts-expect-error - Accessing private property for testing
      cacheService.memoryCache = mockMemoryCache;
      // @ts-expect-error - Accessing private property for testing
      cacheService.redisCache = mockRedisCache;
    });

    it('should clear both cache tiers', async () => {
      await cacheService.clear();

      expect(mockMemoryCache.clear).toHaveBeenCalledOnce();
      expect(mockRedisCache.clear).toHaveBeenCalledOnce();
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      cacheService = new CacheService();
      // @ts-expect-error - Accessing private property for testing
      cacheService.memoryCache = mockMemoryCache;
      // @ts-expect-error - Accessing private property for testing
      cacheService.redisCache = mockRedisCache;
    });

    it('should aggregate stats from both cache tiers', async () => {
      const memoryStats = {
        hits: 100,
        misses: 20,
        size: 500,
        hitRatio: 0.833,
        memoryUsage: 10240,
      };

      const redisStats = {
        hits: 200,
        misses: 50,
        size: 1000,
        hitRatio: 0.8,
        memoryUsage: 51200,
      };

      vi.mocked(mockMemoryCache.getStats).mockResolvedValue(memoryStats);
      vi.mocked(mockRedisCache.getStats).mockResolvedValue(redisStats);

      const stats = await cacheService.getStats();

      expect(stats).toEqual({
        memory: memoryStats,
        redis: redisStats,
      });
    });

    it('should handle stats with only memory cache enabled', async () => {
      const service = new CacheService({ enableRedisCache: false });
      // @ts-expect-error - Accessing private property for testing
      service.memoryCache = mockMemoryCache;

      const memoryStats = {
        hits: 50,
        misses: 10,
        size: 100,
        hitRatio: 0.833,
        memoryUsage: 5120,
      };

      vi.mocked(mockMemoryCache.getStats).mockResolvedValue(memoryStats);

      const stats = await service.getStats();

      expect(stats.memory).toEqual(memoryStats);
      expect(stats.redis).toBeNull();
    });
  });

  describe('Health Check', () => {
    beforeEach(() => {
      cacheService = new CacheService();
      // @ts-expect-error - Accessing private property for testing
      cacheService.memoryCache = mockMemoryCache;
      // @ts-expect-error - Accessing private property for testing
      cacheService.redisCache = mockRedisCache;
    });

    it('should return healthy when both caches are healthy', async () => {
      vi.mocked(mockMemoryCache.isHealthy).mockResolvedValue(true);
      vi.mocked(mockRedisCache.isHealthy).mockResolvedValue(true);

      const healthy = await cacheService.isHealthy();

      expect(healthy).toEqual({ memory: true, redis: true });
    });

    it('should return false when memory cache is unhealthy', async () => {
      vi.mocked(mockMemoryCache.isHealthy).mockResolvedValue(false);
      vi.mocked(mockRedisCache.isHealthy).mockResolvedValue(true);

      const healthy = await cacheService.isHealthy();

      expect(healthy).toEqual({ memory: false, redis: true });
    });

    it('should return false when Redis cache is unhealthy', async () => {
      vi.mocked(mockMemoryCache.isHealthy).mockResolvedValue(true);
      vi.mocked(mockRedisCache.isHealthy).mockResolvedValue(false);

      const healthy = await cacheService.isHealthy();

      expect(healthy).toEqual({ memory: true, redis: false });
    });

    it('should return true when only enabled cache is healthy', async () => {
      const service = new CacheService({ enableRedisCache: false });
      // @ts-expect-error - Accessing private property for testing
      service.memoryCache = mockMemoryCache;

      vi.mocked(mockMemoryCache.isHealthy).mockResolvedValue(true);

      const healthy = await service.isHealthy();

      expect(healthy).toEqual({ memory: true, redis: false });
    });
  });

  describe('Close Operation', () => {
    beforeEach(() => {
      cacheService = new CacheService();
      // @ts-expect-error - Accessing private property for testing
      cacheService.memoryCache = mockMemoryCache;
      // @ts-expect-error - Accessing private property for testing
      cacheService.redisCache = mockRedisCache;
    });

    it('should close both cache providers', async () => {
      await cacheService.close();

      expect(mockMemoryCache.close).toHaveBeenCalledOnce();
      expect(mockRedisCache.close).toHaveBeenCalledOnce();
    });

    it('should handle close with only one cache enabled', async () => {
      const service = new CacheService({ enableMemoryCache: false });
      // @ts-expect-error - Accessing private property for testing
      service.redisCache = mockRedisCache;

      await service.close();

      expect(mockRedisCache.close).toHaveBeenCalledOnce();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null values correctly', async () => {
      cacheService = new CacheService();
      // @ts-expect-error - Accessing private property for testing
      cacheService.memoryCache = mockMemoryCache;
      // @ts-expect-error - Accessing private property for testing
      cacheService.redisCache = mockRedisCache;

      vi.mocked(mockMemoryCache.get).mockResolvedValue(null);
      vi.mocked(mockRedisCache.get).mockResolvedValue(null);

      const result = await cacheService.get('null-test');

      expect(result).toBeNull();
    });

    it('should handle empty string keys', async () => {
      cacheService = new CacheService();
      // @ts-expect-error - Accessing private property for testing
      cacheService.memoryCache = mockMemoryCache;

      await cacheService.set('', { data: 'empty key test' }, 60);

      expect(mockMemoryCache.set).toHaveBeenCalledWith('', expect.any(Object), 30);
    });

    it('should handle very large TTL values', async () => {
      cacheService = new CacheService();
      // @ts-expect-error - Accessing private property for testing
      cacheService.memoryCache = mockMemoryCache;

      const largeTtl = 86400 * 365; // 1 year
      await cacheService.set('long-lived', { data: 'test' }, largeTtl);

      expect(mockMemoryCache.set).toHaveBeenCalledWith(
        'long-lived',
        expect.any(Object),
        Math.ceil(largeTtl * 0.5)
      );
    });

    it('should handle concurrent operations', async () => {
      cacheService = new CacheService();
      // @ts-expect-error - Accessing private property for testing
      cacheService.memoryCache = mockMemoryCache;
      // @ts-expect-error - Accessing private property for testing
      cacheService.redisCache = mockRedisCache;

      vi.mocked(mockMemoryCache.get).mockResolvedValue({ id: '1' });
      vi.mocked(mockRedisCache.get).mockResolvedValue({ id: '2' });

      const results = await Promise.all([
        cacheService.get('key1'),
        cacheService.get('key2'),
        cacheService.get('key3'),
      ]);

      expect(results).toHaveLength(3);
      expect(mockMemoryCache.get).toHaveBeenCalledTimes(3);
    });
  });
});
