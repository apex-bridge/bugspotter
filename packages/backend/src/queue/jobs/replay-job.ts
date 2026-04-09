/**
 * Replay Job Definition
 * Processes replay data: chunk, compress, upload
 */

import type { ReplayJobData, ReplayJobResult } from '../types.js';

export const REPLAY_JOB_NAME = 'process-replay';

export interface ReplayJob {
  name: typeof REPLAY_JOB_NAME;
  data: ReplayJobData;
}

/**
 * Validate replay job data
 * Only accepts presigned URL flow with replayKey
 */
export function validateReplayJobData(data: unknown): data is ReplayJobData {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const d = data as Partial<ReplayJobData>;

  return !!(
    d.bugReportId &&
    typeof d.bugReportId === 'string' &&
    d.projectId &&
    typeof d.projectId === 'string' &&
    d.replayKey &&
    typeof d.replayKey === 'string'
  );
}

/**
 * Create replay job result
 */
export function createReplayJobResult(
  replayUrl: string,
  metadataUrl: string,
  metadata: {
    chunkCount: number;
    totalSize: number;
    duration: number;
    eventCount: number;
    processingTimeMs: number;
  }
): ReplayJobResult {
  return {
    replayUrl,
    metadataUrl,
    ...metadata,
  };
}
