/**
 * Platform Admin — Organization Detail
 * Shows organization overview, members, quota, and subscription info.
 */

import { useState, useRef, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Users,
  BarChart3,
  CreditCard,
  Building2,
  Mail,
  AlertTriangle,
  FolderKanban,
  Key,
  Copy,
  Check,
  Brain,
} from 'lucide-react';
import { organizationService } from '../../services/organization-service';
import { invoiceService } from '../../services/invoice-service';
import type { Invoice } from '../../services/invoice-service';
import { handleApiError } from '../../lib/api-client';
import { formatResourceValue } from '../../lib/format-utils';
import { getQuotaProgressColor } from '../../lib/quota-utils';
import { ChangePlanDialog } from '../../components/organizations/change-plan-dialog';
import { DeleteOrganizationDialog } from '../../components/organizations/delete-organization-dialog';
import { MembersTable } from '../../components/organizations/members-table';
import { InviteMemberForm } from '../../components/organizations/invite-member-form';
import { PendingInvitationsList } from '../../components/organizations/pending-invitations-list';
import { IntelligenceSettingsPanel } from '../../components/intelligence/intelligence-settings-panel';
import type {
  ResourceType,
  AdminSetPlanInput,
  InvitationRole,
  EmailLocale,
} from '../../types/organization';

const TABS = [
  'overview',
  'members',
  'projects',
  'quota',
  'subscription',
  'invitations',
  'intelligence',
] as const;
type Tab = (typeof TABS)[number];

const INVOICE_STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  canceled: 'bg-gray-100 text-gray-400',
};

const TAB_ICONS: Record<Tab, typeof Building2> = {
  overview: Building2,
  members: Users,
  projects: FolderKanban,
  quota: BarChart3,
  subscription: CreditCard,
  invitations: Mail,
  intelligence: Brain,
};

