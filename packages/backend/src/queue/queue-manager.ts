/**
 * Queue Manager
 * Centralized management for job queues.
 * Internally delegates to @bugspotter/message-broker's BullMQBroker.
 */

import type { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { BullMQBroker } from '@bugspotter/message-broker';
import { getLogger } from '../logger.js';
import { getQueueConfig } from '../config/queue.config.js';
import { getConnectionPool } from './redis-connection-pool.js';
import type {
  QueueName,
  JobOptions,
  JobStatus,
  JobState,
  JobProgress,
  QueueMetrics,
  QueueStats,
} from './types.js';
import { QUEUE_NAMES } from './types.js';

const logger = getLogger();

export class QueueManager {
  private connection: Redis;
  private broker: BullMQBroker | null = null;
  private isShuttingDown = false;
  private isInitialized = false;

  constructor() {
    const startTime = Date.now();
    logger.info('QueueManager constructor started');

    const config = getQueueConfig();

    // Use connection pool to limit concurrent connections
    logger.info('Initializing Redis connection from pool', {
      url: config.redis.url.replace(/\/\/[^@]+@/, '//***@'),
    });

    // Temporary placeholder - will be initialized async in initialize()
    this.connection = null as unknown as Redis;

    logger.info('QueueManager constructor completed', {
      duration: Date.now() - startTime,
    });
  }

  /**
   * Initialize all queues
   */
  async initialize(): Promise<void> {
    const startTime = Date.now();
    logger.info('QueueManager.initialize() started');

    if (this.isInitialized) {
      logger.warn('Queue manager already initialized');
      return;
    }

    // Get connection from pool
    const pool = getConnectionPool();
    this.connection = await pool.getMainConnection();

    logger.info('Redis connection obtained from pool', {
      activeConnections: pool.getConnectionCount(),
    });

    // Handle connection events with detailed timing
    this.connection.on('connect', () => {
      const elapsed = Date.now() - startTime;
      logger.info('✅ QueueManager Redis connection established', { elapsed });
    });

    this.connection.on('ready', () => {
      const elapsed = Date.now() - startTime;
      logger.info('✅ QueueManager Redis ready', { elapsed });
    });

    this.connection.on('error', (error: Error) => {
      logger.error('❌ QueueManager Redis connection error', {
        error: error.message,
        code: (error as NodeJS.ErrnoException).code,
        elapsed: Date.now() - startTime,
      });
    });

    this.connection.on('close', () => {
      if (!this.isShuttingDown) {
        logger.warn('⚠️ QueueManager Redis connection closed unexpectedly', {
          elapsed: Date.now() - startTime,
        });
      }
    });

    // Create the message broker
    const jobConfig = getQueueConfig();
    this.broker = new BullMQBroker({
      connection: this.connection,
      defaultJobOptions: {
        attempts: jobConfig.jobs.maxRetries,
        backoff: {
          type: 'exponential',
          delay: jobConfig.jobs.backoffDelay,
        },
        removeOnComplete: {
          age: jobConfig.jobs.retentionDays * 24 * 60 * 60,
          count: 1000,
        },
        removeOnFail: {
          age: jobConfig.jobs.retentionDays * 24 * 60 * 60,
          count: 5000,
        },
      },
    });

    // Register all queues
    const queueNames = Object.values(QUEUE_NAMES);
    logger.info('Creating queues', { count: queueNames.length, names: queueNames });

    for (const queueName of queueNames) {
      const queueStartTime = Date.now();
      this.broker.registerQueue(queueName);
      logger.info('Queue created', {
        name: queueName,
        duration: Date.now() - queueStartTime,
      });
    }

    // Attach event handlers to each queue's QueueEvents
    for (const queueName of queueNames) {
      this.attachQueueEventHandlers(this.broker.getRawQueueEvents(queueName), queueName);
    }

    this.isInitialized = true;

    logger.info('Queue manager initialized successfully', {
      queues: queueNames,
      totalDuration: Date.now() - startTime,
      activeConnections: pool.getConnectionCount(),
    });
  }

  /**
   * Attach standard event handlers to queue events
   */
  private attachQueueEventHandlers(queueEvents: QueueEvents, queueName: QueueName): void {
    queueEvents.on('completed', ({ jobId }) => {
      logger.debug('Job completed', { queue: queueName, jobId });
    });

    queueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error('Job failed', { queue: queueName, jobId, reason: failedReason });
    });

    queueEvents.on('progress', ({ jobId, data }) => {
      logger.debug('Job progress', { queue: queueName, jobId, progress: data });
    });
  }

  private getBroker(): BullMQBroker {
    if (!this.broker) {
      throw new Error('QueueManager not initialized. Call initialize() first.');
    }
    return this.broker;
  }

  /**
   * Get managed queue instance (for admin/inspection operations)
   */
  getQueue(queueName: QueueName): Queue {
    return this.getBroker().getRawQueue(queueName);
  }

  /**
   * Get managed QueueEvents instance for a queue.
   */
  getQueueEvents(queueName: QueueName): QueueEvents {
    return this.getBroker().getRawQueueEvents(queueName);
  }

  /**
   * Add a job to a queue
   */
  async addJob<TData>(
    queueName: QueueName,
    jobName: string,
    data: TData,
    options?: JobOptions
  ): Promise<string> {
    logger.info('🔵 [QUEUE MANAGER] Adding job to queue', {
      queue: queueName,
      jobName,
      dataKeys: Object.keys(data as object),
      options: options ? Object.keys(options) : [],
    });

    const jobId = await this.getBroker().publish(queueName, jobName, data, options);

    logger.info('✅ [QUEUE MANAGER] Job added successfully', {
      queue: queueName,
      jobId,
      jobName,
      timestamp: new Date().toISOString(),
    });

    return jobId;
  }

  /**
   * Get a job by ID
   */
  async getJob<TData = unknown, TResult = unknown>(
    queueName: QueueName,
    jobId: string
  ): Promise<JobStatus<TData, TResult> | null> {
    const queue = this.getBroker().getRawQueue(queueName);

    const job = await queue.getJob(jobId);
    if (!job) {
      return null;
    }

    const state = (await job.getState()) as JobState;

    return {
      id: job.id!,
      name: job.name,
      data: job.data as TData,
      progress: job.progress as JobProgress | null,
      returnValue: job.returnvalue as TResult,
      failedReason: job.failedReason ?? null,
      stacktrace: job.stacktrace ?? null,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      processedOn: job.processedOn ?? null,
      finishedOn: job.finishedOn ?? null,
      state,
    };
  }

  /**
   * Get job status
   */
  async getJobStatus(queueName: QueueName, jobId: string): Promise<string | null> {
    const queue = this.getBroker().getRawQueue(queueName);

    const job = await queue.getJob(jobId);
    if (!job) {
      return null;
    }

    return await job.getState();
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<QueueStats> {
    const stats: QueueStats = {};
    const broker = this.getBroker();

    for (const queueName of Object.values(QUEUE_NAMES)) {
      const queue = broker.getRawQueue(queueName);
      const counts = await queue.getJobCounts();
      const isPaused = await queue.isPaused();

      stats[queueName] = {
        waiting: counts.waiting || 0,
        active: counts.active || 0,
        completed: counts.completed || 0,
        failed: counts.failed || 0,
        delayed: counts.delayed || 0,
        paused: isPaused,
      };
    }

    return stats;
  }

  /**
   * Get metrics for a specific queue
   */
  async getQueueMetrics(queueName: QueueName): Promise<QueueMetrics> {
    const queue = this.getBroker().getRawQueue(queueName);

    const counts = await queue.getJobCounts();
    const isPaused = await queue.isPaused();

    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
      paused: isPaused,
    };
  }

  /**
   * Pause a queue
   */
  async pauseQueue(queueName: QueueName): Promise<void> {
    const queue = this.getBroker().getRawQueue(queueName);
    await queue.pause();
    logger.info('Queue paused', { queue: queueName });
  }

  /**
   * Resume a queue
   */
  async resumeQueue(queueName: QueueName): Promise<void> {
    const queue = this.getBroker().getRawQueue(queueName);
    await queue.resume();
    logger.info('Queue resumed', { queue: queueName });
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Queue manager shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    logger.info('Starting queue manager shutdown');

    try {
      if (this.broker) {
        await this.broker.shutdown();
      }

      // Close Redis connection (may already be closed during cleanup)
      if (this.connection.status === 'ready' || this.connection.status === 'connecting') {
        await this.connection.quit();
        logger.debug('Redis connection closed');
      } else {
        logger.debug('Redis connection already closed', { status: this.connection.status });
      }
    } catch (error) {
      logger.warn('Error during queue manager shutdown', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isInitialized = false;
      logger.info('Queue manager shutdown complete');
    }
  }

  /**
   * Health check - ping Redis
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.connection.ping();
      return true;
    } catch (error) {
      logger.error('Redis health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get Redis connection for workers
   */
  getConnection(): Redis {
    return this.connection;
  }

  /**
   * Get the underlying message broker instance.
   */
  getBrokerInstance(): BullMQBroker {
    return this.getBroker();
  }
}

// Export singleton instance
let queueManagerInstance: QueueManager | null = null;

export function getQueueManager(): QueueManager {
  if (!queueManagerInstance) {
    queueManagerInstance = new QueueManager();
  }
  return queueManagerInstance;
}
