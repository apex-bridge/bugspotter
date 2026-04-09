/**
 * QueueManager Tests
 * Tests for QueueManager initialization, job operations, and queue management
 *
 * Note: These are unit tests with mocked Redis. Integration tests with real Redis
 * should be added in tests/integration/queue.integration.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueueManager } from '../../src/queue/queue-manager.js';
import type { ScreenshotJobData } from '../../src/queue/types.js';

// Mock ioredis
vi.mock('ioredis', () => {
  const createMockRedis = () => ({
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn().mockResolvedValue(undefined),
    duplicate: vi.fn().mockImplementation(() => createMockRedis()),
    status: 'ready',
  });

  return {
    Redis: vi.fn().mockImplementation(() => createMockRedis()),
  };
});

// Mock BullMQ
vi.mock('bullmq', () => {
  const mockJob = {
    id: 'test-job-id',
    name: 'test-job',
    data: { test: 'data' },
    progress: 0,
    returnvalue: null,
    failedReason: null,
    stacktrace: null,
    attemptsMade: 0,
    timestamp: Date.now(),
    processedOn: null,
    finishedOn: null,
    getState: vi.fn().mockResolvedValue('waiting'),
  };

  return {
    Queue: vi.fn().mockImplementation(() => ({
      add: vi.fn().mockResolvedValue(mockJob),
      getJob: vi.fn().mockResolvedValue(mockJob),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      isPaused: vi.fn().mockResolvedValue(false),
      getJobCounts: vi.fn().mockResolvedValue({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
      }),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    })),
    QueueEvents: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('QueueManager', () => {
  let queueManager: QueueManager;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Create fresh QueueManager instance (constructor takes no args, uses config)
    queueManager = new QueueManager();
  });

  afterEach(async () => {
    // Cleanup after each test
    if (queueManager) {
      await queueManager.shutdown();
    }
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await expect(queueManager.initialize()).resolves.not.toThrow();
    });

    it('should create all 8 queues', async () => {
      await queueManager.initialize();

      // Verify queues are created (via mocked Queue constructor)
      const Queue = await import('bullmq').then((m) => m.Queue);
      expect(Queue).toHaveBeenCalledTimes(8);
    });

    it('should allow reinitialization (idempotent)', async () => {
      await queueManager.initialize();

      // Second initialization should not throw - it's idempotent
      await expect(queueManager.initialize()).resolves.not.toThrow();
    });
  });

  describe('addJob()', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    it('should add job to queue', async () => {
      const jobData: ScreenshotJobData = {
        bugReportId: 'bug-123',
        projectId: 'proj-456',
        screenshotKey: 'screenshots/proj-456/bug-123/screenshot.png',
      };

      const jobId = await queueManager.addJob('screenshots', 'process-screenshot', jobData);

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
      expect(jobId).toBe('test-job-id');
    });

    it('should accept job options', async () => {
      const jobData: ScreenshotJobData = {
        bugReportId: 'bug-123',
        projectId: 'proj-456',
        screenshotKey: 'screenshots/proj-456/bug-123/screenshot.png',
      };

      const jobId = await queueManager.addJob('screenshots', 'process-screenshot', jobData, {
        priority: 1,
        delay: 5000,
      });

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
    });

    it('should throw if queue not initialized', async () => {
      const uninitializedManager = new QueueManager();

      await expect(uninitializedManager.addJob('screenshots', 'test', {})).rejects.toThrow();
    });

    it('should throw for invalid queue name', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(queueManager.addJob('invalid-queue' as any, 'test', {})).rejects.toThrow(
        'not registered'
      );
    });
  });

  describe('getJob()', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    it('should retrieve job by ID', async () => {
      const job = await queueManager.getJob('screenshots', 'test-job-id');

      expect(job).toBeDefined();
      expect(job?.id).toBe('test-job-id');
    });

    it('should return null for non-existent job', async () => {
      // Mock the queue's getJob to return null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const queue = (queueManager as any).broker.getRawQueue('screenshots');
      vi.spyOn(queue, 'getJob').mockResolvedValue(null);

      const job = await queueManager.getJob('screenshots', 'non-existent-id');

      expect(job).toBeNull();
    });
  });

  describe('getJobStatus()', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    it('should return job status', async () => {
      const status = await queueManager.getJobStatus('screenshots', 'test-job-id');

      expect(status).toBeDefined();
      expect(typeof status).toBe('string');
      expect(status).toBe('waiting');
    });

    it('should return null for non-existent job', async () => {
      // Mock the queue's getJob to return null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const queue = (queueManager as any).broker.getRawQueue('screenshots');
      vi.spyOn(queue, 'getJob').mockResolvedValue(null);

      const status = await queueManager.getJobStatus('screenshots', 'non-existent-id');
      expect(status).toBeNull();
    });
  });

  describe('getQueueMetrics()', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    it('should return queue metrics', async () => {
      const metrics = await queueManager.getQueueMetrics('screenshots');

      expect(metrics).toBeDefined();
      expect(metrics.waiting).toBe(5);
      expect(metrics.active).toBe(2);
      expect(metrics.completed).toBe(100);
      expect(metrics.failed).toBe(3);
      expect(metrics.delayed).toBe(1);
      expect(metrics.paused).toBe(false);
    });
  });

  describe('getQueueStats()', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    it('should return stats for all queues', async () => {
      const stats = await queueManager.getQueueStats();

      expect(stats).toBeDefined();
      expect(Object.keys(stats)).toHaveLength(8);
      expect(Object.keys(stats)).toEqual(
        expect.arrayContaining([
          'screenshots',
          'replays',
          'integrations',
          'notifications',
          'outbox',
          'payments',
          'payment-events',
          'intelligence',
        ])
      );
    });
  });

  describe('pauseQueue() / resumeQueue()', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    it('should pause queue', async () => {
      await expect(queueManager.pauseQueue('screenshots')).resolves.not.toThrow();
    });

    it('should resume queue', async () => {
      await expect(queueManager.resumeQueue('screenshots')).resolves.not.toThrow();
    });
  });

  describe('healthCheck()', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    it('should return true for healthy Redis connection', async () => {
      const healthy = await queueManager.healthCheck();
      expect(healthy).toBe(true);
    });

    it('should return false for failed ping', async () => {
      // Override connection ping to fail
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const connection = (queueManager as any).connection;
      vi.spyOn(connection, 'ping').mockRejectedValue(new Error('Connection failed'));

      const healthy = await queueManager.healthCheck();
      expect(healthy).toBe(false);
    });
  });

  describe('shutdown()', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    it('should shutdown gracefully', async () => {
      await expect(queueManager.shutdown()).resolves.not.toThrow();
    });

    it('should close Redis connection', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const connection = (queueManager as any).connection;
      const quitSpy = vi.spyOn(connection, 'quit');

      // Mock connection status as 'ready' so quit() is called
      connection.status = 'ready';

      await queueManager.shutdown();

      expect(quitSpy).toHaveBeenCalled();
    });

    it('should close all queues', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const broker = (queueManager as any).broker;
      const shutdownSpy = vi.spyOn(broker, 'shutdown').mockResolvedValue(undefined);

      await queueManager.shutdown();

      expect(shutdownSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle shutdown errors gracefully', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const connection = (queueManager as any).connection;
      // Replace quit with a failing implementation
      const quitSpy = vi.spyOn(connection, 'quit').mockImplementation(() => {
        return Promise.reject(new Error('Quit failed'));
      });

      // Mock connection status as 'ready' so quit() is attempted
      connection.status = 'ready';

      // Shutdown now catches errors and completes gracefully
      await expect(queueManager.shutdown()).resolves.not.toThrow();
      expect(quitSpy).toHaveBeenCalled();

      // Restore original implementation so afterEach doesn't fail
      quitSpy.mockRestore();
    });
  });

  describe('singleton pattern', () => {
    it('should return same instance from getQueueManager()', async () => {
      const { getQueueManager } = await import('../../src/queue/queue-manager.js');

      const instance1 = getQueueManager();
      const instance2 = getQueueManager();

      expect(instance1).toBe(instance2);
    });
  });
});
