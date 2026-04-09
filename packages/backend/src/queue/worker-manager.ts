/**
 * Worker Manager
 * Orchestrates all job queue workers with health checks and graceful shutdown
 *
 * Features:
 * - Starts/stops workers based on configuration
 * - Health checks for each worker
 * - Metrics collection (jobs processed, failures, avg processing time)
 * - Graceful shutdown (completes current jobs)
 * - Worker-specific configuration
 *
 * Usage:
 * ```typescript
 * const workerManager = new WorkerManager(db, storage);
 * await workerManager.start();
 *
 * // Later...
 * await workerManager.shutdown();
 * ```
 */

import { getLogger } from '../logger.js';
import type { Redis } from 'ioredis';
import type { IStorageService } from '../storage/types.js';
import type { DatabaseClient } from '../db/client.js';
import type { BugReportRepository } from '../db/repositories/bug-report.repository.js';
import { getQueueConfig, WORKER_NAMES } from '../config/queue.config.js';
import { getQueueManager } from './queue-manager.js';
import { createScreenshotWorker } from './workers/screenshot-worker.js';
import { createReplayWorker } from './workers/replay-worker.js';
import { createIntegrationWorker } from './workers/integration-worker.js';
import { createNotificationWorker } from './workers/notification-worker.js';
import { createOutboxWorker } from './workers/outbox-worker.js';
import { createPaymentEventWorker } from './workers/payment-event-worker.js';
import { createIntelligenceWorker } from './workers/intelligence-worker.js';
import type { IntelligenceClientFactory as IClientFactory } from '../services/intelligence/tenant-config.js';
import type { BaseWorker } from './workers/base-worker.js';
import type { PluginRegistry } from '../integrations/plugin-registry.js';
import {
  sendWorkerHeartbeat,
  deleteWorkerHeartbeat,
  DEFAULT_HEARTBEAT_CONFIG,
  type WorkerHeartbeatData,
} from './heartbeat.js';
import os from 'os';
import { queueJobsProcessed, queueJobDuration } from '../metrics/registry.js';

const logger = getLogger();

/** Base worker type with erased generics for heterogeneous storage */
type AnyWorker = BaseWorker<unknown, unknown, string>;

/** Worker dependency types - defines what each worker needs for initialization */
const WORKER_DEPENDENCY_TYPE = {
  REPOSITORY: 'repository',
  DATABASE: 'database',
  INTEGRATION: 'integration',
  OUTBOX: 'outbox',
  INTELLIGENCE: 'intelligence',
} as const;

/**
 * Factory function signatures for different worker types
 * Note: We can't use these directly in the registry due to TypeScript's contravariance,
 * but they document the expected signatures and enable type checking in createWorkerInstance
 */
type RepositoryWorkerFactory = (
  bugReportRepo: BugReportRepository,
  storage: IStorageService,
  connection: Redis
) => AnyWorker;

type DatabaseWorkerFactory = (
  db: DatabaseClient,
  storage: IStorageService,
  connection: Redis
) => AnyWorker;

type IntegrationWorkerFactory = (
  pluginRegistry: PluginRegistry,
  bugReportRepo: BugReportRepository,
  connection: Redis
) => AnyWorker;

type OutboxWorkerFactory = (
  db: DatabaseClient,
  pluginRegistry: PluginRegistry,
  connection: Redis
) => AnyWorker;

type IntelligenceWorkerFactory = (
  clientFactory: IClientFactory,
  db: DatabaseClient,
  connection: Redis
) => AnyWorker;

