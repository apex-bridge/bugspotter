/**
 * Replay Worker
 *
 * Processes session replay jobs using presigned URLs.
 * The SDK uploads compressed replay files directly to storage via presigned URLs,
 * and this worker validates the upload and generates signed access URLs.
 *
 * Processing Pipeline:
 * 1. Verify replay file exists in storage
 * 2. Download and validate replay data format
 * 3. Update bug report with signed URL for replay access
 *
 * Dependencies:
 * - BugReportRepository: For updating bug report metadata
 * - IStorageService: For accessing uploaded replay files
 * - zlib: For decompression and validation
 */

import type { IJobHandle } from '@bugspotter/message-broker';
import type { Redis } from 'ioredis';
import { promisify } from 'util';
import * as zlib from 'zlib';
import { getLogger } from '../../logger.js';

const logger = getLogger();
import type { BugReportRepository } from '../../db/repositories.js';
import type { IStorageService } from '../../storage/types.js';
import { validateReplayJobData, createReplayJobResult } from '../jobs/replay-job.js';
import type { ReplayJobData, ReplayJobResult } from '../types.js';
import { QUEUE_NAMES } from '../types.js';
import { JobProcessingError } from '../errors.js';
import type { IWorkerHost } from '@bugspotter/message-broker';
import { attachStandardEventHandlers } from './worker-events.js';
import { ProgressTracker } from './progress-tracker.js';
import { createWorker } from './worker-factory.js';

// Signed URL expiration (6 days - S3 Signature v4 max is 7 days)
const SIGNED_URL_EXPIRATION_SECONDS = 6 * 24 * 60 * 60;

/**
 * Process presigned URL upload (client already uploaded compressed replay)
 */
