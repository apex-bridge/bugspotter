import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle2, AlertTriangle, Loader2, Mail } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { authService } from '../services/api';
import { handleApiError } from '../lib/api-client';
import { useAuth } from '../contexts/auth-context';

type Status = 'verifying' | 'success' | 'invalid' | 'no_token';

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
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();

  // Capture `?token=` ONCE on first render. The strip-on-mount below
  // mutates the URL via `history.replaceState`, and a future React
  // Router release that reflects that into `searchParams` would
  // otherwise flip the captured value to null and crash the state
  // machine mid-flight.
  const [token] = useState<string | null>(() => searchParams.get('token'));

  const [status, setStatus] = useState<Status>(token ? 'verifying' : 'no_token');
  const [resending, setResending] = useState(false);
  // StrictMode runs effects twice in dev; verify-email is idempotent
  // server-side (already-verified is a generic 400) but a double-fire
  // would briefly flash the success state before the second call
  // resolves to invalid. Guard with a ref so only the first attempt
  // drives the UI.
  const startedRef = useRef(false);

  // Strip `?token=` before paint so the link can't be replayed from
  // browser history. Run regardless of verify outcome — even an
  // invalid token shouldn't sit in the address bar.
  useLayoutEffect(() => {
    if (!token) {
      return;
    }
    const sanitized = new URL(window.location.href);
    if (!sanitized.searchParams.has('token')) {
      return;
    }
    sanitized.searchParams.delete('token');
    // Preserve react-router's `history.state` (scroll keys, idx) so
    // back/forward navigation isn't broken by the strip.
    window.history.replaceState(
      window.history.state,
      '',
      sanitized.pathname + sanitized.search + sanitized.hash
    );
  }, [token]);

  useEffect(() => {
    if (!token || startedRef.current) {
      return;
    }
    startedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        await authService.verifyEmail(token);
        if (!cancelled) {
          setStatus('success');
        }
      } catch {
        if (!cancelled) {
          setStatus('invalid');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
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

  // status === 'invalid' || status === 'no_token'
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
