import { useCallback, useEffect, useLayoutEffect, useState, useMemo, useRef } from 'react';
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
 * `?handoff=<base64-json>`. Mirrors the `POST /api/v1/auth/signup`
 * response EXACTLY (snake_case field names, full `user` object). Keep
 * this in sync with `packages/backend/src/api/routes/signup.ts`.
 */
interface OnboardingHandoff {
  access_token: string;
  api_key: string;
  user: User;
  organization: { id: string; name: string; subdomain: string; trial_ends_at?: string };
  project: { id: string; name: string };
}

/**
 * Normalize a base64-encoded querystring value so `atob` accepts it.
 *
 * `URLSearchParams` decodes `+` to a space, and if the producer used
 * URL-safe base64 (`-`/`_` instead of `+`/`/`) we need to map it
 * back. Re-pad to a multiple of 4 since URL-safe encoders often
 * drop padding.
 */
function normalizeBase64(raw: string): string {
  const normalized = raw.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  return normalized + '='.repeat(padLen);
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
 *
 * UTF-8 handling: `atob` returns a binary string, so for non-ASCII
 * names (Cyrillic, Kazakh) we go through `TextDecoder` to reinterpret
 * the bytes as UTF-8 — otherwise JSON.parse either throws or returns
 * mojibake for ru/kk users.
 */
function decodeHandoff(raw: string | null): OnboardingHandoff | null {
  if (!raw) {
    return null;
  }
  try {
    const binary = atob(normalizeBase64(raw));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const json = new TextDecoder().decode(bytes);
    const parsed: unknown = JSON.parse(json);

    // Strict `typeof` checks on every field the page actually renders
    // or passes to the auth context. Truthy-only checks would let a
    // payload with `user.email: 123` or `access_token: {}` through
    // and then crash at `.split('@')` or seed auth with garbage.
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const p = parsed as Record<string, unknown>;
    const user = p.user as Record<string, unknown> | undefined;
    const organization = p.organization as Record<string, unknown> | undefined;
    const project = p.project as Record<string, unknown> | undefined;

    if (
      typeof p.access_token !== 'string' ||
      typeof p.api_key !== 'string' ||
      !user ||
      typeof user !== 'object' ||
      typeof user.id !== 'string' ||
      typeof user.email !== 'string' ||
      !organization ||
      typeof organization !== 'object' ||
      typeof organization.id !== 'string' ||
      typeof organization.name !== 'string' ||
      typeof organization.subdomain !== 'string' ||
      !project ||
      typeof project !== 'object' ||
      typeof project.id !== 'string'
    ) {
      return null;
    }

    return parsed as OnboardingHandoff;
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

  // Capture the handoff ONCE on first render. Using `useState` with
  // an initializer (not `useMemo`) guarantees a stable value across
  // re-renders even if React Router ever starts reflecting
  // `replaceState` URL changes into `searchParams`. A stale/empty
  // handoff after strip-on-mount would otherwise flip to null and
  // re-trigger the /login-redirect branch.
  //
  // Fragment (`#handoff=`) is the PREFERRED source — fragments are
  // never sent to servers or included in `Referer` headers, so the
  // plaintext API key doesn't leak to access logs, CDNs, or any
  // third-party resource the page loads. Query (`?handoff=`) is
  // accepted as a fallback for backward compatibility; the landing
  // signup form should emit fragment form when shipped.
  const [handoff] = useState<OnboardingHandoff | null>(() => {
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('handoff');
    const fromQuery = searchParams.get('handoff');
    return decodeHandoff(fromHash || fromQuery);
  });

  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  // Keyed by a short field id (`'key'`, `'snippet'`) so a second
  // click on the same button cancels the pending "revert to Copy
  // state" timer from the first click instead of racing it. Using a
  // record also keeps the ref bounded — timers self-delete on fire,
  // so it can't grow unbounded over a long session.
  const copyTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Strip the handoff value BEFORE the first paint so it can't be
  // copy-pasted out of the address bar even for a single frame.
  // `useEffect` fires after commit/paint; `useLayoutEffect` fires
  // synchronously after DOM mutations but before the browser paints.
  //
  // Runs regardless of whether decode succeeded — even a malformed
  // `handoff=` value shouldn't linger in the URL during the redirect
  // to /login. Also cleans both query and fragment sources.
  //
  // Using `window.history.replaceState` directly (rather than
  // `setSearchParams({...}, { replace: true })`) because the
  // fragment is the PRIMARY source of the handoff and react-router's
  // hooks don't touch the hash — a clean strip of both pieces
  // requires URL surgery. The router's internal location stays
  // unsynced with the scrubbed URL until the next navigation, but
  // nothing in this flow re-reads the URL via the router after
  // mount (handoff was captured via useState initializer already).
  useLayoutEffect(() => {
    const sanitized = new URL(window.location.href);
    let dirty = false;

    if (sanitized.searchParams.has('handoff')) {
      sanitized.searchParams.delete('handoff');
      dirty = true;
    }

    // URL fragment: parse existing hash as kv pairs, drop only
    // `handoff`, keep any other unrelated fragment state.
    if (sanitized.hash.includes('handoff')) {
      const hashParams = new URLSearchParams(sanitized.hash.slice(1));
      if (hashParams.has('handoff')) {
        hashParams.delete('handoff');
        const remaining = hashParams.toString();
        sanitized.hash = remaining ? `#${remaining}` : '';
        dirty = true;
      }
    }

    if (dirty) {
      window.history.replaceState({}, '', sanitized.pathname + sanitized.search + sanitized.hash);
    }
    // Run once per unique handoff — the normal case is a one-shot
    // mount, but a future remount would re-sanitize if somehow the
    // param came back.
  }, [handoff]);

  // Seed auth context and handle the missing-handoff redirect after
  // commit. Separate from the URL strip above because `login()`
  // triggers context updates that shouldn't block paint.
  useEffect(() => {
    if (!handoff) {
      navigate('/login', { replace: true });
      return;
    }
    // Replay the signup-response auth tokens into the context. The
    // refresh cookie is already set on `.kz.bugspotter.io` by the
    // backend, so a page refresh will still recover via /auth/refresh.
    login(handoff.access_token, '', handoff.user);
  }, [handoff, login, navigate]);

  // Clear any pending copy-feedback timers on unmount.
  useEffect(() => {
    const timers = copyTimersRef.current;
    return () => {
      for (const id of Object.values(timers)) {
        clearTimeout(id);
      }
    };
  }, []);

  // Empty shell while the effect above redirects.
  if (!handoff) {
    return null;
  }

  const installSnippet = useMemo(
    () =>
      // `JSON.stringify` so single-quotes, backslashes, or newlines
      // in a key / id (unlikely, but cheap defense) don't break the
      // generated snippet or enable string-injection into the copy.
      `import { BugSpotter } from '@bugspotter/sdk';

BugSpotter.init({
  apiKey: ${JSON.stringify(handoff.api_key)},
  projectId: ${JSON.stringify(handoff.project.id)},
});`,
    [handoff.api_key, handoff.project.id]
  );

  const copyToClipboard = useCallback(
    async (fieldId: string, value: string, setCopied: (v: boolean) => void, successKey: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        toast.success(t(successKey));
        // Cancel any pending revert from a previous click on the same
        // button so rapid re-clicks don't cause the "Copied" label to
        // flicker back to "Copy" while the user is still reading it.
        const existing = copyTimersRef.current[fieldId];
        if (existing) {
          clearTimeout(existing);
        }
        const id = setTimeout(() => {
          setCopied(false);
          delete copyTimersRef.current[fieldId];
        }, 2000);
        copyTimersRef.current[fieldId] = id;
      } catch {
        toast.error(t('errors.failedToCopyToClipboard'));
      }
    },
    [t]
  );

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
              {handoff.api_key}
            </code>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                copyToClipboard('key', handoff.api_key, setCopiedKey, 'onboarding.apiKey.copied')
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
              copyToClipboard(
                'snippet',
                installSnippet,
                setCopiedSnippet,
                'onboarding.install.copied'
              )
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
