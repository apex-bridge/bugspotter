import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// Mock getQueueConfig before importing RedisConnectionPool
const mockRedisUrl = vi.fn<() => string>();

vi.mock('../../src/config/queue.config.js', () => ({
  getQueueConfig: () => ({
    redis: {
      url: mockRedisUrl(),
      retryDelay: 1000,
    },
  }),
}));

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock('../../src/logger.js', () => ({
  getLogger: () => mockLogger,
}));

// Import after mocks are set up
const { RedisConnectionPool } = await import('../../src/queue/redis-connection-pool.js');

describe('RedisConnectionPool retryStrategy', () => {
  beforeEach(() => {
    mockRedisUrl.mockReturnValue('redis://localhost:6379');
  });

  it('never returns null — always retries', () => {
    const pool = new RedisConnectionPool(4);
    const strategy = (pool as any).connectionConfig.retryStrategy;

    for (let attempt = 1; attempt <= 100; attempt++) {
      const result = strategy(attempt);
      expect(result).toBeTypeOf('number');
      expect(result).toBeGreaterThan(0);
    }
  });

  it('increases delay linearly and caps at 30s', () => {
    const pool = new RedisConnectionPool(4);
    const strategy = (pool as any).connectionConfig.retryStrategy;

    expect(strategy(1)).toBe(1000);
    expect(strategy(2)).toBe(2000);
    expect(strategy(5)).toBe(5000);
    expect(strategy(30)).toBe(30000);
    expect(strategy(100)).toBe(30000); // capped
    expect(strategy(999)).toBe(30000); // still capped
  });

  it('logs warn for first 5 attempts, error after', () => {
    const pool = new RedisConnectionPool(4);
    const strategy = (pool as any).connectionConfig.retryStrategy;

    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();

    for (let i = 1; i <= 5; i++) {
      strategy(i);
    }
    expect(mockLogger.warn).toHaveBeenCalledTimes(5);
    expect(mockLogger.error).toHaveBeenCalledTimes(0);

    mockLogger.warn.mockClear();
    strategy(6);
    expect(mockLogger.warn).toHaveBeenCalledTimes(0);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
  });

  it('uses config.redis.retryDelay as base multiplier', () => {
    const pool = new RedisConnectionPool(4);
    const strategy = (pool as any).connectionConfig.retryStrategy;

    // Default retryDelay is 1000 (from mock)
    expect(strategy(3)).toBe(3000);
  });
});

describe('RedisConnectionPool TLS configuration', () => {
  const originalEnv = process.env.REDIS_TLS_REJECT_UNAUTHORIZED;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.REDIS_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.REDIS_TLS_REJECT_UNAUTHORIZED = originalEnv;
    }
  });

  beforeEach(() => {
    delete process.env.REDIS_TLS_REJECT_UNAUTHORIZED;
  });

  it('sets tls: { rejectUnauthorized: true } for rediss:// URL (secure default)', () => {
    mockRedisUrl.mockReturnValue('rediss://:password@managed-redis.cloud:6380');

    const pool = new RedisConnectionPool(4);
    const config = (pool as any).connectionConfig;

    expect(config.tls).toEqual({ rejectUnauthorized: true });
  });

  it('sets tls: { rejectUnauthorized: false } when env var is "false"', () => {
    mockRedisUrl.mockReturnValue('rediss://:password@managed-redis.cloud:6380');
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED = 'false';

    const pool = new RedisConnectionPool(4);
    const config = (pool as any).connectionConfig;

    expect(config.tls).toEqual({ rejectUnauthorized: false });
  });

  it('omits tls for redis:// URL (non-TLS)', () => {
    mockRedisUrl.mockReturnValue('redis://localhost:6379');

    const pool = new RedisConnectionPool(4);
    const config = (pool as any).connectionConfig;

    expect(config.tls).toBeUndefined();
  });

  it('omits tls for redis:// even when env var is set', () => {
    mockRedisUrl.mockReturnValue('redis://localhost:6379');
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED = 'false';

    const pool = new RedisConnectionPool(4);
    const config = (pool as any).connectionConfig;

    expect(config.tls).toBeUndefined();
  });

  it('omits tls for unparseable URL (lets ioredis handle it)', () => {
    mockRedisUrl.mockReturnValue('not-a-valid-url');

    const pool = new RedisConnectionPool(4);
    const config = (pool as any).connectionConfig;

    expect(config.tls).toBeUndefined();
  });

  it('always sets lazyConnect and other base options regardless of TLS', () => {
    mockRedisUrl.mockReturnValue('rediss://:password@managed-redis.cloud:6380');

    const pool = new RedisConnectionPool(4);
    const config = (pool as any).connectionConfig;

    expect(config.lazyConnect).toBe(true);
    expect(config.maxRetriesPerRequest).toBeNull();
    expect(config.enableOfflineQueue).toBe(true);
    expect(config.connectTimeout).toBe(10000);
  });
});
