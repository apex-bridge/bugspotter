import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Copy, Check, KeyRound, Mail, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { useAuth } from '../contexts/auth-context';
import type { User } from '../types';

/**
 * Shape of the handoff payload the landing page passes in via
 * `?handoff=<base64-json>`. Mirrors the important fields of the
 * `POST /api/v1/auth/signup` response. Keep this in sync with
 * `packages/backend/src/api/routes/signup.ts`.
 */
interface OnboardingHandoff {
  accessToken: string;
  apiKey: string;
  user: Pick<User, 'id' | 'email' | 'name' | 'role'>;
  organization: { id: string; name: string; subdomain: string };
  project: { id: string; name: string };
}

/**
 * Decode the `?handoff=<base64>` URL param. Returns `null` when
 * missing, malformed, or not JSON — caller redirects to `/login`
 * in that case.
 *
 * The payload travels through a cross-origin redirect from
 * `bugspotter.io/signup` to `{subdomain}.kz.bugspotter.io/onboarding`.
 * `localStorage` can't cross origins and the session cookie alone
 * doesn't carry the one-time plaintext API key, so the landing
 * page hands the entire signup response off through this param.
 *
 * The URL is `replaceState`-stripped immediately after decode so the
 * API key doesn't linger in history. A follow-up (R6 hardening) can
 * replace this with a short-lived server-side claim token if the
 * brief in-URL exposure proves unacceptable.
 */
function decodeHandoff(raw: string | null): OnboardingHandoff | null {
  if (!raw) {
    return null;
  }
  try {
    const json = atob(raw);
    const parsed = JSON.parse(json) as OnboardingHandoff;
    // Minimal shape check — anything missing means malformed handoff.
    if (
      !parsed.accessToken ||
      !parsed.apiKey ||
      !parsed.user?.id ||
      !parsed.organization?.subdomain ||
      !parsed.project?.id
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Post-signup landing page. Shows the one-time API key, an install
 * snippet the user can paste into their app, and a verification
 * banner. Deliberately minimal for R1 — the live-waiting UX, extension
 * deep-link, and "resend verification" affordance are tracked as
 * later slices.
 */
export default function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();

  const handoff = useMemo(() => decodeHandoff(searchParams.get('handoff')), [searchParams]);

  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Seed auth context + strip sensitive params from the URL once we
  // have the handoff. No deps on `login` / `navigate` (stable refs
  // from providers) because we only want to run this once per mount.
  useEffect(() => {
    if (!handoff) {
      navigate('/login', { replace: true });
      return;
    }
    // Replay the signup-response auth tokens into the context. The
    // refresh cookie is already set on `.kz.bugspotter.io` by the
    // backend, so a page refresh will still recover via /auth/refresh.
    login(handoff.accessToken, '', handoff.user as User);
    // Strip the handoff param from history so the API key can't be
    // copy-pasted out of the address bar or picked up by referer-
    // logging on subsequent navigations.
    window.history.replaceState({}, '', window.location.pathname);
    // Intentionally runs once on mount — `login` and `navigate` come
    // from stable context refs and adding them would re-trigger the
    // effect after the context update and reset the URL to its
    // already-stripped form.
  }, [handoff, login, navigate]);

  // Empty shell while the effect above redirects.
  if (!handoff) {
    return null;
  }

  const installSnippet = useMemo(
    () =>
      `import { BugSpotter } from '@bugspotter/sdk';

BugSpotter.init({
  apiKey: '${handoff.apiKey}',
  projectId: '${handoff.project.id}',
});`,
    [handoff.apiKey, handoff.project.id]
  );

  const copyToClipboard = async (
    value: string,
    setCopied: (v: boolean) => void,
    successKey: string
  ) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(t(successKey));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('errors.failedToCopyToClipboard'));
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6" data-testid="onboarding-page">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t('onboarding.title', { name: handoff.user.name || handoff.user.email.split('@')[0] })}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {t('onboarding.subtitle', { org: handoff.organization.name })}
        </p>
      </div>

      {/* Verification banner — display-only until backend ships
          `/auth/verify-email` + `/auth/resend-verification`. Tracked as
          a Phase-1 follow-up. */}
      <Alert data-testid="onboarding-verify-email">
        <Mail className="h-4 w-4" />
        <AlertTitle>{t('onboarding.verifyEmail.title')}</AlertTitle>
        <AlertDescription>
          {t('onboarding.verifyEmail.description', { email: handoff.user.email })}
        </AlertDescription>
      </Alert>

      <Card data-testid="onboarding-api-key-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {t('onboarding.apiKey.title')}
          </CardTitle>
          <CardDescription>{t('onboarding.apiKey.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('onboarding.apiKey.onceWarning.title')}</AlertTitle>
            <AlertDescription>{t('onboarding.apiKey.onceWarning.description')}</AlertDescription>
          </Alert>

          <div className="flex items-center gap-2">
            <code
              className="flex-1 font-mono text-sm bg-muted px-3 py-2 rounded border break-all"
              data-testid="onboarding-api-key-value"
            >
              {handoff.apiKey}
            </code>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                copyToClipboard(handoff.apiKey, setCopiedKey, 'onboarding.apiKey.copied')
              }
              data-testid="onboarding-api-key-copy"
            >
              {copiedKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span className="ml-2">{t(copiedKey ? 'common.copied' : 'common.copy')}</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="onboarding-install-card">
        <CardHeader>
          <CardTitle>{t('onboarding.install.title')}</CardTitle>
          <CardDescription>{t('onboarding.install.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre
            className="text-xs bg-muted px-3 py-2 rounded border overflow-x-auto whitespace-pre"
            data-testid="onboarding-install-snippet"
          >
            {installSnippet}
          </pre>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              copyToClipboard(installSnippet, setCopiedSnippet, 'onboarding.install.copied')
            }
            data-testid="onboarding-install-copy"
          >
            {copiedSnippet ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span className="ml-2">
              {t(copiedSnippet ? 'common.copied' : 'onboarding.install.copyButton')}
            </span>
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => navigate('/', { replace: true })}
          data-testid="onboarding-go-to-dashboard"
        >
          {t('onboarding.goToDashboard')}
        </Button>
      </div>
    </div>
  );
}
