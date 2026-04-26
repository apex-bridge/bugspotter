import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle2, AlertTriangle, Loader2, Mail } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { authService } from '../services/api';
import { handleApiError } from '../lib/api-client';
import { useAuth } from '../contexts/auth-context';

type Status = 'verifying' | 'success' | 'invalid' | 'noToken';

/**
 * Public landing for the `?token=...` link sent in the post-signup
 * verification email. Consumes the token via `POST /auth/verify-email`,
 * then renders one of three terminal states (success / invalid /
 * no-token).
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
  //   - `/verify-email`           → param missing → render no-token UI, don't strip
  //   - `/verify-email?token=`    → param present but empty → render invalid UI, still strip
  //   - `/verify-email?token=abc` → present + non-empty → verify, then render success/invalid, strip
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
  // StrictMode runs effects twice in dev; verify-email is idempotent
  // server-side (already-verified is a generic 400) but a double-fire
  // would briefly flash the success state before the second call
  // resolves to invalid. Guard with a ref so only the first attempt
  // drives the UI.
  const startedRef = useRef(false);

  // Strip `?token=` from the address bar — but only after the verify
  // call settles successfully, so a transient network error during
  // the in-flight call leaves the token in the URL and the user can
  // recover by refreshing the page instead of returning to their
  // email client. The empty-`?token=` case (param present, no value)
  // strips immediately because there's nothing to retry.
  //
  // We use `setSearchParams` (rather than `window.history.replaceState`)
  // to keep React Router's location in sync with the URL; the prev-
  // function form preserves any unrelated query params.
  useEffect(() => {
    const shouldStrip = status === 'success' || (hasTokenParam && !token);
    if (!shouldStrip) {
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('token');
        return next;
      },
      { replace: true }
    );
  }, [status, hasTokenParam, token, setSearchParams]);

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
      } catch {
        setStatus('invalid');
      }
    })();
  }, [token]);

  const handleResend = useCallback(async () => {
    setResending(true);
    try {
      await authService.resendVerification();
      toast.success(t('verifyEmailPage.resend.success'));
    } catch (error) {
      toast.error(handleApiError(error) || t('verifyEmailPage.resend.error'));
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
              {t('verifyEmailPage.success.cta')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // status === 'invalid' || status === 'noToken'
  const isInvalid = status === 'invalid';
  const titleKey = isInvalid ? 'verifyEmailPage.invalid.title' : 'verifyEmailPage.noToken.title';
  const descKey = isInvalid
    ? 'verifyEmailPage.invalid.description'
    : 'verifyEmailPage.noToken.description';

  return (
    <div className="max-w-xl mx-auto p-6" data-testid="verify-email-error">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isInvalid ? (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            ) : (
              <Mail className="h-5 w-5 text-muted-foreground" />
            )}
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
