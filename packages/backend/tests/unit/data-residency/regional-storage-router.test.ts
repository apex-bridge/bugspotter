/**
 * Regional Storage Router Tests
 *
 * Tests for regional storage routing and S3 client management:
 * - S3 client caching (client + bucket synchronized)
 * - S3 region configuration from environment variables
 * - Default storage initialization
 * - Cache invalidation and cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';

// Mock AWS SDK before imports
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function (
    this: { config: unknown; send: Mock; destroy: Mock },
    config: unknown
  ) {
    this.config = config;
    this.send = vi.fn().mockResolvedValue({});
    this.destroy = vi.fn();
  }),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed-url.example.com'),
}));

// Mock config module with factory function
vi.mock('../../../src/data-residency/config.js', () => ({
  getRegionalStorageConfig: vi.fn(),
  isRegionAvailable: vi.fn(),
  getDefaultStorageRegionFor: vi.fn(),
}));

import { S3Client } from '@aws-sdk/client-s3';
import {
  initializeDefaultStorage,
  destroyRegionalClients,
  createRegionalStorageRouter,
} from '../../../src/data-residency/regional-storage-router.js';
import {
  getRegionalStorageConfig,
  isRegionAvailable,
  getDefaultStorageRegionFor,
} from '../../../src/data-residency/config.js';
import type { DataResidencyService } from '../../../src/data-residency/data-residency-service.js';
import type { RegionalStorageConfig } from '../../../src/data-residency/types.js';

describe('Regional Storage Router', () => {
  let mockService: DataResidencyService;
  const mockDefaultClient = new S3Client({ region: 'us-east-1' });

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset module state by destroying clients
    destroyRegionalClients();

    // Mock service methods
    mockService = {
      getProjectPolicy: vi.fn().mockResolvedValue({
        region: 'kz',
        storageRegion: 'kz-almaty',
        allowCrossRegionBackup: false,
        allowCrossRegionProcessing: false,
        encryptionRequired: true,
        auditDataAccess: true,
      }),
      validateStorageOperation: vi.fn().mockResolvedValue({
        allowed: true,
        reason: null,
      }),
      auditDataAccess: vi.fn().mockResolvedValue(undefined),
    } as unknown as DataResidencyService;

    // Default mocks
    (isRegionAvailable as Mock).mockReturnValue(true);
    (getDefaultStorageRegionFor as Mock).mockReturnValue('us-east-1');
  });

  afterEach(() => {
    destroyRegionalClients();
  });

  describe('S3 Client Caching', () => {
    it('should cache both client and bucket together', async () => {
      const config1: RegionalStorageConfig = {
        region: 'kz-almaty',
        endpoint: 'https://storage1.example.com',
        bucket: 'bucket-1',
        accessKeyId: 'key1',
        secretAccessKey: 'secret1',
        s3Region: 'kz-almaty',
        available: true,
        displayName: 'KZ Almaty',
        countryCode: 'KZ',
      };

      (getRegionalStorageConfig as Mock).mockReturnValue(config1);

      const router = await createRegionalStorageRouter('project-1', mockService);

      // First upload creates client
      await router.upload('file1.txt', Buffer.from('test'), 'text/plain');

      // Change bucket in config
      const config2 = { ...config1, bucket: 'bucket-2' };
      (getRegionalStorageConfig as Mock).mockReturnValue(config2);

      // Second upload should use CACHED client + bucket, not new config
      await router.upload('file2.txt', Buffer.from('test'), 'text/plain');

      // Verify S3Client was only created once (cache hit on second call)
      const S3ClientMock = S3Client as unknown as Mock;
      expect(S3ClientMock).toHaveBeenCalledTimes(1);

      // Verify it used the original bucket from cache
      expect(S3ClientMock).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'https://storage1.example.com',
          region: 'kz-almaty',
        })
      );
    });

    it('should prevent client/bucket mismatch after config change', async () => {
      const configV1: RegionalStorageConfig = {
        region: 'kz-almaty',
        endpoint: 'https://old-endpoint.example.com',
        bucket: 'old-bucket',
        accessKeyId: 'old-key',
        secretAccessKey: 'old-secret',
        s3Region: 'kz-almaty',
        available: true,
        displayName: 'KZ Almaty',
        countryCode: 'KZ',
      };

      (getRegionalStorageConfig as Mock).mockReturnValue(configV1);

      const router = await createRegionalStorageRouter('project-1', mockService);
      await router.upload('file1.txt', Buffer.from('test'), 'text/plain');

      // Simulate config change (different endpoint and bucket)
      const configV2: RegionalStorageConfig = {
        ...configV1,
        endpoint: 'https://new-endpoint.example.com',
        bucket: 'new-bucket',
        accessKeyId: 'new-key',
        secretAccessKey: 'new-secret',
      };
      (getRegionalStorageConfig as Mock).mockReturnValue(configV2);

      // Second upload uses cached client (configured for old endpoint)
      // This is correct behavior - cache must be invalidated manually for config changes
      await router.upload('file2.txt', Buffer.from('test'), 'text/plain');

      const S3ClientMock = S3Client as unknown as Mock;

      // Only one client created (cache hit)
      expect(S3ClientMock).toHaveBeenCalledTimes(1);

      // Client was created with V1 config (before change)
      expect(S3ClientMock).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'https://old-endpoint.example.com',
        })
      );
    });
  });

  describe('S3 Region Configuration', () => {
    it('should use explicit s3Region from config when provided', async () => {
      const config: RegionalStorageConfig = {
        region: 'kz-almaty',
        endpoint: 'https://storage.yandexcloud.net',
        bucket: 'bugspotter-kz',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        s3Region: 'ru-central1', // S3 client region parameter (required for S3-compatible providers)
        available: true,
        displayName: 'KZ Almaty',
        countryCode: 'KZ',
      };

      (getRegionalStorageConfig as Mock).mockReturnValue(config);

      const router = await createRegionalStorageRouter('project-1', mockService);
      await router.upload('file.txt', Buffer.from('test'), 'text/plain');

      const S3ClientMock = S3Client as unknown as Mock;
      expect(S3ClientMock).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'ru-central1', // Uses explicit s3Region
        })
      );
    });

    it('should fall back to storage region identifier when s3Region not set', async () => {
      // Clear S3Client mock from previous tests
      (S3Client as unknown as Mock).mockClear();

      // Update policy for EU region
      mockService.getProjectPolicy = vi.fn().mockResolvedValue({
        region: 'eu',
        storageRegion: 'eu-central-1',
        allowCrossRegionBackup: true,
        allowCrossRegionProcessing: false,
        encryptionRequired: true,
        auditDataAccess: true,
      });

      const config: RegionalStorageConfig = {
        region: 'eu-central-1',
        endpoint: 'https://s3.eu-central-1.amazonaws.com',
        bucket: 'bugspotter-eu',
        // No s3Region specified
        available: true,
        displayName: 'EU Frankfurt',
        countryCode: 'DE',
      };

      (getRegionalStorageConfig as Mock).mockReturnValue(config);

      const router = await createRegionalStorageRouter('project-1', mockService);
      await router.upload('file.txt', Buffer.from('test'), 'text/plain');

      const S3ClientMock = S3Client as unknown as Mock;
      expect(S3ClientMock).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'eu-central-1', // Falls back to storage region identifier
        })
      );
    });

    it('should support AWS regions outside us-/eu- prefixes', async () => {
      mockService.getProjectPolicy = vi.fn().mockResolvedValue({
        region: 'global',
        storageRegion: 'auto', // Use valid StorageRegion
        allowCrossRegionBackup: true,
        allowCrossRegionProcessing: false,
        encryptionRequired: true,
        auditDataAccess: false,
      });

      const config: RegionalStorageConfig = {
        region: 'auto', // Valid StorageRegion value
        endpoint: 'https://s3.ap-northeast-1.amazonaws.com',
        bucket: 'bugspotter-ap',
        s3Region: 'ap-northeast-1', // Custom s3Region for actual AWS region
        available: true,
        displayName: 'Asia Pacific (Tokyo)',
        countryCode: 'JP',
      };

      (getRegionalStorageConfig as Mock).mockReturnValue(config);

      const router = await createRegionalStorageRouter('project-1', mockService);
      await router.upload('file.txt', Buffer.from('test'), 'text/plain');

      const S3ClientMock = S3Client as unknown as Mock;
      expect(S3ClientMock).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'ap-northeast-1', // Correctly uses ap- prefix
        })
      );
    });

    it('should support custom S3-compatible provider regions', async () => {
      mockService.getProjectPolicy = vi.fn().mockResolvedValue({
        region: 'kz',
        storageRegion: 'kz-astana',
        allowCrossRegionBackup: false,
        allowCrossRegionProcessing: false,
        encryptionRequired: true,
        auditDataAccess: true,
      });

      const config: RegionalStorageConfig = {
        region: 'kz-astana',
        endpoint: 'https://minio.astana.example.com',
        bucket: 'bugspotter',
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
        s3Region: 'astana-datacenter-1', // Custom MinIO region
        available: true,
        displayName: 'KZ Astana',
        countryCode: 'KZ',
      };

      (getRegionalStorageConfig as Mock).mockReturnValue(config);

      const router = await createRegionalStorageRouter('project-1', mockService);
      await router.upload('file.txt', Buffer.from('test'), 'text/plain');

      const S3ClientMock = S3Client as unknown as Mock;
      expect(S3ClientMock).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'https://minio.astana.example.com',
          region: 'astana-datacenter-1', // Uses custom region
          forcePathStyle: true,
        })
      );
    });
  });

  describe('Default Storage', () => {
    it('should use default storage for auto region', async () => {
      // Clear S3Client mock from previous tests
      (S3Client as unknown as Mock).mockClear();

      mockService.getProjectPolicy = vi.fn().mockResolvedValue({
        region: 'global',
        storageRegion: 'auto',
        allowCrossRegionBackup: true,
        allowCrossRegionProcessing: true,
        encryptionRequired: false,
        auditDataAccess: false,
      });

      // Clear config mock to ensure getRegionClient returns null for 'auto'
      (getRegionalStorageConfig as Mock).mockReturnValue(null);

      initializeDefaultStorage(mockDefaultClient, 'default-bucket');

      const router = await createRegionalStorageRouter('project-1', mockService);
      await router.upload('file.txt', Buffer.from('test'), 'text/plain');

      // Should not create new client
      const S3ClientMock = S3Client as unknown as Mock;
      expect(S3ClientMock).not.toHaveBeenCalled();
    });
  });

  describe('Client Cleanup', () => {
    it('should destroy all cached clients on cleanup', async () => {
      const config1: RegionalStorageConfig = {
        region: 'kz-almaty',
        endpoint: 'https://storage1.example.com',
        bucket: 'bucket-1',
        available: true,
        displayName: 'KZ Almaty',
        countryCode: 'KZ',
      };

      const config2: RegionalStorageConfig = {
        region: 'rf-moscow',
        endpoint: 'https://storage2.example.com',
        bucket: 'bucket-2',
        available: true,
        displayName: 'RF Moscow',
        countryCode: 'RU',
      };

      // Create two different regional clients
      mockService.getProjectPolicy = vi
        .fn()
        .mockResolvedValueOnce({
          region: 'kz',
          storageRegion: 'kz-almaty',
          allowCrossRegionBackup: false,
          allowCrossRegionProcessing: false,
          encryptionRequired: true,
          auditDataAccess: true,
        })
        .mockResolvedValueOnce({
          region: 'rf',
          storageRegion: 'rf-moscow',
          allowCrossRegionBackup: false,
          allowCrossRegionProcessing: false,
          encryptionRequired: true,
          auditDataAccess: true,
        });

      (getRegionalStorageConfig as Mock)
        .mockReturnValueOnce(config1)
        .mockReturnValueOnce(config1)
        .mockReturnValueOnce(config2)
        .mockReturnValueOnce(config2);

      const router1 = await createRegionalStorageRouter('project-1', mockService);
      await router1.upload('file1.txt', Buffer.from('test'), 'text/plain');

      const router2 = await createRegionalStorageRouter('project-2', mockService);
      await router2.upload('file2.txt', Buffer.from('test'), 'text/plain');

      // Two clients created
      const S3ClientMock = S3Client as unknown as Mock;
      expect(S3ClientMock).toHaveBeenCalledTimes(2);

      // Cleanup should destroy both
      destroyRegionalClients();

      const client1 = S3ClientMock.mock.results[0].value;
      const client2 = S3ClientMock.mock.results[1].value;

      expect(client1.destroy).toHaveBeenCalled();
      expect(client2.destroy).toHaveBeenCalled();
    });
  });

  describe('Storage Operations', () => {
    beforeEach(() => {
      const config: RegionalStorageConfig = {
        region: 'kz-almaty',
        endpoint: 'https://storage.example.com',
        bucket: 'test-bucket',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        s3Region: 'kz-almaty',
        available: true,
        displayName: 'KZ Almaty',
        countryCode: 'KZ',
      };

      (getRegionalStorageConfig as Mock).mockReturnValue(config);
    });

    it('should validate operation before upload', async () => {
      mockService.validateStorageOperation = vi.fn().mockResolvedValue({
        allowed: false,
        reason: 'Data residency violation',
      });

      const router = await createRegionalStorageRouter('project-1', mockService);

      await expect(router.upload('file.txt', Buffer.from('test'), 'text/plain')).rejects.toThrow(
        'Data residency violation'
      );

      expect(mockService.validateStorageOperation).toHaveBeenCalledWith(
        'project-1',
        'create',
        'kz-almaty'
      );
    });

    it('should audit data access after upload', async () => {
      const router = await createRegionalStorageRouter('project-1', mockService);
      await router.upload('screenshots/file.png', Buffer.from('test'), 'image/png');

      expect(mockService.auditDataAccess).toHaveBeenCalledWith({
        projectId: 'project-1',
        action: 'data_created',
        resourceType: 'file',
        resourceId: 'screenshots/file.png',
        storageRegion: 'kz-almaty',
      });
    });

    it('should return target region from upload', async () => {
      const router = await createRegionalStorageRouter('project-1', mockService);
      const result = await router.upload('file.txt', Buffer.from('test'), 'text/plain');

      expect(result).toEqual({
        key: 'file.txt',
        region: 'kz-almaty',
      });
    });

    it('should get target region', async () => {
      const router = await createRegionalStorageRouter('project-1', mockService);
      expect(router.getTargetRegion()).toBe('kz-almaty');
    });

    it('should get data residency policy', async () => {
      const router = await createRegionalStorageRouter('project-1', mockService);
      const policy = router.getPolicy();

      expect(policy).toEqual({
        region: 'kz',
        storageRegion: 'kz-almaty',
        allowCrossRegionBackup: false,
        allowCrossRegionProcessing: false,
        encryptionRequired: true,
        auditDataAccess: true,
      });
    });
  });
});
