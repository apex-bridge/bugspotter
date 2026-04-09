/**
 * Outbox Worker Wrapper
 * Integrates TicketCreationOutboxProcessor with WorkerManager
 *
 * This worker combines two responsibilities:
 * 1. Periodic polling of ticket_creation_outbox table (poll and schedule)
 * 2. Processing outbox jobs when they're enqueued
 *
 * The outbox pattern ensures reliable ticket creation by:
 * - Writing to outbox table in same transaction as bug report
 * - Polling for pending entries and creating jobs
 * - Processing jobs asynchronously with retries
 */

import type { IJobHandle } from '@bugspotter/message-broker';
import type { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { getLogger } from '../../logger.js';
import type { DatabaseClient } from '../../db/client.js';
import type { PluginRegistry } from '../../integrations/plugin-registry.js';
import {
  createOutboxProcessor,
  type OutboxProcessorJobData,
} from './outbox/ticket-creation-outbox.worker.js';
import { QUEUE_NAMES } from '../types.js';
import type { IWorkerHost } from '@bugspotter/message-broker';
import { attachStandardEventHandlers } from './worker-events.js';
import { createWorker } from './worker-factory.js';

const logger = getLogger();

// Job result structure
interface OutboxJobResult {
  success: boolean;
  outboxEntryId: string;
  externalTicketId?: string;
}

/**
 * Create outbox worker
 *
 * This worker handles ticket creation via the outbox pattern.
 * It polls the ticket_creation_outbox table for pending entries and processes them.
 *
 * @param db - Database client for outbox operations
 * @param pluginRegistry - Plugin registry for integration plugins
 * @param connection - Redis connection for Bull worker
 * @returns BaseWorker instance compatible with WorkerManager
 */
export function createOutboxWorker(
  db: DatabaseClient,
  pluginRegistry: PluginRegistry,
  connection: Redis
): IWorkerHost<OutboxProcessorJobData, OutboxJobResult> {
  logger.info('📬 [OUTBOX WORKER] Initializing outbox worker', {
    hasDb: !!db,
    hasPluginRegistry: !!pluginRegistry,
    hasConnection: !!connection,
  });

  // Create outbox queue for job enqueueing
  const outboxQueue = new Queue<OutboxProcessorJobData>(QUEUE_NAMES.OUTBOX, { connection });

  // Create outbox processor with database, plugin registry, and queue
  const outboxProcessor = createOutboxProcessor(db, pluginRegistry, outboxQueue);

  logger.info('📬 [OUTBOX WORKER] Created outbox processor');

  // ============================================================================
  // PERIODIC POLLING CONFIGURATION
  // ============================================================================
  //
  // NOTE: The current implementation runs polling on EVERY worker instance.
  // This is acceptable for 1-2 workers, but can cause unnecessary database load
  // and contention when scaling to many worker processes.
  //
  // RECOMMENDATION FOR SCALING (>2 workers):
  // Implement a distributed Redis lock to ensure only ONE worker polls at a time:
  //
  // const POLL_LOCK_KEY = 'outbox:poll:lock';
  // const POLL_LOCK_TTL = 8; // seconds (shorter than interval for failover)
  //
  // const acquired = await connection.set(POLL_LOCK_KEY, workerId, 'NX', 'EX', POLL_LOCK_TTL);
  // if (acquired) {
  //   // Only this worker polls the database
  //   await outboxProcessor.pollAndScheduleJobs(BATCH_SIZE);
  // }
  //
  // Benefits: Reduces database queries from N (workers) to 1 per interval
  // Trade-off: Adds Redis lock coordination overhead
  //
  const POLL_INTERVAL_MS = 10 * 1000; // 10 seconds
  const BATCH_SIZE = 10; // Process up to 10 entries per poll

  logger.info('📬 [OUTBOX WORKER] Starting periodic polling', {
    intervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
  });

  let pollingTimeout: NodeJS.Timeout | null = null;
  let isPollingActive = true;
  let currentPollingPromise: Promise<void> | null = null;

  // Recursive setTimeout pattern to prevent overlapping executions
  const schedulePoll = () => {
    if (!isPollingActive) {
      return;
    }

    pollingTimeout = setTimeout(async () => {
      currentPollingPromise = (async () => {
        try {
          const scheduled = await outboxProcessor.pollAndScheduleJobs(BATCH_SIZE);
          if (scheduled > 0) {
            logger.info('📬 [OUTBOX WORKER] Scheduled outbox jobs', { count: scheduled });
          }
        } catch (error) {
          logger.error('📬 [OUTBOX WORKER] Polling error', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        } finally {
          currentPollingPromise = null;
          // Schedule next poll only after current poll completes
          schedulePoll();
        }
      })();
    }, POLL_INTERVAL_MS);
  };

  // Start the polling loop
  schedulePoll();

  // Create Bull worker to process outbox jobs
  const worker = createWorker<OutboxProcessorJobData, OutboxJobResult, typeof QUEUE_NAMES.OUTBOX>({
    name: QUEUE_NAMES.OUTBOX,
    processor: async (job: IJobHandle<OutboxProcessorJobData>): Promise<OutboxJobResult> => {
      logger.info('📬 [OUTBOX WORKER] Processing job', {
        jobId: job.id,
        outboxEntryId: job.data.outboxEntryId,
      });

      try {
        await outboxProcessor.process(job);

        logger.info('📬 [OUTBOX WORKER] Job processed successfully', {
          jobId: job.id,
          outboxEntryId: job.data.outboxEntryId,
        });

        return {
          success: true,
          outboxEntryId: job.data.outboxEntryId,
        };
      } catch (error) {
        logger.error('📬 [OUTBOX WORKER] Job processing failed', {
          jobId: job.id,
          outboxEntryId: job.data.outboxEntryId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });

        throw error; // Re-throw to mark job as failed
      }
    },
    connection,
    workerType: QUEUE_NAMES.OUTBOX,
  });

  // Attach standard event handlers
  attachStandardEventHandlers(worker, 'Outbox', (data, result) => ({
    outboxEntryId: data.outboxEntryId,
    success: result?.success,
  }));

  logger.info('📬 [OUTBOX WORKER] Worker registered and listening for jobs', {
    queueName: QUEUE_NAMES.OUTBOX,
  });

  // Cleanup polling on worker close
  const originalClose = worker.close.bind(worker);
  worker.close = async () => {
    logger.info('📬 [OUTBOX WORKER] Stopping periodic polling');
    isPollingActive = false;
    if (pollingTimeout) {
      clearTimeout(pollingTimeout);
    }
    // Wait for in-flight polling operation to complete before closing queue
    if (currentPollingPromise) {
      logger.info('📬 [OUTBOX WORKER] Waiting for in-flight poll to complete');
      await currentPollingPromise;
    }
    await outboxQueue.close();
    return originalClose();
  };

  // Return worker directly (already implements IWorkerHost)
  return worker;
}