/** Worker configuration with discriminated union for type-safe factories */
type WorkerConfig =
  | {
      name: typeof WORKER_NAMES.SCREENSHOT | typeof WORKER_NAMES.REPLAY;
      type: typeof WORKER_DEPENDENCY_TYPE.REPOSITORY;
      factory: RepositoryWorkerFactory;
    }
  | {
      name: typeof WORKER_NAMES.NOTIFICATION | typeof WORKER_NAMES.PAYMENT_EVENT;
      type: typeof WORKER_DEPENDENCY_TYPE.DATABASE;
      factory: DatabaseWorkerFactory;
    }
  | {
      name: typeof WORKER_NAMES.INTEGRATION;
      type: typeof WORKER_DEPENDENCY_TYPE.INTEGRATION;
      factory: IntegrationWorkerFactory;
    }
  | {
      name: typeof WORKER_NAMES.OUTBOX;
      type: typeof WORKER_DEPENDENCY_TYPE.OUTBOX;
      factory: OutboxWorkerFactory;
    }
  | {
      name: typeof WORKER_NAMES.INTELLIGENCE;
      type: typeof WORKER_DEPENDENCY_TYPE.INTELLIGENCE;
      factory: IntelligenceWorkerFactory;
    };

/**
 * Worker Registry - single source of truth
 * Type assertions required due to TypeScript's contravariance in function parameters
 * The discriminated union ensures we call each factory with the correct parameter types
 */
const WORKER_REGISTRY: WorkerConfig[] = [
  {
    name: WORKER_NAMES.SCREENSHOT,
    type: WORKER_DEPENDENCY_TYPE.REPOSITORY,
    factory: createScreenshotWorker as RepositoryWorkerFactory,
  },
  {
    name: WORKER_NAMES.REPLAY,
    type: WORKER_DEPENDENCY_TYPE.REPOSITORY,
    factory: createReplayWorker as RepositoryWorkerFactory,
  },
  {
    name: WORKER_NAMES.NOTIFICATION,
    type: WORKER_DEPENDENCY_TYPE.DATABASE,
    factory: createNotificationWorker as DatabaseWorkerFactory,
  },
  {
    name: WORKER_NAMES.INTEGRATION,
    type: WORKER_DEPENDENCY_TYPE.INTEGRATION,
    factory: createIntegrationWorker as IntegrationWorkerFactory,
  },
  {
    name: WORKER_NAMES.OUTBOX,
    type: WORKER_DEPENDENCY_TYPE.OUTBOX,
    factory: createOutboxWorker as OutboxWorkerFactory,
  },
  {
    name: WORKER_NAMES.PAYMENT_EVENT,
    type: WORKER_DEPENDENCY_TYPE.DATABASE,
    factory: createPaymentEventWorker as DatabaseWorkerFactory,
  },
  {
    name: WORKER_NAMES.INTELLIGENCE,
    type: WORKER_DEPENDENCY_TYPE.INTELLIGENCE,
    factory: createIntelligenceWorker as IntelligenceWorkerFactory,
  },
];

export interface WorkerMetrics {
  workerName: string;
  isRunning: boolean;
  activeJobs: number; // Number of jobs currently being processed
  jobsProcessed: number;
  jobsFailed: number;
  avgProcessingTimeMs: number;
  totalProcessingTimeMs: number;
  lastProcessedAt: Date | null;
  lastError: string | null;
}

export interface WorkerManagerMetrics {
  totalWorkers: number;
  runningWorkers: number;
  totalJobsProcessed: number;
  totalJobsFailed: number;
  workers: WorkerMetrics[];
  uptime: number;
}

export class WorkerManager {
  private workers: Map<string, AnyWorker>;
  private workerMetrics: Map<string, WorkerMetrics>;
  private db: DatabaseClient;
  private storage: IStorageService;
  private pluginRegistry: PluginRegistry | null;
  private intelligenceClientFactory: IClientFactory | null;
  private startTime: Date | null = null;
  private isShuttingDown = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  /** Tracks job activation time for Prometheus duration fallback (BullMQ may omit processedOn/finishedOn) */
  private jobStartTimes: Map<string, number> = new Map();
  private jobStartTimeSweepInterval: NodeJS.Timeout | null = null;
  /** Entries older than this are considered orphaned (stuck/removed jobs that never fired completed/failed/stalled) */
  private static readonly JOB_START_TIME_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

