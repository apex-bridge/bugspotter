/**
 * Organization Route Guard
 * Ensures user has an organization before rendering children.
 * Redirects to projects page if no organization is available.
 */

import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useOrganization } from '../contexts/organization-context';

interface OrgRouteProps {
  children: React.ReactNode;
}

export function OrgRoute({ children }: OrgRouteProps) {
  const { t } = useTranslation();
  const { hasOrganization, isLoading } = useOrganization();

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="text-center py-12 text-gray-500">
        {t('common.loading')}
      </div>
    );
  }

  if (!hasOrganization) {
    return <Navigate to="/projects" replace />;
  }

  return <>{children}</>;
}
