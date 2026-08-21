/**
 * RedisCache Unit Tests
 *
 * Tests for Redis cache provider including batch deletion,
 * memory efficiency, and edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedisCache } from '../../src/cache/redis-cache.js';

// Mock the entire redis-connection-pool module
const mockRedis = {
  status: 'ready',
  get: vi.fn(),
  set: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  getdel: vi.fn(),
  eval: vi.fn(),
  exists: vi.fn(),
  scan: vi.fn(),
  ping: vi.fn(),
  dbsize: vi.fn(),
  on: vi.fn(),
};

const mockConnectionPool = {
  getMainConnection: vi.fn().mockResolvedValue(mockRedis),
};

vi.mock('../../src/queue/redis-connection-pool.js', () => ({
  getConnectionPool: vi.fn(() => mockConnectionPool),
}));

describe('RedisCache', () => {
  let cache: RedisCache;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset mock implementations
    mockRedis.status = 'ready';
    mockRedis.get.mockReset();
    mockRedis.set.mockReset();
    mockRedis.setex.mockReset();
    mockRedis.del.mockReset();
    mockRedis.getdel.mockReset();
    mockRedis.eval.mockReset();
    mockRedis.exists.mockReset();
    mockRedis.scan.mockReset();
    mockRedis.ping.mockReset();
    mockRedis.dbsize.mockReset();

    cache = new RedisCache({ keyPrefix: 'test', enableMetrics: true });
    // Wait for connection to be established
    await new Promise((resolve) => setImmediate(resolve));
  });

  describe('deletePattern', () => {
    it('should delete keys in batches to avoid memory issues', async () => {
      // Simulate 250 keys across 3 SCAN iterations
      mockRedis.scan
        .mockResolvedValueOnce(['cursor1', Array(100).fill('test:key:1')])
        .mockResolvedValueOnce(['cursor2', Array(100).fill('test:key:2')])
        .mockResolvedValueOnce(['0', Array(50).fill('test:key:3')]);

      mockRedis.del.mockResolvedValue(100).mockResolvedValueOnce(100).mockResolvedValueOnce(50);

      const deleted = await cache.deletePattern('key:*');

      // Should call del 3 times (once per batch), not once with all 250 keys
      expect(mockRedis.del).toHaveBeenCalledTimes(3);
      expect(deleted).toBe(250);

      // Verify no array accumulation - each del call should have ~100 keys max
      const firstCall = mockRedis.del.mock.calls[0];
      const secondCall = mockRedis.del.mock.calls[1];
      const thirdCall = mockRedis.del.mock.calls[2];

      expect(firstCall.length).toBe(100); // Spread of 100 keys
      expect(secondCall.length).toBe(100);
      expect(thirdCall.length).toBe(50);
    });

    it('should handle empty pattern results', async () => {
      mockRedis.scan.mockResolvedValue(['0', []]);

      const deleted = await cache.deletePattern('nonexistent:*');

      expect(deleted).toBe(0);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('should handle single batch deletion', async () => {
      mockRedis.scan.mockResolvedValue(['0', ['test:key:1', 'test:key:2', 'test:key:3']]);
      mockRedis.del.mockResolvedValue(3);

      const deleted = await cache.deletePattern('key:*');

      expect(deleted).toBe(3);
      expect(mockRedis.del).toHaveBeenCalledTimes(1);
      expect(mockRedis.del).toHaveBeenCalledWith('test:key:1', 'test:key:2', 'test:key:3');
    });

    it('should handle large number of keys without memory issues', async () => {
      // Simulate 10,000 keys across 100 iterations
      const iterations = 100;
      for (let i = 0; i < iterations - 1; i++) {
        mockRedis.scan.mockResolvedValueOnce([
          `cursor${i}`,
          Array(100)
            .fill(null)
            .map((_, idx) => `test:key:${i * 100 + idx}`),
        ]);
      }
      // Last iteration returns cursor '0'
      mockRedis.scan.mockResolvedValueOnce([
        '0',
        Array(100)
          .fill(null)
          .map((_, idx) => `test:key:${(iterations - 1) * 100 + idx}`),
      ]);

      mockRedis.del.mockResolvedValue(100);

      const deleted = await cache.deletePattern('key:*');

      // Should delete in 100 batches of 100 keys each
      expect(mockRedis.del).toHaveBeenCalledTimes(100);
      expect(deleted).toBe(10000);

      // Verify each batch is exactly 100 keys (no accumulation)
      for (const call of mockRedis.del.mock.calls) {
        expect(call.length).toBe(100);
      }
    });

    it('should continue on partial failures', async () => {
      mockRedis.scan
        .mockResolvedValueOnce(['cursor1', ['test:key:1', 'test:key:2']])
        .mockResolvedValueOnce(['0', ['test:key:3', 'test:key:4']]);

      // First batch succeeds, second fails
      mockRedis.del.mockResolvedValueOnce(2).mockRejectedValueOnce(new Error('Redis error'));

      const deleted = await cache.deletePattern('key:*');

      // Should still count first batch
      expect(deleted).toBe(2);
      expect(mockRedis.del).toHaveBeenCalledTimes(2);
    });

    it('should use correct pattern prefix', async () => {
      mockRedis.scan.mockResolvedValue(['0', ['test:user:123']]);
      mockRedis.del.mockResolvedValue(1);

      await cache.deletePattern('user:*');

      expect(mockRedis.scan).toHaveBeenCalledWith(
        expect.any(String),
        'MATCH',
        'test:user:*',
        'COUNT',
        100
      );
    });

    it('should handle SCAN errors gracefully', async () => {
      mockRedis.scan.mockRejectedValue(new Error('Connection lost'));

      const deleted = await cache.deletePattern('key:*');

      expect(deleted).toBe(0);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('should handle DEL errors gracefully and return partial count', async () => {
      mockRedis.scan
        .mockResolvedValueOnce(['cursor1', ['test:key:1']])
        .mockResolvedValueOnce(['0', ['test:key:2']]);

      mockRedis.del.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('DEL command failed'));

      const deleted = await cache.deletePattern('key:*');

      // Should return count from successful batch
      expect(deleted).toBe(1);
    });

    it('should not accumulate keys in memory during iteration', async () => {
      const memoryUsageBefore = process.memoryUsage().heapUsed;

      // Simulate many small batches
      for (let i = 0; i < 50; i++) {
        mockRedis.scan.mockResolvedValueOnce([
          `cursor${i}`,
          Array(50)
            .fill(null)
            .map((_, idx) => `test:key:${i * 50 + idx}`),
        ]);
      }
      mockRedis.scan.mockResolvedValueOnce(['0', []]);
      mockRedis.del.mockResolvedValue(50);

      await cache.deletePattern('key:*');

      const memoryUsageAfter = process.memoryUsage().heapUsed;
      const memoryGrowth = memoryUsageAfter - memoryUsageBefore;

      // Memory growth should be minimal (< 1MB) since we're not accumulating
      // This is a rough check - actual value depends on V8 GC
      expect(memoryGrowth).toBeLessThan(1024 * 1024); // Less than 1MB growth
    });

    it('should handle cursor pagination correctly', async () => {
      mockRedis.scan
        .mockResolvedValueOnce(['cursor-next', ['test:key:1']])
        .mockResolvedValueOnce(['cursor-more', ['test:key:2']])
        .mockResolvedValueOnce(['0', ['test:key:3']]); // cursor '0' ends iteration

      mockRedis.del.mockResolvedValue(1);

      const deleted = await cache.deletePattern('key:*');

      expect(deleted).toBe(3);
      expect(mockRedis.scan).toHaveBeenCalledTimes(3);

      // Verify cursor progression
      expect(mockRedis.scan).toHaveBeenNthCalledWith(1, '0', 'MATCH', 'test:key:*', 'COUNT', 100);
      expect(mockRedis.scan).toHaveBeenNthCalledWith(
        2,
        'cursor-next',
        'MATCH',
        'test:key:*',
        'COUNT',
        100
      );
      expect(mockRedis.scan).toHaveBeenNthCalledWith(
        3,
        'cursor-more',
        'MATCH',
        'test:key:*',
        'COUNT',
        100
      );
    });
  });

  describe('get', () => {
    it('should parse JSON values', async () => {
      mockRedis.get.mockResolvedValue('{"name":"test"}');

      const result = await cache.get<{ name: string }>('key');

      expect(result).toEqual({ name: 'test' });
    });

    it('should return null for non-existent keys', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await cache.get('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null for malformed JSON', async () => {
      mockRedis.get.mockResolvedValue('plain-string');

      const result = await cache.get<string>('key');

      // Returns null instead of unsafe type assertion
      expect(result).toBeNull();
    });

    it('should track metrics on hit', async () => {
      mockRedis.get.mockResolvedValue('"value"');

      await cache.get('key');

      const stats = await cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(0);
    });

    it('should track metrics on miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      await cache.get('key');

      const stats = await cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
    });
  });

  describe('getAndDelete', () => {
    it('should use native GETDEL, not a separate get+del pair', async () => {
      mockRedis.getdel.mockResolvedValue('{"name":"test"}');

      const result = await cache.getAndDelete<{ name: string }>('key');

      expect(mockRedis.getdel).toHaveBeenCalledWith('test:key');
      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(mockRedis.del).not.toHaveBeenCalled();
      expect(result).toEqual({ name: 'test' });
    });

    it('should return null for non-existent keys', async () => {
      mockRedis.getdel.mockResolvedValue(null);

      const result = await cache.getAndDelete('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null for malformed JSON', async () => {
      mockRedis.getdel.mockResolvedValue('plain-string');

      const result = await cache.getAndDelete<string>('key');

      expect(result).toBeNull();
    });

    it('should not throw on Redis errors, and should not fall back to eval for unrelated errors', async () => {
      // A generic/unrelated error (e.g. a network blip) is NOT the
      // "server doesn't support GETDEL" case - it must propagate to the
      // outer catch like every other error in this method, not trigger
      // the Lua eval fallback.
      mockRedis.getdel.mockRejectedValue(new Error('Redis down'));

      await expect(cache.getAndDelete('key')).resolves.toBeNull();
      expect(mockRedis.eval).not.toHaveBeenCalled();
    });

    it('should fall back to the Lua eval when the Redis SERVER rejects GETDEL as unknown (Redis < 6.2)', async () => {
      // ioredis exposes a `getdel` method on the client regardless of
      // which Redis server version it's talking to (it's compiled into
      // the library at build time), so `typeof redis.getdel === 'function'`
      // is always true and can't be used to detect server support. The
      // real signal is the server rejecting the command at runtime.
      mockRedis.getdel.mockRejectedValue(
        new Error("ERR unknown command 'GETDEL', with args beginning with: ")
      );
      mockRedis.eval.mockResolvedValue('{"name":"test"}');

      const result = await cache.getAndDelete<{ name: string }>('key');

      expect(mockRedis.getdel).toHaveBeenCalledWith('test:key');
      expect(mockRedis.eval).toHaveBeenCalledWith(
        "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v",
        1,
        'test:key'
      );
      expect(result).toEqual({ name: 'test' });
    });

    it('should track metrics on hit and miss', async () => {
      mockRedis.getdel.mockResolvedValueOnce('"value"').mockResolvedValueOnce(null);

      await cache.getAndDelete('key1');
      await cache.getAndDelete('key2');

      const stats = await cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it('should fall back to an atomic Lua eval when GETDEL is unavailable (Redis < 6.2)', async () => {
      // Simulate an older/self-hosted Redis where ioredis has no `getdel`
      // method at all - the capability check in the implementation must
      // detect this and use the Lua eval fallback instead, matching
      // consumePasswordResetToken()'s pattern.
      const originalGetdel = mockRedis.getdel;
      // @ts-expect-error - simulating a Redis client without GETDEL support
      delete mockRedis.getdel;
      mockRedis.eval.mockResolvedValue('{"name":"test"}');

      try {
        const result = await cache.getAndDelete<{ name: string }>('key');

        expect(mockRedis.eval).toHaveBeenCalledWith(
          "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v",
          1,
          'test:key'
        );
        expect(result).toEqual({ name: 'test' });
      } finally {
        mockRedis.getdel = originalGetdel;
      }
    });

    it('should return null via the Lua eval fallback when the key does not exist', async () => {
      const originalGetdel = mockRedis.getdel;
      // @ts-expect-error - simulating a Redis client without GETDEL support
      delete mockRedis.getdel;
      mockRedis.eval.mockResolvedValue(null);

      try {
        const result = await cache.getAndDelete('nonexistent');

        expect(mockRedis.eval).toHaveBeenCalled();
        expect(result).toBeNull();
      } finally {
        mockRedis.getdel = originalGetdel;
      }
    });
  });

  describe('set', () => {
    it('should set value with TTL', async () => {
      await cache.set('key', { data: 'test' }, 300);

      expect(mockRedis.setex).toHaveBeenCalledWith('test:key', 300, '{"data":"test"}');
    });

    it('should set value without TTL', async () => {
      await cache.set('key', 'value', 0);

      expect(mockRedis.set).toHaveBeenCalledWith('test:key', '"value"');
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('should use default TTL when not specified', async () => {
      const cacheWithDefaultTtl = new RedisCache({ defaultTtl: 600 });
      // Need to reinject mock
      vi.doMock('../../src/queue/redis-connection-pool.js', () => ({
        getConnectionPool: () => ({
          getMainConnection: vi.fn().mockResolvedValue(mockRedis),
        }),
      }));

      await cacheWithDefaultTtl.set('key', 'value');

      // Cache uses default prefix 'cache' when keyPrefix not specified
      expect(mockRedis.setex).toHaveBeenCalledWith('cache:key', 600, '"value"');
    });

    it('should not throw on Redis errors', async () => {
      mockRedis.setex.mockRejectedValue(new Error('Redis down'));

      await expect(cache.set('key', 'value', 60)).resolves.not.toThrow();
    });
  });

  describe('delete', () => {
    it('should delete key and return true', async () => {
      mockRedis.del.mockResolvedValue(1);

      const result = await cache.delete('key');

      expect(result).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith('test:key');
    });

    it('should return false when key not found', async () => {
      mockRedis.del.mockResolvedValue(0);

      const result = await cache.delete('nonexistent');

      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis error'));

      const result = await cache.delete('key');

      expect(result).toBe(false);
    });
  });

  describe('isHealthy', () => {
    it('should return true when Redis is healthy', async () => {
      mockRedis.ping.mockResolvedValue('PONG');

      const healthy = await cache.isHealthy();

      expect(healthy).toBe(true);
    });

    it('should return false when ping fails', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Connection lost'));

      const healthy = await cache.isHealthy();

      expect(healthy).toBe(false);
    });

    it('should return false when ping returns unexpected response', async () => {
      mockRedis.ping.mockResolvedValue('NOPE');

      const healthy = await cache.isHealthy();

      expect(healthy).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return statistics with size', async () => {
      mockRedis.get.mockResolvedValue('"value"');
      await cache.get('key1'); // hit
      await cache.get('key2'); // hit

      mockRedis.get.mockResolvedValue(null);
      await cache.get('key3'); // miss

      mockRedis.scan.mockResolvedValue(['0', ['test:key1', 'test:key2']]);

      const stats = await cache.getStats();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(2);
      expect(stats.hitRatio).toBeCloseTo(0.667, 2);
    });

    it('should handle SCAN errors in getStats', async () => {
      mockRedis.scan.mockRejectedValue(new Error('Scan failed'));

      const stats = await cache.getStats();

      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('resetMetrics', () => {
    it('should reset hit and miss counters', async () => {
      mockRedis.get.mockResolvedValue('"value"');
      await cache.get('key1');
      await cache.get('key2');

      let stats = await cache.getStats();
      expect(stats.hits).toBe(2);

      cache.resetMetrics();

      stats = await cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });
});
