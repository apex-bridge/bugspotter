import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import axios from 'axios';
import { useAuth } from '../contexts/auth-context';
import { authService } from '../services/api';
import { handleApiError } from '../lib/api-client';
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
  const [accessRevoked, setAccessRevoked] = useState(false);
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

  // Login-specific post-setup logic: registration status + magic token
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
      },
      (error) => {
        // Non-critical — sign-up link stays hidden as a safe default
        if (import.meta.env.DEV) {
          console.warn('Failed to check registration status:', error);
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
        <Input
          label={t('auth.emailAddress')}
          type="email"
          placeholder="admin@example.com"
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
        <Button type="submit" className="w-full" isLoading={isLoading}>
          <LogIn className="w-4 h-4 mr-2" aria-hidden="true" />
          {isLoading ? t('auth.loggingIn') : t('auth.loginButton')}
        </Button>
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
