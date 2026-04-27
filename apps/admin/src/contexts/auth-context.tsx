import {
  createContext,
  useContext,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { setAuthTokenAccessors } from '../lib/api-client';
import { authService } from '../services/api';
import { setupService } from '../services/setup-service';
import { userService } from '../services/user-service';
import type { User, LanguageCode } from '../types';

/**
 * Channel name for cross-tab session-replacement notifications.
 * Same-origin only — BroadcastChannel can't cross subdomains. The
 * cross-subdomain case (e.g. info@org-a.kz.bugspotter.io tab still
 * open while a new session starts on org-b.kz.bugspotter.io) needs
 * server-side session-id versioning to close, tracked separately.
 */
const AUTH_BROADCAST_CHANNEL = 'bugspotter-auth';

interface SessionReplacedMessage {
  type: 'session-replaced';
  userId: string | null;
  /** Sender tab's monotonic id, used to ignore self-echo on same tab. */
  senderTabId: string;
}

/**
 * Stable per-tab id so a tab can ignore its own broadcasts without
 * needing user-id equality (which would fail to dedupe a relogin
 * as the same user from the same tab — cheap but worth getting right).
 */
const TAB_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;

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
  const { t, i18n } = useTranslation();

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
      const isPublicRoute =
        location.pathname.startsWith('/shared/') ||
        location.pathname === '/login' ||
        location.pathname === '/register' ||
        location.pathname === '/setup' ||
        location.pathname === '/onboarding';

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

  /**
   * Wipe all client-side auth state (memory + sessionStorage +
   * legacy localStorage keys). Does NOT call the backend logout
   * endpoint and does NOT navigate — those are layered on top by
   * `logout()` and the broadcast listener for their own reasons
   * (logout: invalidate the refresh cookie server-side; broadcast
   * listener: avoid recursive logout-API calls when another tab
   * already invalidated the cookie).
   */
  const clearLocalSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('refresh_token');
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
  }, []);

  /**
   * Broadcast channel for cross-tab session-replacement signals.
   * Lazily initialized — feature-detect for environments without
   * BroadcastChannel (older Safari, jsdom test env). When unavailable
   * we silently degrade: same-tab login still works correctly,
   * cross-tab invalidation just doesn't fire.
   */
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }
    const channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
    broadcastChannelRef.current = channel;

    channel.onmessage = (event: MessageEvent<SessionReplacedMessage>) => {
      const data = event.data;
      if (!data || data.type !== 'session-replaced') {
        return;
      }
      // Ignore our own broadcasts. We use a per-tab id rather than
      // user-id equality so that a relogin as the SAME user from
      // a different tab still triggers our cleanup — different tab
      // means we have a different in-memory access_token that needs
      // replacing.
      if (data.senderTabId === TAB_ID) {
        return;
      }
      // Another tab on this origin just installed a different
      // identity. Our in-memory access_token is now stale (and
      // dangerous if it had elevated privileges that the new identity
      // doesn't). Wipe local state and bounce to /login so the next
      // page load re-authenticates against whatever cookie is now
      // in place.
      clearLocalSession();
      toast.info(t('auth.sessionReplacedByOtherTab'));
      navigate('/login', { replace: true });
    };

    return () => {
      channel.close();
      broadcastChannelRef.current = null;
    };
  }, [clearLocalSession, navigate, t]);

  const login = useCallback(
    (accessToken: string, _refreshToken: string, userData: User, onComplete?: () => void) => {
      // Wipe any stale state from a prior session BEFORE installing
      // the new identity. Without this, legacy localStorage keys
      // (`access_token` / `user` / `refresh_token`) from older
      // versions of the app, or stale `sessionStorage.user` from a
      // prior identity, could survive into the new session and bleed
      // through on the next storage-restore path.
      clearLocalSession();

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

      // Tell every other same-origin tab on this device that the
      // session for this app has been replaced — they should bail
      // out of any in-memory token they were holding. This is the
      // critical fix for the post-self-service-signup cross-identity
      // bleed where a stale platform-admin token in another tab kept
      // operating as platform admin against the newly-issued user's
      // refresh cookie. See AUTH_BROADCAST_CHANNEL doc above for the
      // (significant) cross-origin limitation.
      broadcastChannelRef.current?.postMessage({
        type: 'session-replaced',
        userId: userData?.id ?? null,
        senderTabId: TAB_ID,
      } satisfies SessionReplacedMessage);

      // Call completion callback if provided
      if (onComplete) {
        setTimeout(onComplete, 100);
      }
    },
    [applyToken, clearLocalSession, loadUserPreferences]
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

    clearLocalSession();
    navigate('/login');
  }, [clearLocalSession, navigate]);

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
