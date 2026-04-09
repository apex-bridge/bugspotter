/**
 * Screenshot Worker
 * Processes screenshot jobs: download, optimize, create thumbnail, upload
 */

import type { IJobHandle } from '@bugspotter/message-broker';
import type { Redis } from 'ioredis';
import sharp from 'sharp';
import { getLogger } from '../../logger.js';
import { getQueueConfig } from '../../config/queue.config.js';
import type { BugReportRepository } from '../../db/repositories.js';
import type { IStorageService } from '../../storage/types.js';
import type { BugReport } from '../../db/types.js';
import type { ScreenshotJobData, ScreenshotJobResult } from '../types.js';
import { QUEUE_NAMES } from '../types.js';
import { JobProcessingError } from '../errors.js';
import { createScreenshotJobResult, validateScreenshotJobData } from '../jobs/screenshot-job.js';
import type { IWorkerHost } from '@bugspotter/message-broker';
import { attachStandardEventHandlers } from './worker-events.js';
import { ProgressTracker } from './progress-tracker.js';
import { createWorker } from './worker-factory.js';

const logger = getLogger();

// Size limits for screenshot processing
const MAX_SCREENSHOT_BYTES = 50 * 1024 * 1024; // 50MB file size limit
const MAX_SCREENSHOT_PIXELS = 268435456; // 16384×16384 max resolution (268M pixels)
// Protects against decompression bombs (small files that decompress to huge images)

const SUPPORTED_IMAGE_FORMATS = ['jpeg', 'jpg', 'png', 'webp', 'gif'] as const;
// Expected format: screenshots/{projectId}/{bugReportId}/{filename}
// - projectId and bugReportId must be UUIDs (36 chars with hyphens)
// - filename can be any non-slash characters
const SCREENSHOT_KEY_PATTERN = /^screenshots\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[^/]+$/;

/**
 * Create and initialize the Screenshot worker
 */
