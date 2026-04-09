/**
 * Worker Event Handlers
 *
 * Provides standardized event handlers for workers to eliminate
 * duplication across different worker types.
 *
 * Benefits:
 * - DRY: Single source of truth for event handling logic
 * - Consistent logging format across all workers
 * - Easy to add global event tracking/metrics in one place
 */

import type { IWorkerHost, IJobHandle } from '@bugspotter/message-broker';
import { getLogger } from '../../logger.js';

const logger = getLogger();

/**
 * Context extractor function
 * Takes job data and optional result, returns object with relevant fields for logging
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic defaults for flexible job types
export type JobContextExtractor<D = any, R = any> = (
  data: D,
  result?: R
) => Record<string, unknown>;

/**
 * Attach standard 'completed' and 'failed' event handlers to a worker
 *
 * Eliminates ~30 lines of duplicated event handler code per worker.
 * All workers follow the same pattern: log job completion/failure with context.
 *
 * @param worker - IWorkerHost instance to attach handlers to
 * @param workerName - Display name for logging (e.g., 'Screenshot', 'Replay')
 * @param extractContext - Function to extract relevant fields from job data/result
 *
 * @example
 * ```typescript
 * attachStandardEventHandlers(worker, 'Replay', (data, result) => ({
 *   bugReportId: data.bugReportId,
 *   chunkCount: result?.chunkCount,
 *   duration: result?.duration,
 * }));
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic defaults for flexible worker event types
export function attachStandardEventHandlers<D = any, R = any>(
  worker: IWorkerHost<D, R>,
  workerName: string,
  extractContext: JobContextExtractor<D, R>
): void {
  // Event: Job completed successfully
  worker.on('completed', (job: IJobHandle<D, R>, result: R) => {
    logger.info(`${workerName} job completed`, {
      jobId: job.id,
      ...extractContext(job.data, result),
    });
  });

  // Event: Job failed with error
  worker.on('failed', (job: IJobHandle<D, R> | undefined, error: Error) => {
    logger.error(`${workerName} job failed`, {
      jobId: job?.id,
      ...(job?.data ? extractContext(job.data) : {}),
      error: error.message,
      stack: error.stack,
    });
  });
}
