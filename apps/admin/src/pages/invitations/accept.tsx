/**
 * Invitation Accept Page
 * Handles invitation acceptance via token in URL.
 * If authenticated: accepts invitation and redirects to org.
 * If not: redirects to login with invite_token preserved.
 * If email mismatch: shows actionable error with switch-account link.
 */

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { api, API_ENDPOINTS, handleApiError } from '../../lib/api-client';
import { useAuth } from '../../contexts/auth-context';
import type { OrganizationInvitation } from '../../types/organization';

export default function AcceptInvitationPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [invitation, setInvitation] = useState<OrganizationInvitation | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isEmailMismatch, setIsEmailMismatch] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage(t('organizations.invitations.noToken'));
      return;
    }

    // If not authenticated, redirect to register (invited users likely don't have an account yet).
    // The register page links to login for existing users.
    if (!user) {
      navigate(`/register?invite_token=${encodeURIComponent(token)}`);
      return;
    }

    // Accept the invitation
    const accept = async () => {
      try {
        const response = await api.post<{
          success: boolean;
          data: { invitation: OrganizationInvitation; joined: boolean };
        }>(API_ENDPOINTS.invitations.accept(), { token });
        setInvitation(response.data.data.invitation);
        setStatus('success');
      } catch (error) {
        setStatus('error');

        // Detect email mismatch (403 with EmailMismatch error code)
        if (axios.isAxiosError(error) && error.response?.status === 403) {
          const data = error.response.data;
          if (data?.error === 'EmailMismatch' && data?.details) {
            setIsEmailMismatch(true);
            setErrorMessage(
              t('organizations.invitations.emailMismatch', {
                invitationEmail: data.details?.invitation_email,
                currentEmail: data.details?.current_user_email,
              })
            );
            return;
          }
        }

        setErrorMessage(handleApiError(error));
      }
    };

    accept();
  }, [token, user, navigate, t]);

  // Auto-redirect after success, with cleanup on unmount
  useEffect(() => {
    if (status !== 'success') {
      return;
    }
    const timer = setTimeout(() => navigate('/my-organization'), 3000);
    return () => clearTimeout(timer);
  }, [status, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-lg p-8 text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="w-12 h-12 text-primary mx-auto mb-4 animate-spin" />
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              {t('organizations.invitations.accepting')}
            </h1>
            <p className="text-sm text-gray-500">
              {t('organizations.invitations.acceptingDescription')}
            </p>
          </>
        )}

        {status === 'success' && invitation && (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              {t('organizations.invitations.accepted')}
            </h1>
            <p className="text-sm text-gray-500 mb-4">
              {t('organizations.invitations.acceptedDescription', {
                org: invitation.organization_name || 'the organization',
              })}
            </p>
            <button
              onClick={() => navigate('/my-organization')}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90"
            >
              {t('organizations.invitations.continue')}
            </button>
            <p className="text-xs text-gray-400 mt-2">
              {t('organizations.invitations.redirecting')}
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              {t('organizations.invitations.error')}
            </h1>
            <p className="text-sm text-gray-500 mb-4">{errorMessage}</p>
            {isEmailMismatch && token ? (
              <button
                onClick={async () => {
                  await logout();
                  navigate(`/login?invite_token=${encodeURIComponent(token)}`);
                }}
                className="text-sm text-primary hover:underline"
              >
                {t('organizations.invitations.signInDifferent')}
              </button>
            ) : (
              <Link to="/" className="text-sm text-primary hover:underline">
                {t('organizations.invitations.goHome')}
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}