async function processPresignedReplay(
  job: IJobHandle<ReplayJobData, ReplayJobResult>,
  bugReportRepo: BugReportRepository,
  storage: IStorageService,
  projectId: string,
  bugReportId: string,
  replayKey: string
): Promise<ReplayJobResult> {
  const startTime = Date.now();
  const progress = new ProgressTracker(job, 3);

  logger.info('Processing presigned replay upload', {
    jobId: job.id,
    bugReportId,
    projectId,
    replayKey,
  });

  // Step 1: Verify file exists in storage
  await progress.update(1, 'Verifying uploaded replay');
  const headObject = await storage.headObject(replayKey);

  if (!headObject) {
    throw new JobProcessingError(job.id || 'unknown', 'Replay file not found in storage', {
      replayKey,
      projectId,
      bugReportId,
    });
  }

  const totalSize = headObject.size || 0;

  // Step 2: Download and validate replay data
  await progress.update(2, 'Validating replay data');
  const stream = await storage.getObject(replayKey);

  // Collect chunks into buffer (replay files are already compressed, should be small)
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  // Decompress and parse to validate structure
  const gunzip = promisify(zlib.gunzip);
  let decompressed: Buffer;
  try {
    decompressed = await gunzip(buffer);
  } catch (error) {
    throw new JobProcessingError(
      job.id || 'unknown',
      'Failed to decompress replay file - not a valid gzip file',
      { error: error instanceof Error ? error.message : String(error) }
    );
  }

  // Parse JSON to validate structure
  let replayData: unknown;
  try {
    replayData = JSON.parse(decompressed.toString('utf-8'));
  } catch (error) {
    throw new JobProcessingError(job.id || 'unknown', 'Failed to parse replay JSON', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Handle two formats:
  // 1. SDK format: Array of events directly: [{timestamp, type, data}, ...]
  // 2. Legacy format: Object with events property: {events: [...], duration?: number}
  let events: Array<{ timestamp: number }>;
  let duration: number | undefined;

  if (Array.isArray(replayData)) {
    // SDK format: direct array of events
    events = replayData as Array<{ timestamp: number }>;
    duration = events.length > 0 ? events[events.length - 1].timestamp - events[0].timestamp : 0;
  } else if (typeof replayData === 'object' && replayData !== null) {
    // Legacy format: object with events array
    const dataObj = replayData as { events?: unknown; duration?: number };
    if (!dataObj.events || !Array.isArray(dataObj.events)) {
      throw new JobProcessingError(
        job.id || 'unknown',
        'Invalid replay format: missing events array',
        { hasEvents: !!dataObj.events, isArray: Array.isArray(dataObj.events) }
      );
    }
    events = dataObj.events as Array<{ timestamp: number }>;
    duration =
      dataObj.duration ||
      (events.length > 0 ? events[events.length - 1].timestamp - events[0].timestamp : 0);
  } else {
    throw new JobProcessingError(
      job.id || 'unknown',
      'Invalid replay format: expected array or object with events',
      { type: typeof replayData, isArray: Array.isArray(replayData) }
    );
  }

  const eventCount = events.length;

  // Step 3: Update bug report with replay URL
  await progress.complete('Updating bug report');

  // Build the public URL for the replay (same pattern as other storage URLs)
  // The storage key is already the full path: replays/{projectId}/{bugId}/replay.gz
  // We need to use getSignedUrl to generate an accessible URL
  const replayUrl = await storage.getSignedUrl(replayKey, {
    expiresIn: SIGNED_URL_EXPIRATION_SECONDS,
  });

  // Update bug_reports table with replay_url
  const query = `
    UPDATE bug_reports 
    SET replay_url = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
  `;
  const result = await bugReportRepo['getClient']().query(query, [replayUrl, bugReportId]);
  const rowsAffected = result.rowCount ?? 0;

  if (rowsAffected === 0) {
    throw new JobProcessingError(
      job.id || 'unknown',
      'Failed to update bug report with replay URL',
      { bugReportId, projectId }
    );
  }

  const processingTime = Date.now() - startTime;

  logger.info('Presigned replay job completed', {
    jobId: job.id,
    bugReportId,
    eventCount,
    duration,
    totalSize,
    processingTime,
  });

  return createReplayJobResult(
    replayUrl,
    replayUrl, // metadataUrl same as replayUrl for presigned flow
    {
      chunkCount: 1, // Single file in presigned flow
      totalSize,
      duration,
      eventCount,
      processingTimeMs: processingTime,
    }
  );
}

/**
 * Process replay job - all production jobs use presigned URL flow
 */
async function processReplayJob(
  job: IJobHandle<ReplayJobData, ReplayJobResult>,
  bugReportRepo: BugReportRepository,
  storage: IStorageService
): Promise<ReplayJobResult> {
  if (!validateReplayJobData(job.data)) {
    throw new JobProcessingError(
      job.id || 'unknown',
      'Invalid replay job data: must provide bugReportId, projectId, and replayKey',
      { data: job.data }
    );
  }

  const { bugReportId, projectId, replayKey } = job.data;

  logger.info('Processing replay job', { jobId: job.id, bugReportId, projectId, replayKey });

  return processPresignedReplay(job, bugReportRepo, storage, projectId, bugReportId, replayKey);
}

/**
 * Create replay worker with concurrency and event handlers
 * Returns a BaseWorker wrapper for consistent interface with other workers
 */
export function createReplayWorker(
  bugReportRepo: BugReportRepository,
  storage: IStorageService,
  connection: Redis
): IWorkerHost<ReplayJobData, ReplayJobResult> {
  const worker = createWorker<ReplayJobData, ReplayJobResult, typeof QUEUE_NAMES.REPLAYS>({
    name: QUEUE_NAMES.REPLAYS, // Use queue name for consistency with other workers
    processor: async (job) => processReplayJob(job, bugReportRepo, storage),
    connection,
    workerType: QUEUE_NAMES.REPLAYS,
  });

  // Attach standard event handlers with job-specific context
  attachStandardEventHandlers(worker, 'Replay', (data, result) => ({
    bugReportId: data.bugReportId,
    replayUrl: result?.replayUrl,
    chunkCount: result?.chunkCount,
    duration: result?.duration,
  }));

  logger.info('Replay worker started');

  // Return worker directly (already implements IWorkerHost)
  return worker;
}
