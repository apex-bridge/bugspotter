/**
 * Organization Billing Page
 * Shows current plan, upgrade options, and cancel subscription.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CreditCard, Check, AlertTriangle } from 'lucide-react';
import { useOrganization } from '../../contexts/organization-context';
import { organizationService } from '../../services/organization-service';
import { useOrgPermissions } from '../../hooks/use-org-permissions';
import type { PlanConfig } from '../../services/organization-service';

const GB = 1024 ** 3;

function formatQuota(key: string, value: number): string {
  if (key === 'storage_bytes') {
    return `${Math.round(value / GB)} GB`;
  }
  return value.toLocaleString();
}

const QUOTA_LABELS: Record<string, string> = {
  projects: 'billing.projects',
  bug_reports: 'billing.bugReports',
  storage_bytes: 'billing.storage',
  api_calls: 'billing.apiCalls',
};

export default function OrgBillingPage() {
  const { t } = useTranslation();
  const { currentOrganization } = useOrganization();
  const queryClient = useQueryClient();
  const { canManageBilling } = useOrgPermissions();
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const { data: plans } = useQuery<PlanConfig[]>({
    queryKey: ['billing-plans'],
    queryFn: () => organizationService.getPlans(),
  });

  const { data: subscription } = useQuery({
    queryKey: ['subscription', currentOrganization?.id],
    queryFn: () => organizationService.getSubscription(currentOrganization!.id),
    enabled: !!currentOrganization?.id,
  });

  const checkoutMutation = useMutation({
    mutationFn: (planName: string) =>
      organizationService.createCheckout(planName, window.location.href),
    onSuccess: (data) => {
      window.location.href = data.redirect_url;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => organizationService.cancelSubscription(),
    onSuccess: () => {
      setShowCancelConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
  });

  const currentPlan = subscription?.plan_name ?? 'trial';
  const isActive = subscription?.status === 'active';
  const isTrial = subscription?.status === 'trial';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('billing.title')}</h1>
        <p className="text-gray-500 mt-1">{t('billing.subtitle')}</p>
      </div>

      {/* Current plan card */}
      <div className="bg-white rounded-lg border p-6">
        <div className="flex items-center gap-3 mb-4">
          <CreditCard className="h-5 w-5 text-gray-500" aria-hidden="true" />
          <h2 className="text-lg font-semibold">{t('billing.currentPlan')}</h2>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-2xl font-bold capitalize">{currentPlan}</span>
          <span
            className={`px-2 py-1 rounded text-xs font-medium ${
              isActive
                ? 'bg-green-100 text-green-800'
                : isTrial
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-gray-100 text-gray-800'
            }`}
          >
            {subscription?.status ?? 'unknown'}
          </span>
          {subscription?.payment_provider && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 capitalize">
              {subscription.payment_provider}
            </span>
          )}
        </div>

        {canManageBilling && (isActive || isTrial) && !showCancelConfirm && (
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="mt-4 text-sm text-red-600 hover:text-red-700"
          >
            {t('billing.cancelSubscription')}
          </button>
        )}

        {canManageBilling && showCancelConfirm && (
          <div className="mt-4 p-4 border border-red-200 rounded-lg bg-red-50">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden="true" />
              <span className="font-medium text-red-800">{t('billing.cancelConfirmTitle')}</span>
            </div>
            <p className="text-sm text-red-700 mb-3">{t('billing.cancelConfirmMessage')}</p>
            <div className="flex gap-2">
              <button
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
              >
                {cancelMutation.isPending ? t('common.loading') : t('billing.confirmCancel')}
              </button>
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="px-3 py-1.5 bg-white text-gray-700 text-sm rounded border hover:bg-gray-50"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Plan cards */}
      {plans && (
        <div>
          <h2 className="text-lg font-semibold mb-4">{t('billing.availablePlans')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => {
              const isCurrent = currentPlan === plan.name;
              return (
                <div
                  key={plan.name}
                  className={`bg-white rounded-lg border p-6 ${isCurrent ? 'border-blue-500 ring-1 ring-blue-500' : ''}`}
                >
                  <h3 className="text-lg font-bold capitalize mb-2">{plan.name}</h3>
                  <ul className="space-y-2 text-sm text-gray-600 mb-4">
                    {Object.entries(plan.quotas)
                      .filter(([key]) => key in QUOTA_LABELS)
                      .map(([key, value]) => (
                        <li key={key} className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-green-500" aria-hidden="true" />
                          {formatQuota(key, value)} {t(QUOTA_LABELS[key])}
                        </li>
                      ))}
                  </ul>
                  {isCurrent ? (
                    <span className="block text-center text-sm font-medium text-blue-600">
                      {t('billing.currentPlanLabel')}
                    </span>
                  ) : canManageBilling ? (
                    <button
                      onClick={() => checkoutMutation.mutate(plan.name)}
                      disabled={checkoutMutation.isPending}
                      className="w-full px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {checkoutMutation.isPending ? t('common.loading') : t('billing.upgrade')}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {checkoutMutation.isError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {t('billing.checkoutError')}
        </div>
      )}
    </div>
  );
}
