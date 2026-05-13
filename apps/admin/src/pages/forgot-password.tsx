import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Mail, ArrowLeft } from 'lucide-react';
import { authService } from '../services/api';
import { handleApiError } from '../lib/api-client';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { AuthPageLayout } from '../components/auth/auth-page-layout';

/**
 * Email-entry page for the password-reset flow. Always renders a
 * generic success state after submit — the backend treats unknown
 * emails the same as known ones (anti-enumeration), so the UI must
 * not branch on the response either.
 */
export default function ForgotPasswordPage() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const locale = ['en', 'ru', 'kk'].includes(i18n.language)
        ? (i18n.language as 'en' | 'ru' | 'kk')
        : 'en';
      await authService.requestPasswordReset(email, locale);
      setSubmitted(true);
    } catch (error) {
      // Backend always returns 200; the only way here is network /
      // rate-limit (429) / 5xx. Surface generic toast and let the
      // user retry — don't latch into the success state.
      toast.error(handleApiError(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthPageLayout
      title={t('auth.forgotPasswordTitle')}
      description={t('auth.forgotPasswordDescription')}
    >
      {submitted ? (
        <div className="space-y-4">
          <div
            className="bg-blue-50 border border-blue-200 rounded-md p-4 text-sm text-blue-900"
            data-testid="forgot-password-success"
          >
            {t('auth.forgotPasswordSuccess')}
          </div>
          <Link
            to="/login"
            className="inline-flex items-center text-sm text-blue-600 hover:underline"
          >
            <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" />
            {t('auth.backToLogin')}
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('auth.emailAddress')}
            type="email"
            placeholder="admin@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" className="w-full" isLoading={isLoading}>
            <Mail className="w-4 h-4 mr-2" aria-hidden="true" />
            {isLoading ? t('auth.sending') : t('auth.sendResetLink')}
          </Button>
          <div className="text-center">
            <Link to="/login" className="text-sm text-blue-600 hover:underline">
              {t('auth.backToLogin')}
            </Link>
          </div>
        </form>
      )}
    </AuthPageLayout>
  );
}
