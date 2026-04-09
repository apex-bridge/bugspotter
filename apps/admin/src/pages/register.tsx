import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Info, UserPlus } from 'lucide-react';
import { useAuth } from '../contexts/auth-context';
import { authService } from '../services/api';
import { handleApiError } from '../lib/api-client';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { useSetupGuard } from '../hooks/use-setup-guard';
import { useInvitationPreview } from '../hooks/use-invitation-preview';
import { SetupLoadingScreen } from '../components/auth/setup-loading-screen';
import { InvitationBanner } from '../components/auth/invitation-banner';
import { AuthPageLayout } from '../components/auth/auth-page-layout';

export default function RegisterPage() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [requireInvitation, setRequireInvitation] = useState<boolean | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { isChecking, isInitialized } = useSetupGuard();

  const inviteToken = searchParams.get('invite_token');
  // When registering via invitation, auto-accept already handles it — go straight to org
  const postRegisterPath = inviteToken ? '/my-organization' : '/';

  const loginLink = `/login${inviteToken ? `?invite_token=${encodeURIComponent(inviteToken)}` : ''}`;

  const invitePreview = useInvitationPreview(inviteToken);

  // Check if invitation is required for registration
  useEffect(() => {
    if (!isInitialized) {
      return;
    }
    authService.getRegistrationStatus().then(
      (status) => setRequireInvitation(status.requireInvitation),
      () => setRequireInvitation(true) // restrictive default: block on API failure
    );
  }, [isInitialized]);

  // Pre-fill email from invitation preview
  useEffect(() => {
    if (invitePreview) {
      setEmail((prev) => prev || invitePreview.email);
    }
  }, [invitePreview]);

  const emailLockedByInvitation = !!invitePreview;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error(t('auth.passwordMismatch'));
      return;
    }

    setIsLoading(true);

    try {
      const response = await authService.register(
        email,
        password,
        name || undefined,
        inviteToken || undefined
      );
      login(response.access_token, '', response.user);
      toast.success(t('auth.registrationSuccess'));
      navigate(postRegisterPath);
    } catch (error) {
      toast.error(handleApiError(error));
    } finally {
      setIsLoading(false);
    }
  };

  if (isChecking) {
    return <SetupLoadingScreen />;
  }

  // Invitation required but no token — show message instead of form
  if (requireInvitation && !inviteToken) {
    return (
      <AuthPageLayout title={t('auth.registerTitle')} description={t('auth.registerDescription')}>
        <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
          <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('auth.registrationRequiresInvitation')}</span>
        </div>
        <p className="mt-4 text-center text-sm text-gray-600">
          {t('auth.haveAccount')}{' '}
          <Link to="/login" className="text-blue-600 hover:underline font-medium">
            {t('auth.signIn')}
          </Link>
        </p>
      </AuthPageLayout>
    );
  }

  return (
    <AuthPageLayout title={t('auth.registerTitle')} description={t('auth.registerDescription')}>
      {inviteToken && (
        <InvitationBanner
          preview={invitePreview}
          i18nKeyWithOrg="auth.inviteBannerRegisterWithOrg"
          i18nKeyFallback="auth.inviteBannerRegister"
        />
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={`${t('auth.fullName')} (${t('common.optional')})`}
          type="text"
          placeholder={t('auth.fullNamePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label={t('auth.emailAddress')}
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          readOnly={emailLockedByInvitation}
          className={emailLockedByInvitation ? 'bg-gray-50 text-gray-500' : ''}
          helperText={emailLockedByInvitation ? t('auth.emailLockedByInvitation') : undefined}
        />
        <Input
          label={t('auth.password')}
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          helperText={t('auth.passwordHelperText')}
        />
        <Input
          label={t('auth.confirmPassword')}
          type="password"
          placeholder="••••••••"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
          helperText={t('auth.confirmPasswordHelperText')}
        />
        <Button type="submit" className="w-full" isLoading={isLoading}>
          <UserPlus className="w-4 h-4 mr-2" aria-hidden="true" />
          {isLoading ? t('auth.registering') : t('auth.registerButton')}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-600">
        {t('auth.haveAccount')}{' '}
        <Link to={loginLink} className="text-blue-600 hover:underline font-medium">
          {t('auth.signIn')}
        </Link>
      </p>
    </AuthPageLayout>
  );
}
