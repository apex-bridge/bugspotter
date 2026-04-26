import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import axios from 'axios';
import { CheckCircle2, AlertTriangle, Loader2, Mail, CloudOff } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { authService } from '../services/api';
import { handleApiError } from '../lib/api-client';
import { useAuth } from '../contexts/auth-context';

type Status = 'verifying' | 'success' | 'invalid' | 'transientError' | 'noToken';

/**
 * Classify a thrown verifyEmail error into terminal vs. retryable.
 *
 * Terminal (4xx): the token is genuinely dead — already used, expired,
 * or never existed. The "invalid or expired" message is correct.
 *
 * Retryable: 5xx responses (server hiccup), 429 (rate-limit hit — the
 * verify-email route is capped at 5/min per IP), or no response at
 * all (network/CORS failure). The token may still be valid in any of
 * these cases; we shouldn't tell the user their link is dead. We
 * also default to retryable for non-axios errors of unknown shape —
 * the conservative choice is to suggest a retry rather than declare
 * the link dead.
 */
function isTransientError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return true;
  }
  const status = error.response?.status;
  if (typeof status !== 'number') {
    return true;
  }
  return status === 429 || status >= 500;
}

/**
 * Public landing for the `?token=...` link sent in the post-signup
 * verification email. Consumes the token via `POST /auth/verify-email`,
 * then renders one of four terminal states (success / invalid /
 * transientError / noToken).
 *
 * Authentication is irrelevant for the verify call itself — the token
 * IS the auth — but matters for the recovery affordance: if the user
 * is signed in we offer a one-click "resend" button; otherwise we
 * point them to /login so they can request a fresh link from the
 * onboarding banner after signing in.
 */
