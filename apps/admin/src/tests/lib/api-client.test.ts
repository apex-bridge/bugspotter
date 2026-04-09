import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import axios, { type AxiosRequestConfig } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { api as apiClient, setAuthTokenAccessors } from '../../lib/api-client';

describe('API Client', () => {
  let mockAxios: MockAdapter;
  let mockGlobalAxios: MockAdapter;
  let getAccessToken: () => string | null;
  let updateAccessToken: (token: string) => void;
  let currentToken: string | null = null;

  beforeEach(() => {
    // Create mock axios adapter on the apiClient instance
    mockAxios = new MockAdapter(apiClient);

    // Also mock global axios (used for refresh token call)
    mockGlobalAxios = new MockAdapter(axios);

    // Setup token accessors
    getAccessToken = () => currentToken;
    updateAccessToken = (token: string) => {
      currentToken = token;
    };

    // Reset token
    currentToken = 'initial-access-token';

    // Register accessors with api client
    setAuthTokenAccessors(getAccessToken, updateAccessToken);
  });

  afterEach(() => {
    mockAxios.restore();
    mockGlobalAxios.restore();
    currentToken = null;
    vi.clearAllMocks();
  });

  describe('Request Interceptor', () => {
    it('should add Authorization header when access token exists', async () => {
      currentToken = 'test-token-123';

      mockAxios.onGet('/api/test').reply((config: AxiosRequestConfig) => {
        expect(config.headers?.Authorization).toBe('Bearer test-token-123');
        return [200, { success: true, data: { message: 'ok' } }];
      });

      await apiClient.get('/api/test');
    });

    it('should not add Authorization header when access token is null', async () => {
      currentToken = null;

      mockAxios.onGet('/api/test').reply((config: AxiosRequestConfig) => {
        expect(config.headers?.Authorization).toBeUndefined();
        return [200, { success: true, data: { message: 'ok' } }];
      });

      await apiClient.get('/api/test');
    });

    it('should update token on each request if token changes', async () => {
      currentToken = 'token-1';

      mockAxios.onGet('/api/test1').reply((config: AxiosRequestConfig) => {
        expect(config.headers?.Authorization).toBe('Bearer token-1');
        return [200, { success: true, data: {} }];
      });

      await apiClient.get('/api/test1');

      // Change token
      currentToken = 'token-2';

      mockAxios.onGet('/api/test2').reply((config: AxiosRequestConfig) => {
        expect(config.headers?.Authorization).toBe('Bearer token-2');
        return [200, { success: true, data: {} }];
      });

      await apiClient.get('/api/test2');
    });
  });

  describe('Response Interceptor - Token Refresh', () => {
    it('should retry request after successful token refresh on 401', async () => {
      currentToken = 'expired-token';

      // First request fails with 401
      mockAxios.onGet('/api/protected').replyOnce(401, {
        success: false,
        error: 'Token expired',
      });

      // Refresh endpoint returns new token in nested data structure (uses global axios)
      // When API_BASE_URL is empty, the path is just /api/v1/auth/refresh
      mockGlobalAxios.onPost('/api/v1/auth/refresh').replyOnce(200, {
        success: true,
        data: {
          access_token: 'new-refreshed-token',
          expires_in: 3600,
          token_type: 'Bearer',
        },
        timestamp: new Date().toISOString(),
      });

      // Retry with new token succeeds
      mockAxios.onGet('/api/protected').replyOnce((config: AxiosRequestConfig) => {
        expect(config.headers?.Authorization).toBe('Bearer new-refreshed-token');
        return [200, { success: true, data: { message: 'success' } }];
      });

      const response = await apiClient.get('/api/protected');

      expect(response.data.data.message).toBe('success');
      expect(currentToken).toBe('new-refreshed-token');
    });

    it('should extract access_token from correct nested path (response.data.data)', async () => {
      currentToken = 'expired-token';

      mockAxios.onGet('/api/test').replyOnce(401);

      // Mock refresh response with backend's standard wrapper structure (uses global axios)
      mockGlobalAxios.onPost('/api/v1/auth/refresh').replyOnce(200, {
        success: true,
        data: {
          access_token: 'correctly-extracted-token',
          expires_in: 3600,
          token_type: 'Bearer',
        },
        timestamp: '2025-10-16T12:00:00Z',
      });

      mockAxios.onGet('/api/test').replyOnce(200, { success: true, data: {} });

      await apiClient.get('/api/test');

      // Verify token was extracted from response.data.data.access_token
      expect(currentToken).toBe('correctly-extracted-token');
    });

    it('should only refresh token once for multiple concurrent 401s', async () => {
      currentToken = 'expired-token';
      let refreshCallCount = 0;

      // First requests all fail with 401
      mockAxios.onGet('/api/test1').replyOnce(401);
      mockAxios.onGet('/api/test2').replyOnce(401);
      mockAxios.onGet('/api/test3').replyOnce(401);

      // Track refresh calls (uses global axios)
      mockGlobalAxios.onPost('/api/v1/auth/refresh').reply(() => {
        refreshCallCount++;
        return [
          200,
          {
            success: true,
            data: {
              access_token: 'new-token',
              expires_in: 3600,
              token_type: 'Bearer',
            },
            timestamp: new Date().toISOString(),
          },
        ];
      });

      // Retry requests succeed
      mockAxios.onGet('/api/test1').reply(200, { success: true, data: {} });
      mockAxios.onGet('/api/test2').reply(200, { success: true, data: {} });
      mockAxios.onGet('/api/test3').reply(200, { success: true, data: {} });

      // Fire 3 concurrent requests
      await Promise.all([
        apiClient.get('/api/test1'),
        apiClient.get('/api/test2'),
        apiClient.get('/api/test3'),
      ]);

      // Should only refresh once due to promise caching
      expect(refreshCallCount).toBe(1);
      expect(currentToken).toBe('new-token');
    });

    it('should reject all pending requests if token refresh fails', async () => {
      currentToken = 'expired-token';

      mockAxios.onGet('/api/test').reply(401);

      // Refresh fails with 401 (refresh token expired, uses global axios)
      mockGlobalAxios.onPost('http://localhost:3000/api/v1/auth/refresh').reply(401, {
        success: false,
        error: 'Refresh token expired',
      });

      await expect(apiClient.get('/api/test')).rejects.toThrow();
      expect(currentToken).toBe('expired-token'); // Token not updated
    });

    it('should not retry on 401 if URL is /api/v1/auth/refresh', async () => {
      currentToken = 'some-token';

      // Refresh endpoint itself returns 401 - should not trigger infinite loop
      mockAxios.onPost('/api/v1/auth/refresh').reply(401, {
        success: false,
        error: 'Refresh token invalid',
      });

      // Make request directly to refresh endpoint
      await expect(apiClient.post('/api/v1/auth/refresh')).rejects.toThrow();

      // Should only be called once (no retry attempt)
      expect(mockAxios.history.post.filter((r) => r.url === '/api/v1/auth/refresh').length).toBe(1);
    });

    it('should not retry on 401 if URL is /api/auth/login', async () => {
      currentToken = null;

      mockAxios.onPost('/api/v1/auth/login').replyOnce(401, {
        success: false,
        error: 'Invalid credentials',
      });

      await expect(
        apiClient.post('/api/v1/auth/login', {
          email: 'test@example.com',
          password: 'wrong',
        })
      ).rejects.toThrow();

      // Should not attempt refresh
      expect(
        mockAxios.history.post.filter((h: AxiosRequestConfig) => h.url === '/api/v1/auth/refresh')
          .length
      ).toBe(0);
    });

    it('should pass through non-401 errors without retry', async () => {
      currentToken = 'valid-token';

      mockAxios.onGet('/api/test').reply(500, {
        success: false,
        error: 'Internal server error',
      });

      await expect(apiClient.get('/api/test')).rejects.toThrow();

      // Should not attempt refresh
      expect(mockAxios.history.post.length).toBe(0);
    });

    it('should handle 401 errors without response data gracefully', async () => {
      currentToken = 'expired-token';

      // 401 with no response body
      mockAxios.onGet('/api/test').replyOnce(401);

      mockGlobalAxios.onPost('/api/v1/auth/refresh').replyOnce(200, {
        success: true,
        data: {
          access_token: 'new-token',
          expires_in: 3600,
          token_type: 'Bearer',
        },
        timestamp: new Date().toISOString(),
      });

      mockAxios.onGet('/api/test').replyOnce(200, { success: true, data: {} });

      const response = await apiClient.get('/api/test');
      expect(response.status).toBe(200);
      expect(currentToken).toBe('new-token');
    });
  });

  describe('Base URL Configuration', () => {
    it('should use API_URL from environment if set', () => {
      // Note: This test validates configuration at import time
      // Actual baseURL depends on import.meta.env.VITE_API_URL
      expect(apiClient.defaults.baseURL).toBeDefined();
    });

    it('should set withCredentials to true for cookie support', () => {
      expect(apiClient.defaults.withCredentials).toBe(true);
    });

    it('should set default headers', () => {
      expect(apiClient.defaults.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('Token Accessor Edge Cases', () => {
    it('should handle missing token accessors gracefully', async () => {
      // Reset to no accessors
      setAuthTokenAccessors(
        () => null,
        () => {}
      );

      mockAxios.onGet('/api/test').reply((config: AxiosRequestConfig) => {
        expect(config.headers?.Authorization).toBeUndefined();
        return [200, { success: true, data: {} }];
      });

      await apiClient.get('/api/test');
    });

    it('should not call updateAccessToken if token extraction fails', async () => {
      currentToken = 'expired-token';
      const updateSpy = vi.fn();

      setAuthTokenAccessors(() => currentToken, updateSpy);

      mockAxios.onGet('/api/test').replyOnce(401);

      // Refresh returns malformed response (missing data.access_token, uses global axios)
      mockGlobalAxios.onPost('http://localhost:3000/api/v1/auth/refresh').replyOnce(200, {
        success: true,
        data: {
          // Missing access_token field
          expires_in: 3600,
        },
        timestamp: new Date().toISOString(),
      });

      try {
        await apiClient.get('/api/test');
      } catch {
        // Expected to fail
      }

      // updateAccessToken should not be called with undefined
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('Request Config Preservation', () => {
    it('should preserve original request config when retrying after token refresh', async () => {
      currentToken = 'expired-token';

      const customHeaders = { 'X-Custom-Header': 'test-value' };
      const requestConfig = {
        headers: customHeaders,
        params: { filter: 'active' },
      };

      mockAxios.onGet('/api/test').replyOnce(401);

      // Refresh token (uses global axios)
      mockGlobalAxios.onPost('/api/v1/auth/refresh').replyOnce(200, {
        success: true,
        data: {
          access_token: 'new-token',
          expires_in: 3600,
          token_type: 'Bearer',
        },
        timestamp: new Date().toISOString(),
      });

      mockAxios.onGet('/api/test').replyOnce((config: AxiosRequestConfig) => {
        // Check custom header preserved
        expect(config.headers?.['X-Custom-Header']).toBe('test-value');
        // Check query params preserved
        expect(config.params?.filter).toBe('active');
        // Check new auth header added
        expect(config.headers?.Authorization).toBe('Bearer new-token');
        return [200, { success: true, data: {} }];
      });

      await apiClient.get('/api/test', requestConfig);
    });
  });
});
