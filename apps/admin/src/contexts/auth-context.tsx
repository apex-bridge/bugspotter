import {
  createContext,
  useContext,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  ReactNode,
} from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { setAuthTokenAccessors } from '../lib/api-client';
import { authService } from '../services/api';
import { setupService } from '../services/setup-service';
import { userService } from '../services/user-service';
import type { User, LanguageCode } from '../types';

// Validate language code against supported languages
const isValidLanguage = (code: unknown): code is LanguageCode => {
  return code === 'en' || code === 'ru' || code === 'kk';
};

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  accessToken: string | null;
  login: (accessToken: string, refreshToken: string, user: User, onComplete?: () => void) => void;
  logout: () => void;
  updateAccessToken: (newAccessToken: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // Store access token in memory only (cleared on page reload)
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { i18n } = useTranslation();

  // Load user language preference
  const loadUserPreferences = useCallback(
    async (currentAccessToken?: string | null) => {
      // Determine which token to use
      const tokenToUse = currentAccessToken !== undefined ? currentAccessToken : accessToken;

      // Try API call only if token is available
      if (tokenToUse) {
        try {
          // Try to get preferences from API
          const preferences = await userService.getPreferences();

          // Apply language preference if available and valid
          if (preferences.language && isValidLanguage(preferences.language)) {
            i18n.changeLanguage(preferences.language);
            return; // Success, exit early
          } else if (preferences.language) {
            // Log invalid language code in development
            if (import.meta.env.DEV) {
              console.warn('Invalid language code from API:', preferences.language);
            }
          }
        } catch (error) {
          // Log error in development for debugging
          if (import.meta.env.DEV) {
            console.warn('Failed to load user preferences from API:', error);
          }
          // Continue to localStorage fallback
        }
      }

      // Fallback to localStorage with validation (for both no-token and API-error cases)
      const savedLanguage = localStorage.getItem('preferredLanguage');
      if (savedLanguage && isValidLanguage(savedLanguage)) {
        i18n.changeLanguage(savedLanguage);
      } else if (savedLanguage) {
        // Clear invalid language from localStorage
        if (import.meta.env.DEV) {
          console.warn('Invalid language code in localStorage, clearing:', savedLanguage);
        }
        localStorage.removeItem('preferredLanguage');
      }
    },
    [i18n]
  );

  // Update both React state and the API client interceptor in one call.
  // Needed because useLayoutEffect([accessToken]) only fires after re-render,
  // but callers (initAuth, login) need the interceptor updated immediately.
  const applyToken = useCallback((token: string) => {
    setAccessToken(token);
    setAuthTokenAccessors(
      () => token,
      (t) => setAccessToken(t)
    );
  }, []);

  // Register token accessors with API client - must run synchronously before paint
  // Using useLayoutEffect to prevent race condition where API calls happen before accessors are updated
  useLayoutEffect(() => {
    setAuthTokenAccessors(
      () => accessToken,
      (token) => setAccessToken(token)
    );
  }, [accessToken]);

  useEffect(() => {
    const abortController = new AbortController();

    const initAuth = async () => {
      // Skip auth check for public routes. `/onboarding` is listed
      // because it bootstraps the auth session itself from a URL
      // handoff param on first load — if initAuth ran here it would
      // race the page's `login()` call and a failed refresh could
      // redirect to /login before onboarding finishes seeding state.
      // `/verify-email` is listed for the same reason, plus it's
      // routinely opened in a different browser from signup, so the
      // refresh-cookie probe is expected to fail and shouldn't bounce
      // the user away before the page renders the verify outcome.
      const isPublicRoute =
        location.pathname.startsWith('/shared/') ||
        location.pathname === '/login' ||
        location.pathname === '/register' ||
        location.pathname === '/setup' ||
        location.pathname === '/onboarding' ||
        location.pathname === '/verify-email';

      if (isPublicRoute) {
        setIsLoading(false);
        return;
      }

      // First, check if system requires setup
      try {
        const status = await setupService.getStatus();
        if (!status.initialized && window.location.pathname !== '/setup') {
          // System not initialized, redirect to setup
          navigate('/setup');
          setIsLoading(false);
          return;
        }
      } catch (error) {
        // If setup status check fails, continue with normal auth flow
        // (Backend might not have setup endpoint in older versions)
        if (import.meta.env.DEV) {
          console.warn('Setup status check failed:', error);
        }
      }

      // On mount, try to restore session using refresh token
      const storedUser = sessionStorage.getItem('user');

      if (storedUser && storedUser !== 'undefined' && storedUser !== 'null') {
        try {
          const userData = JSON.parse(storedUser);

          // Proactively refresh access token using httpOnly refresh cookie
          // Use authService which leverages api-client's token refresh logic
          const newAccessToken = await authService.refreshToken();

          // Check if component was unmounted during async operation
          if (abortController.signal.aborted) {
            return;
          }

          // Validate token before setting state
          if (!newAccessToken) {
            throw new Error('Token refresh returned empty access token');
          }

          // CRITICAL: Set token BEFORE user to ensure it's available when isAuthenticated becomes true
          applyToken(newAccessToken);
          setUser(userData);

          // Load user preferences with token passed explicitly to avoid race condition
          loadUserPreferences(newAccessToken);
        } catch (error) {
          // Don't update state if component unmounted
          if (abortController.signal.aborted) {
            return;
          }

          if (error instanceof Error && error.name === 'AbortError') {
            // Request was cancelled, don't show error
            return;
          }

          console.error('❌ Token refresh failed:', error);
          // Clear session and redirect to login
          sessionStorage.removeItem('user');
          setUser(null);
          navigate('/login');
        }
      }

      // Don't set loading false if aborted
      if (!abortController.signal.aborted) {
        setIsLoading(false);
      }
    };

    initAuth();

    // Cleanup: Abort any pending requests when component unmounts
    return () => {
      abortController.abort();
    };
  }, [navigate, location.pathname, applyToken, loadUserPreferences]);

  const login = useCallback(
    (accessToken: string, _refreshToken: string, userData: User, onComplete?: () => void) => {
      // Store access token in memory only (XSS protection)
      applyToken(accessToken);

      // Store user data in sessionStorage (cleared when tab closes)
      // Less risk than localStorage, but still consider moving to memory-only in future
      if (userData) {
        const userJson = JSON.stringify(userData);
        sessionStorage.setItem('user', userJson);
      }

      setUser(userData);

      // Load user preferences with token passed explicitly to avoid race condition
      // Token is set above but state update is async, so we pass it directly
      loadUserPreferences(accessToken);

      // Refresh token is now stored in httpOnly cookie by backend
      // No need to store it in frontend storage (XSS protection)

      // Call completion callback if provided
      if (onComplete) {
        setTimeout(onComplete, 100);
      }
    },
    [applyToken, loadUserPreferences]
  );

  const updateAccessToken = useCallback((newAccessToken: string) => {
    setAccessToken(newAccessToken);
  }, []);

  const logout = useCallback(async () => {
    try {
      // Call backend logout endpoint to clear httpOnly cookie
      await authService.logout();
    } catch (error) {
      console.error('Logout API call failed:', error);
      // Continue with local cleanup even if API fails
    }

    // Clear memory
    setAccessToken(null);
    setUser(null);

    // Clear sessionStorage
    sessionStorage.removeItem('user');

    // Clear any legacy storage items
    sessionStorage.removeItem('refresh_token');
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');

    navigate('/login');
  }, [navigate]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        accessToken,
        login,
        logout,
        updateAccessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
