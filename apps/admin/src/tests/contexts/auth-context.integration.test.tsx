/**
 * Auth Context Integration Tests
 * Tests the auth context with actual API calls using MSW (Mock Service Worker)
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { AuthProvider, useAuth } from '../../contexts/auth-context';

// Mock navigate
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Setup MSW server with absolute URLs for happy-dom compatibility
const API_BASE = 'http://localhost:3000';

// Create response handlers
const setupStatusHandler = () =>
  HttpResponse.json({
    success: true,
    data: {
      initialized: true,
      requiresSetup: false,
      setupMode: 'minimal' as const,
    },
  });

const tokenRefreshHandler = () =>
  HttpResponse.json({
    success: true,
    data: {
      access_token: 'refreshed-access-token',
      expires_in: 3600,
      token_type: 'Bearer',
    },
  });

const logoutHandler = () =>
  HttpResponse.json({
    success: true,
  });

const server = setupServer(
  // Default handlers with absolute URLs
  http.get(`${API_BASE}/api/v1/setup/status`, setupStatusHandler),
  http.post(`${API_BASE}/api/v1/auth/refresh`, tokenRefreshHandler),
  http.post(`${API_BASE}/api/v1/auth/logout`, logoutHandler)
);
describe('Auth Context Integration Tests', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'warn' });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    // Set full location object for MSW compatibility
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'http://localhost:3000',
        protocol: 'http:',
        host: 'localhost:3000',
        hostname: 'localhost',
        port: '3000',
        pathname: '/',
        search: '',
        hash: '',
        href: 'http://localhost:3000/',
      },
      writable: true,
    });
  });
  afterEach(() => {
    server.resetHandlers();
    sessionStorage.clear();
  });

  afterAll(() => {
    server.close();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <BrowserRouter>
      <AuthProvider>{children}</AuthProvider>
    </BrowserRouter>
  );

  describe('Setup Status Integration', () => {
    it('should redirect to /setup when API returns uninitialized status', async () => {
      // Override setup status endpoint (both absolute and relative URLs)
      const uninitializedResponse = () =>
        HttpResponse.json({
          success: true,
          data: {
            initialized: false,
            requiresSetup: true,
            setupMode: 'minimal' as const,
          },
        });

      server.use(http.get(`${API_BASE}/api/v1/setup/status`, uninitializedResponse));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/setup');
    });

    it('should handle API errors gracefully', async () => {
      // Setup endpoint returns 500
      const errorResponse = () => new HttpResponse(null, { status: 500 });

      server.use(http.get(`${API_BASE}/api/v1/setup/status`, errorResponse));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should not redirect on API error
      expect(mockNavigate).not.toHaveBeenCalledWith('/setup');
    });

    it('should handle network errors gracefully', async () => {
      // Setup endpoint throws network error
      const networkError = () => HttpResponse.error();

      server.use(http.get(`${API_BASE}/api/v1/setup/status`, networkError));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should not redirect on network error
      expect(mockNavigate).not.toHaveBeenCalledWith('/setup');
    });
  });

  describe('Token Refresh Integration', () => {
    it('should refresh token successfully with stored user', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin' as const,
        created_at: '2025-01-01T00:00:00Z',
      };

      sessionStorage.setItem('user', JSON.stringify(mockUser));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).toEqual(mockUser);
      expect(result.current.accessToken).toBe('refreshed-access-token');
    });

    it('should handle token refresh failure', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin' as const,
        created_at: '2025-01-01T00:00:00Z',
      };

      sessionStorage.setItem('user', JSON.stringify(mockUser));

      // Token refresh fails
      const refreshFail = () => new HttpResponse(null, { status: 401 });

      server.use(http.post(`${API_BASE}/api/v1/auth/refresh`, refreshFail));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
      expect(sessionStorage.getItem('user')).toBeNull();
    });

    it('should handle missing access token in refresh response', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin' as const,
        created_at: '2025-01-01T00:00:00Z',
      };

      sessionStorage.setItem('user', JSON.stringify(mockUser));

      // Token refresh returns invalid response (will cause TypeError when accessing undefined.access_token)
      const invalidRefresh = () =>
        HttpResponse.json({
          success: true,
          data: {
            // Missing access_token - this will cause authService.refreshToken() to throw
            expires_in: 3600,
            token_type: 'Bearer',
          },
        });

      server.use(http.post(`${API_BASE}/api/v1/auth/refresh`, invalidRefresh));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // The auth context should catch the error from authService.refreshToken() and redirect
      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(false);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
      expect(sessionStorage.getItem('user')).toBeNull();
    });

    it('should abort token refresh on unmount', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin' as const,
        created_at: '2025-01-01T00:00:00Z',
      };

      sessionStorage.setItem('user', JSON.stringify(mockUser));

      // Make token refresh slow
      const slowRefresh = async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return HttpResponse.json({
          success: true,
          data: {
            access_token: 'slow-token',
            expires_in: 3600,
            token_type: 'Bearer',
          },
        });
      };

      server.use(http.post(`${API_BASE}/api/v1/auth/refresh`, slowRefresh));

      const { unmount } = renderHook(() => useAuth(), { wrapper });

      // Unmount quickly
      await new Promise((resolve) => setTimeout(resolve, 100));
      unmount();

      // Wait a bit more
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // State should not have been updated
      // (Can't check result after unmount, but test shouldn't crash)
    });
  });

  describe('Logout Integration', () => {
    it('should call logout API and clear state', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin' as const,
        created_at: '2025-01-01T00:00:00Z',
      };

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Login
      result.current.login('access-token', 'refresh-token', mockUser);

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      // Track logout API call
      let logoutCalled = false;
      const logoutSuccess = () => {
        logoutCalled = true;
        return HttpResponse.json({ success: true });
      };

      server.use(http.post(`${API_BASE}/api/v1/auth/logout`, logoutSuccess));

      // Logout
      await result.current.logout();

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(false);
      });

      expect(logoutCalled).toBe(true);
      expect(result.current.user).toBeNull();
      expect(result.current.accessToken).toBeNull();
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });

    it('should clear state even if logout API fails', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin' as const,
        created_at: '2025-01-01T00:00:00Z',
      };

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Login
      result.current.login('access-token', 'refresh-token', mockUser);

      // Logout API fails
      const logoutFail = () => new HttpResponse(null, { status: 500 });

      server.use(http.post(`${API_BASE}/api/v1/auth/logout`, logoutFail));

      // Logout should still work
      await result.current.logout();

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle rapid setup status changes', async () => {
      let requestCount = 0;
      const rapidStatusChange = () => {
        requestCount++;
        // First request: not initialized
        // Subsequent requests: initialized
        const initialized = requestCount > 1;

        return HttpResponse.json({
          success: true,
          data: {
            initialized,
            requiresSetup: !initialized,
            setupMode: 'minimal' as const,
          },
        });
      };

      server.use(http.get(`${API_BASE}/api/v1/setup/status`, rapidStatusChange));

      const { result, rerender } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should have redirected to setup on first mount
      expect(mockNavigate).toHaveBeenCalledWith('/setup');

      // Rerender (simulating component update)
      rerender();

      // Should not redirect again
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent login and token refresh', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin' as const,
        created_at: '2025-01-01T00:00:00Z',
      };

      sessionStorage.setItem('user', JSON.stringify(mockUser));

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Wait for initial mount and setup check
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Call login after mount (token refresh may have already completed)
      result.current.login('new-access-token', 'new-refresh-token', {
        ...mockUser,
        name: 'Updated User',
      });

      await waitFor(() => {
        expect(result.current.user?.name).toBe('Updated User');
      });

      // Login should update user data
      expect(result.current.user?.name).toBe('Updated User');
      // Token will be the last one set (could be from login or refresh)
      expect(result.current.accessToken).toBeTruthy();
    });
  });
});
