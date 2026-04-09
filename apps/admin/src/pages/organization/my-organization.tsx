/**
 * My Organization — Dashboard
 * Shows organization overview: name, plan, trial countdown, quick stats.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CreditCard, BarChart3, Users } from 'lucide-react';
import { useOrganization } from '../../contexts/organization-context';
import { organizationService } from '../../services/organization-service';
import { getQuotaProgressColor } from '../../lib/quota-utils';
import { Link } from 'react-router-dom';
import type { ResourceType } from '../../types/organization';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // Milliseconds in a day (86400000)

/**
 * Calculates days remaining until a future date.
 * @param endDate - ISO 8601 date string or Date object
 * @returns Days remaining (0 if expired), or null if no date provided
 */
function calculateDaysRemaining(endDate: string | Date | null | undefined): number | null {
  if (!endDate) {
    return null;
  }
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate;
  const diffMs = end.getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / MS_PER_DAY));
}

export default function MyOrganizationPage() {
  const { t } = useTranslation();
  const { currentOrganization: org } = useOrganization();

  const { data: quota } = useQuery({
    queryKey: ['organization-quota', org?.id],
    queryFn: () => organizationService.getQuota(org!.id),
    enabled: !!org,
  });

  const { data: subscription } = useQuery({
    queryKey: ['organization-subscription', org?.id],
    queryFn: () => organizationService.getSubscription(org!.id),
    enabled: !!org,
  });

  const { data: members } = useQuery({
    queryKey: ['organization-members', org?.id],
    queryFn: () => organizationService.getMembers(org!.id),
    enabled: !!org,
  });

  if (!org) {
    return null;
  }

  const trialDaysLeft = calculateDaysRemaining(org.trial_ends_at);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{org.name}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {org.subdomain} &middot; {org.data_residency_region.toUpperCase()}
        </p>
      </div>

      {/* Trial banner */}
      {org.subscription_status === 'trial' && trialDaysLeft !== null && (
        <div
          data-testid="trial-banner"
          className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg"
        >
          <p className="text-sm text-blue-800">
            {t('organization.trialBanner', { days: trialDaysLeft })}
          </p>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Link
          to="/my-organization/usage"
          className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-sm transition-shadow"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <BarChart3 className="w-5 h-5 text-blue-600" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs text-gray-500">{t('organization.plan')}</p>
              <p className="text-lg font-semibold capitalize">
                {subscription?.plan_name || org.subscription_status}
              </p>
            </div>
          </div>
        </Link>

        <Link
          to="/my-organization/members"
          className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-sm transition-shadow"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-50 rounded-lg">
              <Users className="w-5 h-5 text-green-600" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs text-gray-500">{t('organization.teamMembers')}</p>
              <p className="text-lg font-semibold">{members?.length ?? '—'}</p>
            </div>
          </div>
        </Link>

        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-50 rounded-lg">
              <CreditCard className="w-5 h-5 text-purple-600" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs text-gray-500">{t('organization.billingStatus')}</p>
              <p className="text-lg font-semibold capitalize">{subscription?.status || '—'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick quota overview */}
      {quota && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-500">{t('organization.quotaOverview')}</h2>
            <Link to="/my-organization/usage" className="text-xs text-primary hover:underline">
              {t('organization.viewAll')}
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {(
              Object.entries(quota.resources) as [
                ResourceType,
                { current: number; limit: number },
              ][]
            ).map(([type, resource]) => {
              const pct =
                resource.limit > 0 ? Math.round((resource.current / resource.limit) * 100) : 0;
              return (
                <div key={type}>
                  <p className="text-xs text-gray-500 mb-1">
                    {t(`organization.resources.${type}`)}
                  </p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-sm font-medium">{pct}%</span>
                    <span className="text-xs text-gray-400">{t('organization.used')}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                    <div
                      className={`h-1.5 rounded-full ${getQuotaProgressColor(pct)}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
