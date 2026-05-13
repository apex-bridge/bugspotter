import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import axios from 'axios';
import { KeyRound, ArrowLeft } from 'lucide-react';
import { authService } from '../services/api';
import { handleApiError } from '../lib/api-client';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { AuthPageLayout } from '../components/auth/auth-page-layout';

/**
 * Public landing for the `?token=...` link in the password-reset
 * email. Accepts a new password + confirmation, posts to
 * `/auth/reset-password`, and routes to login on success.
 *
 * A 400 from the backend means the token is dead — show a terminal
 * "request a fresh link" state. Everything else (network, 429, 5xx)
 * is treated as transient via the generic toast.
 */
export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tokenDead, setTokenDead] = useState(false);

  if (!token) {
    return (
      <AuthPageLayout
        title={t('auth.resetPasswordTitle')}
        description={t('auth.resetPasswordTokenMissing')}
      >
        <Link
          to="/forgot-password"
          className="inline-flex items-center text-sm text-blue-600 hover:underline"
        >
          <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" />
          {t('auth.requestNewResetLink')}
        </Link>
      </AuthPageLayout>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error(t('auth.passwordMismatch'));
      return;
    }
    setIsLoading(true);
    try {
      await authService.resetPassword(token, password);
      toast.success(t('auth.resetPasswordSuccess'));
      navigate('/login', { replace: true });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 400) {
        setTokenDead(true);
      } else {
        toast.error(handleApiError(error));
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (tokenDead) {
    return (
      <AuthPageLayout
        title={t('auth.resetPasswordTitle')}
        description={t('auth.resetPasswordTokenDead')}
      >
        <Link
          to="/forgot-password"
          className="inline-flex items-center text-sm text-blue-600 hover:underline"
          data-testid="reset-password-token-dead"
        >
          <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" />
          {t('auth.requestNewResetLink')}
        </Link>
      </AuthPageLayout>
    );
  }

  return (
    <AuthPageLayout
      title={t('auth.resetPasswordTitle')}
      description={t('auth.resetPasswordDescription')}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={t('auth.newPassword')}
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
        />
        <Button type="submit" className="w-full" isLoading={isLoading}>
          <KeyRound className="w-4 h-4 mr-2" aria-hidden="true" />
          {isLoading ? t('auth.resetting') : t('auth.resetPasswordButton')}
        </Button>
      </form>
    </AuthPageLayout>
  );
}
