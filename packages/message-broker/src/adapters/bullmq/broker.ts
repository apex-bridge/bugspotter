/**
 * BullMQ Message Broker — implements IMessageBroker using BullMQ Queue + QueueEvents.
 */

import { Queue, QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import type { IMessageBroker, PublishOptions } from '../../interfaces.js';
import { MessageBrokerTimeoutError, QueueNotRegisteredError } from '../../errors.js';

export interface BullMQBrokerOptions {
  connection: Redis;
  defaultJobOptions?: {
    attempts?: number;
    backoff?: { type: string; delay: number };
    removeOnComplete?: { age?: number; count?: number };
    removeOnFail?: { age?: number; count?: number };
  };
}

export class BullMQBroker implements IMessageBroker {
  private readonly queues = new Map<string, Queue>();
  private readonly queueEvents = new Map<string, QueueEvents>();
  private readonly connection: Redis;
  private readonly defaultJobOptions: BullMQBrokerOptions['defaultJobOptions'];

  constructor(options: BullMQBrokerOptions) {
    this.connection = options.connection;
    this.defaultJobOptions = options.defaultJobOptions;
  }

  /**
   * Register a queue name so the broker manages its Queue and QueueEvents.
   * Must be called before publish/publishAndWait for that queue.
   */
  registerQueue(queueName: string): void {
    if (this.queues.has(queueName)) {
      return;
    }

    const queue = new Queue(queueName, {
      connection: this.connection,
      defaultJobOptions: this.defaultJobOptions,
    });

    const queueEvt = new QueueEvents(queueName, {
      connection: this.connection.duplicate(),
    });

    this.queues.set(queueName, queue);
    this.queueEvents.set(queueName, queueEvt);
  }

  private getQueue(name: string): Queue {
    const q = this.queues.get(name);
    if (!q) {
      throw new QueueNotRegisteredError(name);
    }
    return q;
  }

  private getQueueEvents(name: string): QueueEvents {
    const qe = this.queueEvents.get(name);
    if (!qe) {
      throw new QueueNotRegisteredError(name);
    }
    return qe;
  }

  async publish<D>(
    queue: string,
    jobName: string,
    data: D,
    opts?: PublishOptions
  ): Promise<string> {
    const q = this.getQueue(queue);
    const job = await q.add(jobName, data, opts);
    return job.id!;
  }

  async publishAndWait<D, R>(
    queue: string,
    jobName: string,
    data: D,
    opts?: PublishOptions & { timeout?: number }
  ): Promise<R> {
    const q = this.getQueue(queue);
    const qe = this.getQueueEvents(queue);

    const { timeout, ...jobOpts } = opts ?? {};
    const job = await q.add(jobName, data, jobOpts);

    if (timeout && timeout > 0) {
      let timeoutHandle: ReturnType<typeof setTimeout>;
      const timer = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new MessageBrokerTimeoutError(queue, timeout));
        }, timeout);
      });

      try {
        return await Promise.race([job.waitUntilFinished(qe) as Promise<R>, timer]);
      } finally {
        clearTimeout(timeoutHandle!);
      }
    }

    return (await job.waitUntilFinished(qe)) as R;
  }

  async healthCheck(): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    try {
      await this.connection.ping();
      for (const name of this.queues.keys()) {
        result[name] = true;
      }
    } catch {
      for (const name of this.queues.keys()) {
        result[name] = false;
      }
    }
    return result;
  }

  async shutdown(): Promise<void> {
    for (const qe of this.queueEvents.values()) {
      await qe.close();
    }
    for (const q of this.queues.values()) {
      await q.close();
    }
    this.queueEvents.clear();
    this.queues.clear();
  }

  /** Expose the raw Redis connection for legacy callers during migration. */
  getConnection(): Redis {
    return this.connection;
  }

  /** Expose a raw BullMQ Queue for legacy callers during migration. */
  getRawQueue(name: string): Queue {
    return this.getQueue(name);
  }

  /** Expose raw QueueEvents for legacy callers during migration. */
  getRawQueueEvents(name: string): QueueEvents {
    return this.getQueueEvents(name);
  }
}
