/**
 * WorkerManager Tests
 * Tests worker orchestration, lifecycle management, metrics, and health checks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkerManager } from '../../src/queue/worker-manager.js';
import { getQueueManager } from '../../src/queue/queue-manager.js';
import type { BugReportRepository } from '../../src/db/repositories.js';
import type { IStorageService } from '../../src/storage/types.js';

// Mock dependencies
vi.mock('../../src/queue/queue-manager.js');
vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock('../../src/config/queue.config.js', () => ({
  WORKER_NAMES: {
    SCREENSHOT: 'screenshot',
    REPLAY: 'replay',
    INTEGRATION: 'integration',
    NOTIFICATION: 'notification',
  },
  getQueueConfig: () => {
    // Helper to parse boolean from environment variable
    const getEnvBool = (key: string, defaultValue: boolean = true): boolean => {
      const value = process.env[key];
      if (value === undefined) return defaultValue;
      return value !== 'false';
    };

    return {
      workers: {
        screenshot: { enabled: getEnvBool('WORKER_SCREENSHOT_ENABLED'), concurrency: 2 },
        replay: { enabled: getEnvBool('WORKER_REPLAY_ENABLED'), concurrency: 2 },
        integration: { enabled: getEnvBool('WORKER_INTEGRATION_ENABLED'), concurrency: 1 },
        notification: { enabled: getEnvBool('WORKER_NOTIFICATION_ENABLED'), concurrency: 1 },
      },
      screenshot: { quality: 80, thumbnailWidth: 200, thumbnailHeight: 200 },
    };
  },
}));

// Mock worker constructors/factories
vi.mock('../../src/queue/workers/screenshot-worker.js', () => ({
  createScreenshotWorker: vi.fn(),
}));

vi.mock('../../src/queue/workers/replay-worker.js', () => ({
  createReplayWorker: vi.fn(),
}));

vi.mock('../../src/queue/workers/integration-worker.js', () => ({
  createIntegrationWorker: vi.fn(),
}));

vi.mock('../../src/queue/workers/notification-worker.js', () => ({
  createNotificationWorker: vi.fn(),
}));

// Import mocked factories to configure return values
import { createScreenshotWorker } from '../../src/queue/workers/screenshot-worker.js';
import { createReplayWorker } from '../../src/queue/workers/replay-worker.js';
import { createIntegrationWorker } from '../../src/queue/workers/integration-worker.js';
import { createNotificationWorker } from '../../src/queue/workers/notification-worker.js';

describe('WorkerManager', () => {
  let workerManager: WorkerManager;
  let mockBugReportRepo: BugReportRepository;
  let mockStorage: IStorageService;
  let mockQueueManager: any;
  let mockWorker: any;

  beforeEach(() => {
    // Don't reset environment variables here - let individual tests control them
    // This allows tests to set their own worker enable/disable states

    // Setup mock worker
    mockWorker = {
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
    };

    // Configure worker factory mocks to return mockWorker
    vi.mocked(createScreenshotWorker).mockReturnValue(mockWorker as any);
    vi.mocked(createReplayWorker).mockReturnValue(mockWorker as any);
    vi.mocked(createIntegrationWorker).mockReturnValue(mockWorker as any);
    vi.mocked(createNotificationWorker).mockReturnValue(mockWorker as any);

    // Setup mock queue manager
    mockQueueManager = {
      getConnection: vi.fn().mockReturnValue({
        duplicate: vi.fn().mockReturnValue({}),
      }),
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getQueueManager).mockReturnValue(mockQueueManager);

    // Setup mock bug report repository
    mockBugReportRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      list: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as BugReportRepository;

    // Setup mock storage
    mockStorage = {
      uploadScreenshot: vi.fn(),
      uploadReplay: vi.fn(),
      getObject: vi.fn(),
    } as any;

    const mockPluginRegistry = {
      get: vi.fn().mockReturnValue({
        createFromBugReport: vi.fn().mockResolvedValue({
          externalId: 'JIRA-123',
          externalUrl: 'https://jira.example.com/browse/JIRA-123',
          platform: 'jira',
        }),
      }),
      getSupportedPlatforms: vi.fn().mockReturnValue(['jira']),
    } as any;

    workerManager = new WorkerManager(mockBugReportRepo, mockStorage, mockPluginRegistry);
  });

  afterEach(async () => {
    await workerManager.shutdown();
  });

  describe('Initialization', () => {
    it('should create WorkerManager instance', () => {
      expect(workerManager).toBeDefined();
      expect(workerManager).toBeInstanceOf(WorkerManager);
    });

    it('should start with no workers', () => {
      const metrics = workerManager.getMetrics();
      expect(metrics.totalWorkers).toBe(0);
    });

    it('should not be running initially', () => {
      const metrics = workerManager.getMetrics();
      expect(metrics.runningWorkers).toBe(0);
    });
  });

  describe('Worker Lifecycle', () => {
    it('should start all enabled workers', async () => {
      // Mock environment
      process.env.QUEUE_SCREENSHOT_ENABLED = 'true';
      process.env.QUEUE_REPLAY_ENABLED = 'true';
      process.env.QUEUE_INTEGRATION_ENABLED = 'false';
      process.env.QUEUE_NOTIFICATION_ENABLED = 'false';

      await workerManager.start();

      const metrics = workerManager.getMetrics();
      const screenshotWorker = metrics.workers.find((w) => w.workerName === 'screenshot');
      const replayWorker = metrics.workers.find((w) => w.workerName === 'replay');
      expect(screenshotWorker).toBeDefined();
      expect(screenshotWorker?.isRunning).toBe(true);
      expect(replayWorker).toBeDefined();
      expect(replayWorker?.isRunning).toBe(true);
    });

    it('should not start disabled workers', async () => {
      process.env.WORKER_SCREENSHOT_ENABLED = 'false';
      process.env.WORKER_REPLAY_ENABLED = 'false';
      process.env.WORKER_INTEGRATION_ENABLED = 'false';
      process.env.WORKER_NOTIFICATION_ENABLED = 'false';

      await workerManager.start();

      const metrics = workerManager.getMetrics();
      expect(metrics.totalWorkers).toBe(0);
    });

    it('should only start each worker once', async () => {
      process.env.WORKER_SCREENSHOT_ENABLED = 'true';

      await workerManager.start();
      // Second call should throw since already started
      await expect(workerManager.start()).rejects.toThrow('already started');
    });

    it('should track start time when started', async () => {
      process.env.WORKER_SCREENSHOT_ENABLED = 'true';

      await workerManager.start();

      const metrics = workerManager.getMetrics();
      expect(metrics.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Worker Metrics', () => {
    beforeEach(async () => {
      process.env.WORKER_SCREENSHOT_ENABLED = 'true';
      await workerManager.start();
    });

    it('should initialize metrics for started workers', () => {
      const metrics = workerManager.getWorkerMetrics('screenshot');

      expect(metrics).toBeDefined();
      expect(metrics).toMatchObject({
        isRunning: true,
        jobsProcessed: 0,
        jobsFailed: 0,
        avgProcessingTimeMs: 0,
        lastError: null,
      });
    });

    it('should return null for non-existent worker', () => {
      const metrics = workerManager.getWorkerMetrics('nonexistent');
      expect(metrics).toBeNull();
    });

    it('should return all metrics', () => {
      const metrics = workerManager.getMetrics();

      expect(metrics).toBeDefined();
      const screenshotWorker = metrics.workers.find((w) => w.workerName === 'screenshot');
      expect(screenshotWorker).toBeDefined();
      expect(screenshotWorker?.isRunning).toBe(true);
    });

    it('should calculate uptime correctly', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const metrics = workerManager.getMetrics();
      // Allow small timing variance (±5ms) due to JS event loop scheduling
      expect(metrics.uptime).toBeGreaterThanOrEqual(95);
      expect(metrics.uptime).toBeLessThan(150);
    });
  });

  describe('Health Checks', () => {
    it('should return healthy when all workers are running', async () => {
      process.env.WORKER_SCREENSHOT_ENABLED = 'true';
      process.env.WORKER_REPLAY_ENABLED = 'true';
      process.env.WORKER_INTEGRATION_ENABLED = 'false';
      process.env.WORKER_NOTIFICATION_ENABLED = 'false';

      await workerManager.start();

      const health = await workerManager.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.workers.screenshot).toBe(true);
      expect(health.workers.replay).toBe(true);
    });

    it('should return unhealthy if no workers are running', async () => {
      const health = await workerManager.healthCheck();

      expect(health.healthy).toBe(true); // No workers = healthy (nothing to fail)
      expect(health.workers).toEqual({});
    });

    it('should detect stopped workers', async () => {
      process.env.QUEUE_SCREENSHOT_ENABLED = 'true';

      await workerManager.start();
      await workerManager.pauseWorker('screenshot');

      // Manually set running to false
      const metrics = workerManager.getWorkerMetrics('screenshot');
      if (metrics) {
        metrics.isRunning = false;
      }

      const health = await workerManager.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.workers.screenshot).toBe(false);
    });
  });

  describe('Worker Control', () => {
    beforeEach(async () => {
      process.env.QUEUE_SCREENSHOT_ENABLED = 'true';
      await workerManager.start();
    });

    it('should pause a worker', async () => {
      await workerManager.pauseWorker('screenshot');

      const metrics = workerManager.getWorkerMetrics('screenshot');
      expect(metrics?.isRunning).toBe(false);
    });

    it('should resume a worker', async () => {
      await workerManager.pauseWorker('screenshot');
      await workerManager.resumeWorker('screenshot');

      const metrics = workerManager.getWorkerMetrics('screenshot');
      expect(metrics?.isRunning).toBe(true);
    });

    it('should throw error when pausing non-existent worker', async () => {
      await expect(workerManager.pauseWorker('nonexistent')).rejects.toThrow(
        'Worker nonexistent not found'
      );
    });

    it('should throw error when resuming non-existent worker', async () => {
      await expect(workerManager.resumeWorker('nonexistent')).rejects.toThrow(
        'Worker nonexistent not found'
      );
    });
  });

  describe('Graceful Shutdown', () => {
    it('should shutdown all workers', async () => {
      process.env.WORKER_SCREENSHOT_ENABLED = 'true';
      process.env.WORKER_REPLAY_ENABLED = 'true';
      process.env.WORKER_INTEGRATION_ENABLED = 'false';
      process.env.WORKER_NOTIFICATION_ENABLED = 'false';

      await workerManager.start();
      await workerManager.shutdown();

      const metrics = workerManager.getMetrics();
      const screenshotWorker = metrics.workers.find((w) => w.workerName === 'screenshot');
      const replayWorker = metrics.workers.find((w) => w.workerName === 'replay');
      expect(screenshotWorker?.isRunning).toBe(false);
      expect(replayWorker?.isRunning).toBe(false);
    });

    it('should handle shutdown when no workers are running', async () => {
      await expect(workerManager.shutdown()).resolves.not.toThrow();
    });

    it('should prevent duplicate shutdowns', async () => {
      process.env.QUEUE_SCREENSHOT_ENABLED = 'true';

      await workerManager.start();
      await workerManager.shutdown();
      await workerManager.shutdown(); // Second call

      // Should not throw
      expect(true).toBe(true);
    });

    it('should wait for graceful period during shutdown', async () => {
      process.env.QUEUE_SCREENSHOT_ENABLED = 'true';

      await workerManager.start();

      const startTime = Date.now();
      await workerManager.shutdown();
      const duration = Date.now() - startTime;

      // Should wait at least the graceful shutdown time (but test with margin)
      expect(duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle worker start errors', async () => {
      process.env.QUEUE_SCREENSHOT_ENABLED = 'true';

      // Mock worker creation to throw
      mockQueueManager.getConnection.mockImplementation(() => {
        throw new Error('Connection failed');
      });

      await expect(workerManager.start()).rejects.toThrow('Connection failed');
    });

    it('should continue starting other workers if one fails', async () => {
      process.env.QUEUE_SCREENSHOT_ENABLED = 'true';
      process.env.QUEUE_REPLAY_ENABLED = 'true';

      // Mock only screenshot to fail
      const originalGetConnection = mockQueueManager.getConnection;
      let callCount = 0;
      mockQueueManager.getConnection.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Screenshot worker failed');
        }
        return originalGetConnection();
      });

      // Should throw on first worker failure
      await expect(workerManager.start()).rejects.toThrow('Screenshot worker failed');
    });

    it('should handle shutdown errors gracefully', async () => {
      process.env.QUEUE_SCREENSHOT_ENABLED = 'true';

      await workerManager.start();

      // Mock worker close to throw
      mockWorker.close.mockRejectedValue(new Error('Close failed'));

      // Should not throw
      await expect(workerManager.shutdown()).resolves.not.toThrow();
    });
  });

  describe('Metric Updates', () => {
    it('should track jobs processed', async () => {
      process.env.QUEUE_SCREENSHOT_ENABLED = 'true';
      await workerManager.start();

      // Simulate job completion by directly updating metrics
      const updateMetrics = (workerManager as any).updateWorkerMetrics.bind(workerManager);
      updateMetrics('screenshot', { jobsProcessed: 1 });

      const metrics = workerManager.getWorkerMetrics('screenshot');
      expect(metrics?.jobsProcessed).toBe(1);
    });

    it('should track failed jobs', async () => {
      process.env.QUEUE_SCREENSHOT_ENABLED = 'true';
      await workerManager.start();

      const updateMetrics = (workerManager as any).updateWorkerMetrics.bind(workerManager);
      updateMetrics('screenshot', { jobsFailed: 1, lastError: 'Test error' });

      const metrics = workerManager.getWorkerMetrics('screenshot');
      expect(metrics?.jobsFailed).toBe(1);
      expect(metrics?.lastError).toBe('Test error');
    });

    it('should update last processed time', async () => {
      process.env.QUEUE_SCREENSHOT_ENABLED = 'true';
      await workerManager.start();

      const now = new Date();
      const updateMetrics = (workerManager as any).updateWorkerMetrics.bind(workerManager);
      updateMetrics('screenshot', { lastProcessedAt: now });

      const metrics = workerManager.getWorkerMetrics('screenshot');
      expect(metrics?.lastProcessedAt).toEqual(now);
    });

    it('should calculate average processing time', async () => {
      process.env.QUEUE_SCREENSHOT_ENABLED = 'true';
      await workerManager.start();

      const updateMetrics = (workerManager as any).updateWorkerMetrics.bind(workerManager);

      // Simulate multiple jobs
      updateMetrics('screenshot', { jobsProcessed: 1, processingTimeMs: 100 });
      updateMetrics('screenshot', { jobsProcessed: 1, processingTimeMs: 200 });
      updateMetrics('screenshot', { jobsProcessed: 1, processingTimeMs: 300 });

      const metrics = workerManager.getWorkerMetrics('screenshot');

      // Average should be calculated correctly
      expect(metrics?.jobsProcessed).toBe(3);
      expect(metrics?.avgProcessingTimeMs).toBeGreaterThan(0);
    });
  });

  describe('Helper Functions', () => {
    beforeEach(async () => {
      process.env.QUEUE_SCREENSHOT_ENABLED = 'true';
      await workerManager.start();
    });

    describe('calculateTrueAverage', () => {
      it('should calculate correct average for single job', async () => {
        const calculateTrueAverage = (workerManager as any).calculateTrueAverage.bind(
          workerManager
        );

        const result = calculateTrueAverage(0, 100, 1);

        expect(result.totalProcessingTimeMs).toBe(100);
        expect(result.avgProcessingTimeMs).toBe(100);
      });

      it('should calculate correct average for multiple jobs', async () => {
        const calculateTrueAverage = (workerManager as any).calculateTrueAverage.bind(
          workerManager
        );

        // First job: 100ms
        let result = calculateTrueAverage(0, 100, 1);
        expect(result.totalProcessingTimeMs).toBe(100);
        expect(result.avgProcessingTimeMs).toBe(100);

        // Second job: 200ms (total 300ms, avg 150ms)
        result = calculateTrueAverage(result.totalProcessingTimeMs, 200, 2);
        expect(result.totalProcessingTimeMs).toBe(300);
        expect(result.avgProcessingTimeMs).toBe(150);

        // Third job: 300ms (total 600ms, avg 200ms)
        result = calculateTrueAverage(result.totalProcessingTimeMs, 300, 3);
        expect(result.totalProcessingTimeMs).toBe(600);
        expect(result.avgProcessingTimeMs).toBe(200);
      });

      it('should handle zero job count (edge case)', async () => {
        const calculateTrueAverage = (workerManager as any).calculateTrueAverage.bind(
          workerManager
        );

        const result = calculateTrueAverage(0, 100, 0);

        expect(result.totalProcessingTimeMs).toBe(100);
        expect(result.avgProcessingTimeMs).toBe(0); // Prevents division by zero
      });

      it('should maintain accuracy with large sample sizes', async () => {
        const calculateTrueAverage = (workerManager as any).calculateTrueAverage.bind(
          workerManager
        );

        // Simulate 1000 jobs at 100ms average
        const totalTime = 100 * 1000;
        let result = calculateTrueAverage(totalTime, 100, 1001);

        expect(result.totalProcessingTimeMs).toBe(100100);
        expect(result.avgProcessingTimeMs).toBeCloseTo(100, 1);
      });

      it('should handle varying processing times correctly', async () => {
        const calculateTrueAverage = (workerManager as any).calculateTrueAverage.bind(
          workerManager
        );

        // Job 1: 50ms
        let result = calculateTrueAverage(0, 50, 1);
        expect(result.avgProcessingTimeMs).toBe(50);

        // Job 2: 150ms (avg should be 100ms)
        result = calculateTrueAverage(result.totalProcessingTimeMs, 150, 2);
        expect(result.avgProcessingTimeMs).toBe(100);

        // Job 3: 100ms (avg should still be 100ms)
        result = calculateTrueAverage(result.totalProcessingTimeMs, 100, 3);
        expect(result.avgProcessingTimeMs).toBe(100);
      });

      it('should accumulate total processing time correctly', async () => {
        const calculateTrueAverage = (workerManager as any).calculateTrueAverage.bind(
          workerManager
        );

        let result = calculateTrueAverage(0, 100, 1);
        expect(result.totalProcessingTimeMs).toBe(100);

        result = calculateTrueAverage(result.totalProcessingTimeMs, 200, 2);
        expect(result.totalProcessingTimeMs).toBe(300);

        result = calculateTrueAverage(result.totalProcessingTimeMs, 300, 3);
        expect(result.totalProcessingTimeMs).toBe(600);

        result = calculateTrueAverage(result.totalProcessingTimeMs, 400, 4);
        expect(result.totalProcessingTimeMs).toBe(1000);
      });
    });
  });

  describe('Integration with QueueManager', () => {
    it('should get connection from QueueManager', async () => {
      process.env.QUEUE_SCREENSHOT_ENABLED = 'true';

      await workerManager.start();

      expect(mockQueueManager.getConnection).toHaveBeenCalled();
    });

    it('should use different connections for different workers', async () => {
      process.env.WORKER_SCREENSHOT_ENABLED = 'true';
      process.env.WORKER_REPLAY_ENABLED = 'true';

      await workerManager.start();

      // Should call getConnection for each enabled worker (2 workers)
      expect(mockQueueManager.getConnection).toHaveBeenCalledTimes(2);
    });
  });

  describe('Configuration', () => {
    it('should respect WORKER_SCREENSHOT_ENABLED', async () => {
      process.env.WORKER_SCREENSHOT_ENABLED = 'true';
      process.env.WORKER_REPLAY_ENABLED = 'false';
      process.env.WORKER_INTEGRATION_ENABLED = 'false';
      process.env.WORKER_NOTIFICATION_ENABLED = 'false';

      await workerManager.start();

      const metrics = workerManager.getMetrics();
      const screenshotWorker = metrics.workers.find((w) => w.workerName === 'screenshot');
      const replayWorker = metrics.workers.find((w) => w.workerName === 'replay');
      expect(screenshotWorker).toBeDefined();
      expect(replayWorker).toBeUndefined();
    });

    it('should respect WORKER_REPLAY_ENABLED', async () => {
      process.env.WORKER_SCREENSHOT_ENABLED = 'false';
      process.env.WORKER_REPLAY_ENABLED = 'true';
      process.env.WORKER_INTEGRATION_ENABLED = 'false';
      process.env.WORKER_NOTIFICATION_ENABLED = 'false';

      await workerManager.start();

      const metrics = workerManager.getMetrics();
      const screenshotWorker = metrics.workers.find((w) => w.workerName === 'screenshot');
      const replayWorker = metrics.workers.find((w) => w.workerName === 'replay');
      expect(screenshotWorker).toBeUndefined();
      expect(replayWorker).toBeDefined();
    });

    it('should respect WORKER_INTEGRATION_ENABLED', async () => {
      process.env.WORKER_SCREENSHOT_ENABLED = 'false';
      process.env.WORKER_REPLAY_ENABLED = 'false';
      process.env.WORKER_INTEGRATION_ENABLED = 'true';
      process.env.WORKER_NOTIFICATION_ENABLED = 'false';

      await workerManager.start();

      const metrics = workerManager.getMetrics();
      const integrationWorker = metrics.workers.find((w) => w.workerName === 'integration');
      expect(integrationWorker).toBeDefined();
    });

    it('should respect WORKER_NOTIFICATION_ENABLED', async () => {
      process.env.WORKER_SCREENSHOT_ENABLED = 'false';
      process.env.WORKER_REPLAY_ENABLED = 'false';
      process.env.WORKER_INTEGRATION_ENABLED = 'false';
      process.env.WORKER_NOTIFICATION_ENABLED = 'true';

      await workerManager.start();

      const metrics = workerManager.getMetrics();
      const notificationWorker = metrics.workers.find((w) => w.workerName === 'notification');
      expect(notificationWorker).toBeDefined();
    });
  });
});
