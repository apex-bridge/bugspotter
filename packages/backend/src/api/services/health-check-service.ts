/**
 * Health Check Service
 * Centralized health monitoring for all system components
 */

import type { DatabaseClient } from '../../db/client.js';
import type { WorkerHealth, QueueHealth, PluginHealth, ServiceHealth } from '@bugspotter/types';
import type { QueueName } from '../../queue/index.js';
import { getLogger } from '../../logger.js';
import { config } from '../../config.js';
import fs from 'fs/promises';

const logger = getLogger();

/**
 * Health check thresholds for determining system issues
 */
export const HEALTH_THRESHOLDS = {
  MIN_JOBS_FOR_FAILURE_RATE: 10,
  FAILURE_RATE_THRESHOLD: 0.1,
  WAITING_JOBS_BACKLOG_THRESHOLD: 20,
  RECENT_FAILURE_WINDOW_HOURS: 24,
} as const;

export type HealthStatus = 'up' | 'degraded' | 'down';

export interface ProcessHealth {
  status: HealthStatus;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
    heapUsagePercent: number;
  };
  uptime: number;
  pid: number;
  nodeVersion: string;
}

export interface ComprehensiveHealth {
  status: HealthStatus;
  services: {
    database: ServiceHealth;
    redis: ServiceHealth;
    storage: ServiceHealth;
  };
  system: {
    disk: {
      available: number;
      total: number;
      usage_percent: number;
    };
    queue_depth: number;
  };
  process: ProcessHealth;
  workers: WorkerHealth[];
  queues: QueueHealth[];
  plugins: PluginHealth[];
}

