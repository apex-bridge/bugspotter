/**
 * S3 Bucket Initializer
 * Single Responsibility: Handle bucket creation and access verification
 */

import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import type { S3Config } from './types.js';
import { StorageConnectionError } from './types.js';
import { getLogger } from '../logger.js';

const logger = getLogger();

export class S3BucketInitializer {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly config: S3Config;

  constructor(client: S3Client, bucket: string, config: S3Config) {
    this.client = client;
    this.bucket = bucket;
    this.config = config;
  }

  /**
   * Verify bucket exists and is accessible, create if needed
   */
  async verifyBucketAccess(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      logger.info('Bucket exists and is accessible', { bucket: this.bucket });
    } catch (error: unknown) {
      await this.handleBucketAccessError(error);
    }
  }

  /**
   * Test write permissions to bucket
   */
  async testWritePermissions(): Promise<void> {
    try {
      const testKey = '.health-check';
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: testKey,
          Body: Buffer.from('OK'),
          ContentType: 'text/plain',
        })
      );

      // Clean up test file
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: testKey,
        })
      );

      logger.info('Storage write test successful');
    } catch (error) {
      throw new StorageConnectionError(
        `No write permissions on bucket: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Handle bucket access errors - create bucket if not found
   */
  private async handleBucketAccessError(error: unknown): Promise<void> {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };

    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      await this.createBucket();
    } else {
      throw new StorageConnectionError(
        `Failed to access bucket: ${err.name ?? 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Create new S3 bucket
   */
  private async createBucket(): Promise<void> {
    logger.info('Bucket not found, attempting to create', { bucket: this.bucket });
    try {
      await this.client.send(
        new CreateBucketCommand({
          Bucket: this.bucket,
          CreateBucketConfiguration:
            this.config.region !== 'us-east-1'
              ? { LocationConstraint: this.config.region as BucketLocationConstraint }
              : undefined,
        })
      );
      logger.info('Bucket created successfully', { bucket: this.bucket });
    } catch (createError) {
      throw new StorageConnectionError(
        `Failed to create bucket: ${createError instanceof Error ? createError.message : String(createError)}`,
        createError instanceof Error ? createError : undefined
      );
    }
  }
}
