/**
 * Regional Storage Router
 *
 * Routes storage operations to the correct regional storage backend
 * based on project data residency policy.
 *
 * This enables compliance with KZ, RF, EU data residency requirements
 * by ensuring data is stored in the correct geographic region.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import { getLogger } from '../logger.js';
import type { StorageRegion, DataResidencyPolicy } from './types.js';
import type { DataResidencyService } from './data-residency-service.js';
import {
  getRegionalStorageConfig,
  isRegionAvailable,
  getDefaultStorageRegionFor,
} from './config.js';

const logger = getLogger();

/**
 * Cache of S3 clients per region
 * Stores both client and bucket to ensure they're synchronized
 */
const regionClients = new Map<StorageRegion, { client: S3Client; bucket: string }>();

/**
 * Default S3 client (for 'auto' region)
 */
let defaultClient: S3Client | null = null;
let defaultBucket: string | null = null;

/**
 * Initialize the default storage client
 * This should be called during server startup
 */
export function initializeDefaultStorage(client: S3Client, bucket: string): void {
  defaultClient = client;
  defaultBucket = bucket;
  logger.debug('Default storage initialized for regional router');
}

/**
 * Get or create S3 client for a specific region
 */
function getRegionClient(region: StorageRegion): { client: S3Client; bucket: string } | null {
  if (region === 'auto') {
    if (!defaultClient || !defaultBucket) {
      logger.warn('Default storage not initialized for regional router');
      return null;
    }
    return { client: defaultClient, bucket: defaultBucket };
  }

  // Check cache first (client and bucket are cached together)
  const cached = regionClients.get(region);
  if (cached) {
    return cached;
  }

  const config = getRegionalStorageConfig(region);

  if (!config) {
    logger.warn('No storage configuration for region', { region });
    return null;
  }

  // Determine S3 client region:
  // 1. Use explicit s3Region from env var if set (STORAGE_{REGION}_REGION)
  // 2. Use storage region identifier if it looks like an AWS region
  // 3. Default to 'us-east-1' for S3-compatible providers
  const s3Region = config.s3Region || region;

  // Create new client for this region
  const client = new S3Client({
    endpoint: config.endpoint,
    region: s3Region,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          }
        : undefined,
    forcePathStyle: true,
  });

  const storage = { client, bucket: config.bucket };
  regionClients.set(region, storage);
  logger.debug('Created S3 client for region', { region, s3Region, bucket: config.bucket });

  return storage;
}

/**
 * Regional Storage Router
 * Routes storage operations to the correct regional backend
 */
export class RegionalStorageRouter {
  private projectId: string;
  private policy: DataResidencyPolicy;
  private targetRegion: StorageRegion;
  private service: DataResidencyService;

  private constructor(
    projectId: string,
    policy: DataResidencyPolicy,
    service: DataResidencyService
  ) {
    this.projectId = projectId;
    this.service = service;
    this.policy = policy;

    // Determine target region
    this.targetRegion = this.policy.storageRegion;
    if (this.targetRegion === 'auto') {
      this.targetRegion = getDefaultStorageRegionFor(this.policy.region);
    }

    logger.debug('Regional storage router created', {
      projectId,
      dataResidencyRegion: this.policy.region,
      targetRegion: this.targetRegion,
    });
  }

  /**
   * Create a new RegionalStorageRouter instance
   */
  static async create(
    projectId: string,
    service: DataResidencyService
  ): Promise<RegionalStorageRouter> {
    const policy = await service.getProjectPolicy(projectId);
    return new RegionalStorageRouter(projectId, policy, service);
  }

