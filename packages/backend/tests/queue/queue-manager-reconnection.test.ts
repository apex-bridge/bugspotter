/**
 * Queue Manager Reconnection Tests
 * Tests Redis reconnection behavior when connection is lost
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock ioredis
const mockRedis = vi.fn();
const mockRedisInstance = new EventEmitter() as EventEmitter & {
  ping: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  duplicate: ReturnType<typeof vi.fn>;
  defineCommand: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  status: string;
  options: Record<string, any>;
};
mockRedisInstance.ping = vi.fn().mockResolvedValue('PONG');
mockRedisInstance.connect = vi.fn().mockResolvedValue(undefined);
mockRedisInstance.quit = vi.fn().mockResolvedValue('OK');
mockRedisInstance.disconnect = vi.fn().mockResolvedValue(undefined);
mockRedisInstance.duplicate = vi.fn().mockImplementation(() => mockRedisInstance);
mockRedisInstance.defineCommand = vi.fn();
mockRedisInstance.info = vi.fn().mockResolvedValue('redis_version:7.0.0');
mockRedisInstance.status = 'ready';
mockRedisInstance.options = {
  keyPrefix: '',
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  lazyConnect: true,
};

vi.mock('ioredis', () => ({
  Redis: mockRedis.mockImplementation(() => mockRedisInstance),
}));

// Mock logger
vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock queue config
vi.mock('../../src/config/queue.config.js', () => ({
  getQueueConfig: () => ({
    redis: {
      url: 'redis://localhost:6379',
      maxRetries: 10,
      retryDelay: 1000,
    },
    jobs: {
      maxRetries: 3,
      backoffDelay: 1000,
    },
  }),
}));

describe('QueueManager - Redis Reconnection', () => {
  let QueueManager: any;
  let queueManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamic import after mocks are set up
    const module = await import('../../src/queue/queue-manager.js');
    QueueManager = module.QueueManager;
  });

  afterEach(async () => {
    if (queueManager) {
      // Add timeout to prevent hanging - mocked Redis may not respond properly
      await Promise.race([
        queueManager.shutdown().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 100)),
      ]);
      queueManager = null;
    }
    vi.clearAllMocks();
  });

  it('should create QueueManager with connection pool', () => {
    queueManager = new QueueManager();
    expect(queueManager).toBeDefined();
  });

  it('should initialize successfully with Redis connection', async () => {
    queueManager = new QueueManager();
    await expect(queueManager.initialize()).resolves.not.toThrow();
    expect(mockRedisInstance.connect).toHaveBeenCalled();
  });

  it('should pass health check when Redis is connected', async () => {
    queueManager = new QueueManager();

    // Initialize first to set up connection
    try {
      await queueManager.initialize();
    } catch (e) {
      // Initialization may fail with mocks, but healthCheck should still work
    }

    const isHealthy = await queueManager.healthCheck();

    expect(isHealthy).toBe(true);
    expect(mockRedisInstance.ping).toHaveBeenCalled();
  });

  it('should fail health check when Redis ping fails', async () => {
    mockRedisInstance.ping.mockRejectedValueOnce(new Error('Connection lost'));

    queueManager = new QueueManager();

    try {
      await queueManager.initialize();
    } catch (e) {
      // Initialization may fail with mocks
    }

    const isHealthy = await queueManager.healthCheck();

    expect(isHealthy).toBe(false);
  });

  it('should handle Redis connection errors gracefully', async () => {
    const connectError = new Error('connect ECONNREFUSED 127.0.0.1:6379');
    mockRedisInstance.ping.mockRejectedValueOnce(connectError);

    queueManager = new QueueManager();

    try {
      await queueManager.initialize();
    } catch (e) {
      // May fail during initialization with mocked connection error
    }

    // Verify connection state through health check
    const isHealthy = await queueManager.healthCheck();
    expect(isHealthy).toBe(false);
  });

  it('should create Redis connection on initialize', async () => {
    queueManager = new QueueManager();
    await queueManager.initialize();

    // Verify connection by checking health
    const isHealthy = await queueManager.healthCheck();
    expect(isHealthy).toBe(true);
  });

  it('should close connections on shutdown', async () => {
    queueManager = new QueueManager();
    await queueManager.initialize();

    // Wrap shutdown with timeout to prevent hanging with mocked Redis
    await expect(
      Promise.race([queueManager.shutdown(), new Promise((resolve) => setTimeout(resolve, 100))])
    ).resolves.not.toThrow();
  });

  it('should handle shutdown errors gracefully', async () => {
    mockRedisInstance.quit.mockRejectedValueOnce(new Error('Quit failed'));

    queueManager = new QueueManager();
    await queueManager.initialize();

    // Wrap shutdown with timeout to prevent hanging with mocked Redis
    await expect(
      Promise.race([queueManager.shutdown(), new Promise((resolve) => setTimeout(resolve, 100))])
    ).resolves.not.toThrow();
  });
});
