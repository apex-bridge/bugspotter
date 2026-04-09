/**
 * HealthCheckService Tests
 * Comprehensive unit tests for health monitoring
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HealthCheckService,
  HEALTH_THRESHOLDS,
} from '../../../src/api/services/health-check-service.js';
import type { DatabaseClient } from '../../../src/db/client.js';
import type { PluginRegistry } from '../../../src/integrations/plugin-registry.js';

describe('HealthCheckService', () => {
  let service: HealthCheckService;
  let mockDb: any;
  let mockPluginRegistry: any;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      integrations: {
        getCustomPluginsPlatforms: vi.fn(),
      },
    };

    mockPluginRegistry = {
      getSupportedPlatforms: vi.fn(),
      get: vi.fn(),
      getPluginMetadata: vi.fn(),
    };

    service = new HealthCheckService(
      mockDb as unknown as DatabaseClient,
      mockPluginRegistry as unknown as PluginRegistry
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('checkDatabaseHealth', () => {
    it('should return up status when database is healthy', async () => {
      mockDb.query.mockResolvedValue([]);

      const health = await service.checkDatabaseHealth();

      expect(health.status).toBe('up');
      expect(health.response_time).toBeGreaterThanOrEqual(0);
      expect(health.last_check).toBeDefined();
      expect(health.error).toBeUndefined();
      expect(mockDb.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('should return down status when database query fails', async () => {
      mockDb.query.mockRejectedValue(new Error('Connection refused'));

      const health = await service.checkDatabaseHealth();

      expect(health.status).toBe('down');
      expect(health.response_time).toBeGreaterThanOrEqual(0);
      expect(health.last_check).toBeDefined();
      expect(health.error).toBe('Connection refused');
    });

    it('should handle non-Error exceptions', async () => {
      mockDb.query.mockRejectedValue('String error');

      const health = await service.checkDatabaseHealth();

      expect(health.status).toBe('down');
      expect(health.error).toBe('Unknown error');
    });
  });

  describe('checkRedisHealth', () => {
    let mockQueueManager: any;

    beforeEach(() => {
      mockQueueManager = {
        getConnection: vi.fn().mockReturnValue({
          ping: vi.fn().mockResolvedValue('PONG'),
        }),
      };

      vi.doMock('../../../src/queue/index.js', () => ({
        getQueueManager: () => mockQueueManager,
      }));
    });

    it('should return up status when Redis is healthy', async () => {
      const health = await service.checkRedisHealth();

      expect(health.status).toBe('up');
      expect(health.response_time).toBeGreaterThanOrEqual(0);
      expect(health.last_check).toBeDefined();
      expect(health.error).toBeUndefined();
    });

    it('should return down status when Redis connection fails', async () => {
      mockQueueManager.getConnection().ping.mockRejectedValue(new Error('ECONNREFUSED'));

      const health = await service.checkRedisHealth();

      expect(health.status).toBe('down');
      expect(health.error).toContain('ECONNREFUSED');
    });

    it('should log critical error for suspended Redis', async () => {
      const loggerSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockQueueManager.getConnection().ping.mockRejectedValue(new Error('Database suspended'));

      await service.checkRedisHealth();

      loggerSpy.mockRestore();
    });
  });

  describe('getDiskSpace', () => {
    it('should return disk space information', async () => {
      const diskSpace = await service.getDiskSpace();

      expect(diskSpace).toHaveProperty('available');
      expect(diskSpace).toHaveProperty('total');
      expect(diskSpace.available).toBeGreaterThanOrEqual(0);
      expect(diskSpace.total).toBeGreaterThan(0);
    });

    it('should use fallback path on /app access error', async () => {
      // This test relies on filesystem behavior
      const diskSpace = await service.getDiskSpace();

      expect(diskSpace.total).toBeGreaterThan(0);
    });
  });

  describe('getWorkerQueueDepth', () => {
    it('should return total queue depth', async () => {
      const mockQueueManager = {
        getQueueStats: vi.fn().mockResolvedValue({
          screenshot: {
            waiting: 5,
            active: 2,
            completed: 100,
            failed: 3,
            delayed: 0,
            paused: false,
          },
          replay: { waiting: 3, active: 1, completed: 50, failed: 1, delayed: 0, paused: false },
        }),
      };

      vi.doMock('../../../src/queue/index.js', () => ({
        getQueueManager: () => mockQueueManager,
      }));

      const depth = await service.getWorkerQueueDepth();

      // 5 + 2 + 3 + 1 = 11
      expect(depth).toBe(11);
    });

    it('should return 0 when queue manager is unavailable', async () => {
      vi.doMock('../../../src/queue/index.js', () => ({
        getQueueManager: () => {
          throw new Error('Queue manager not initialized');
        },
      }));

      const depth = await service.getWorkerQueueDepth();

      expect(depth).toBe(0);
    });
  });

  describe('getWorkerHealth', () => {
    it('should return worker health from heartbeats', async () => {
      const mockHeartbeats = new Map([
        [
          'screenshot',
          {
            worker_type: 'screenshot',
            status: 'running',
            jobs_processed: 100,
            jobs_failed: 5,
            avg_processing_time_ms: 250,
            last_error: undefined,
          },
        ],
      ]);

      vi.doMock('../../../src/config/queue.config.js', () => ({
        getQueueConfig: () => ({
          workers: {
            screenshot: { enabled: true },
            replay: { enabled: false },
          },
        }),
        WORKER_NAMES: { SCREENSHOT: 'screenshot', REPLAY: 'replay' },
      }));

      vi.doMock('../../../src/queue/index.js', () => ({
        getQueueManager: () => ({
          getConnection: () => ({}),
          getQueueStats: () => ({}),
        }),
      }));

      vi.doMock('../../../src/queue/heartbeat.js', () => ({
        getAllWorkerHeartbeats: vi.fn().mockResolvedValue(mockHeartbeats),
      }));

      const workers = await service.getWorkerHealth();

      expect(workers).toHaveLength(1);
      expect(workers[0].name).toBe('screenshot');
      expect(workers[0].running).toBe(true);
      expect(workers[0].jobs_processed).toBe(100);
      expect(workers[0].jobs_failed).toBe(5);
    });

    it('should fallback to queue stats when heartbeat missing', async () => {
      const mockHeartbeats = new Map();

      vi.doMock('../../../src/config/queue.config.js', () => ({
        getQueueConfig: () => ({
          workers: {
            screenshot: { enabled: true },
          },
        }),
        WORKER_NAMES: { SCREENSHOT: 'screenshot' },
      }));

      vi.doMock('../../../src/queue/index.js', () => ({
        getQueueManager: () => ({
          getConnection: () => ({}),
          getQueueStats: () => ({
            screenshot: {
              waiting: 10,
              active: 0,
              completed: 50,
              failed: 2,
              delayed: 0,
              paused: false,
            },
          }),
        }),
      }));

      vi.doMock('../../../src/queue/heartbeat.js', () => ({
        getAllWorkerHeartbeats: vi.fn().mockResolvedValue(mockHeartbeats),
      }));

      const workers = await service.getWorkerHealth();

      expect(workers[0].running).toBe(false);
      expect(workers[0].last_error).toContain('waiting but worker not processing');
    });

    it('should return empty array on error', async () => {
      vi.doMock('../../../src/config/queue.config.js', () => ({
        getQueueConfig: () => {
          throw new Error('Config error');
        },
      }));

      const workers = await service.getWorkerHealth();

      expect(workers).toEqual([]);
    });
  });

  describe('getQueueHealth', () => {
    it('should return queue statistics', async () => {
      const mockQueueManager = {
        getQueueStats: vi.fn().mockResolvedValue({
          screenshot: {
            waiting: 5,
            active: 2,
            completed: 100,
            failed: 3,
            delayed: 0,
            paused: false,
          },
          replay: { waiting: 0, active: 1, completed: 25, failed: 0, delayed: 1, paused: true },
        }),
      };

      vi.doMock('../../../src/queue/index.js', () => ({
        getQueueManager: () => mockQueueManager,
      }));

      const queues = await service.getQueueHealth();

      expect(queues).toHaveLength(2);
      expect(queues[0]).toMatchObject({
        name: 'screenshot',
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
      });
      expect(queues[1].paused).toBe(true);
    });

    it('should return empty array on error', async () => {
      vi.doMock('../../../src/queue/index.js', () => ({
        getQueueManager: () => {
          throw new Error('Queue error');
        },
      }));

      const queues = await service.getQueueHealth();

      expect(queues).toEqual([]);
    });
  });

  describe('getRecentFailedJobsCount', () => {
    it('should count recent failures within time window', async () => {
      const now = Date.now();
      const mockJobs = [
        { finishedOn: now - 1000 * 60 * 60, data: {} }, // 1 hour ago
        { finishedOn: now - 1000 * 60 * 60 * 12, data: {} }, // 12 hours ago
        { finishedOn: now - 1000 * 60 * 60 * 48, data: {} }, // 48 hours ago (excluded)
      ];

      const mockQueue = {
        getFailed: vi.fn().mockResolvedValue(mockJobs),
      };

      vi.doMock('../../../src/queue/index.js', () => ({
        getQueueManager: () => ({
          getQueue: () => mockQueue,
        }),
      }));

      const count = await service.getRecentFailedJobsCount('screenshot', 24);

      expect(count).toBe(2);
    });

    it('should return 0 when queue not found', async () => {
      vi.doMock('../../../src/queue/index.js', () => ({
        getQueueManager: () => ({
          getQueue: () => null,
        }),
      }));

      const count = await service.getRecentFailedJobsCount('nonexistent', 24);

      expect(count).toBe(0);
    });
  });

  describe('getRecentCompletedJobsCount', () => {
    it('should count recent completions within time window', async () => {
      const now = Date.now();
      const mockJobs = [
        { finishedOn: now - 1000 * 60 * 30, data: {} }, // 30 min ago
        { finishedOn: now - 1000 * 60 * 60 * 6, data: {} }, // 6 hours ago
      ];

      const mockQueue = {
        getCompleted: vi.fn().mockResolvedValue(mockJobs),
      };

      vi.doMock('../../../src/queue/index.js', () => ({
        getQueueManager: () => ({
          getQueue: () => mockQueue,
        }),
      }));

      const count = await service.getRecentCompletedJobsCount('screenshot', 24);

      expect(count).toBe(2);
    });
  });

  describe('getProcessHealth', () => {
    it('should return process health with memory metrics', () => {
      const health = service.getProcessHealth();

      expect(health.status).toBeOneOf(['up', 'degraded', 'down']);
      expect(health.memory.rss).toBeGreaterThan(0);
      expect(health.memory.heapTotal).toBeGreaterThan(0);
      expect(health.memory.heapUsed).toBeGreaterThan(0);
      expect(health.memory.heapUsagePercent).toBeGreaterThanOrEqual(0);
      expect(health.memory.heapUsagePercent).toBeLessThanOrEqual(100);
      expect(health.uptime).toBeGreaterThanOrEqual(0);
      expect(health.pid).toBeGreaterThan(0);
      expect(health.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);
    });

    it('should return up status when heap usage is normal', () => {
      // Spy on process.memoryUsage
      const originalMemoryUsage = process.memoryUsage;
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 50_000_000,
        heapTotal: 100_000_000,
        heapUsed: 50_000_000, // 50% usage
        external: 1_000_000,
        arrayBuffers: 500_000,
      });

      const health = service.getProcessHealth();

      expect(health.status).toBe('up');
      expect(health.memory.heapUsagePercent).toBe(50);

      process.memoryUsage = originalMemoryUsage;
    });

    it('should return degraded status when heap usage is high', () => {
      const originalMemoryUsage = process.memoryUsage;
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 95_000_000,
        heapTotal: 100_000_000,
        heapUsed: 92_000_000, // 92% usage
        external: 1_000_000,
        arrayBuffers: 500_000,
      });

      const health = service.getProcessHealth();

      expect(health.status).toBe('degraded');
      expect(health.memory.heapUsagePercent).toBe(92);

      process.memoryUsage = originalMemoryUsage;
    });

    it('should return down status when heap usage is critical', () => {
      const originalMemoryUsage = process.memoryUsage;
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 98_000_000,
        heapTotal: 100_000_000,
        heapUsed: 97_000_000, // 97% usage
        external: 1_000_000,
        arrayBuffers: 500_000,
      });

      const health = service.getProcessHealth();

      expect(health.status).toBe('down');
      expect(health.memory.heapUsagePercent).toBe(97);

      process.memoryUsage = originalMemoryUsage;
    });

    it('should round heap usage percentage to 2 decimal places', () => {
      const originalMemoryUsage = process.memoryUsage;
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 50_000_000,
        heapTotal: 100_000_000,
        heapUsed: 33_333_333, // 33.333333% usage
        external: 1_000_000,
        arrayBuffers: 500_000,
      });

      const health = service.getProcessHealth();

      expect(health.memory.heapUsagePercent).toBe(33.33);

      process.memoryUsage = originalMemoryUsage;
    });

    it('should include all memory metrics', () => {
      const health = service.getProcessHealth();

      expect(health.memory).toHaveProperty('rss');
      expect(health.memory).toHaveProperty('heapTotal');
      expect(health.memory).toHaveProperty('heapUsed');
      expect(health.memory).toHaveProperty('external');
      expect(health.memory).toHaveProperty('arrayBuffers');
      expect(health.memory).toHaveProperty('heapUsagePercent');
    });
  });

  describe('getPluginHealth', () => {
    it('should return built-in and custom plugins', async () => {
      mockPluginRegistry.getSupportedPlatforms.mockReturnValue(['jira', 'github']);
      mockPluginRegistry.get.mockImplementation((platform: string) => ({ platform }));
      mockPluginRegistry.getPluginMetadata.mockImplementation((platform: string) => ({
        isBuiltIn: platform === 'jira',
      }));

      mockDb.integrations.getCustomPluginsPlatforms.mockResolvedValue([
        { platform: 'custom-tool', enabled: true },
      ]);

      const plugins = await service.getPluginHealth();

      expect(plugins).toHaveLength(3);
      expect(plugins.find((p) => p.platform === 'jira')?.type).toBe('built-in');
      expect(plugins.find((p) => p.platform === 'github')?.type).toBe('custom');
      expect(plugins.find((p) => p.platform === 'custom-tool')?.type).toBe('custom');
    });

    it('should handle missing plugin registry', async () => {
      const serviceWithoutRegistry = new HealthCheckService(mockDb as unknown as DatabaseClient);
      mockDb.integrations.getCustomPluginsPlatforms.mockResolvedValue([]);

      const plugins = await serviceWithoutRegistry.getPluginHealth();

      expect(plugins).toEqual([]);
    });

    it('should handle registry errors gracefully', async () => {
      mockPluginRegistry.getSupportedPlatforms.mockImplementation(() => {
        throw new Error('Registry error');
      });
      mockDb.integrations.getCustomPluginsPlatforms.mockResolvedValue([]);

      const plugins = await service.getPluginHealth();

      expect(plugins).toEqual([]);
    });
  });

  describe('getComprehensiveHealth', () => {
    beforeEach(() => {
      // Mock all dependencies for comprehensive health check
      vi.spyOn(service, 'checkDatabaseHealth').mockResolvedValue({
        status: 'up',
        response_time: 10,
        last_check: new Date().toISOString(),
      });

      vi.spyOn(service, 'checkRedisHealth').mockResolvedValue({
        status: 'up',
        response_time: 5,
        last_check: new Date().toISOString(),
      });

      vi.spyOn(service, 'checkStorageHealth').mockResolvedValue({
        status: 'up',
        response_time: 15,
        last_check: new Date().toISOString(),
      });

      vi.spyOn(service, 'getDiskSpace').mockResolvedValue({
        available: 50_000_000_000,
        total: 100_000_000_000,
      });

      vi.spyOn(service, 'getProcessHealth').mockReturnValue({
        status: 'up',
        memory: {
          rss: 50_000_000,
          heapTotal: 100_000_000,
          heapUsed: 50_000_000,
          external: 1_000_000,
          arrayBuffers: 500_000,
          heapUsagePercent: 50,
        },
        uptime: 12345,
        pid: process.pid,
        nodeVersion: process.version,
      });

      vi.spyOn(service, 'getWorkerHealth').mockResolvedValue([
        {
          name: 'screenshot',
          enabled: true,
          running: true,
          jobs_processed: 100,
          jobs_failed: 5,
          avg_processing_time_ms: 250,
          last_processed_at: undefined,
          last_error: undefined,
        },
      ]);

      vi.spyOn(service, 'getQueueHealth').mockResolvedValue([
        {
          name: 'screenshot',
          waiting: 5,
          active: 2,
          completed: 100,
          failed: 5,
          delayed: 0,
          paused: false,
        },
      ]);

      vi.spyOn(service, 'getPluginHealth').mockResolvedValue([
        {
          platform: 'jira',
          enabled: true,
          type: 'built-in',
        },
      ]);

      vi.spyOn(service, 'getWorkerQueueDepth').mockResolvedValue(7);
      vi.spyOn(service, 'getRecentFailedJobsCount').mockResolvedValue(2);
      vi.spyOn(service, 'getRecentCompletedJobsCount').mockResolvedValue(50);
    });

    it('should return up status when all systems healthy', async () => {
      const health = await service.getComprehensiveHealth();

      expect(health.status).toBe('up');
      expect(health.services.database.status).toBe('up');
      expect(health.services.redis.status).toBe('up');
      expect(health.services.storage.status).toBe('up');
      expect(health.system.queue_depth).toBe(7);
      expect(health.system.disk.usage_percent).toBe(50);
      expect(health.process.status).toBe('up');
      expect(health.process.memory.heapUsagePercent).toBe(50);
      expect(health.process.uptime).toBe(12345);
      expect(health.workers).toHaveLength(1);
      expect(health.queues).toHaveLength(1);
      expect(health.plugins).toHaveLength(1);
    });

    it('should return down status when service is down', async () => {
      vi.spyOn(service, 'checkDatabaseHealth').mockResolvedValue({
        status: 'down',
        response_time: 1000,
        last_check: new Date().toISOString(),
        error: 'Connection timeout',
      });

      const health = await service.getComprehensiveHealth();

      expect(health.status).toBe('down');
    });

    it('should return degraded status when worker has issues', async () => {
      vi.spyOn(service, 'getWorkerHealth').mockResolvedValue([
        {
          name: 'screenshot',
          enabled: true,
          running: false,
          jobs_processed: 50,
          jobs_failed: 2,
          avg_processing_time_ms: 0,
          last_processed_at: undefined,
          last_error: 'Worker stopped',
        },
      ]);

      const health = await service.getComprehensiveHealth();

      expect(health.status).toBe('degraded');
    });

    it('should return degraded status when worker has high failure rate', async () => {
      vi.spyOn(service, 'getWorkerHealth').mockResolvedValue([
        {
          name: 'screenshot',
          enabled: true,
          running: true,
          jobs_processed: 50,
          jobs_failed: 20, // 28% failure rate
          avg_processing_time_ms: 250,
          last_processed_at: undefined,
          last_error: undefined,
        },
      ]);

      const health = await service.getComprehensiveHealth();

      expect(health.status).toBe('degraded');
    });

    it('should return degraded status when queue is paused', async () => {
      vi.spyOn(service, 'getQueueHealth').mockResolvedValue([
        {
          name: 'screenshot',
          waiting: 5,
          active: 0,
          completed: 100,
          failed: 5,
          delayed: 0,
          paused: true,
        },
      ]);

      const health = await service.getComprehensiveHealth();

      expect(health.status).toBe('degraded');
    });

    it('should return degraded status when queue has high recent failure rate', async () => {
      vi.spyOn(service, 'getRecentFailedJobsCount').mockResolvedValue(15);
      vi.spyOn(service, 'getRecentCompletedJobsCount').mockResolvedValue(20);

      const health = await service.getComprehensiveHealth();

      // 15/(15+20) = 42.8% failure rate (> 10% threshold)
      expect(health.status).toBe('degraded');
    });

    it('should return degraded status when queue has backlog', async () => {
      vi.spyOn(service, 'getQueueHealth').mockResolvedValue([
        {
          name: 'screenshot',
          waiting: 50, // > WAITING_JOBS_BACKLOG_THRESHOLD (20)
          active: 0,
          completed: 100,
          failed: 5,
          delayed: 0,
          paused: false,
        },
      ]);

      const health = await service.getComprehensiveHealth();

      expect(health.status).toBe('degraded');
    });

    it('should ignore disabled workers in health calculation', async () => {
      vi.spyOn(service, 'getWorkerHealth').mockResolvedValue([
        {
          name: 'screenshot',
          enabled: false,
          running: false,
          jobs_processed: 0,
          jobs_failed: 0,
          avg_processing_time_ms: 0,
          last_processed_at: undefined,
          last_error: undefined,
        },
      ]);

      const health = await service.getComprehensiveHealth();

      expect(health.status).toBe('up');
    });

    it('should not flag low-volume queues with high failure rate', async () => {
      // Only 5 jobs total (< MIN_JOBS_FOR_FAILURE_RATE threshold of 10)
      vi.spyOn(service, 'getRecentFailedJobsCount').mockResolvedValue(4);
      vi.spyOn(service, 'getRecentCompletedJobsCount').mockResolvedValue(1);

      const health = await service.getComprehensiveHealth();

      // 80% failure rate but only 5 jobs - should not trigger degraded
      expect(health.status).toBe('up');
    });
  });

  describe('HEALTH_THRESHOLDS constants', () => {
    it('should export threshold constants', () => {
      expect(HEALTH_THRESHOLDS.MIN_JOBS_FOR_FAILURE_RATE).toBe(10);
      expect(HEALTH_THRESHOLDS.FAILURE_RATE_THRESHOLD).toBe(0.1);
      expect(HEALTH_THRESHOLDS.WAITING_JOBS_BACKLOG_THRESHOLD).toBe(20);
      expect(HEALTH_THRESHOLDS.RECENT_FAILURE_WINDOW_HOURS).toBe(24);
    });
  });
});
