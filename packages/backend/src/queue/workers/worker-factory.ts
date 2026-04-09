/**
 * Worker Factory
 *
 * Provides standardized worker creation using @bugspotter/message-broker.
 *
 * Benefits:
 * - DRY: Single place for worker configuration
 * - Consistent worker setup across all types
 * - Easy to add global worker features (rate limiting, etc.)
 */

import type { WorkerOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { BullMQWorkerHost } from '@bugspotter/message-broker';
import type { IJobHandle, IWorkerHost } from '@bugspotter/message-broker';
import { getLogger } from '../../logger.js';
import { getQueueConfig } from '../../config/queue.config.js';
import type { QueueName } from '../types.js';
import { QUEUE_NAMES } from '../types.js';

const logger = getLogger();

/**
 * Map queue names (plural) to worker config keys (singular).
 * Only includes queues processed by backend workers — the PAYMENTS queue
 * is consumed by the external payment-service, not by this application.
 */
const QUEUE_TO_WORKER_CONFIG: Partial<Record<QueueName, string>> = {
  [QUEUE_NAMES.SCREENSHOTS]: 'screenshot',
  [QUEUE_NAMES.REPLAYS]: 'replay',
  [QUEUE_NAMES.INTEGRATIONS]: 'integration',
  [QUEUE_NAMES.NOTIFICATIONS]: 'notification',
  [QUEUE_NAMES.OUTBOX]: 'outbox',
  [QUEUE_NAMES.PAYMENT_EVENTS]: 'payment-event',
  [QUEUE_NAMES.INTELLIGENCE]: 'intelligence',
};

/**
 * Worker creation options
 */
interface CreateWorkerOptions<D = unknown, R = unknown, N extends QueueName = QueueName> {
  /** Queue name (must match job name) */
  name: N;

  /** Job processor function */
  processor: (job: IJobHandle<D, R>) => Promise<R>;

  /** Redis connection */
  connection: Redis;

  /** Worker type for config lookup - uses QueueName type */
  workerType: N;

  /** Optional custom worker options (overrides defaults) */
  customOptions?: Partial<WorkerOptions>;
}

/**
 * Create a worker with standard configuration.
 * Returns an IWorkerHost backed by BullMQ.
 *
 * @example
 * ```typescript
 * const worker = createWorker({
 *   name: QUEUE_NAMES.REPLAYS,
 *   processor: async (job) => processReplayJob(job, db, storage),
 *   connection,
 *   workerType: QUEUE_NAMES.REPLAYS,
 * });
 * ```
 */
export function createWorker<D = unknown, R = unknown, N extends QueueName = QueueName>(
  options: CreateWorkerOptions<D, R, N>
): IWorkerHost<D, R> {
  const config = getQueueConfig();
  const workerConfigKey = QUEUE_TO_WORKER_CONFIG[options.workerType];
  if (!workerConfigKey) {
    throw new Error(
      `No worker config for queue "${options.workerType}" — this queue is not processed by backend workers`
    );
  }
  const concurrency =
    config.workers[workerConfigKey as import('../../config/queue.config.js').WorkerName]
      .concurrency;

  logger.info('Creating worker', {
    name: options.name,
    queueName: options.workerType,
    concurrency,
    connectionHost: options.connection.options?.host,
    connectionPort: options.connection.options?.port,
  });

  const workerHost = new BullMQWorkerHost<D, R>({
    queue: options.name,
    processor: options.processor,
    connection: options.connection,
    concurrency,
    customOptions: options.customOptions,
  });

  logger.info('Worker created successfully', {
    name: options.name,
    queueName: options.workerType,
  });

  return workerHost;
}
