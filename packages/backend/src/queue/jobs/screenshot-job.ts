/**
 * Screenshot Job Definition
 * Processes screenshot uploads: download, optimize, create thumbnail
 */

import type { ScreenshotJobData, ScreenshotJobResult } from '../types.js';

export const SCREENSHOT_JOB_NAME = 'process-screenshot';

export interface ScreenshotJob {
  name: typeof SCREENSHOT_JOB_NAME;
  data: ScreenshotJobData;
}

/**
 * Validate screenshot job data
 * Only supports presigned URL flow
 */
export function validateScreenshotJobData(data: unknown): data is ScreenshotJobData {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const d = data as Partial<ScreenshotJobData>;

  // Must have required IDs and screenshot key
  return !!(
    d.bugReportId &&
    typeof d.bugReportId === 'string' &&
    d.projectId &&
    typeof d.projectId === 'string' &&
    d.screenshotKey &&
    typeof d.screenshotKey === 'string'
  );
}

/**
 * Create screenshot job result
 */
export function createScreenshotJobResult(
  originalUrl: string,
  thumbnailUrl: string,
  metadata: {
    originalSize: number;
    thumbnailSize: number;
    width: number;
    height: number;
    processingTimeMs: number;
  }
): ScreenshotJobResult {
  return {
    originalUrl,
    thumbnailUrl,
    ...metadata,
  };
}
