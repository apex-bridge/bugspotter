/**
 * BullMQ Worker Host Factory — creates BullMQWorkerHost instances.
 */

import type { WorkerOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import type {
  IJobHandle,
  IWorkerHost,
  IWorkerHostFactory,
  WorkerHostOptions,
} from '../../interfaces.js';
import { BullMQWorkerHost } from './worker-host.js';

export interface BullMQWorkerHostFactoryOptions {
  connection: Redis;
  /** Extra BullMQ-specific options applied to every worker. */
  customOptions?: Partial<WorkerOptions>;
}

export class BullMQWorkerHostFactory implements IWorkerHostFactory {
  constructor(private readonly options: BullMQWorkerHostFactoryOptions) {}

  createWorker<D = unknown, R = unknown>(
    queue: string,
    processor: (job: IJobHandle<D, R>) => Promise<R>,
    opts?: WorkerHostOptions
  ): IWorkerHost<D, R> {
    return new BullMQWorkerHost<D, R>({
      queue,
      processor,
      connection: this.options.connection,
      concurrency: opts?.concurrency,
      limiter: opts?.limiter,
      customOptions: this.options.customOptions,
    });
  }
}
