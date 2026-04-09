/**
 * S3 Object Parameters Builder
 * Single Responsibility: Build S3 command parameters from config
 */

import type { ServerSideEncryption, StorageClass } from '@aws-sdk/client-s3';
import type { S3Config } from './types.js';

export interface S3ObjectParams {
  ServerSideEncryption?: ServerSideEncryption;
  SSEKMSKeyId?: string;
  StorageClass?: StorageClass;
}

export class S3ParamsBuilder {
  private readonly config: S3Config;

  constructor(config: S3Config) {
    this.config = config;
  }

  /**
   * Build common S3 object parameters from config
   * Applies encryption and storage class settings
   */
  buildObjectParams(): S3ObjectParams {
    const params: S3ObjectParams = {};

    if (this.config.serverSideEncryption) {
      params.ServerSideEncryption = this.config.serverSideEncryption as ServerSideEncryption;
      if (this.config.serverSideEncryption === 'aws:kms' && this.config.sseKmsKeyId) {
        params.SSEKMSKeyId = this.config.sseKmsKeyId;
      }
    }

    if (this.config.storageClass) {
      params.StorageClass = this.config.storageClass as StorageClass;
    }

    return params;
  }
}
