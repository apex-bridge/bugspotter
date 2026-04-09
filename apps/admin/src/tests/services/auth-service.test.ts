/**
 * Auth Service Tests
 * Tests for authentication service methods
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosResponse } from 'axios';
import { authService } from '../../services/auth-service';

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

import { api } from '../../lib/api-client';

describe('Auth Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('should register with email and password', async () => {
      const mockResponse = {
        access_token: 'test-token',
        user: {
          id: 'user-123',
          email: 'new@example.com',
          name: null,
          role: 'user',
          created_at: '2025-01-01T00:00:00Z',
        },
      };

      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: true, data: mockResponse },
      } as AxiosResponse);

      const result = await authService.register('new@example.com', 'password123');

      expect(result).toEqual(mockResponse);
      expect(api.post).toHaveBeenCalledWith('/api/v1/auth/register', {
        email: 'new@example.com',
        password: 'password123',
      });
    });

    it('should register with email, password, and name', async () => {
      const mockResponse = {
        access_token: 'test-token',
        user: {
          id: 'user-456',
          email: 'named@example.com',
          name: 'Jane Doe',
          role: 'user',
          created_at: '2025-01-01T00:00:00Z',
        },
      };

      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: true, data: mockResponse },
      } as AxiosResponse);

      const result = await authService.register('named@example.com', 'password123', 'Jane Doe');

      expect(result).toEqual(mockResponse);
      expect(api.post).toHaveBeenCalledWith('/api/v1/auth/register', {
        email: 'named@example.com',
        password: 'password123',
        name: 'Jane Doe',
      });
    });

    it('should not include name when undefined', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: true, data: { access_token: 'token', user: {} } },
      } as AxiosResponse);

      await authService.register('test@example.com', 'pass123', undefined);

      expect(api.post).toHaveBeenCalledWith('/api/v1/auth/register', {
        email: 'test@example.com',
        password: 'pass123',
      });
    });

    it('should propagate API errors', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Registration disabled'));

      await expect(authService.register('test@example.com', 'pass123')).rejects.toThrow(
        'Registration disabled'
      );
    });
  });

  describe('getRegistrationStatus', () => {
    it('should return allowed: true when registration is enabled', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { success: true, data: { allowed: true } },
      } as AxiosResponse);

      const result = await authService.getRegistrationStatus();

      expect(result).toEqual({ allowed: true });
      expect(api.get).toHaveBeenCalledWith('/api/v1/auth/registration-status');
    });

    it('should return allowed: false when registration is disabled', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { success: true, data: { allowed: false } },
      } as AxiosResponse);

      const result = await authService.getRegistrationStatus();

      expect(result).toEqual({ allowed: false });
    });

    it('should propagate API errors', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));

      await expect(authService.getRegistrationStatus()).rejects.toThrow('Network error');
    });
  });

  describe('login', () => {
    it('should login with email and password', async () => {
      const mockResponse = {
        access_token: 'access-token',
        user: {
          id: 'user-789',
          email: 'login@example.com',
          role: 'admin',
          created_at: '2025-01-01T00:00:00Z',
        },
      };

      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: true, data: mockResponse },
      } as AxiosResponse);

      const result = await authService.login('login@example.com', 'password123');

      expect(result).toEqual(mockResponse);
      expect(api.post).toHaveBeenCalledWith('/api/v1/auth/login', {
        email: 'login@example.com',
        password: 'password123',
      });
    });
  });

  describe('refreshToken', () => {
    it('should return new access token', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: true, data: { access_token: 'new-token' } },
      } as AxiosResponse);

      const result = await authService.refreshToken();

      expect(result).toBe('new-token');
      expect(api.post).toHaveBeenCalledWith('/api/v1/auth/refresh', {});
    });
  });
});