export class HealthCheckService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly pluginRegistry?: import('../../integrations/plugin-registry.js').PluginRegistry
  ) {}

  /**
   * Check database health
   */
  async checkDatabaseHealth(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      await this.db.query('SELECT 1');
      return {
        status: 'up',
        response_time: Date.now() - start,
        last_check: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'down',
        response_time: Date.now() - start,
        last_check: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check Redis health
   */
  async checkRedisHealth(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      const { getQueueManager } = await import('../../queue/index.js');
      const queueManager = getQueueManager();

      await queueManager.getConnection().ping();

      return {
        status: 'up',
        response_time: Date.now() - start,
        last_check: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('suspended') || errorMessage.includes('ECONNREFUSED')) {
        logger.error('[CRITICAL] Redis service unavailable:', {
          error: errorMessage,
          timestamp: new Date().toISOString(),
          message: errorMessage.includes('suspended')
            ? 'Redis database has been suspended - check provider dashboard'
            : 'Redis connection refused - service may be down',
        });
      }

      return {
        status: 'down',
        response_time: Date.now() - start,
        last_check: new Date().toISOString(),
        error: errorMessage,
      };
    }
  }

  /**
   * Check storage health
   */
  async checkStorageHealth(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      if (config.storage.backend === 'local') {
        await fs.access(config.storage.local.baseDirectory);
      } else {
        const { createStorageFromEnv } = await import('../../storage/index.js');
        const storage = createStorageFromEnv();
        const healthy = await storage.healthCheck();

        if (!healthy) {
          throw new Error('Storage health check failed');
        }
      }

      return {
        status: 'up',
        response_time: Date.now() - start,
        last_check: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'down',
        response_time: Date.now() - start,
        last_check: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get disk space information
   */
  async getDiskSpace(): Promise<{ available: number; total: number }> {
    try {
      const diskUsage = await fs.statfs('/app');
      return {
        available: diskUsage.bavail * diskUsage.bsize,
        total: diskUsage.blocks * diskUsage.bsize,
      };
    } catch {
      const fallbackPath = process.cwd();
      const diskUsage = await fs.statfs(fallbackPath);
      return {
        available: diskUsage.bavail * diskUsage.bsize,
        total: diskUsage.blocks * diskUsage.bsize,
      };
    }
  }

  /**
   * Get total worker queue depth across all queues
   */
  async getWorkerQueueDepth(): Promise<number> {
    try {
      const { getQueueManager } = await import('../../queue/index.js');
      const queueManager = getQueueManager();
      const stats = await queueManager.getQueueStats();

      return Object.values(stats).reduce(
        (total, queueMetrics) => total + queueMetrics.waiting + queueMetrics.active,
        0
      );
    } catch {
      return 0;
    }
  }

  /**
   * Get worker health status
   */
  async getWorkerHealth(): Promise<WorkerHealth[]> {
    try {
      const { getQueueConfig, WORKER_NAMES } = await import('../../config/queue.config.js');
      const { getQueueManager } = await import('../../queue/index.js');
      const { getAllWorkerHeartbeats } = await import('../../queue/heartbeat.js');

      const queueConfig = getQueueConfig();
      const queueManager = getQueueManager();
      const connection = queueManager.getConnection();

      const workerTypes = Object.values(WORKER_NAMES);
      const heartbeats = await getAllWorkerHeartbeats(connection, [...workerTypes]);
      const queueStats = await queueManager.getQueueStats();

      const workers: WorkerHealth[] = workerTypes
        .filter((workerType) => queueConfig.workers[workerType].enabled)
        .map((workerType) => {
          const heartbeat = heartbeats.get(workerType);

          if (heartbeat) {
            return {
              name: workerType,
              enabled: true,
              running: heartbeat.status !== 'stopped',
              jobs_processed: heartbeat.jobs_processed,
              jobs_failed: heartbeat.jobs_failed,
              avg_processing_time_ms: heartbeat.avg_processing_time_ms,
              last_processed_at: undefined,
              last_error: heartbeat.last_error,
            };
          }

          const workerQueueStats = queueStats[workerType];

          let isRunning = false;
          let lastError: string | undefined;

          if (workerQueueStats) {
            if (workerQueueStats.active > 0) {
              isRunning = true;
            } else if (workerQueueStats.waiting > 0) {
              isRunning = false;
              lastError = `${workerQueueStats.waiting} job(s) waiting but worker not processing`;
            } else {
              isRunning = false;
              lastError = 'No heartbeat received (worker may not be running)';
            }
          } else {
            lastError = 'No heartbeat or queue stats available';
          }

          return {
            name: workerType,
            enabled: true,
            running: isRunning,
            jobs_processed: workerQueueStats?.completed || 0,
            jobs_failed: workerQueueStats?.failed || 0,
            avg_processing_time_ms: 0,
            last_processed_at: undefined,
            last_error: lastError,
          };
        });

      return workers;
    } catch (error) {
      logger.error('[HEALTH] Failed to get worker health:', {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      return [];
    }
  }

  /**
   * Get queue health status
   */
  async getQueueHealth(): Promise<QueueHealth[]> {
    try {
      const { getQueueManager } = await import('../../queue/index.js');
      const queueManager = getQueueManager();
      const stats = await queueManager.getQueueStats();

      return Object.entries(stats).map(([name, metrics]) => ({
        name,
        waiting: metrics.waiting,
        active: metrics.active,
        completed: metrics.completed,
        failed: metrics.failed,
        delayed: metrics.delayed,
        paused: metrics.paused,
      }));
    } catch (error) {
      logger.error('[HEALTH] Failed to get queue health:', {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      return [];
    }
  }

  /**
   * Get recent failed jobs count for a queue
   */
  async getRecentFailedJobsCount(queueName: string, hoursBack: number): Promise<number> {
    try {
      const { getQueueManager } = await import('../../queue/index.js');
      const queueManager = getQueueManager();
      const queue = queueManager.getQueue(queueName as QueueName);

      if (!queue) {
        return 0;
      }

      const cutoffTime = Date.now() - hoursBack * 60 * 60 * 1000;
      const failedJobs = await queue.getFailed(0, 100);

      const recentFailures = failedJobs.filter((job) => {
        const finishedTime = job.finishedOn || job.processedOn || 0;
        return finishedTime >= cutoffTime;
      });

      return recentFailures.length;
    } catch (error) {
      logger.warn('[HEALTH] Failed to get recent failures for queue', {
        queue: queueName,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Get recent completed jobs count for a queue
   */
  async getRecentCompletedJobsCount(queueName: string, hoursBack: number): Promise<number> {
    try {
      const { getQueueManager } = await import('../../queue/index.js');
      const queueManager = getQueueManager();
      const queue = queueManager.getQueue(queueName as QueueName);

      if (!queue) {
        return 0;
      }

      const cutoffTime = Date.now() - hoursBack * 60 * 60 * 1000;
      const completedJobs = await queue.getCompleted(0, 100);

      const recentCompletions = completedJobs.filter((job) => {
        const finishedTime = job.finishedOn || job.processedOn || 0;
        return finishedTime >= cutoffTime;
      });

      return recentCompletions.length;
    } catch (error) {
      logger.warn('[HEALTH] Failed to get recent completions for queue', {
        queue: queueName,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Get process health and memory usage
   */
  getProcessHealth(): ProcessHealth {
    const mem = process.memoryUsage();
    const heapUsagePercent = (mem.heapUsed / mem.heapTotal) * 100;

    // Determine status based on heap usage
    let status: HealthStatus;
    if (heapUsagePercent > 95) {
      status = 'down';
    } else if (heapUsagePercent > 90) {
      status = 'degraded';
    } else {
      status = 'up';
    }

    return {
      status,
      memory: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers,
        heapUsagePercent: Math.round(heapUsagePercent * 100) / 100,
      },
      uptime: process.uptime(),
      pid: process.pid,
      nodeVersion: process.version,
    };
  }

  /**
   * Get plugin registry health
   */
  async getPluginHealth(): Promise<PluginHealth[]> {
    const pluginsMap = new Map<string, PluginHealth>();

    if (this.pluginRegistry) {
      try {
        const platforms = this.pluginRegistry.getSupportedPlatforms();

        for (const platform of platforms) {
          const plugin = this.pluginRegistry.get(platform);
          const metadata = this.pluginRegistry.getPluginMetadata(platform);
          const isCustom = metadata?.isBuiltIn === false;

          pluginsMap.set(platform, {
            platform,
            enabled: !!plugin,
            type: isCustom ? ('custom' as const) : ('built-in' as const),
          });
        }
      } catch (error) {
        logger.error('[HEALTH] Failed to get plugin registry health:', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      const customPlugins = await this.db.integrations.getCustomPluginsPlatforms();

      for (const row of customPlugins) {
        if (!pluginsMap.has(row.platform)) {
          pluginsMap.set(row.platform, {
            platform: row.platform,
            enabled: row.enabled,
            type: 'custom' as const,
          });
        }
      }
    } catch (error) {
      logger.error('[HEALTH] Failed to get custom plugins from database:', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return Array.from(pluginsMap.values());
  }

  /**
   * Get comprehensive health status
   */
  async getComprehensiveHealth(): Promise<ComprehensiveHealth> {
    const processHealth = this.getProcessHealth();

    const [databaseHealth, redisHealth, storageHealth, diskSpace, workers, queues, plugins] =
      await Promise.all([
        this.checkDatabaseHealth(),
        this.checkRedisHealth(),
        this.checkStorageHealth(),
        this.getDiskSpace(),
        this.getWorkerHealth(),
        this.getQueueHealth(),
        this.getPluginHealth(),
      ]);

    // Calculate overall status
    const servicesDown = [databaseHealth, redisHealth, storageHealth].filter(
      (s) => s.status === 'down'
    ).length;

    const workersWithIssues = workers.filter((w) => {
      if (!w.enabled) {
        return false;
      }

      if (!w.running) {
        return true;
      }

      const totalJobs = w.jobs_processed + w.jobs_failed;
      if (
        totalJobs > HEALTH_THRESHOLDS.MIN_JOBS_FOR_FAILURE_RATE &&
        w.jobs_failed / totalJobs > HEALTH_THRESHOLDS.FAILURE_RATE_THRESHOLD
      ) {
        return true;
      }

      return false;
    }).length;

    const queueIssueChecks = await Promise.all(
      queues.map(async (q) => {
        if (q.paused) {
          return true;
        }

        const [recentFailed, recentCompleted] = await Promise.all([
          this.getRecentFailedJobsCount(q.name, HEALTH_THRESHOLDS.RECENT_FAILURE_WINDOW_HOURS),
          this.getRecentCompletedJobsCount(q.name, HEALTH_THRESHOLDS.RECENT_FAILURE_WINDOW_HOURS),
        ]);

        const recentTotal = recentFailed + recentCompleted;
        if (
          recentTotal > HEALTH_THRESHOLDS.MIN_JOBS_FOR_FAILURE_RATE &&
          recentFailed / recentTotal > HEALTH_THRESHOLDS.FAILURE_RATE_THRESHOLD
        ) {
          return true;
        }

        if (q.waiting > HEALTH_THRESHOLDS.WAITING_JOBS_BACKLOG_THRESHOLD && q.active === 0) {
          return true;
        }

        return false;
      })
    );

    const queuesWithIssues = queueIssueChecks.filter(Boolean).length;

    let status: HealthStatus;
    if (servicesDown > 0) {
      status = 'down';
    } else if (workersWithIssues > 0 || queuesWithIssues > 0) {
      status = 'degraded';
    } else {
      status = 'up';
    }

    const queueDepth = await this.getWorkerQueueDepth();

    return {
      status,
      services: {
        database: databaseHealth,
        redis: redisHealth,
        storage: storageHealth,
      },
      system: {
        disk: {
          available: diskSpace.available,
          total: diskSpace.total,
          usage_percent:
            diskSpace.total > 0
              ? ((diskSpace.total - diskSpace.available) / diskSpace.total) * 100
              : 0,
        },
        queue_depth: queueDepth,
      },
      process: processHealth,
      workers,
      queues,
      plugins,
    };
  }
}