export default function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [selectedMemberUserId, setSelectedMemberUserId] = useState('');
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const { data: org, isLoading: orgLoading } = useQuery({
    queryKey: ['organization', id],
    queryFn: () => organizationService.getById(id!),
    enabled: !!id,
  });

  const { data: magicLoginStatus } = useQuery({
    queryKey: ['organization-magic-login', id],
    queryFn: () => organizationService.getMagicLoginStatus(id!),
    enabled: !!id && activeTab === 'overview',
  });

  const { data: members } = useQuery({
    queryKey: ['organization-members', id],
    queryFn: () => organizationService.getMembers(id!),
    enabled:
      !!id &&
      (activeTab === 'members' || (activeTab === 'overview' && magicLoginStatus?.allowed === true)),
  });

  const {
    data: projects,
    isLoading: projectsLoading,
    isError: projectsError,
  } = useQuery({
    queryKey: ['organization-projects', id],
    queryFn: () => organizationService.adminListProjects(id!),
    enabled: !!id && activeTab === 'projects',
  });

  const { data: quota } = useQuery({
    queryKey: ['organization-quota', id],
    queryFn: () => organizationService.getQuota(id!),
    enabled: !!id && (activeTab === 'quota' || activeTab === 'overview'),
  });

  const { data: subscription } = useQuery({
    queryKey: ['organization-subscription', id],
    queryFn: () => organizationService.getSubscription(id!),
    enabled: !!id && (activeTab === 'subscription' || activeTab === 'overview'),
  });

  const { data: invitations = [] } = useQuery({
    queryKey: ['organization-invitations', id],
    queryFn: () => organizationService.listInvitations(id!, true),
    enabled: !!id && activeTab === 'invitations',
  });

  const { data: orgInvoices } = useQuery({
    queryKey: ['organization-invoices', id],
    queryFn: () => invoiceService.adminListInvoices(id!),
    enabled: !!id && activeTab === 'subscription',
  });

  const markPaidMutation = useMutation({
    mutationFn: (invoiceId: string) => invoiceService.markPaid(invoiceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-invoices', id] });
      queryClient.invalidateQueries({ queryKey: ['organization-subscription', id] });
      toast.success(t('organizations.invoiceMarkedPaid'));
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  const [localBillingMethod, setLocalBillingMethod] = useState<'card' | 'invoice'>(
    org?.billing_method ?? 'card'
  );

  // Sync local state when org data loads or changes (e.g. after query invalidation)
  useEffect(() => {
    if (org?.billing_method) {
      setLocalBillingMethod(org.billing_method);
    }
  }, [org?.billing_method]);

  const billingMethodMutation = useMutation({
    mutationFn: (method: 'card' | 'invoice') =>
      organizationService.adminSetBillingMethod(id!, method),
    onMutate: (newMethod) => {
      const previousMethod = localBillingMethod;
      setLocalBillingMethod(newMethod);
      return { previousMethod };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization', id] });
      toast.success(t('organizations.billingMethodUpdated'));
    },
    onError: (error, _variables, context) => {
      if (context?.previousMethod) {
        setLocalBillingMethod(context.previousMethod);
      }
      toast.error(handleApiError(error));
    },
  });

  const [showChangePlan, setShowChangePlan] = useState(false);

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => organizationService.removeMember(id!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-members', id] });
      toast.success(t('organizations.memberRemoved'));
    },
    onError: () => toast.error(t('organizations.memberRemoveFailed')),
  });

  const changePlanMutation = useMutation({
    mutationFn: (input: AdminSetPlanInput) => organizationService.adminSetPlan(id!, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-subscription', id] });
      queryClient.invalidateQueries({ queryKey: ['organization', id] });
      queryClient.invalidateQueries({ queryKey: ['organization-quota', id] });
      toast.success(t('organizations.changePlan.success'));
      setShowChangePlan(false);
    },
    onError: (error) => toast.error(handleApiError(error) || t('organizations.changePlan.failed')),
  });

  const inviteMutation = useMutation({
    mutationFn: ({
      email,
      role,
      locale,
    }: {
      email: string;
      role: InvitationRole;
      locale?: EmailLocale;
    }) => organizationService.createInvitation(id!, { email, role, locale }, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-invitations', id] });
      toast.success(t('organizations.invitations.sent'));
    },
    onError: (error) =>
      toast.error(handleApiError(error) || t('organizations.invitations.sendFailed')),
  });

  const cancelInvitationMutation = useMutation({
    mutationFn: (invitationId: string) =>
      organizationService.cancelInvitation(id!, invitationId, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-invitations', id] });
      toast.success(t('organizations.invitations.canceled'));
    },
    onError: () => toast.error(t('organizations.invitations.cancelFailed')),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ permanent }: { permanent: boolean }) =>
      organizationService.adminDelete(id!, permanent),
    onSuccess: (result) => {
      setShowDeleteDialog(false);
      if (result.mode === 'hard') {
        toast.success(t('organizations.delete.hardSuccess'));
        navigate('/organizations');
      } else {
        toast.success(t('organizations.delete.softSuccess'));
        queryClient.invalidateQueries({ queryKey: ['organization', id] });
      }
    },
    onError: (error) => toast.error(handleApiError(error) || t('organizations.delete.failed')),
  });

  const toggleMagicLoginMutation = useMutation({
    mutationFn: (enabled: boolean) => organizationService.setMagicLoginStatus(id!, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-magic-login', id] });
      toast.success(t('organizations.magicLoginUpdated'));
    },
    onError: (error) =>
      toast.error(handleApiError(error) || t('organizations.magicLoginUpdateFailed')),
  });

  const generateMagicTokenMutation = useMutation({
    mutationFn: (userId: string) => organizationService.generateMagicToken(id!, userId, '30d'),
    onSuccess: (data) => {
      setGeneratedToken(data.token);
      toast.success(t('organizations.magicTokenGenerated'));
    },
    onError: (error) => toast.error(handleApiError(error) || t('organizations.magicTokenFailed')),
  });

  const restoreMutation = useMutation({
    mutationFn: () => organizationService.adminRestore(id!),
    onSuccess: () => {
      toast.success(t('organizations.restore.success'));
      queryClient.invalidateQueries({ queryKey: ['organization', id] });
    },
    onError: (error) => toast.error(handleApiError(error) || t('organizations.restore.failed')),
  });

  if (orgLoading) {
    return (
      <div role="status" aria-live="polite" className="text-center py-12 text-gray-500">
        {t('common.loading')}
      </div>
    );
  }

  if (!org) {
    return <div className="text-center py-12 text-gray-500">{t('organizations.notFound')}</div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/organizations"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          {t('organizations.backToList')}
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{org.name}</h1>
          <span
            role="status"
            aria-label={`Organization subdomain: ${org.subdomain}`}
            data-testid="subdomain-badge"
            className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700"
          >
            {org.subdomain}
          </span>
          {!org.deleted_at && (
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="ml-auto px-3 py-1.5 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50"
            >
              {t('organizations.delete.button')}
            </button>
          )}
        </div>
      </div>

      {/* Deleted banner */}
      {org.deleted_at && (
        <div className="flex items-center gap-3 rounded-md bg-amber-50 border border-amber-200 p-4 mb-6">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">
              {t('organizations.delete.alreadyDeleted')}
            </p>
            <p className="text-xs text-amber-600">
              {t('organizations.restore.banner', {
                date: new Date(org.deleted_at).toLocaleDateString('en-CA'),
              })}
            </p>
          </div>
          <button
            onClick={() => restoreMutation.mutate()}
            disabled={restoreMutation.isPending}
            className="px-3 py-1.5 text-sm font-medium text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100"
          >
            {t('organizations.restore.button')}
          </button>
        </div>
      )}

      {/* Delete dialog */}
      <DeleteOrganizationDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        orgId={id!}
        orgName={org.name}
        onDelete={(permanent) => deleteMutation.mutate({ permanent })}
        isDeleting={deleteMutation.isPending}
      />

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {TABS.map((tab) => {
            const Icon = TAB_ICONS[tab];
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t(`organizations.tabs.${tab}`)}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-4">{t('organizations.details')}</h3>
            <dl className="space-y-3">
              <div>
                <dt className="text-xs text-gray-400">{t('organizations.subdomain')}</dt>
                <dd className="text-sm font-medium">{org.subdomain}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">{t('organizations.region')}</dt>
                <dd className="text-sm font-medium uppercase">{org.data_residency_region}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">{t('common.status')}</dt>
                <dd className="text-sm font-medium">{org.subscription_status}</dd>
              </div>
              {org.trial_ends_at && (
                <div>
                  <dt className="text-xs text-gray-400">{t('organizations.trialEnds')}</dt>
                  <dd className="text-sm font-medium">
                    {new Date(org.trial_ends_at).toLocaleDateString('en-CA')}
                  </dd>
                </div>
              )}
              {org.pending_owner_email && (
                <div>
                  <dt className="text-xs text-gray-400">{t('organizations.pendingOwner')}</dt>
                  <dd className="text-sm font-medium text-amber-700">{org.pending_owner_email}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-gray-400">{t('common.date')}</dt>
                <dd className="text-sm font-medium">
                  {new Date(org.created_at).toLocaleDateString('en-CA')}
                </dd>
              </div>
              {magicLoginStatus && (
                <div>
                  <dt className="text-xs text-gray-400">{t('organizations.magicLogin')}</dt>
                  <dd className="text-sm font-medium flex items-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={magicLoginStatus.allowed}
                      aria-label={t('organizations.magicLogin')}
                      disabled={toggleMagicLoginMutation.isPending}
                      onClick={() => toggleMagicLoginMutation.mutate(!magicLoginStatus.allowed)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
                        magicLoginStatus.allowed ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                          magicLoginStatus.allowed ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className={magicLoginStatus.allowed ? 'text-green-600' : 'text-gray-400'}>
                      {magicLoginStatus.allowed
                        ? t('organizations.magicLoginAllowed')
                        : t('organizations.magicLoginDisabled')}
                    </span>
                  </dd>
                </div>
              )}
              {magicLoginStatus?.allowed && members && members.length > 0 && (
                <div>
                  <dt className="text-xs text-gray-400">{t('organizations.magicToken')}</dt>
                  <dd className="text-sm mt-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedMemberUserId}
                        onChange={(e) => setSelectedMemberUserId(e.target.value)}
                        aria-label={t('organizations.magicTokenSelectUser')}
                        className="text-sm border border-gray-300 rounded-md px-2 py-1.5 flex-1"
                      >
                        <option value="" disabled>
                          {t('organizations.magicTokenSelectUser')}
                        </option>
                        {members.map((m) => (
                          <option key={m.user_id} value={m.user_id}>
                            {m.user_name || m.user_email} ({m.role})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={generateMagicTokenMutation.isPending || !selectedMemberUserId}
                        onClick={() => {
                          if (selectedMemberUserId) {
                            setGeneratedToken(null);
                            setTokenCopied(false);
                            generateMagicTokenMutation.mutate(selectedMemberUserId);
                          }
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Key className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('organizations.magicTokenGenerate')}
                      </button>
                    </div>
                    {generatedToken && (
                      <div className="flex items-center gap-2 bg-gray-50 border rounded-md p-2">
                        <code className="text-xs flex-1 break-all select-all">
                          {generatedToken}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(generatedToken).catch(() => {
                              toast.error(t('common.copyFailed'));
                            });
                            setTokenCopied(true);
                            if (copyTimeoutRef.current) {
                              clearTimeout(copyTimeoutRef.current);
                            }
                            copyTimeoutRef.current = setTimeout(() => setTokenCopied(false), 2000);
                          }}
                          className="shrink-0 p-1 hover:bg-gray-200 rounded"
                          aria-label={t('common.copy')}
                        >
                          {tokenCopied ? (
                            <Check className="w-4 h-4 text-green-600" />
                          ) : (
                            <Copy className="w-4 h-4 text-gray-500" />
                          )}
                        </button>
                      </div>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </div>
          {subscription && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-4">
                {t('organizations.tabs.subscription')}
              </h3>
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs text-gray-400">{t('organizations.plan')}</dt>
                  <dd className="text-sm font-medium capitalize">{subscription.plan_name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">{t('organizations.billingStatus')}</dt>
                  <dd className="text-sm font-medium">{subscription.status}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">{t('organizations.currentPeriod')}</dt>
                  <dd className="text-sm font-medium">
                    {new Date(subscription.current_period_start).toLocaleDateString('en-CA')}{' '}
                    &ndash; {new Date(subscription.current_period_end).toLocaleDateString('en-CA')}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      )}

      {activeTab === 'members' && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <MembersTable
            members={members ?? []}
            onRemove={(userId) => removeMemberMutation.mutate(userId)}
          />
        </div>
      )}

      {activeTab === 'projects' && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {projectsLoading ? (
            <div role="status" aria-live="polite" className="text-center py-8 text-gray-400">
              {t('common.loading')}
            </div>
          ) : projectsError ? (
            <div role="alert" className="text-center py-8 text-red-500">
              {t('organizations.errors.loadProjectsFailed')}
            </div>
          ) : projects && projects.length > 0 ? (
            <table className="w-full text-sm">
              <caption className="sr-only">{t('organizations.tabs.projects')}</caption>
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">
                    {t('projects.projectName')}
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">
                    {t('projects.created')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {projects.map((project) => (
                  <tr key={project.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/projects/${project.id}/integrations`}
                        className="text-primary hover:underline font-medium"
                      >
                        {project.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(project.created_at).toLocaleDateString('en-CA')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-8 text-gray-400">{t('projects.noProjects')}</div>
          )}
        </div>
      )}

      {activeTab === 'quota' && quota && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500">{t('organizations.quotaUsage')}</h3>
            <span
              role="status"
              aria-label={`Current plan: ${quota.plan}`}
              data-testid="plan-badge"
              className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700 capitalize"
            >
              {quota.plan}
            </span>
          </div>
          <div className="space-y-4">
            {(
              Object.entries(quota.resources) as [
                ResourceType,
                { current: number; limit: number },
              ][]
            ).map(([type, resource]) => {
              const pct = resource.limit > 0 ? (resource.current / resource.limit) * 100 : 0;
              return (
                <div key={type}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-700">
                      {t(`organization.resources.${type}`)}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatResourceValue(type, resource.current)} /{' '}
                      {formatResourceValue(type, resource.limit)}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      data-testid="quota-progress-bar"
                      className={`h-2 rounded-full transition-all ${getQuotaProgressColor(pct)}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'subscription' && subscription && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500">
              {t('organizations.tabs.subscription')}
            </h3>
            <button
              onClick={() => setShowChangePlan(true)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              {t('organizations.changePlan.button')}
            </button>
          </div>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <dt className="text-xs text-gray-400">{t('organizations.plan')}</dt>
              <dd className="text-lg font-semibold capitalize">{subscription.plan_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">{t('organizations.billingStatus')}</dt>
              <dd className="text-lg font-semibold">{subscription.status}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">{t('organizations.currentPeriod')}</dt>
              <dd className="text-sm">
                {new Date(subscription.current_period_start).toLocaleDateString('en-CA')} &ndash;{' '}
                {new Date(subscription.current_period_end).toLocaleDateString('en-CA')}
              </dd>
            </div>
            {subscription.external_subscription_id && (
              <div>
                <dt className="text-xs text-gray-400">
                  {subscription.payment_provider ?? 'Payment'} ID
                </dt>
                <dd className="text-sm font-mono text-gray-500">
                  {subscription.external_subscription_id}
                </dd>
              </div>
            )}
          </dl>

          {/* Billing Method Toggle */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex items-center gap-4">
              <div>
                <label htmlFor="billing-method-select" className="block text-xs text-gray-400 mb-1">
                  {t('organizations.billingMethod')}
                </label>
                <select
                  id="billing-method-select"
                  value={localBillingMethod}
                  onChange={(e) =>
                    billingMethodMutation.mutate(e.target.value as 'card' | 'invoice')
                  }
                  disabled={billingMethodMutation.isPending}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="card">{t('organizations.billingMethodCard')}</option>
                  <option value="invoice">{t('organizations.billingMethodInvoice')}</option>
                </select>
              </div>
              {localBillingMethod === 'invoice' && (
                <p className="text-xs text-green-600">{t('organizations.invoiceBillingActive')}</p>
              )}
            </div>
          </div>

          <ChangePlanDialog
            open={showChangePlan}
            onOpenChange={setShowChangePlan}
            onSubmit={async (input) => {
              await changePlanMutation.mutateAsync(input);
            }}
            currentPlan={subscription.plan_name}
            isLoading={changePlanMutation.isPending}
          />

          {/* Admin Invoices */}
          {orgInvoices && orgInvoices.data.length > 0 && (
            <div className="mt-6">
              <h4 className="text-sm font-medium text-gray-500 mb-3">
                {t('organizations.invoices')}
              </h4>
              <table className="w-full text-sm">
                <caption className="sr-only">{t('organizations.invoices')}</caption>
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">
                      {t('invoiceBilling.columns.number')}
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">
                      {t('invoiceBilling.columns.amount')}
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">
                      {t('invoiceBilling.columns.status')}
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">
                      {t('invoiceBilling.columns.issued')}
                    </th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">
                      {t('invoiceBilling.columns.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {orgInvoices.data.map((inv: Invoice) => (
                    <tr key={inv.id}>
                      <td className="px-3 py-2 font-mono text-xs">{inv.invoice_number}</td>
                      <td className="px-3 py-2">
                        {new Intl.NumberFormat(i18n.language, {
                          style: 'currency',
                          currency: inv.currency,
                        }).format(Number(inv.amount))}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            INVOICE_STATUS_STYLES[inv.status] ?? 'bg-yellow-100 text-yellow-700'
                          }`}
                        >
                          {t(`invoiceBilling.status.${inv.status}`)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        {inv.issued_at
                          ? new Date(inv.issued_at).toLocaleDateString(i18n.language)
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {inv.status !== 'paid' && inv.status !== 'canceled' && (
                          <button
                            onClick={() => {
                              if (window.confirm(t('organizations.confirmMarkPaid'))) {
                                markPaidMutation.mutate(inv.id);
                              }
                            }}
                            disabled={markPaidMutation.isPending}
                            className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            {t('organizations.markPaid')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'invitations' && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-4">
            {t('organizations.invitations.title')}
          </h3>
          <InviteMemberForm
            onSubmit={async (email, role, locale) => {
              await inviteMutation.mutateAsync({ email, role, locale });
            }}
            isLoading={inviteMutation.isPending}
          />
          <PendingInvitationsList
            invitations={invitations}
            onCancel={(invId) => cancelInvitationMutation.mutate(invId)}
            isCanceling={cancelInvitationMutation.isPending}
          />
        </div>
      )}

      {activeTab === 'intelligence' && id && <IntelligenceSettingsPanel orgId={id} hideHeader />}
    </div>
  );
}