export default function VerifyEmailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();

  // Capture both the token VALUE and whether the param was PRESENT,
  // once on first render. We need to distinguish:
  //   - `/verify-email`           → param missing → render no-token UI
  //   - `/verify-email?token=`    → param present but empty → render invalid UI
  //   - `/verify-email?token=abc` → present + non-empty → verify, then render terminal state
  // `searchParams.get` returns '' for an empty value, which would
  // collapse cases 1 and 2 if we relied on a single string variable.
  // Capturing in `useState` initializers keeps both stable across the
  // re-render that `setSearchParams` triggers when we strip below.
  const [{ token, hasTokenParam }] = useState<{
    token: string | null;
    hasTokenParam: boolean;
  }>(() => ({
    token: searchParams.get('token'),
    hasTokenParam: searchParams.has('token'),
  }));

  const [status, setStatus] = useState<Status>(() => {
    if (token) {
      return 'verifying';
    }
    return hasTokenParam ? 'invalid' : 'noToken';
  });
  const [resending, setResending] = useState(false);
  // StrictMode runs effects twice in dev. Without a guard, the
  // duplicate verify POST consumes the token on the first call and
  // then fails on the second, briefly flashing 'success' before
  // reverting to 'invalid'. The ref guard fires verify exactly once
  // per component instance.
  const startedRef = useRef(false);
  // Latches once the URL has been stripped so the strip effect can
  // never re-fire under any future router behavior change.
  const strippedRef = useRef(false);

  // Strip `?token=` from the address bar on mount, regardless of the
  // verify outcome. The token is auth-equivalent and shouldn't linger
  // in the URL — browser history persists it across sessions, and
  // (for cross-origin requests with non-strict referrer policies) it
  // can leak via `Referer`. Recovery from a transient verify failure
  // is via re-clicking the email link rather than refreshing this
  // page; the backend's `verifyEmail` is idempotent for an
  // already-verified user, so the email-reclick path is clean.
  //
  // We use `setSearchParams` (rather than `window.history.replaceState`)
  // to keep React Router's location in sync with the URL; the prev-
  // function form preserves any unrelated query params.
  useEffect(() => {
    if (strippedRef.current) {
      return;
    }
    if (!hasTokenParam) {
      return;
    }
    strippedRef.current = true;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('token');
        return next;
      },
      { replace: true }
    );
  }, [hasTokenParam, setSearchParams]);

  useEffect(() => {
    if (!token || startedRef.current) {
      return;
    }
    startedRef.current = true;

    // No `cancelled` flag here on purpose: the StrictMode dev-mode
    // setup → cleanup → setup cycle would set it true between the
    // first and second effect runs, and the ref guard would then
    // bail the second run without resetting it — leaving the page
    // stuck on the 'verifying' state when the in-flight verify
    // resolves. `token` comes from a `useState` initializer and
    // never changes for the life of the component, so a stale
    // resolution can't race a new verify, and React 18 silently
    // ignores `setState` on unmounted components.
    void (async () => {
      try {
        await authService.verifyEmail(token);
        setStatus('success');
      } catch (error) {
        // Distinguish terminal failures (4xx — token dead) from
        // transient ones (5xx, network) so we don't tell the user
        // their link is dead when the server just had a hiccup.
        setStatus(isTransientError(error) ? 'transientError' : 'invalid');
      }
    })();
  }, [token]);

  const handleResend = useCallback(async () => {
    setResending(true);
    try {
      await authService.resendVerification();
      toast.success(t('verifyEmailPage.resend.success'));
    } catch (error) {
      // `handleApiError` always returns a non-empty string (it falls
      // back to a generic English message when no axios response is
      // available), so a `|| t(...)` fallback would be dead code.
      // Match the pattern used in login.tsx and other admin pages.
      toast.error(handleApiError(error));
    } finally {
      setResending(false);
    }
  }, [t]);

  if (status === 'verifying') {
    return (
      <div
        className="max-w-xl mx-auto p-6 flex items-center gap-3 text-muted-foreground"
        data-testid="verify-email-loading"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>{t('verifyEmailPage.verifying')}</span>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="max-w-xl mx-auto p-6" data-testid="verify-email-success">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              {t('verifyEmailPage.success.title')}
            </CardTitle>
            <CardDescription>{t('verifyEmailPage.success.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              onClick={() => navigate(isAuthenticated ? '/' : '/login', { replace: true })}
              data-testid="verify-email-success-cta"
            >
              {t(isAuthenticated ? 'verifyEmailPage.success.cta' : 'auth.signIn')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Three error-shaped states share the same card layout. Pick the
  // copy and icon up front; the auth-state recovery affordance
  // (resend vs. sign-in) is shared across all three.
  let titleKey: string;
  let descKey: string;
  let icon: React.ReactNode;
  if (status === 'invalid') {
    titleKey = 'verifyEmailPage.invalid.title';
    descKey = 'verifyEmailPage.invalid.description';
    icon = <AlertTriangle className="h-5 w-5 text-destructive" />;
  } else if (status === 'transientError') {
    titleKey = 'verifyEmailPage.transientError.title';
    descKey = 'verifyEmailPage.transientError.description';
    icon = <CloudOff className="h-5 w-5 text-destructive" />;
  } else {
    // status === 'noToken'
    titleKey = 'verifyEmailPage.noToken.title';
    descKey = 'verifyEmailPage.noToken.description';
    icon = <Mail className="h-5 w-5 text-muted-foreground" />;
  }

  return (
    <div className="max-w-xl mx-auto p-6" data-testid="verify-email-error">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {icon}
            {t(titleKey)}
          </CardTitle>
          <CardDescription>{t(descKey)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {isAuthenticated ? (
            <Button
              type="button"
              onClick={handleResend}
              disabled={resending}
              data-testid="verify-email-resend"
            >
              {resending ? t('verifyEmailPage.resend.sending') : t('verifyEmailPage.resend.button')}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => navigate('/login')}
              data-testid="verify-email-sign-in"
            >
              {t('auth.signIn')}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
