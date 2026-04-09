import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosResponse } from 'axios';
import { apiKeyService } from '../../services/api-key-service';
import type { ApiKeyUsage } from '../../types/api-keys';

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

describe('API Key Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe('getAll', () => {
    it('should fetch all API keys with default pagination', async () => {
      const mockData = [
        {
          id: '1',
          name: 'Test Key',
          type: 'development' as const,
          allowed_projects: ['proj-1'],
          key_prefix: 'bgs_test',
          permissions: ['reports:write'],
          last_used_at: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          created_by: 'user-1',
        },
      ];

      vi.mocked(api.get).mockResolvedValue({
        data: {
          success: true,
          data: mockData,
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
            totalPages: 1,
          },
        },
      } as AxiosResponse);

      const result = await apiKeyService.getAll();

      expect(api.get).toHaveBeenCalledWith('/api/v1/api-keys?page=1&limit=20');
      expect(result.data).toEqual(mockData);
      expect(result.pagination.page).toBe(1);
    });

    it('should fetch API keys with custom pagination', async () => {
      vi.mocked(api.get).mockResolvedValue({
        data: {
          success: true,
          data: [],
          pagination: {
            page: 2,
            limit: 10,
            total: 0,
            totalPages: 0,
          },
        },
      } as AxiosResponse);

      await apiKeyService.getAll(2, 10);

      expect(api.get).toHaveBeenCalledWith('/api/v1/api-keys?page=2&limit=10');
    });

    it('should handle API errors', async () => {
      const mockError = new Error('Network error');
      vi.mocked(api.get).mockRejectedValue(mockError);

      await expect(apiKeyService.getAll()).rejects.toThrow('Network error');
    });
  });

  describe('create', () => {
    it('should create a new API key and flatten response structure', async () => {
      const createData = {
        name: 'New Test Key',
        type: 'production' as const,
        permission_scope: 'write' as const,
        allowed_projects: ['proj-1'],
        permissions: ['reports:write', 'sessions:write'],
      };

      vi.mocked(api.post).mockResolvedValue({
        data: {
          success: true,
          data: {
            api_key: 'bgs_test123456789abcdefghijklmnopqrstuvwxyz1234',
            key_details: {
              id: '1',
              name: 'New Test Key',
              type: 'production',
              allowed_projects: ['proj-1'],
              key_prefix: 'bgs_test12',
              permissions: ['reports:write', 'sessions:write'],
              created_at: '2025-01-01T00:00:00Z',
            },
          },
        },
      } as AxiosResponse);

      const result = await apiKeyService.create(createData);

      expect(api.post).toHaveBeenCalledWith('/api/v1/api-keys', createData);
      expect(result.api_key).toBe('bgs_test123456789abcdefghijklmnopqrstuvwxyz1234');
      expect(result.id).toBe('1');
      expect(result.name).toBe('New Test Key');
      expect(result.type).toBe('production');
      expect(result.key_prefix).toBe('bgs_test12');
    });

    it('should handle validation errors', async () => {
      const invalidData = {
        name: '',
        type: 'development' as const,
        permission_scope: 'write' as const,
        allowed_projects: [],
        permissions: [],
      };

      vi.mocked(api.post).mockRejectedValue(new Error('Validation failed: name is required'));

      await expect(apiKeyService.create(invalidData)).rejects.toThrow('Validation failed');
    });
  });

  describe('revoke', () => {
    it('should revoke an API key by ID', async () => {
      vi.mocked(api.delete).mockResolvedValue({
        data: { success: true, message: 'API key revoked' },
      } as AxiosResponse);

      await apiKeyService.revoke('key-1');

      expect(api.delete).toHaveBeenCalledWith('/api/v1/api-keys/key-1');
    });

    it('should handle revoke errors', async () => {
      vi.mocked(api.delete).mockRejectedValue(new Error('Key not found'));

      await expect(apiKeyService.revoke('invalid-id')).rejects.toThrow('Key not found');
    });
  });

  describe('rotate', () => {
    it('should rotate an API key and return flattened response', async () => {
      vi.mocked(api.post).mockResolvedValue({
        data: {
          success: true,
          data: {
            new_api_key: 'bgs_new123456789abcdefghijklmnopqrstuvwxyz1234',
            key_details: {
              id: '1',
              name: 'Rotated Key',
              type: 'production',
              allowed_projects: ['proj-1'],
              key_prefix: 'bgs_new123',
              permissions: ['reports:write'],
              created_at: '2025-01-02T00:00:00Z',
            },
          },
        },
      } as AxiosResponse);

      const result = await apiKeyService.rotate('key-1');

      expect(api.post).toHaveBeenCalledWith('/api/v1/api-keys/key-1/rotate');
      expect(result.api_key).toBe('bgs_new123456789abcdefghijklmnopqrstuvwxyz1234');
      expect(result.key_prefix).toBe('bgs_new123');
    });

    it('should handle rotate errors', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Key not found'));

      await expect(apiKeyService.rotate('invalid-id')).rejects.toThrow('Key not found');
    });
  });

  describe('getUsage', () => {
    it('should fetch usage statistics for an API key', async () => {
      const mockUsage: ApiKeyUsage = {
        id: '1',
        name: 'Test Key',
        total_requests: 1000,
        requests_last_24h: 50,
        requests_last_7d: 300,
        requests_last_30d: 950,
        last_used_at: '2025-01-01T12:00:00Z',
        created_at: '2025-01-01T00:00:00Z',
      };

      vi.mocked(api.get).mockResolvedValue({
        data: { success: true, data: mockUsage },
      } as AxiosResponse);

      const result = await apiKeyService.getUsage('key-1');

      expect(api.get).toHaveBeenCalledWith('/api/v1/api-keys/key-1/usage');
      expect(result).toEqual(mockUsage);
      expect(result.total_requests).toBe(1000);
      expect(result.requests_last_24h).toBe(50);
    });

    it('should handle keys with no usage', async () => {
      const mockUsage: ApiKeyUsage = {
        id: '1',
        name: 'Unused Key',
        total_requests: 0,
        requests_last_24h: 0,
        requests_last_7d: 0,
        requests_last_30d: 0,
        last_used_at: null,
        created_at: '2025-01-01T00:00:00Z',
      };

      vi.mocked(api.get).mockResolvedValue({
        data: { success: true, data: mockUsage },
      } as AxiosResponse);

      const result = await apiKeyService.getUsage('key-1');

      expect(result.total_requests).toBe(0);
      expect(result.last_used_at).toBeNull();
    });
  });

  describe('Response Structure', () => {
    it('should correctly flatten nested create response', async () => {
      vi.mocked(api.post).mockResolvedValue({
        data: {
          success: true,
          data: {
            api_key: 'bgs_fullkey123',
            key_details: {
              id: '1',
              name: 'Test',
              type: 'development',
              allowed_projects: ['proj-1'],
              key_prefix: 'bgs_fullke',
              permissions: ['reports:write'],
              created_at: '2025-01-01T00:00:00Z',
            },
          },
        },
      } as AxiosResponse);

      const result = await apiKeyService.create({
        name: 'Test',
        type: 'development',
        permission_scope: 'write',
        allowed_projects: ['proj-1'],
        permissions: ['reports:write'],
      });

      // Verify flattened structure
      expect(result.api_key).toBe('bgs_fullkey123');
      expect(result.id).toBe('1');
      expect(result.name).toBe('Test');
      expect(result.key_prefix).toBe('bgs_fullke');
    });

    it('should correctly flatten nested rotate response', async () => {
      vi.mocked(api.post).mockResolvedValue({
        data: {
          success: true,
          data: {
            new_api_key: 'bgs_rotated456',
            key_details: {
              id: '1',
              name: 'Rotated',
              type: 'production',
              allowed_projects: ['proj-1'],
              key_prefix: 'bgs_rotate',
              permissions: ['reports:write'],
              created_at: '2025-01-02T00:00:00Z',
            },
          },
        },
      } as AxiosResponse);

      const result = await apiKeyService.rotate('key-1');

      // Verify flattened structure
      expect(result.api_key).toBe('bgs_rotated456');
      expect(result.key_prefix).toBe('bgs_rotate');
    });
  });

  describe('Type Safety', () => {
    it('should enforce type field values', async () => {
      const createData = {
        name: 'Type Test',
        type: 'development' as const,
        permission_scope: 'write' as const,
        allowed_projects: ['proj-1'],
        permissions: ['reports:write'],
      };

      vi.mocked(api.post).mockResolvedValue({
        data: {
          success: true,
          data: {
            api_key: 'bgs_test',
            key_details: {
              id: '1',
              name: 'Type Test',
              type: 'development',
              allowed_projects: ['proj-1'],
              key_prefix: 'bgs_test',
              permissions: ['reports:write'],
              created_at: '2025-01-01T00:00:00Z',
            },
          },
        },
      } as AxiosResponse);

      const result = await apiKeyService.create(createData);

      expect(result.type).toBe('development');
      // TypeScript should enforce type is one of: 'production' | 'development' | 'test'
    });
  });
});
