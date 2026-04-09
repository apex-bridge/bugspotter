/**
 * S3 Stream Uploader
 * Single Responsibility: Handle multipart stream uploads
 * Note: Retry logic is handled by S3Client's built-in maxAttempts configuration
 */

import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'node:stream';
import type { S3Config, UploadResult, MultipartUploadOptions } from './types.js';
import { StorageUploadError } from './types.js';
import { S3UrlBuilder } from './s3-url.builder.js';
import { S3ParamsBuilder } from './s3-params.builder.js';
import { getLogger } from '../logger.js';

const logger = getLogger();

export class S3StreamUploader {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly config: S3Config;
  private readonly urlBuilder: S3UrlBuilder;
  private readonly paramsBuilder: S3ParamsBuilder;

  constructor(
    client: S3Client,
    bucket: string,
    config: S3Config,
    urlBuilder: S3UrlBuilder,
    paramsBuilder: S3ParamsBuilder
  ) {
    this.client = client;
    this.bucket = bucket;
    this.config = config;
    this.urlBuilder = urlBuilder;
    this.paramsBuilder = paramsBuilder;
  }

  /**
   * Upload stream using multipart upload
   * S3Client handles retries automatically via maxAttempts configuration
   */
  async upload(
    key: string,
    stream: Readable,
    options?: MultipartUploadOptions
  ): Promise<UploadResult> {
    const contentType = options?.contentType ?? 'application/octet-stream';
    let uploadedBytes = 0;

    // Handle stream errors
    const streamErrorHandler = (error: Error) => {
      logger.error('Stream error during upload', { key, error: error.message });
    };
    stream.once('error', streamErrorHandler);

    try {
      // Use S3 Upload for true streaming (no buffering entire file in memory)
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: key,
          Body: stream,
          ContentType: contentType,
          ...this.paramsBuilder.buildObjectParams(),
        },
        queueSize: this.config.multipartQueueSize ?? 4,
        partSize: options?.partSize ?? 5 * 1024 * 1024, // Default 5MB parts (S3 minimum)
      });

      // Track upload progress if callback provided
      if (options?.onProgress) {
        upload.on('httpUploadProgress', (progress) => {
          if (progress.loaded && progress.total) {
            uploadedBytes = progress.loaded;
            options.onProgress!(progress.loaded, progress.total);
          }
        });
      }

      const result = await upload.done();

      // Get actual size from S3 response or tracked bytes
      const size = await this.getUploadedSize(key, uploadedBytes);

      logger.debug('Stream uploaded successfully', { key, size });

      return {
        key,
        url: this.urlBuilder.buildObjectUrl(key),
        size,
        etag: result.ETag,
        contentType,
      };
    } catch (error) {
      throw new StorageUploadError(
        `Stream upload failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    } finally {
      // Always clean up error handler, even on failure
      stream.removeListener('error', streamErrorHandler);
    }
  }

  /**
   * Get actual uploaded file size
   * Falls back to HeadObject for small files where progress events don't fire
   */
  private async getUploadedSize(key: string, uploadedBytes: number): Promise<number> {
    if (uploadedBytes > 0) {
      return uploadedBytes;
    }

    // For small files where progress events don't fire, get size from S3
    try {
      const headResult = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return headResult.ContentLength ?? 0;
    } catch (error) {
      logger.warn('Could not retrieve uploaded file size', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
