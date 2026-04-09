/**
 * Share Token Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shareTokenService } from '../../services/share-token-service';
import * as apiClient from '../../lib/api-client';

vi.mock('../../lib/api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  API_ENDPOINTS: {},
  handleApiError: vi.fn(),
}));

describe('shareTokenService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a share token with default expiration', async () => {
      const bugReportId = 'bug-123';
      const mockResponse = {
        data: {
          success: true,
          data: {
            token: 'abc123token',
            expires_at: '2024-12-31T23:59:59Z',
            share_url: 'https://app.bugspotter.com/shared/abc123token',
            password_protected: false,
          },
        },
      };

      vi.mocked(apiClient.api.post).mockResolvedValue(mockResponse);

      const result = await shareTokenService.create(bugReportId, {});

      expect(apiClient.api.post).toHaveBeenCalledWith(`/api/v1/replays/${bugReportId}/share`, {});
      expect(result).toEqual(mockResponse.data.data);
    });

    it('should create a password-protected share token with custom expiration', async () => {
      const bugReportId = 'bug-456';
      const requestData = {
        expires_in_hours: 48,
        password: 'securepass123',
      };
      const mockResponse = {
        data: {
          success: true,
          data: {
            token: 'xyz789token',
            expires_at: '2025-01-02T12:00:00Z',
            share_url: 'https://app.bugspotter.com/shared/xyz789token',
            password_protected: true,
          },
        },
      };

      vi.mocked(apiClient.api.post).mockResolvedValue(mockResponse);

      const result = await shareTokenService.create(bugReportId, requestData);

      expect(apiClient.api.post).toHaveBeenCalledWith(
        `/api/v1/replays/${bugReportId}/share`,
        requestData
      );
      expect(result.password_protected).toBe(true);
      expect(result.token).toBe('xyz789token');
    });

    it('should handle API errors', async () => {
      const bugReportId = 'bug-error';
      const error = new Error('API Error');

      vi.mocked(apiClient.api.post).mockRejectedValue(error);

      await expect(shareTokenService.create(bugReportId, {})).rejects.toThrow('API Error');
    });
  });

  describe('getActive', () => {
    it('should return active share token if exists', async () => {
      const bugReportId = 'bug-active';
      const mockResponse = {
        data: {
          success: true,
          data: {
            id: 'token-uuid',
            token: 'active-token-123',
            expires_at: '2025-01-15T00:00:00Z',
            share_url: 'https://app.bugspotter.com/shared/active-token-123',
            password_protected: false,
            view_count: 5,
            created_by: 'user-uuid',
            created_at: '2025-01-01T00:00:00Z',
          },
        },
      };

      vi.mocked(apiClient.api.get).mockResolvedValue(mockResponse);

      const result = await shareTokenService.getActive(bugReportId);

      expect(apiClient.api.get).toHaveBeenCalledWith(`/api/v1/replays/${bugReportId}/share`);
      expect(result).toEqual(mockResponse.data.data);
      expect(result?.view_count).toBe(5);
    });

    it('should return null when no active share token exists (404)', async () => {
      const bugReportId = 'bug-no-share';
      const error = Object.assign(new Error('Not Found'), {
        isAxiosError: true,
        response: { status: 404 },
      });

      vi.mocked(apiClient.api.get).mockRejectedValue(error);

      const result = await shareTokenService.getActive(bugReportId);

      expect(result).toBeNull();
    });

    it('should throw error for non-404 errors', async () => {
      const bugReportId = 'bug-error';
      const error = Object.assign(new Error('Server Error'), {
        isAxiosError: true,
        response: { status: 500 },
      });

      vi.mocked(apiClient.api.get).mockRejectedValue(error);

      await expect(shareTokenService.getActive(bugReportId)).rejects.toThrow('Server Error');
    });
  });

  describe('revoke', () => {
    it('should revoke a share token', async () => {
      const token = 'token-to-revoke';

      vi.mocked(apiClient.api.delete).mockResolvedValue({});

      await shareTokenService.revoke(token);

      expect(apiClient.api.delete).toHaveBeenCalledWith(`/api/v1/replays/share/${token}`);
    });

    it('should handle revoke errors', async () => {
      const token = 'invalid-token';
      const error = new Error('Token not found');

      vi.mocked(apiClient.api.delete).mockRejectedValue(error);

      await expect(shareTokenService.revoke(token)).rejects.toThrow('Token not found');
    });
  });
});
