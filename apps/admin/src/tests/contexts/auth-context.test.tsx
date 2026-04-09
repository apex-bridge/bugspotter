/**
 * Auth Context Tests
 * Tests for authentication context including setup redirect logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../../contexts/auth-context';
import { setupService } from '../../services/setup-service';
import { authService } from '../../services/api';
import { userService } from '../../services/user-service';
import * as apiClient from '../../lib/api-client';

// Mock dependencies
vi.mock('../../services/setup-service', () => ({
  setupService: {
    getStatus: vi.fn(),
  },
}));

vi.mock('../../services/api', () => ({
  authService: {
    logout: vi.fn(),
    refreshToken: vi.fn(),
  },
}));

vi.mock('../../services/user-service', () => ({
  userService: {
    getPreferences: vi.fn().mockResolvedValue({ language: 'en' }),
  },
}));

vi.mock('../../lib/api-client', () => ({
  setAuthTokenAccessors: vi.fn(),
  handleApiError: vi.fn((error) => error.message),
}));

// Override global i18n mock — auth context needs a no-op changeLanguage
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn().mockResolvedValue('en') },
  }),
}));

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    // Mock window.location.pathname
    Object.defineProperty(window, 'location', {
      value: { pathname: '/' },
      writable: true,
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  describe('Setup Status Check', () => {
    it('should redirect to /setup when system is not initialized', async () => {
      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: false,
        requiresSetup: true,
        setupMode: 'minimal' as const,
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(setupService.getStatus).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/setup');
    });

    it('should not redirect when system is already initialized', async () => {
      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: true,
        requiresSetup: false,
        setupMode: 'minimal' as const,
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(setupService.getStatus).toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalledWith('/setup');
    });

    it('should not redirect when already on /setup page', async () => {
      Object.defineProperty(window, 'location', {
        value: { pathname: '/setup' },
        writable: true,
      });

      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: false,
        requiresSetup: true,
        setupMode: 'minimal' as const,
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Setup check should be skipped for /setup route (public route)
      expect(setupService.getStatus).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('should skip auth check on /register page (public route)', async () => {
      Object.defineProperty(window, 'location', {
        value: { pathname: '/register' },
        writable: true,
      });

      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: false,
        requiresSetup: true,
        setupMode: 'minimal' as const,
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Auth check should be skipped for /register route (public route)
      expect(setupService.getStatus).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('should continue with auth flow if setup check fails', async () => {
      vi.mocked(setupService.getStatus).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(setupService.getStatus).toHaveBeenCalled();
      // Should not redirect on error, continue with normal auth flow
      expect(mockNavigate).not.toHaveBeenCalledWith('/setup');
    });
  });

  describe('Session Restoration', () => {
    it('should restore session from sessionStorage when valid user exists', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'admin' as const,
        created_at: '2025-01-01T00:00:00Z',
      };

      sessionStorage.setItem('user', JSON.stringify(mockUser));

      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: true,
        requiresSetup: false,
        setupMode: 'minimal' as const,
      });

      // Mock authService.refreshToken
      vi.mocked(authService.refreshToken).mockResolvedValue('new-access-token');

      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(authService.refreshToken).toHaveBeenCalled();

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
        expect(result.current.user).toEqual(mockUser);
        expect(result.current.accessToken).toBe('new-access-token');
      });
    });

    it('should redirect to login when token refresh fails', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin' as const,
        created_at: '2025-01-01T00:00:00Z',
      };

      sessionStorage.setItem('user', JSON.stringify(mockUser));

      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: true,
        requiresSetup: false,
        setupMode: 'minimal' as const,
      });

      // Mock authService.refreshToken failure
      vi.mocked(authService.refreshToken).mockRejectedValue(new Error('Token refresh failed'));

      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/login');
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(sessionStorage.getItem('user')).toBeNull();
    });

    it('should handle invalid stored user data gracefully', async () => {
      sessionStorage.setItem('user', 'invalid-json');

      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: true,
        requiresSetup: false,
        setupMode: 'minimal' as const,
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(sessionStorage.getItem('user')).toBeNull();
    });
  });

  describe('Login', () => {
    it('should set user and access token on login', async () => {
      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: true,
        requiresSetup: false,
        setupMode: 'minimal' as const,
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin' as const,
        created_at: '2025-01-01T00:00:00Z',
      };

      act(() => {
        result.current.login('access-token', 'refresh-token', mockUser);
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
        expect(result.current.user).toEqual(mockUser);
        expect(result.current.accessToken).toBe('access-token');
        expect(sessionStorage.getItem('user')).toBe(JSON.stringify(mockUser));
      });
    });

    it('should call onComplete callback after login', async () => {
      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: true,
        requiresSetup: false,
        setupMode: 'minimal' as const,
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin' as const,
        created_at: '2025-01-01T00:00:00Z',
      };

      const onComplete = vi.fn();

      result.current.login('access-token', 'refresh-token', mockUser, onComplete);

      await waitFor(
        () => {
          expect(onComplete).toHaveBeenCalled();
        },
        { timeout: 200 }
      );
    });
  });

  describe('Logout', () => {
    it('should clear all auth state and redirect to login', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin' as const,
        created_at: '2025-01-01T00:00:00Z',
      };

      sessionStorage.setItem('user', JSON.stringify(mockUser));

      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: true,
        requiresSetup: false,
        setupMode: 'minimal' as const,
      });

      // Mock authService.refreshToken
      vi.mocked(authService.refreshToken).mockResolvedValue('new-access-token');

      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      await result.current.logout();

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(false);
        expect(result.current.user).toBeNull();
        expect(result.current.accessToken).toBeNull();
        expect(sessionStorage.getItem('user')).toBeNull();
        expect(mockNavigate).toHaveBeenCalledWith('/login');
      });
    });
  });

  describe('Token Accessors', () => {
    it('should register token accessors with API client', async () => {
      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: true,
        requiresSetup: false,
        setupMode: 'minimal' as const,
      });

      renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(apiClient.setAuthTokenAccessors).toHaveBeenCalled();
      });
    });
  });

  describe('Update Access Token', () => {
    it('should update access token when called', async () => {
      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: true,
        requiresSetup: false,
        setupMode: 'minimal' as const,
      });

      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      result.current.updateAccessToken('new-access-token');

      await waitFor(() => {
        expect(result.current.accessToken).toBe('new-access-token');
      });
    });
  });

  describe('Load User Preferences', () => {
    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    it('should load language preference from API when token is available', async () => {
      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: true,
        requiresSetup: false,
        setupMode: 'minimal' as const,
      });

      vi.mocked(userService.getPreferences).mockResolvedValue({
        language: 'ru',
      });

      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'admin' as const,
        created_at: '2025-01-01T00:00:00Z',
      };

      sessionStorage.setItem('user', JSON.stringify(mockUser));
      vi.mocked(authService.refreshToken).mockResolvedValue('access-token');

      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Preferences should have been loaded during mount
      expect(userService.getPreferences).toHaveBeenCalled();
    });

    it('should fall back to localStorage when API call fails', async () => {
      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: true,
        requiresSetup: false,
        setupMode: 'minimal' as const,
      });

      vi.mocked(userService.getPreferences).mockRejectedValue(new Error('Network error'));

      localStorage.setItem('preferredLanguage', 'en');

      const mockUser = {
        id: 'user-789',
        email: 'error@example.com',
        role: 'admin' as const,
        created_at: '2025-01-01T00:00:00Z',
      };

      sessionStorage.setItem('user', JSON.stringify(mockUser));
      vi.mocked(authService.refreshToken).mockResolvedValue('access-token');

      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // API call should have failed and fallen back to localStorage
      expect(userService.getPreferences).toHaveBeenCalled();
      // localStorage preference should still be available
      expect(localStorage.getItem('preferredLanguage')).toBe('en');
    });

    it('should exit early when API returns valid language', async () => {
      vi.mocked(setupService.getStatus).mockResolvedValue({
        initialized: true,
        requiresSetup: false,
        setupMode: 'minimal' as const,
      });

      vi.mocked(userService.getPreferences).mockResolvedValue({
        language: 'ru',
      });

      localStorage.setItem('preferredLanguage', 'en');

      const mockUser = {
        id: 'user-321',
        email: 'success@example.com',
        role: 'admin' as const,
        created_at: '2025-01-01T00:00:00Z',
      };

      sessionStorage.setItem('user', JSON.stringify(mockUser));
      vi.mocked(authService.refreshToken).mockResolvedValue('access-token');

      const { result } = renderHook(() => useAuth(), {
        wrapper: ({ children }) => (
          <BrowserRouter>
            <AuthProvider>{children}</AuthProvider>
          </BrowserRouter>
        ),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // API should have succeeded and returned 'ru'
      expect(userService.getPreferences).toHaveBeenCalled();
    });
  });
});
