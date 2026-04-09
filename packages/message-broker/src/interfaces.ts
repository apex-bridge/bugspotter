/**
 * Transport-agnostic message broker interfaces.
 *
 * These interfaces decouple application code from any specific message queue
 * implementation (BullMQ, RabbitMQ, Kafka, etc.). Only adapters depend on the
 * concrete transport library.
 */

// ============================================================================
// Job Handle — passed to worker processors instead of transport-specific Job
// ============================================================================

export interface IJobHandle<D = unknown, _R = unknown> {
  readonly id: string;
  readonly name: string;
  readonly data: D;
  readonly attemptsMade: number;
  updateProgress(value: number | object): Promise<void>;
  log(message: string): Promise<void>;
}

// ============================================================================
// Publish Options
// ============================================================================

export interface PublishOptions {
  jobId?: string;
  attempts?: number;
  backoff?: number | { type: string; delay: number };
  priority?: number;
  delay?: number;
  removeOnComplete?: boolean | number | { age?: number; count?: number };
  removeOnFail?: boolean | number | { age?: number; count?: number };
}

// ============================================================================
// Message Broker — producer side
// ============================================================================

export interface IMessageBroker {
  /**
   * Publish a job to a queue (fire-and-forget).
   * Returns the job ID.
   */
  publish<D>(queue: string, jobName: string, data: D, opts?: PublishOptions): Promise<string>;

  /**
   * Publish a job and wait for the worker to return a result (request-reply).
   * Used by BillingService for checkout sessions.
   */
  publishAndWait<D, R>(
    queue: string,
    jobName: string,
    data: D,
    opts?: PublishOptions & { timeout?: number }
  ): Promise<R>;

  /**
   * Health check — returns status per queue.
   */
  healthCheck(): Promise<Record<string, boolean>>;

  /**
   * Gracefully shut down all managed connections.
   */
  shutdown(): Promise<void>;
}

// ============================================================================
// Worker Host — consumer side
// ============================================================================

export type WorkerEventHandler =
  | { event: 'completed'; handler: (job: IJobHandle, result: unknown) => void }
  | { event: 'failed'; handler: (job: IJobHandle | undefined, error: Error) => void }
  | { event: 'error'; handler: (error: Error) => void }
  | { event: 'active'; handler: (job: IJobHandle) => void };

export interface IWorkerHost<D = unknown, R = unknown> {
  close(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  on(event: 'completed', handler: (job: IJobHandle<D, R>, result: R) => void): void;
  on(event: 'failed', handler: (job: IJobHandle<D, R> | undefined, error: Error) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'active', handler: (job: IJobHandle<D, R>) => void): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

// ============================================================================
// Worker Host Factory — creates workers
// ============================================================================

export interface WorkerHostOptions {
  concurrency?: number;
  limiter?: { max: number; duration: number };
}

export interface IWorkerHostFactory {
  createWorker<D = unknown, R = unknown>(
    queue: string,
    processor: (job: IJobHandle<D, R>) => Promise<R>,
    opts?: WorkerHostOptions
  ): IWorkerHost<D, R>;
}