  constructor(db: DatabaseClient, storage: IStorageService, pluginRegistry?: PluginRegistry) {
    this.db = db;
    this.storage = storage;
    this.pluginRegistry = pluginRegistry || null;
    this.intelligenceClientFactory = null;
    this.workers = new Map();
    this.workerMetrics = new Map();
  }

  async start(): Promise<void> {
    if (this.startTime) {
      throw new Error('WorkerManager already started');
    }

    const config = getQueueConfig();
    const queueManager = getQueueManager();

    // Initialize queue manager first
    await queueManager.initialize();

    // Initialize intelligence client factory only when the worker is enabled
    if (config.workers.intelligence?.enabled) {
      try {
        const { getIntelligenceConfig } = await import('../config/intelligence.config.js');
        const intelligenceConfig = getIntelligenceConfig();
        if (!intelligenceConfig.enabled) {
          throw new Error('WORKER_INTELLIGENCE_ENABLED=true requires INTELLIGENCE_ENABLED=true');
        }
        const { getEncryptionService } = await import('../utils/encryption.js');
        const { IntelligenceClientFactory } = await import(
          '../services/intelligence/tenant-config.js'
        );
        this.intelligenceClientFactory = new IntelligenceClientFactory(
          this.db,
          intelligenceConfig,
          getEncryptionService()
        );
        logger.info('Intelligence client factory initialized for worker');
      } catch (error) {
        // Fail fast: operator explicitly enabled the worker but factory can't init
        throw new Error(
          `Intelligence worker is enabled but client factory failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error }
        );
      }
    }

    this.startTime = new Date();

    logger.info('Starting WorkerManager', {
      enabledWorkers: Object.entries(config.workers)
        .filter(([_, cfg]) => cfg.enabled)
        .map(([name]) => name),
    });

    for (const workerConfig of WORKER_REGISTRY) {
      const workerSettings = (config.workers as Record<string, { enabled: boolean }>)[
        workerConfig.name
      ];
      if (workerSettings?.enabled) {
        await this.startWorker(workerConfig);
      }
    }

    logger.info('WorkerManager started successfully', {
      activeWorkers: this.workers.size,
    });
  }

  private async createWorkerInstance(
    workerConfig: WorkerConfig,
    connection: Redis
  ): Promise<AnyWorker> {
    switch (workerConfig.type) {
      case WORKER_DEPENDENCY_TYPE.REPOSITORY: {
        return workerConfig.factory(this.db.bugReports, this.storage, connection);
      }

      case WORKER_DEPENDENCY_TYPE.DATABASE: {
        return workerConfig.factory(this.db, this.storage, connection);
      }

      case WORKER_DEPENDENCY_TYPE.INTEGRATION: {
        if (!this.pluginRegistry) {
          throw new Error('PluginRegistry required for integration worker but not provided');
        }
        return workerConfig.factory(this.pluginRegistry, this.db.bugReports, connection);
      }

      case WORKER_DEPENDENCY_TYPE.OUTBOX: {
        if (!this.pluginRegistry) {
          throw new Error('PluginRegistry required for outbox worker but not provided');
        }
        return workerConfig.factory(this.db, this.pluginRegistry, connection);
      }

      case WORKER_DEPENDENCY_TYPE.INTELLIGENCE: {
        if (!this.intelligenceClientFactory) {
          throw new Error(
            'IntelligenceClientFactory required for intelligence worker but not available. ' +
              'Ensure INTELLIGENCE_ENABLED=true and WORKER_INTELLIGENCE_ENABLED=true.'
          );
        }
        return workerConfig.factory(this.intelligenceClientFactory, this.db, connection);
      }

      default: {
        const _exhaustiveCheck: never = workerConfig;
        throw new Error(
          `Unhandled worker type in switch statement: ${(_exhaustiveCheck as WorkerConfig).type}`
        );
      }
    }
  }

  private async startWorker(workerConfig: WorkerConfig): Promise<void> {
    const { name } = workerConfig;

    try {
      logger.info(`Starting ${name} worker`);
      const queueManager = getQueueManager();
      const connection = queueManager.getConnection();

      const worker = await this.createWorkerInstance(workerConfig, connection);

      this.workers.set(name, worker);
      this.initializeWorkerMetrics(name);
      this.attachWorkerEventHandlers(worker, name);

      logger.info(`${this.capitalize(name)} worker started`);
    } catch (error) {
      logger.error(`Failed to start ${name} worker`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private attachWorkerEventHandlers(worker: AnyWorker, workerName: string): void {
    const capitalizedName = this.capitalize(workerName);

    worker.on('active', (job: unknown) => {
      this.updateWorkerMetrics(workerName, {
        activeJobs: 1, // Increment active jobs
      });
      const jobId = (job as { id?: string }).id;
      if (jobId) {
        this.jobStartTimes.set(jobId, Date.now());
      }
      logger.debug(`${capitalizedName} job started`, { jobId });
    });

    worker.on('completed', (job: unknown) => {
      this.updateWorkerMetrics(workerName, {
        activeJobs: -1, // Decrement active jobs
        jobsProcessed: 1,
        lastProcessedAt: new Date(),
      });
      queueJobsProcessed.inc({ queue_name: workerName, status: 'completed' });
      const j = job as { id?: string; processedOn?: number; finishedOn?: number };
      let durationMs: number | undefined;
      if (j.processedOn && j.finishedOn) {
        durationMs = j.finishedOn - j.processedOn;
      } else if (j.id) {
        const startTime = this.jobStartTimes.get(j.id);
        if (startTime !== undefined) {
          durationMs = Date.now() - startTime;
        }
      }
      if (durationMs !== undefined && durationMs > 0) {
        queueJobDuration.observe({ queue_name: workerName }, durationMs / 1000);
      }
      if (j.id) {
        this.jobStartTimes.delete(j.id);
      }
      logger.debug(`${capitalizedName} job completed`, { jobId: j.id });
    });

    worker.on('failed', (job: unknown, error: Error) => {
      this.updateWorkerMetrics(workerName, {
        activeJobs: -1, // Decrement active jobs
        jobsFailed: 1,
        lastError: error.message,
        lastProcessedAt: new Date(),
      });
      queueJobsProcessed.inc({ queue_name: workerName, status: 'failed' });
      const jobId = (job as { id?: string } | undefined)?.id;
      if (jobId) {
        this.jobStartTimes.delete(jobId);
      }
      logger.error(`${capitalizedName} job failed`, {
        jobId,
        error: error.message,
      });
    });

    worker.on('stalled', (jobId: unknown) => {
      const id = typeof jobId === 'string' ? jobId : String(jobId);
      this.jobStartTimes.delete(id);
      logger.warn(`${capitalizedName} job stalled`, { jobId: id });
    });
  }

  private initializeWorkerMetrics(workerName: string): void {
    this.workerMetrics.set(workerName, {
      workerName,
      isRunning: true,
      activeJobs: 0,
      jobsProcessed: 0,
      jobsFailed: 0,
      avgProcessingTimeMs: 0,
      totalProcessingTimeMs: 0,
      lastProcessedAt: null,
      lastError: null,
    });
  }

  private calculateTrueAverage(
    totalProcessingTimeMs: number,
    processingTimeMs: number,
    jobsProcessed: number
  ): { avgProcessingTimeMs: number; totalProcessingTimeMs: number } {
    const newTotal = totalProcessingTimeMs + processingTimeMs;
    const newAvg = jobsProcessed > 0 ? newTotal / jobsProcessed : 0;
    return {
      avgProcessingTimeMs: newAvg,
      totalProcessingTimeMs: newTotal,
    };
  }

  private updateWorkerMetrics(
    workerName: string,
    updates: Partial<
      Omit<
        WorkerMetrics,
        'workerName' | 'isRunning' | 'activeJobs' | 'avgProcessingTimeMs' | 'totalProcessingTimeMs'
      >
    > & {
      activeJobs?: number; // Delta to add/subtract from active jobs count
      processingTimeMs?: number; // Single job processing time (for true average calculation)
    }
  ): void {
    const metrics = this.workerMetrics.get(workerName);
    if (!metrics) {
      return;
    }

    if (updates.activeJobs !== undefined) {
      metrics.activeJobs = Math.max(0, metrics.activeJobs + updates.activeJobs);
    }
    if (updates.jobsProcessed) {
      metrics.jobsProcessed += updates.jobsProcessed;
    }
    if (updates.jobsFailed) {
      metrics.jobsFailed += updates.jobsFailed;
    }
    if (updates.lastProcessedAt) {
      metrics.lastProcessedAt = updates.lastProcessedAt;
    }

    if (updates.lastError !== undefined) {
      metrics.lastError = updates.lastError;
    }

    if (updates.processingTimeMs !== undefined) {
      const { avgProcessingTimeMs, totalProcessingTimeMs } = this.calculateTrueAverage(
        metrics.totalProcessingTimeMs,
        updates.processingTimeMs,
        metrics.jobsProcessed
      );
      metrics.avgProcessingTimeMs = avgProcessingTimeMs;
      metrics.totalProcessingTimeMs = totalProcessingTimeMs;
    }
  }

  getMetrics(): WorkerManagerMetrics {
    const workers = Array.from(this.workerMetrics.values());
    const totalJobsProcessed = workers.reduce((sum, w) => sum + w.jobsProcessed, 0);
    const totalJobsFailed = workers.reduce((sum, w) => sum + w.jobsFailed, 0);
    const runningWorkers = workers.filter((w) => w.isRunning).length;

    return {
      totalWorkers: this.workers.size,
      runningWorkers,
      totalJobsProcessed,
      totalJobsFailed,
      workers,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
    };
  }

  getWorkerMetrics(workerName: string): WorkerMetrics | null {
    return this.workerMetrics.get(workerName) || null;
  }

  async healthCheck(): Promise<{ healthy: boolean; workers: Record<string, boolean> }> {
    const workerHealth: Record<string, boolean> = {};

    for (const [name] of this.workers.entries()) {
      try {
        const metrics = this.workerMetrics.get(name);
        workerHealth[name] = metrics?.isRunning ?? false;
      } catch (error) {
        workerHealth[name] = false;
        logger.error(`Health check failed for ${name} worker`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const healthy = Object.values(workerHealth).every((h) => h);

    return { healthy, workers: workerHealth };
  }

  async pauseWorker(workerName: string): Promise<void> {
    const worker = this.workers.get(workerName);
    if (!worker) {
      throw new Error(`Worker ${workerName} not found`);
    }

    await worker.pause();

    const metrics = this.workerMetrics.get(workerName);
    if (metrics) {
      metrics.isRunning = false;
    }

    logger.info(`Worker ${workerName} paused`);
  }

  async resumeWorker(workerName: string): Promise<void> {
    const worker = this.workers.get(workerName);
    if (!worker) {
      throw new Error(`Worker ${workerName} not found`);
    }

    await worker.resume();

    const metrics = this.workerMetrics.get(workerName);
    if (metrics) {
      metrics.isRunning = true;
    }

    logger.info(`Worker ${workerName} resumed`);
  }

  /**
   * Start heartbeat system
   * Workers send periodic heartbeats to Redis for health monitoring
   */
  async startHeartbeat(): Promise<void> {
    const queueManager = getQueueManager();
    const connection = queueManager.getConnection();

    logger.info('Starting heartbeat system', {
      interval: DEFAULT_HEARTBEAT_CONFIG.interval,
      ttl: DEFAULT_HEARTBEAT_CONFIG.ttl,
    });

    // Send initial heartbeats
    await this.sendHeartbeats(connection);

    // Setup periodic heartbeat sending
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.sendHeartbeats(connection);
      } catch (error) {
        logger.error('Failed to send heartbeats', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, DEFAULT_HEARTBEAT_CONFIG.interval);

    // Sweep orphaned jobStartTimes entries (stuck/removed jobs that never
    // fired completed/failed/stalled). Runs every 10 minutes.
    this.jobStartTimeSweepInterval = setInterval(
      () => {
        const cutoff = Date.now() - WorkerManager.JOB_START_TIME_MAX_AGE_MS;
        let deletedCount = 0;
        for (const [jobId, startTime] of this.jobStartTimes) {
          if (startTime < cutoff) {
            this.jobStartTimes.delete(jobId);
            deletedCount++;
          }
        }
        if (deletedCount > 0) {
          getLogger().debug('Cleaned up orphaned job start times', { count: deletedCount });
        }
      },
      10 * 60 * 1000
    );
  }

  /**
   * Send heartbeats for all active workers
   */
  private async sendHeartbeats(connection: Redis): Promise<void> {
    const heartbeats: Promise<void>[] = [];

    for (const [workerName, metrics] of this.workerMetrics) {
      // Determine granular status:
      // - stopped: worker is not running
      // - running: worker is actively processing jobs
      // - idle: worker is running but waiting for jobs
      let status: 'running' | 'idle' | 'stopped';
      if (!metrics.isRunning) {
        status = 'stopped';
      } else if (metrics.activeJobs > 0) {
        status = 'running';
      } else {
        status = 'idle';
      }

      const heartbeatData: WorkerHeartbeatData = {
        status,
        timestamp: new Date().toISOString(),
        pid: process.pid,
        hostname: os.hostname(),
        jobs_processed: metrics.jobsProcessed,
        jobs_failed: metrics.jobsFailed,
        avg_processing_time_ms: metrics.avgProcessingTimeMs,
        last_error: metrics.lastError || undefined,
      };

      heartbeats.push(
        sendWorkerHeartbeat(connection, workerName, heartbeatData, DEFAULT_HEARTBEAT_CONFIG.ttl)
      );
    }

    await Promise.all(heartbeats);
  }

  /**
   * Stop heartbeat system and clean up Redis keys
   */
  async stopHeartbeat(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.jobStartTimeSweepInterval) {
      clearInterval(this.jobStartTimeSweepInterval);
      this.jobStartTimeSweepInterval = null;
    }
    this.jobStartTimes.clear();

    // Delete all heartbeat keys from Redis
    const queueManager = getQueueManager();
    const connection = queueManager.getConnection();

    const deletions: Promise<void>[] = [];
    for (const workerName of this.workerMetrics.keys()) {
      deletions.push(deleteWorkerHeartbeat(connection, workerName));
    }

    await Promise.all(deletions);

    logger.info('Heartbeat system stopped');
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('WorkerManager shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;

    logger.info('Starting WorkerManager graceful shutdown', {
      activeWorkers: this.workers.size,
    });

    const shutdownPromises: Promise<void>[] = [];

    for (const [name, workerInstance] of this.workers.entries()) {
      logger.info(`Shutting down ${name} worker`);

      shutdownPromises.push(
        workerInstance
          .close()
          .then(() => {
            logger.info(`${name} worker closed successfully`);
            const metrics = this.workerMetrics.get(name);
            if (metrics) {
              metrics.isRunning = false;
            }
          })
          .catch((error: unknown) => {
            logger.error(`Failed to close ${name} worker`, {
              error: error instanceof Error ? error.message : String(error),
            });
          })
      );
    }

    await Promise.allSettled(shutdownPromises);

    this.workers.clear();

    const queueManager = getQueueManager();
    await queueManager.shutdown();

    logger.info('WorkerManager shutdown complete');
  }
}

let workerManagerInstance: WorkerManager | null = null;

export function createWorkerManager(
  db: DatabaseClient,
  storage: IStorageService,
  pluginRegistry?: PluginRegistry
): WorkerManager {
  if (!workerManagerInstance) {
    workerManagerInstance = new WorkerManager(db, storage, pluginRegistry);
  }
  return workerManagerInstance;
}

export function getWorkerManager(): WorkerManager {
  if (!workerManagerInstance) {
    throw new Error('WorkerManager not initialized. Call createWorkerManager() first.');
  }
  return workerManagerInstance;
}
