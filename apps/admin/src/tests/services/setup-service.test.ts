/**
 * Setup Service Tests
 * Tests for setup service including environment defaults
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AxiosResponse } from 'axios';
import { setupService } from '../../services/setup-service';
import type { SetupStatus } from '../../types';

// Mock the API client
vi.mock('../../lib/api-client', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
  };
});

// Import mocked api after mock is setup
import { api } from '../../lib/api-client';

describe('Setup Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getStatus', () => {
    it('should return setup status without defaults', async () => {
      const mockStatus: SetupStatus = {
        initialized: false,
        requiresSetup: true,
        setupMode: 'minimal' as const,
      };

      vi.mocked(api.get).mockResolvedValueOnce({
        data: { success: true, data: mockStatus },
      } as AxiosResponse);

      const result = await setupService.getStatus();

      expect(result).toEqual(mockStatus);
      expect(api.get).toHaveBeenCalledWith('/api/v1/setup/status');
    });

    it('should return setup status with environment defaults', async () => {
      const mockStatus: SetupStatus = {
        initialized: false,
        requiresSetup: true,
        setupMode: 'minimal' as const,
        defaults: {
          instance_name: 'Test Instance',
          instance_url: 'https://test.example.com',
          storage_type: 'minio',
          storage_endpoint: 'http://minio:9000',
          storage_bucket: 'test-bucket',
          storage_region: 'us-east-1',
        },
      };

      vi.mocked(api.get).mockResolvedValueOnce({
        data: { success: true, data: mockStatus },
      } as AxiosResponse);

      const result = await setupService.getStatus();

      expect(result).toEqual(mockStatus);
      expect(result.defaults).toBeDefined();
      expect(result.defaults?.instance_name).toBe('Test Instance');
      expect(result.defaults?.storage_type).toBe('minio');
      expect(result.defaults?.storage_endpoint).toBe('http://minio:9000');
    });

    it('should handle status check when already initialized', async () => {
      const mockStatus: SetupStatus = {
        initialized: true,
        requiresSetup: false,
        setupMode: 'minimal' as const,
      };

      vi.mocked(api.get).mockResolvedValueOnce({
        data: { success: true, data: mockStatus },
      } as AxiosResponse);

      const result = await setupService.getStatus();

      expect(result.initialized).toBe(true);
      expect(result.requiresSetup).toBe(false);
      expect(result.defaults).toBeUndefined();
    });

    it('should handle API errors', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));

      await expect(setupService.getStatus()).rejects.toThrow('Network error');
    });
  });

  describe('initialize', () => {
    it('should initialize with all fields provided', async () => {
      const setupData = {
        admin_email: 'admin@test.com',
        admin_password: 'password123',
        admin_name: 'Admin User',
        instance_name: 'Test Instance',
        instance_url: 'http://localhost:3001',
        storage_type: 'minio' as const,
        storage_endpoint: 'http://minio:9000',
        storage_access_key: 'test-key',
        storage_secret_key: 'test-secret',
        storage_bucket: 'test-bucket',
        storage_region: 'us-east-1',
      };

      const mockResponse = {
        access_token: 'test-token',
        user: {
          id: '123',
          email: 'admin@test.com',
          role: 'admin',
        },
        expires_in: 86400,
        token_type: 'Bearer',
      };

      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: true, data: mockResponse },
      } as AxiosResponse);

      const result = await setupService.initialize(setupData);

      expect(result).toEqual(mockResponse);
      expect(api.post).toHaveBeenCalledWith('/api/v1/setup/initialize', setupData);
    });

    it('should initialize with partial fields (using env defaults)', async () => {
      const setupData = {
        admin_email: 'admin@test.com',
        admin_password: 'password123',
        admin_name: 'Admin User',
        instance_name: 'Test Instance',
        instance_url: 'http://localhost:4001',
        storage_type: 'minio' as const,
        storage_endpoint: '',
        storage_access_key: '',
        storage_secret_key: '',
        storage_bucket: '',
        storage_region: '',
      };

      const mockResponse = {
        access_token: 'test-token',
        user: {
          id: '123',
          email: 'admin@test.com',
          role: 'admin',
        },
        expires_in: 86400,
        token_type: 'Bearer',
      };

      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: true, data: mockResponse },
      } as AxiosResponse);

      const result = await setupService.initialize(setupData);

      expect(result).toEqual(mockResponse);
      expect(api.post).toHaveBeenCalledWith('/api/v1/setup/initialize', setupData);
    });

    it('should handle initialization errors', async () => {
      const setupData = {
        admin_email: 'admin@test.com',
        admin_password: 'password123',
        admin_name: 'Admin User',
        instance_name: 'Test Instance',
        instance_url: 'http://localhost:4001',
        storage_type: 'minio' as const,
        storage_access_key: 'key',
        storage_secret_key: 'secret',
        storage_bucket: 'bucket',
      };

      vi.mocked(api.post).mockRejectedValueOnce(new Error('Validation error'));

      await expect(setupService.initialize(setupData)).rejects.toThrow('Validation error');
    });
  });

  describe('testStorageConnection', () => {
    it('should test storage connection successfully', async () => {
      const storageConfig = {
        storage_type: 'minio',
        storage_endpoint: 'http://minio:9000',
        storage_access_key: 'test-key',
        storage_secret_key: 'test-secret',
        storage_bucket: 'test-bucket',
        storage_region: 'us-east-1',
      };

      const mockResponse = {
        success: true,
      };

      vi.mocked(api.post).mockResolvedValueOnce({
        data: mockResponse,
      } as AxiosResponse);

      const result = await setupService.testStorageConnection(storageConfig);

      expect(result).toEqual(mockResponse);
      expect(api.post).toHaveBeenCalledWith('/api/v1/setup/test-storage', storageConfig);
    });

    it('should return failure for invalid storage configuration', async () => {
      const storageConfig = {
        storage_type: 'minio',
        storage_endpoint: 'http://invalid:9000',
        storage_access_key: 'invalid',
        storage_secret_key: 'invalid',
        storage_bucket: 'invalid',
        storage_region: 'us-east-1',
      };

      const mockResponse = {
        success: false,
        error: 'Connection failed',
      };

      vi.mocked(api.post).mockResolvedValueOnce({
        data: mockResponse,
      } as AxiosResponse);

      const result = await setupService.testStorageConnection(storageConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection failed');
    });

    it('should handle network errors during storage test', async () => {
      const storageConfig = {
        storage_type: 's3',
        storage_access_key: 'key',
        storage_secret_key: 'secret',
        storage_bucket: 'bucket',
      };

      vi.mocked(api.post).mockRejectedValueOnce(new Error('Network timeout'));

      await expect(setupService.testStorageConnection(storageConfig)).rejects.toThrow(
        'Network timeout'
      );
    });
  });
});