  /**
   * Get the storage client and bucket for this project
   */
  private getStorage(): { client: S3Client; bucket: string } {
    // For 'auto' or unavailable regions, use default storage
    if (this.targetRegion === 'auto' || !isRegionAvailable(this.targetRegion)) {
      if (!defaultClient || !defaultBucket) {
        throw new Error('Default storage not initialized');
      }
      return { client: defaultClient, bucket: defaultBucket };
    }

    const storage = getRegionClient(this.targetRegion);
    if (!storage) {
      // Fall back to default storage with warning
      if (!defaultClient || !defaultBucket) {
        throw new Error(
          `Regional storage not available for ${this.targetRegion} and no default storage`
        );
      }
      logger.warn('Regional storage not available, using default', {
        projectId: this.projectId,
        requestedRegion: this.targetRegion,
      });
      return { client: defaultClient, bucket: defaultBucket };
    }

    return storage;
  }

  /**
   * Upload a file to the correct regional storage
   */
  async upload(
    key: string,
    body: Buffer | Readable,
    contentType: string
  ): Promise<{ key: string; region: StorageRegion }> {
    // Validate operation is allowed
    const validation = await this.service.validateStorageOperation(
      this.projectId,
      'create',
      this.targetRegion
    );

    if (!validation.allowed) {
      throw new Error(`Data residency violation: ${validation.reason}`);
    }

    const { client, bucket } = this.getStorage();

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );

    // Audit the upload
    await this.service.auditDataAccess({
      projectId: this.projectId,
      action: 'data_created',
      resourceType: 'file',
      resourceId: key,
      storageRegion: this.targetRegion,
    });

    logger.debug('File uploaded to regional storage', {
      projectId: this.projectId,
      key,
      region: this.targetRegion,
    });

    return { key, region: this.targetRegion };
  }

  /**
   * Get a signed URL for downloading a file
   */
  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    // Validate read operation
    const validation = await this.service.validateStorageOperation(
      this.projectId,
      'read',
      this.targetRegion
    );
    if (!validation.allowed) {
      throw new Error(`Data residency violation: ${validation.reason}`);
    }

    const { client, bucket } = this.getStorage();

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const url = await getSignedUrl(client, command, { expiresIn });

    // Audit the read
    if (this.policy.auditDataAccess) {
      await this.service.auditDataAccess({
        projectId: this.projectId,
        action: 'data_read',
        resourceType: 'file',
        resourceId: key,
        storageRegion: this.targetRegion,
      });
    }

    return url;
  }

  /**
   * Delete a file from regional storage
   */
  async delete(key: string): Promise<void> {
    // Validate delete operation
    const validation = await this.service.validateStorageOperation(
      this.projectId,
      'delete',
      this.targetRegion
    );
    if (!validation.allowed) {
      throw new Error(`Data residency violation: ${validation.reason}`);
    }

    const { client, bucket } = this.getStorage();

    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    // Audit the deletion
    await this.service.auditDataAccess({
      projectId: this.projectId,
      action: 'data_deleted',
      resourceType: 'file',
      resourceId: key,
      storageRegion: this.targetRegion,
    });

    logger.debug('File deleted from regional storage', {
      projectId: this.projectId,
      key,
      region: this.targetRegion,
    });
  }

  /**
   * Check if a file exists in regional storage
   */
  async exists(key: string): Promise<boolean> {
    const { client, bucket } = this.getStorage();

    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the target storage region for this project
   */
  getTargetRegion(): StorageRegion {
    return this.targetRegion;
  }

  /**
   * Get the data residency policy for this project
   */
  getPolicy(): DataResidencyPolicy {
    return this.policy;
  }
}

/**
 * Create a regional storage router for a project
 */
export async function createRegionalStorageRouter(
  projectId: string,
  service: DataResidencyService
): Promise<RegionalStorageRouter> {
  return await RegionalStorageRouter.create(projectId, service);
}

/**
 * Cleanup: destroy all regional S3 clients
 */
export function destroyRegionalClients(): void {
  for (const [region, { client }] of regionClients) {
    try {
      client.destroy();
      logger.debug('Destroyed S3 client for region', { region });
    } catch (error) {
      logger.error('Error destroying S3 client', { region, error });
    }
  }
  regionClients.clear();
}
