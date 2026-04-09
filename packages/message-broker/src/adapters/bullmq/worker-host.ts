/**
 * BullMQ Worker Host — wraps a BullMQ Worker into the transport-agnostic IWorkerHost.
 */

import { Worker, type WorkerOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import type { IJobHandle, IWorkerHost, WorkerHostOptions } from '../../interfaces.js';
import { BullMQJobHandle } from './job-handle.js';

export interface BullMQWorkerHostConfig<D, R> extends WorkerHostOptions {
  queue: string;
  processor: (job: IJobHandle<D, R>) => Promise<R>;
  connection: Redis;
  customOptions?: Partial<WorkerOptions>;
}

export class BullMQWorkerHost<D = unknown, R = unknown> implements IWorkerHost<D, R> {
  private readonly worker: Worker<D, R>;

  constructor(config: BullMQWorkerHostConfig<D, R>) {
    const opts: WorkerOptions = {
      connection: config.connection,
      concurrency: config.concurrency,
      limiter: config.limiter,
      ...config.customOptions,
    };

    this.worker = new Worker<D, R>(
      config.queue,
      async (job) => {
        const handle = new BullMQJobHandle<D, R>(job);
        return config.processor(handle);
      },
      opts
    );
  }

  /** Access the underlying BullMQ Worker for advanced/legacy use. */
  getRawWorker(): Worker<D, R> {
    return this.worker;
  }

  async close(): Promise<void> {
    await this.worker.close();
  }

  async pause(): Promise<void> {
    await this.worker.pause();
  }

  async resume(): Promise<void> {
    await this.worker.resume();
  }

  on(event: 'completed', handler: (job: IJobHandle<D, R>, result: R) => void): void;
  on(event: 'failed', handler: (job: IJobHandle<D, R> | undefined, error: Error) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'active', handler: (job: IJobHandle<D, R>) => void): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: (...args: any[]) => void): void {
    if (event === 'completed') {
      this.worker.on('completed', (job, result) => {
        handler(new BullMQJobHandle(job), result);
      });
    } else if (event === 'active') {
      this.worker.on('active', (job) => {
        handler(new BullMQJobHandle(job));
      });
    } else if (event === 'failed') {
      this.worker.on('failed', (job, err) => {
        handler(job ? new BullMQJobHandle(job) : undefined, err);
      });
    } else {
      this.worker.on(event as keyof typeof this.worker.eventNames, handler as never);
    }
  }
}
