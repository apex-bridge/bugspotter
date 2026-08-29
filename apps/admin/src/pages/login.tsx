import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import axios from 'axios';
import { useAuth } from '../contexts/auth-context';
import { authService } from '../services/api';
import { API_BASE_URL, API_ENDPOINTS, handleApiError } from '../lib/api-client';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '../components/ui/alert';
import { LogIn } from 'lucide-react';
import { useSetupGuard } from '../hooks/use-setup-guard';
import { useInvitationPreview } from '../hooks/use-invitation-preview';
import { SetupLoadingScreen } from '../components/auth/setup-loading-screen';
import { InvitationBanner } from '../components/auth/invitation-banner';
import { AuthPageLayout } from '../components/auth/auth-page-layout';

/**
 * Backend error code for "user authenticated but every org they
 * belong to is soft-deleted" — see auth.ts login handler. Surfaced
 * as an inline alert above the form rather than a generic toast so
 * the user gets a clear "this isn't a typo, your org is gone"
 * message instead of cycling through password attempts.
 */
const ERROR_CODE_ORG_ACCESS_REVOKED = 'OrgAccessRevoked';

export default function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [registrationAllowed, setRegistrationAllowed] = useState(false);
  const [passwordResetEnabled, setPasswordResetEnabled] = useState(false);
  const [accessRevoked, setAccessRevoked] = useState(false);
  // `null` = not yet resolved (including a failed status probe — see the
  // getSsoStatus().then rejection handler below). Password fields stay
  // hidden while this is `null`, so there's no flash of password UI on
  // first paint. Once resolved, `showPasswordForm` below is what actually
  // decides visibility — it isn't a bare `enforceSso === false` check.
  const [enforceSso, setEnforceSso] = useState<boolean | null>(null);
  // Host-resolved org id from getSsoStatus() — null until resolved, and
  // stays null in selfhosted mode / on the saas hub domain (see that
  // method's doc comment). Needed to build the OIDC login-initiation URL;
  // kept separate from `enforceSso` because the SSO button is offered
  // even when SSO isn't mandatory (AC #1 in spec #408).
  const [ssoTenantId, setSsoTenantId] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { isChecking, isInitialized } = useSetupGuard();

  /** Where to go after login — invitation accept page or default home */
  const inviteToken = searchParams.get('invite_token');
  const postLoginPath = inviteToken
    ? `/invitations/accept?token=${encodeURIComponent(inviteToken)}`
    : '/';

  const invitePreview = useInvitationPreview(inviteToken);

  // Pre-fill email from invitation preview
  useEffect(() => {
    if (invitePreview) {
      setEmail((prev) => prev || invitePreview.email);
    }
  }, [invitePreview]);

  const handleMagicLogin = useCallback(
    async (token: string) => {
      setIsLoading(true);
      try {
        const response = await authService.magicLogin(token);
        login(response.access_token, '', response.user);
        toast.success('Successfully logged in with magic link!');
        navigate(postLoginPath, { replace: true });
      } catch (error) {
        toast.error(handleApiError(error));
        // Remove token from URL on error
        navigate('/login', { replace: true });
      } finally {
        setIsLoading(false);
      }
    },
    [login, navigate, postLoginPath]
  );

  // Navigates the browser to the backend's OIDC login-initiation route
  // (#367, already merged), which redirects to the tenant's IdP. A real
  // navigation, not an XHR — the browser must leave the SPA for the IdP's
  // authorization endpoint and later land on the backend's callback route.
  // `ssoTenantId` is null in selfhosted mode and on the saas hub domain
  // (no host-resolved tenant) — selfhosted's own OIDC login route is
  // separate, not-`:tenant`-scoped work still tracked by #353 (ADR-0044
  // Decision 1's selfhosted note) and doesn't exist yet, so there's
  // nothing to navigate to there. Surface that as a visible error rather
  // than silently doing nothing, since the button is always rendered
  // (AC #1, spec #408) regardless of whether a tenant resolved.
  const handleSsoLogin = () => {
    if (!ssoTenantId) {
      toast.error(t('auth.ssoLoginUnavailable'));
      return;
    }
    window.location.href = `${API_BASE_URL}${API_ENDPOINTS.auth.ssoLogin(ssoTenantId)}`;
  };

  // Login-specific post-setup logic: registration status + SSO status + magic token
  useEffect(() => {
    if (!isInitialized) {
      return;
    }

    // Check registration status (fire-and-forget, non-blocking)
    authService.getRegistrationStatus().then(
      (status) => {
        // Show "Sign up" link only when registration is allowed AND
        // either open registration or an invite_token is present
        setRegistrationAllowed(status.allowed && (!status.requireInvitation || !!inviteToken));
        setPasswordResetEnabled(status.passwordResetEnabled);
      },
      (error) => {
        // Non-critical — sign-up and forgot-password links both stay
        // hidden as a safe default if the status probe fails.
        if (import.meta.env.DEV) {
          console.warn('Failed to check registration status:', error);
        }
      }
    );

    // Check SSO enforcement status (fire-and-forget, non-blocking). `?? false`
    // normalizes an absent flag to false so password fields render when
    // enforce_sso is false OR absent, not just when it's explicitly false.
    authService.getSsoStatus().then(
      (status) => {
        setEnforceSso(status.enforceSso ?? false);
        setSsoTenantId(status.tenantId ?? null);
      },
      (error) => {
        // Fail CLOSED to "unresolved" (not `false`) on a status-check
        // failure — unlike getRegistrationStatus() above, `false` here
        // isn't a safe default: it would render the password form as
        // though SSO were confirmed off, while the backend's
        // assertSsoNotEnforced (enforce-sso.ts) still fail-closes on the
        // real submit and 403s if SSO actually is enforced. That's a
        // misleading dead-end UI, not a bypass — but it's still worse
        // than staying in the pre-resolution state (SSO button only,
        // same as before this probe ever resolves) until a retry (e.g.
        // page reload) gets a real answer.
        if (import.meta.env.DEV) {
          console.warn('Failed to check SSO status:', error);
        }
      }
    );

    // Check for magic token in URL query parameter
    const magicToken = searchParams.get('token');
    if (magicToken) {
      handleMagicLogin(magicToken);
    }
  }, [isInitialized, searchParams, handleMagicLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Clear any prior access-revoked state so a successful retry
    // (e.g. with a different account) hides the alert.
    setAccessRevoked(false);

    try {
      const response = await authService.login(email, password);
      // Refresh token is now in httpOnly cookie, pass empty string for backward compat
      login(response.access_token, '', response.user);
      toast.success('Login successful');
      navigate(postLoginPath);
    } catch (error) {
      // Surface the SaaS-mode "every org you belong to is soft-
      // deleted" error as a dedicated alert instead of a toast —
      // it isn't a credential typo and a user retrying their
      // password won't fix it.
      if (
        axios.isAxiosError(error) &&
        error.response?.data?.error === ERROR_CODE_ORG_ACCESS_REVOKED
      ) {
        setAccessRevoked(true);
      } else {
        toast.error(handleApiError(error));
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (isChecking) {
    return <SetupLoadingScreen />;
  }

  // The password form (and its submit button) render whenever SSO
  // enforcement has resolved to "off" (`enforceSso === false`), OR
  // resolved to "on" but with no tenant-scoped SSO login target to
  // redirect to (`ssoTenantId` null) — selfhosted mode, or the saas hub
  // domain, per getSsoStatus()'s doc comment. That second case is a real
  // gap, not a hypothetical one: a selfhosted operator can set
  // `OIDC_ENFORCE_SSO=true` (ADR-0044 Decision 4) before the selfhosted
  // OIDC login route (#353) exists, and the always-rendered SSO button's
  // handleSsoLogin has nothing to navigate to (`ssoTenantId` is always
  // null off saas). Hiding the password form there leaves no clickable
  // path to authenticate at all. Showing it here is never a bypass: the
  // backend's assertSsoNotEnforced (enforce-sso.ts) is the actual
  // fail-closed gate on submit, and rejects with a clear 403 if SSO
  // really is enforced — this is only about giving the operator
  // something to click and a real error to read, instead of a blank gap
  // between an invisible form and a button that just toasts.
  // `enforceSso === null` (not yet resolved, or the status probe failed —
  // see the `getSsoStatus().then` rejection handler above) always hides
  // the form, matching the "no flash of password UI" intent this page
  // already had.
  const showPasswordForm = enforceSso === false || (enforceSso === true && !ssoTenantId);

  return (
    <AuthPageLayout title="BugSpotter Admin" description={t('auth.loginToContinue')}>
      {inviteToken && (
        <InvitationBanner
          preview={invitePreview}
          i18nKeyWithOrg="auth.inviteBannerWithOrg"
          i18nKeyFallback="auth.inviteBanner"
        />
      )}
      {accessRevoked && (
        <Alert variant="destructive" data-testid="login-access-revoked" className="mb-4">
          <AlertTitle>{t('auth.accessRevokedTitle')}</AlertTitle>
          <AlertDescription>{t('auth.accessRevokedMessage')}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        {showPasswordForm && (
          <>
            <Input
              label={t('auth.emailAddress')}
              type="email"
              placeholder={t('auth.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label={t('auth.password')}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </>
        )}
        {showPasswordForm && (
          <Button type="submit" className="w-full" isLoading={isLoading}>
            <LogIn className="w-4 h-4 mr-2" aria-hidden="true" />
            {isLoading ? t('auth.loggingIn') : t('auth.loginButton')}
          </Button>
        )}
        <Button type="button" onClick={handleSsoLogin} className="w-full" variant="outline">
          {t('auth.signInWithSso')}
        </Button>
        {passwordResetEnabled && showPasswordForm && (
          <div className="text-right">
            <Link to="/forgot-password" className="text-sm text-blue-600 hover:underline">
              {t('auth.forgotPassword')}
            </Link>
          </div>
        )}
      </form>
      {registrationAllowed && (
        <p className="mt-4 text-center text-sm text-gray-600">
          {t('auth.noAccount')}{' '}
          <Link
            to={`/register${inviteToken ? `?invite_token=${encodeURIComponent(inviteToken)}` : ''}`}
            className="text-blue-600 hover:underline font-medium"
          >
            {t('auth.signUp')}
          </Link>
        </p>
      )}
    </AuthPageLayout>
  );
}
