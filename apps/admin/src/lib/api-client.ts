import axios, { AxiosError } from 'axios';
import { API_ENDPOINTS } from './api-constants';

// Runtime configuration from /config.js (injected by docker-entrypoint.sh)
// Falls back to build-time env var for local development
// Type definition in src/types/window.d.ts
const getRuntimeConfig = () => {
  return window.__RUNTIME_CONFIG__ || {};
};

/**
 * Backend API base URL. Read once at module load.
 * Single source of truth — `deployment-context.tsx` and the onboarding
 * page import this instead of duplicating the precedence chain.
 */
export const API_BASE_URL = getRuntimeConfig().apiUrl || import.meta.env.VITE_API_URL || '';

// Re-export API constants for convenience
export { API_VERSION, API_ENDPOINTS } from './api-constants';

// Store access token getter function that will be set by auth context
let getAccessToken: (() => string | null) | null = null;
let updateAccessToken: ((token: string) => void) | null = null;

// Promise caching to prevent multiple concurrent refresh calls
let refreshTokenPromise: Promise<string> | null = null;

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Important: Send cookies with requests (for httpOnly refresh token)
});

/**
 * Set token accessor functions from auth context
 * This allows the API client to access tokens without importing React context
 */
export const setAuthTokenAccessors = (
  getter: () => string | null,
  updater: (token: string) => void
) => {
  getAccessToken = getter;
  updateAccessToken = updater;
};

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
  // Get token from memory via accessor function (more secure than localStorage)
  const token = getAccessToken?.();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor to handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as typeof error.config & { _retry?: boolean };

    // Don't retry on auth endpoints (prevents infinite loops)
    const isAuthEndpoint =
      originalRequest.url?.includes('/auth/login') ||
      originalRequest.url?.includes('/auth/refresh');

    // If error is 401 and we haven't retried yet and it's not an auth endpoint
    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      originalRequest._retry = true;

      try {
        // Use cached promise if refresh already in progress (prevents multiple concurrent refreshes)
        if (!refreshTokenPromise) {
          refreshTokenPromise = (async () => {
            try {
              // Refresh token is in httpOnly cookie, backend reads it automatically
              const response = await axios.post(
                `${API_BASE_URL}${API_ENDPOINTS.auth.refresh()}`,
                {}, // Empty body - refresh token comes from cookie
                { withCredentials: true } // Critical: Send httpOnly cookie
              );

              const { access_token } = response.data.data;

              // Guard: Ensure token exists before updating
              if (!access_token) {
                throw new Error('No access_token in refresh response');
              }

              // Update access token in memory via accessor function
              if (updateAccessToken) {
                updateAccessToken(access_token);
              }

              return access_token;
            } finally {
              // Clear promise cache after completion (success or failure)
              refreshTokenPromise = null;
            }
          })();
        }

        // Wait for refresh to complete
        const access_token = await refreshTokenPromise;

        // Retry the original request with new token
        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed (invalid/expired cookie or network error)
        sessionStorage.removeItem('user');

        // Clear legacy localStorage items
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');

        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

/**
 * Pull the best human-readable text out of an error. Backend uses
 * two shapes — `AppError` populates `data.message`, ad-hoc
 * `reply.send` paths use `data.error` — and very rarely a raw
 * string body. Falls back to Axios's own message and a generic
 * last resort. Returns a string so all 30+ call sites stay simple
 * (most pipe straight into `toast.error()`).
 */
export const handleApiError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (typeof data === 'string' && data) {
      return data;
    }
    if (typeof data?.message === 'string' && data.message) {
      return data.message;
    }
    if (typeof data?.error === 'string' && data.error) {
      return data.error;
    }
    return error.message || 'An error occurred';
  }
  return 'An unexpected error occurred';
};
