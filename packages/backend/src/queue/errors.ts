/**
 * Queue-specific error classes
 * Provides type-safe error handling for queue operations
 */

/**
 * Thrown when attempting to access a queue that doesn't exist
 */
export class QueueNotFoundError extends Error {
  constructor(
    public readonly queueName: string,
    message?: string
  ) {
    super(message || `Queue ${queueName} not found`);
    this.name = 'QueueNotFoundError';

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, QueueNotFoundError);
    }
  }
}

/**
 * Thrown when a job is not found in the queue
 */
export class JobNotFoundError extends Error {
  constructor(
    public readonly jobId: string,
    public readonly queueName: string,
    message?: string
  ) {
    super(message || `Job ${jobId} not found in queue ${queueName}`);
    this.name = 'JobNotFoundError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, JobNotFoundError);
    }
  }
}

/**
 * Thrown when a job fails during processing due to invalid state or missing data
 */
export class JobProcessingError extends Error {
  constructor(
    public readonly jobId: string,
    public readonly reason: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(`Job ${jobId} processing failed: ${reason}`);
    this.name = 'JobProcessingError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, JobProcessingError);
    }
  }
}
