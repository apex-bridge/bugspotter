import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
  type PutObjectCommandInput,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl as getS3SignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import type {
  S3Config,
  UploadResult,
  SignedUrlOptions,
  ListObjectsOptions,
  ListObjectsResult,
  StorageObject,
  MultipartUploadOptions,
} from './types.js';
import { BaseStorageService } from './base-storage-service.js';
import { StorageError, StorageUploadError, StorageNotFoundError } from './types.js';
import {
  DEFAULT_EXPIRATION_SECONDS,
  DEFAULT_SIGNED_URL_EXPIRATION_SECONDS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
  MAX_KEYS_PER_REQUEST,
  S3_MAX_PUT_OBJECT_SIZE,
} from './constants.js';
import { executeWithRetry, RetryPredicates } from '../utils/retry.js';
import { getLogger } from '../logger.js';
import { S3ClientBuilder } from './s3-client.builder.js';
import { S3UrlBuilder } from './s3-url.builder.js';
import { S3BucketInitializer } from './s3-bucket.initializer.js';
import { S3ParamsBuilder } from './s3-params.builder.js';
import { S3StreamUploader } from './s3-stream.uploader.js';

const logger = getLogger();

/**
 * S3-compatible storage service implementation
 */
export class StorageService extends BaseStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly config: S3Config;
  private readonly urlBuilder: S3UrlBuilder;
  private readonly paramsBuilder: S3ParamsBuilder;
  private readonly streamUploader: S3StreamUploader;
  private readonly bucketInitializer: S3BucketInitializer;
  private initialized = false;
  private signedUrlExpiration: number = DEFAULT_SIGNED_URL_EXPIRATION_SECONDS;

  constructor(config: S3Config) {
    super();
    this.config = config;
    this.bucket = config.bucket;

    // Read signed URL expiration from environment or use default (30 days)
    this.configureSignedUrlExpiration();

    // Build S3 client using helper
    this.client = S3ClientBuilder.build(config);

    // Initialize helper classes (Single Responsibility Principle)
    this.urlBuilder = new S3UrlBuilder(config, this.bucket);
    this.paramsBuilder = new S3ParamsBuilder(config);
    this.streamUploader = new S3StreamUploader(
      this.client,
      this.bucket,
      config,
      this.urlBuilder,
      this.paramsBuilder
    );
    this.bucketInitializer = new S3BucketInitializer(this.client, this.bucket, config);

    logger.info('S3 storage service created', {
      bucket: this.bucket,
      region: config.region,
      endpoint: config.endpoint ?? 'AWS S3',
      forcePathStyle: config.forcePathStyle,
      hasCredentials: S3ClientBuilder.hasCredentials(config),
    });
  }

  /**
   * Expose default S3 client and bucket for regional storage routing
   */
  getDefaultStorage(): { client: S3Client; bucket: string } {
    return { client: this.client, bucket: this.bucket };
  }

  private configureSignedUrlExpiration() {
    const envExpiration = process.env.SIGNED_URL_EXPIRATION_SECONDS;

    const parsed = envExpiration ? parseInt(envExpiration, 10) : NaN;
    if (envExpiration && (isNaN(parsed) || parsed <= 0)) {
      logger.warn('Invalid SIGNED_URL_EXPIRATION_SECONDS, using default', {
        provided: envExpiration,
        defaultSeconds: DEFAULT_SIGNED_URL_EXPIRATION_SECONDS,
      });
    }

    this.signedUrlExpiration =
      !isNaN(parsed) && parsed > 0 ? parsed : DEFAULT_SIGNED_URL_EXPIRATION_SECONDS;

    logger.debug('Storage service signed URL expiration configured', {
      expirationSeconds: this.signedUrlExpiration,
      expirationDays: Math.round(this.signedUrlExpiration / 86400),
      source: envExpiration ? 'environment' : 'default',
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('Storage already initialized');
      return;
    }

    // Use bucket initializer helper (Single Responsibility)
    await this.bucketInitializer.verifyBucketAccess();
    await this.bucketInitializer.testWritePermissions();

    this.initialized = true;
    logger.info('Storage service initialized successfully');
  }

  async getSignedUrl(key: string, options?: SignedUrlOptions): Promise<string> {
    const expiresIn = options?.expiresIn ?? DEFAULT_EXPIRATION_SECONDS;

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: options?.responseContentType,
        ResponseContentDisposition: options?.responseContentDisposition,
      });

      const url = await getS3SignedUrl(this.client, command, { expiresIn });
      logger.debug('Generated signed URL', { key, expiresIn });
      return url;
    } catch (error) {
      throw new StorageError(
        `Failed to generate signed URL: ${error instanceof Error ? error.message : String(error)}`,
        'SIGNED_URL_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Generate a presigned URL for uploading to S3
   * Allows clients to upload directly without proxying through API server
   * @param key - Storage key (e.g., 'screenshots/project-id/bug-id/file.png')
   * @param contentType - MIME type to enforce (included in signature for security)
   * @param expiresIn - URL validity in seconds (default: 3600 = 1 hour)
   * @returns Presigned PUT URL for client-side upload
   *
   * @remarks
   * CRITICAL SECURITY: Content-Type is included in the signature to prevent XSS attacks.
   * Clients MUST upload with the exact Content-Type header or the signature will fail.
   * This prevents attackers from uploading malicious HTML/scripts disguised as images.
   *
   * Checksum headers are removed by S3ClientBuilder.removeChecksumsMiddleware()
   * when config.disableChecksums is true (set via S3_DISABLE_CHECKSUMS env var
   * or auto-detected for incompatible providers like R2, B2).
   */
  async getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn?: number
  ): Promise<string> {
    const expiry = expiresIn ?? DEFAULT_EXPIRATION_SECONDS;

    try {
      // CRITICAL SECURITY: ContentType MUST be in signature to prevent stored XSS
      // Client must send 'Content-Type' header matching this value or upload fails
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType, // Enforces Content-Type in signature
        // ChecksumAlgorithm: DISABLED - checksums removed via middleware removal
      });

      // Checksum middleware has already been removed from the S3Client
      // during initialization if disableChecksums is true
      const url = await getS3SignedUrl(this.client, command, { expiresIn: expiry });

      logger.debug('Generated presigned upload URL with Content-Type enforcement', {
        key,
        contentType,
        expiresIn: expiry,
        disableChecksums: this.config.disableChecksums,
      });
      return url;
    } catch (error) {
      throw new StorageError(
        `Failed to generate presigned upload URL: ${error instanceof Error ? error.message : String(error)}`,
        'PRESIGNED_UPLOAD_URL_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      logger.debug('Object deleted', { key });
    } catch (error) {
      throw new StorageError(
        `Failed to delete object: ${error instanceof Error ? error.message : String(error)}`,
        'DELETE_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  async deleteFolder(prefix: string): Promise<void> {
    // Use base class validation (DRY + consistent security)
    const validatedPrefix = this.validateDeletePrefix(prefix);

    try {
      let deletedCount = 0;
      let continuationToken: string | undefined;
      let iterations = 0;
      const maxIterations = 1000; // Safety limit: 1M objects max (1000 iterations * 1000 keys)

      do {
        iterations++;
        if (iterations > maxIterations) {
          logger.warn('Delete folder reached max iterations limit', {
            prefix: validatedPrefix,
            deletedCount,
            maxIterations,
          });
          break;
        }

        const listResult = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: validatedPrefix,
            MaxKeys: MAX_KEYS_PER_REQUEST,
            ContinuationToken: continuationToken,
          })
        );

        const objects = listResult.Contents ?? [];

        if (objects.length > 0) {
          const deleteResult = await this.client.send(
            new DeleteObjectsCommand({
              Bucket: this.bucket,
              Delete: {
                Objects: objects.map((obj) => ({ Key: obj.Key! })),
                Quiet: true,
              },
            })
          );

          deletedCount += objects.length - (deleteResult.Errors?.length ?? 0);

          if (deleteResult.Errors && deleteResult.Errors.length > 0) {
            logger.warn('Some objects failed to delete', {
              prefix: validatedPrefix,
              errors: deleteResult.Errors,
            });
          }
        }

        continuationToken = listResult.NextContinuationToken;
      } while (continuationToken);

      logger.info('Folder deleted', { prefix: validatedPrefix, deletedCount });
    } catch (error) {
      throw new StorageError(
        `Failed to delete folder: ${error instanceof Error ? error.message : String(error)}`,
        'DELETE_FOLDER_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  async listObjects(options?: ListObjectsOptions): Promise<ListObjectsResult> {
    // Use base class validation for consistency
    const validatedPrefix = this.validateListPrefix(options?.prefix);

    try {
      const result: ListObjectsV2CommandOutput = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: validatedPrefix || undefined,
          MaxKeys: options?.maxKeys ?? MAX_KEYS_PER_REQUEST,
          ContinuationToken: options?.continuationToken,
        })
      );

      const objects: StorageObject[] =
        result.Contents?.map((obj) => ({
          key: obj.Key!,
          size: obj.Size!,
          lastModified: obj.LastModified!,
          etag: obj.ETag,
        })) ?? [];

      return {
        objects,
        isTruncated: result.IsTruncated ?? false,
        nextContinuationToken: result.NextContinuationToken,
      };
    } catch (error) {
      throw new StorageError(
        `Failed to list objects: ${error instanceof Error ? error.message : String(error)}`,
        'LIST_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  async getObject(key: string): Promise<Readable> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      if (!result.Body) {
        throw new StorageNotFoundError(key);
      }

      return result.Body as Readable;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === 'NoSuchKey') {
        throw new StorageNotFoundError(key);
      }
      throw new StorageError(
        `Failed to get object: ${error instanceof Error ? error.message : String(error)}`,
        'GET_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  async headObject(key: string): Promise<StorageObject | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      return {
        key,
        size: result.ContentLength ?? 0,
        lastModified: result.LastModified ?? new Date(),
        etag: result.ETag,
        contentType: result.ContentType,
      };
    } catch (error: unknown) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw new StorageError(
        `Failed to head object: ${error instanceof Error ? error.message : String(error)}`,
        'HEAD_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  async uploadStream(
    key: string,
    stream: Readable,
    options?: MultipartUploadOptions
  ): Promise<UploadResult> {
    // Delegate to stream uploader helper (Single Responsibility)
    return this.streamUploader.upload(key, stream, options);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete all objects in the bucket. Use with extreme caution!
   * This is typically only used in tests or administrative cleanup.
   * Note: For S3, this deletes all objects but not the bucket itself.
   */
  async clearAllStorage(): Promise<void> {
    logger.warn('Clearing all S3 storage', { bucket: this.bucket });

    try {
      let deletedTotal = 0;
      let continuationToken: string | undefined;
      let iterations = 0;
      const maxIterations = 1000; // Safety limit

      do {
        iterations++;
        if (iterations > maxIterations) {
          logger.warn('Clear all storage reached max iterations limit', {
            deletedTotal,
            maxIterations,
          });
          break;
        }

        const listResult = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            MaxKeys: MAX_KEYS_PER_REQUEST,
            ContinuationToken: continuationToken,
          })
        );

        const objects = listResult.Contents ?? [];

        if (objects.length > 0) {
          const deleteResult = await this.client.send(
            new DeleteObjectsCommand({
              Bucket: this.bucket,
              Delete: {
                Objects: objects.map((obj) => ({ Key: obj.Key! })),
                Quiet: true,
              },
            })
          );

          deletedTotal += objects.length - (deleteResult.Errors?.length ?? 0);

          if (deleteResult.Errors && deleteResult.Errors.length > 0) {
            logger.error('Some objects failed to delete during clear all', {
              errors: deleteResult.Errors,
            });
          }
        }

        continuationToken = listResult.NextContinuationToken;
      } while (continuationToken);

      logger.info('All S3 storage cleared', { deletedTotal });
    } catch (error) {
      throw new StorageError(
        `Failed to clear storage: ${error instanceof Error ? error.message : String(error)}`,
        'CLEAR_STORAGE_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Validate buffer size for upload operations
   * @throws {StorageUploadError} If buffer is empty or exceeds size limit
   */
  private validateBufferSize(buffer: Buffer, maxSize: number): void {
    const bufferSize = buffer.length;

    if (bufferSize === 0) {
      throw new StorageUploadError('Cannot upload empty buffer');
    }

    if (bufferSize > maxSize) {
      throw new StorageUploadError(
        `Buffer size ${bufferSize} bytes exceeds maximum limit (${maxSize} bytes). Use uploadStream for large files.`
      );
    }
  }

  /**
   * Build retry configuration for upload operations
   */
  private buildRetryConfig(key: string, maxAttempts: number) {
    return {
      maxAttempts,
      baseDelay: DEFAULT_RETRY_DELAY_MS,
      shouldRetry: RetryPredicates.isStorageError,
      onRetry: (error: unknown, attempt: number, delay: number) => {
        logger.warn('Upload attempt failed, retrying', {
          key,
          attempt,
          maxAttempts,
          delay: Math.round(delay),
          error: error instanceof Error ? error.message : String(error),
        });
      },
    };
  }

  protected async uploadBuffer(
    key: string,
    buffer: Buffer,
    contentType: string
  ): Promise<UploadResult> {
    // Validate buffer size using helper
    this.validateBufferSize(buffer, S3_MAX_PUT_OBJECT_SIZE);

    const maxAttempts = (this.config.maxRetries ?? DEFAULT_MAX_RETRIES) + 1;

    try {
      return await executeWithRetry(
        async () => {
          const params: PutObjectCommandInput = {
            Bucket: this.bucket,
            Key: key,
            Body: buffer,
            ContentType: contentType,
            ContentLength: buffer.length,
            ...this.paramsBuilder.buildObjectParams(), // Use params builder helper
          };

          const result = await this.client.send(new PutObjectCommand(params));

          logger.debug('Object uploaded', { key, size: buffer.length });

          // Generate signed URL for private bucket access (configurable expiration)
          const signedUrl = await this.getSignedUrl(key, {
            expiresIn: this.signedUrlExpiration,
          });

          return {
            key,
            url: signedUrl, // Use signed URL for private bucket access
            size: buffer.length,
            etag: result.ETag,
            contentType,
          };
        },
        this.buildRetryConfig(key, maxAttempts)
      );
    } catch (error) {
      throw new StorageUploadError(
        `Upload failed after ${maxAttempts} attempts: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async destroy(): Promise<void> {
    try {
      this.client.destroy();
      logger.info('Storage service destroyed');
    } catch (error) {
      logger.error('Error destroying storage service', { error });
    }
  }
}
