/**
 * BullMQ Job Handle — wraps a BullMQ Job into the transport-agnostic IJobHandle.
 */

import type { Job } from 'bullmq';
import type { IJobHandle } from '../../interfaces.js';

export class BullMQJobHandle<D = unknown, R = unknown> implements IJobHandle<D, R> {
  readonly id: string;
  readonly name: string;
  readonly data: D;
  readonly attemptsMade: number;

  constructor(private readonly job: Job<D, R>) {
    this.id = job.id ?? 'unknown';
    this.name = job.name;
    this.data = job.data;
    this.attemptsMade = job.attemptsMade;
  }

  async updateProgress(value: number | object): Promise<void> {
    await this.job.updateProgress(value);
  }

  async log(message: string): Promise<void> {
    await this.job.log(message);
  }
}
