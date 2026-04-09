/**
 * Platform Admin — Organizations List
 * Lists all organizations with search, filter, and pagination.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Building2, Search, Users, Plus } from 'lucide-react';
import { organizationService } from '../../services/organization-service';
import { CreateOrganizationDialog } from '../../components/organizations/create-organization-dialog';
import type { SubscriptionStatus, AdminCreateOrganizationInput } from '../../types/organization';

const STATUS_COLORS: Record<SubscriptionStatus, string> = {
  trial: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  past_due: 'bg-yellow-100 text-yellow-700',
  canceled: 'bg-gray-100 text-gray-700',
  trial_expired: 'bg-red-100 text-red-700',
};

export default function OrganizationsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatus | ''>('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const createOrgMutation = useMutation({
    mutationFn: (input: AdminCreateOrganizationInput) => organizationService.adminCreate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      toast.success(t('organizations.createOrg.success'));
      setShowCreateDialog(false);
    },
    onError: (error: Error) => toast.error(error.message || t('organizations.createOrg.failed')),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['organizations', page, search, statusFilter, includeDeleted],
    queryFn: () =>
      organizationService.list({
        page,
        limit: 20,
        search: search || undefined,
        subscription_status: statusFilter || undefined,
        include_deleted: includeDeleted || undefined,
      }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('organizations.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('organizations.description')}</p>
        </div>
        <button
          onClick={() => setShowCreateDialog(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {t('organizations.createOrg.button')}
        </button>
      </div>

      <CreateOrganizationDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSubmit={async (input) => {
          await createOrgMutation.mutateAsync(input);
        }}
        isLoading={createOrgMutation.isPending}
      />

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            aria-hidden="true"
          />
          <input
            type="text"
            role="searchbox"
            aria-label={t('organizations.searchLabel')}
            placeholder={t('organizations.searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>
        <select
          aria-label={t('organizations.statusFilterLabel')}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as SubscriptionStatus | '');
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">{t('organizations.allStatuses')}</option>
          <option value="trial">{t('organizations.status.trial')}</option>
          <option value="active">{t('organizations.status.active')}</option>
          <option value="past_due">{t('organizations.status.past_due')}</option>
          <option value="canceled">{t('organizations.status.canceled')}</option>
          <option value="trial_expired">{t('organizations.status.trial_expired')}</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => {
              setIncludeDeleted(e.target.checked);
              setPage(1);
            }}
            className="accent-primary"
          />
          {t('organizations.showDeleted')}
        </label>
      </div>

      {/* Table */}
      {isLoading ? (
        <div role="status" aria-live="polite" className="text-center py-12 text-gray-500">
          {t('common.loading')}
        </div>
      ) : !data?.data.length ? (
        <div className="text-center py-12">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" aria-hidden="true" />
          <p className="text-gray-500">{t('organizations.noOrganizations')}</p>
        </div>
      ) : (
        <>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <caption className="sr-only">{t('organizations.tableCaption')}</caption>
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    {t('organizations.name')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    {t('organizations.subdomain')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    {t('common.status')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    {t('organizations.region')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    {t('organizations.members')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    {t('common.date')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {data.data.map((org) => (
                  <tr
                    key={org.id}
                    className={`hover:bg-gray-50 ${org.deleted_at ? 'opacity-50' : ''}`}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/organizations/${org.id}`}
                          className={`text-sm font-medium text-primary hover:underline ${org.deleted_at ? 'line-through' : ''}`}
                        >
                          {org.name}
                        </Link>
                        {org.deleted_at && (
                          <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-red-100 text-red-600">
                            {t('organizations.deleted')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{org.subdomain}</td>
                    <td className="px-6 py-4">
                      <span
                        role="status"
                        aria-label={`Subscription status: ${t(`organizations.status.${org.subscription_status}`)}`}
                        data-testid="status-badge"
                        className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[org.subscription_status]}`}
                      >
                        {t(`organizations.status.${org.subscription_status}`)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 uppercase">
                      {org.data_residency_region}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-sm text-gray-500">
                          <Users className="w-3.5 h-3.5" aria-hidden="true" />
                          {org.member_count}
                        </span>
                        {org.pending_owner_email && (
                          <span
                            role="status"
                            aria-label={`${t('organizations.pendingOwner')}: ${org.pending_owner_email}`}
                            className="px-1.5 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-700"
                          >
                            {t('organizations.pendingOwner')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(org.created_at).toLocaleDateString('en-CA')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-500">
                {t('common.page')} {data.pagination.page} {t('common.of')}{' '}
                {data.pagination.totalPages} ({data.pagination.total} total)
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50"
                >
                  {t('common.previous')}
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
                  disabled={page >= data.pagination.totalPages}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50"
                >
                  {t('common.next')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
