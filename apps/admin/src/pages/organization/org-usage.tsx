/**
 * My Organization — Usage & Quotas
 * Shows quota progress bars for all resource types.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { useOrganization } from '../../contexts/organization-context';
import { organizationService } from '../../services/organization-service';
import { formatResourceValue } from '../../lib/format-utils';
import { getQuotaProgressColor, isQuotaCritical, isQuotaWarning } from '../../lib/quota-utils';
import type { ResourceType } from '../../types/organization';

export default function OrgUsagePage() {
  const { t } = useTranslation();
  const { currentOrganization: org } = useOrganization();

  const { data: quota, isLoading } = useQuery({
    queryKey: ['organization-quota', org?.id],
    queryFn: () => organizationService.getQuota(org!.id),
    enabled: !!org,
  });

  if (!org) {
    return null;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('organization.usageTitle')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('organization.usageDescription')}</p>
      </div>

      {isLoading ? (
        <div role="status" aria-live="polite" className="text-center py-12 text-gray-500">
          {t('common.loading')}
        </div>
      ) : !quota ? (
        <div className="text-center py-12 text-gray-500">{t('organization.noQuotaData')}</div>
      ) : (
        <>
          {/* Plan badge */}
          <div className="mb-6 flex items-center gap-3">
            <span
              data-testid="plan-badge"
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-100 text-blue-700 capitalize"
            >
              {quota.plan} plan
            </span>
            <span className="text-sm text-gray-500">
              {t('organization.period')}: {new Date(quota.period.start).toLocaleDateString('en-CA')}{' '}
              &ndash; {new Date(quota.period.end).toLocaleDateString('en-CA')}
            </span>
          </div>

          {/* Resource quotas */}
          <div className="space-y-4">
            {(
              Object.entries(quota.resources) as [
                ResourceType,
                { current: number; limit: number },
              ][]
            ).map(([type, resource]) => {
              const pct = resource.limit > 0 ? (resource.current / resource.limit) * 100 : 0;
              const isNearLimit = isQuotaWarning(pct);
              const isAtLimit = isQuotaCritical(pct);

              return (
                <div key={type} className="bg-white border border-gray-200 rounded-lg p-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-gray-400" aria-hidden="true" />
                      <span className="text-sm font-medium text-gray-700">
                        {t(`organization.resources.${type}`)}
                      </span>
                    </div>
                    <span className="text-sm text-gray-500">
                      {formatResourceValue(type, resource.current)} /{' '}
                      {formatResourceValue(type, resource.limit)}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      data-testid="quota-progress-bar"
                      className={`h-3 rounded-full transition-all ${getQuotaProgressColor(pct)}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-400">
                      {Math.round(pct)}% {t('organization.used')}
                    </span>
                    {isAtLimit && (
                      <span className="text-xs text-red-500 font-medium">
                        {t('organization.limitReached')}
                      </span>
                    )}
                    {isNearLimit && !isAtLimit && (
                      <span className="text-xs text-yellow-600 font-medium">
                        {t('organization.nearLimit')}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