export function createScreenshotWorker(
  bugReportRepo: BugReportRepository,
  storage: IStorageService,
  connection: Redis
): IWorkerHost<ScreenshotJobData, ScreenshotJobResult> {
  /**
   * Validate screenshot key format and authorization
   * Prevents path traversal and ensures key belongs to specified project/bug
   */
  function validateScreenshotKey(
    screenshotKey: string,
    projectId: string,
    bugReportId: string,
    jobId: string
  ): void {
    // Validate key is a non-empty string
    if (!screenshotKey || typeof screenshotKey !== 'string') {
      throw new JobProcessingError(jobId, 'Invalid screenshot key: must be a non-empty string', {
        screenshotKey,
      });
    }

    // Validate key matches expected format (prevents path traversal)
    if (!SCREENSHOT_KEY_PATTERN.test(screenshotKey)) {
      throw new JobProcessingError(jobId, 'Screenshot key does not match expected format', {
        screenshotKey,
        expectedPattern: SCREENSHOT_KEY_PATTERN.source,
      });
    }

    // Authorization check: verify key belongs to this project and bug report
    const expectedKeyPrefix = `screenshots/${projectId}/${bugReportId}/`;
    if (!screenshotKey.startsWith(expectedKeyPrefix)) {
      throw new JobProcessingError(
        jobId,
        'Screenshot key does not belong to specified project and bug report',
        { screenshotKey, expectedKeyPrefix, projectId, bugReportId }
      );
    }
  }

  /**
   * Handle presigned flow retry: reuse existing files and metadata from database
   * Optimized to avoid re-downloading and re-processing the entire image
   */
  async function handleRetry(
    projectId: string,
    bugReportId: string,
    existingReport: BugReport,
    existingScreenshotUrl: string,
    existingThumbnailUrl: string
  ) {
    // Fetch actual file sizes from storage metadata
    const originalKey = `screenshots/${projectId}/${bugReportId}/original.png`;
    const thumbnailKey = `screenshots/${projectId}/${bugReportId}-thumb/original.png`;

    const [originalMetadata, thumbnailMetadata] = await Promise.all([
      storage.headObject(originalKey),
      storage.headObject(thumbnailKey),
    ]);

    // Retrieve image metadata from database (stored during initial processing)
    // This avoids re-downloading and re-processing the entire file
    const metadata = existingReport.metadata || {};
    const imageMetadata = {
      width: (metadata.screenshotWidth as number | undefined) ?? 0,
      height: (metadata.screenshotHeight as number | undefined) ?? 0,
      format: (metadata.screenshotFormat as string | undefined) ?? 'jpeg',
    };

    return {
      originalUrl: existingScreenshotUrl,
      thumbnailUrl: existingThumbnailUrl,
      originalSize: originalMetadata?.size ?? 0,
      thumbnailSize: thumbnailMetadata?.size ?? 0,
      imageMetadata,
    };
  }

  /**
   * Process presigned URL upload (client already uploaded, we optimize and create thumbnail)
   */
  async function processScreenshot(
    job: IJobHandle<ScreenshotJobData>,
    projectId: string,
    bugReportId: string,
    screenshotKey: string
  ) {
    // Security: Validate screenshot key format and authorization
    validateScreenshotKey(screenshotKey, projectId, bugReportId, job.id || 'unknown');

    const progress = new ProgressTracker(job, 4);

    // Step 1: Download from storage as stream
    await progress.update(1, 'Downloading uploaded screenshot');
    const stream = await storage.getObject(screenshotKey);

    // Defense-in-depth: Track byte size and errors while streaming
    // Using object to prevent race conditions with shared mutable state
    const streamState = {
      totalBytes: 0,
      error: null as Error | null,
    };

    stream.on('data', (chunk: Buffer) => {
      streamState.totalBytes += chunk.length;
      // Guard prevents multiple error objects if data events fire before stream is destroyed
      if (streamState.totalBytes > MAX_SCREENSHOT_BYTES && !streamState.error) {
        streamState.error = new JobProcessingError(
          job.id || 'unknown',
          `Screenshot exceeds maximum size limit of ${MAX_SCREENSHOT_BYTES} bytes`,
          { totalBytesRead: streamState.totalBytes }
        );
        stream.destroy(streamState.error);
      }
    });

    // Create Sharp instance from stream with pixel limit (protects against decompression bombs)
    // Sharp will stream-process the image without loading entire file into memory
    const sharpInstance = sharp({ limitInputPixels: MAX_SCREENSHOT_PIXELS });

    // Pipe stream to Sharp (stream-to-stream processing)
    stream.pipe(sharpInstance);

    // Wait for Sharp to finish consuming the stream before proceeding
    // This ensures metadata() won't be called before Sharp has fully processed the input
    await new Promise<void>((resolve, reject) => {
      stream.on('error', (err) => {
        // If we have a tracked error (size limit), use that for better context
        reject(streamState.error || err);
      });

      sharpInstance.on('error', (err) => {
        // If stream error already occurred, that takes precedence
        if (streamState.error) {
          reject(streamState.error);
        } else {
          reject(
            new JobProcessingError(job.id || 'unknown', 'Failed to process image', {
              error: err.message,
              totalBytesRead: streamState.totalBytes,
            })
          );
        }
      });

      // Wait for Sharp to finish consuming input (not just stream end)
      // Sharp's 'finish' event fires when it has fully consumed the piped stream
      sharpInstance.on('finish', () => {
        resolve();
      });
    });

    // Get metadata for validation (Sharp caches this from the stream)
    const imageMetadata = await sharpInstance.metadata();

    // Validate it's an actual image with valid dimensions
    if (!imageMetadata.format || !imageMetadata.width || !imageMetadata.height) {
      throw new JobProcessingError(
        job.id || 'unknown',
        'Invalid image format - not a valid image file',
        {
          hasFormat: !!imageMetadata.format,
          hasWidth: !!imageMetadata.width,
          hasHeight: !!imageMetadata.height,
        }
      );
    }

    // Validate format is supported
    if (!SUPPORTED_IMAGE_FORMATS.includes(imageMetadata.format as any)) {
      throw new JobProcessingError(job.id || 'unknown', 'Unsupported image format', {
        format: imageMetadata.format,
        supportedFormats: SUPPORTED_IMAGE_FORMATS,
      });
    }

    // Step 2 & 3: Process optimized and thumbnail in parallel
    await progress.update(2, 'Processing image');
    const config = getQueueConfig();

    // Clone for parallel processing (Sharp internally caches the decoded image)
    const [optimizedBuffer, thumbnailBuffer] = await Promise.all([
      sharpInstance.clone().jpeg({ quality: config.screenshot.quality }).toBuffer(),
      sharpInstance
        .clone()
        .resize(config.screenshot.thumbnailWidth, config.screenshot.thumbnailHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toBuffer(),
    ]);

    // Step 4: Re-upload optimized versions
    await progress.complete('Uploading optimized versions');

    // Upload both in parallel
    const [originalResult, thumbnailResult] = await Promise.all([
      storage.uploadScreenshot(projectId, bugReportId, optimizedBuffer),
      storage.uploadScreenshot(projectId, `${bugReportId}-thumb`, thumbnailBuffer),
    ]);

    // Update database with both URLs and image metadata
    const rowsAffected = await bugReportRepo.updateScreenshotUrls(
      bugReportId,
      originalResult.url,
      thumbnailResult.url,
      originalResult.key,
      thumbnailResult.key,
      {
        width: imageMetadata.width,
        height: imageMetadata.height,
        format: imageMetadata.format,
      }
    );

    if (rowsAffected === 0) {
      throw new JobProcessingError(
        job.id || 'unknown',
        'Failed to update bug report with screenshot URLs',
        { bugReportId, projectId }
      );
    }

    return {
      originalUrl: originalResult.url,
      thumbnailUrl: thumbnailResult.url,
      originalSize: optimizedBuffer.length,
      thumbnailSize: thumbnailBuffer.length,
      imageMetadata,
    };
  }

  /**
   * Process screenshot job
   */
  async function processScreenshotJob(
    job: IJobHandle<ScreenshotJobData>
  ): Promise<ScreenshotJobResult> {
    const startTime = Date.now();
    const { bugReportId, projectId, screenshotKey } = job.data;

    // Validate job data
    if (!validateScreenshotJobData(job.data)) {
      throw new JobProcessingError(
        job.id || 'unknown',
        'Invalid screenshot job data: must provide bugReportId, projectId, and screenshotKey',
        { data: job.data }
      );
    }

    logger.info('Processing screenshot', {
      jobId: job.id,
      bugReportId,
      projectId,
    });

    try {
      // Check if files already uploaded from previous retry attempt
      const existingReport = await bugReportRepo.findById(bugReportId);
      const existingThumbnailUrl = existingReport?.metadata?.thumbnailUrl as string | undefined;

      let result;

      // Idempotent retry: Check if processing already completed
      const isCompleted =
        existingReport?.screenshot_url &&
        existingThumbnailUrl &&
        existingReport.upload_status === 'completed';

      if (isCompleted) {
        // Files already uploaded and processing completed, reuse existing URLs
        logger.info('Reusing uploaded screenshots from previous retry', {
          jobId: job.id,
          bugReportId,
          attemptNumber: job.attemptsMade,
          uploadStatus: existingReport.upload_status,
        });

        // TypeScript: We've verified these are not null above
        const screenshotUrl = existingReport.screenshot_url!;
        const thumbnailUrl = existingThumbnailUrl!;

        result = await handleRetry(
          projectId,
          bugReportId,
          existingReport,
          screenshotUrl,
          thumbnailUrl
        );
      } else {
        // First attempt or incomplete processing: Process presigned upload
        result = await processScreenshot(job, projectId, bugReportId, screenshotKey);
      }

      const processingTimeMs = Date.now() - startTime;

      logger.info('Screenshot processed successfully', {
        jobId: job.id,
        bugReportId,
        originalSize: result.originalSize,
        thumbnailSize: result.thumbnailSize,
        processingTimeMs,
      });

      return createScreenshotJobResult(result.originalUrl, result.thumbnailUrl, {
        originalSize: result.originalSize,
        thumbnailSize: result.thumbnailSize,
        width: result.imageMetadata.width ?? 0,
        height: result.imageMetadata.height ?? 0,
        processingTimeMs,
      });
    } catch (error) {
      logger.error('Screenshot processing error', {
        jobId: job.id,
        bugReportId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // Create worker using factory with custom rate limiting
  const worker = createWorker<
    ScreenshotJobData,
    ScreenshotJobResult,
    typeof QUEUE_NAMES.SCREENSHOTS
  >({
    name: QUEUE_NAMES.SCREENSHOTS,
    processor: processScreenshotJob,
    connection,
    workerType: QUEUE_NAMES.SCREENSHOTS,
    customOptions: {
      limiter: {
        max: 10,
        duration: 1000, // 10 jobs per second max
      },
    },
  });

  // Attach standard event handlers with job-specific context
  attachStandardEventHandlers(worker, 'Screenshot', (data, result) => ({
    bugReportId: data.bugReportId,
    projectId: data.projectId,
    originalSize: result?.originalSize,
    thumbnailSize: result?.thumbnailSize,
    processingTimeMs: result?.processingTimeMs,
  }));

  logger.info('Screenshot worker started');

  // Return worker directly (already implements IWorkerHost)
  return worker;
}
