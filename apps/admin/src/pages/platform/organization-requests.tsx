/**
 * Platform Admin — Organization Requests
 * Lists organization registration requests with approve/reject actions.
 */

import { useCallback, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertCircle, ClipboardList, Search, Check, X, Trash2 } from 'lucide-react';
import { organizationRequestService } from '../../services/organization-request-service';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { useModalFocus } from '../../hooks/use-modal-focus';
import { useDebounce } from '../../hooks/use-debounce';
import { handleApiError } from '../../lib/api-client';
import type { OrgRequestStatus } from '../../types/organization';

const ORG_REQUEST_STATUSES: OrgRequestStatus[] = [
  'pending_verification',
  'verified',
  'approved',
  'rejected',
  'expired',
];

const STATUS_COLORS: Record<OrgRequestStatus, string> = {
  pending_verification: 'bg-yellow-100 text-yellow-700',
  verified: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-700',
};

export default function OrganizationRequestsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrgRequestStatus | ''>('');
  const [rejectDialogId, setRejectDialogId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);
  const rejectDialogRef = useRef<HTMLDivElement>(null);

  const closeRejectDialog = useCallback(() => {
    setRejectDialogId(null);
    setRejectionReason('');
  }, []);

  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['organization-requests', page, debouncedSearch, statusFilter],
    queryFn: () =>
      organizationRequestService.list({
        page,
        limit: 20,
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
      }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => organizationRequestService.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-requests'] });
      toast.success(t('organizationRequests.approve.success'));
    },
    onError: (error: unknown) => toast.error(handleApiError(error)),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      organizationRequestService.reject(id, { rejection_reason: reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-requests'] });
      setRejectDialogId(null);
      setRejectionReason('');
      toast.success(t('organizationRequests.reject.success'));
    },
    onError: (error: unknown) => toast.error(handleApiError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => organizationRequestService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-requests'] });
      setDeleteDialogId(null);
      toast.success(t('organizationRequests.deleteSuccess'));
    },
    onError: (error: unknown) => toast.error(handleApiError(error)),
  });

  useModalFocus(rejectDialogRef, !!rejectDialogId && !rejectMutation.isPending, closeRejectDialog);

  const requests = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('organizationRequests.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('organizationRequests.description')}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder={t('organizationRequests.searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"
            aria-label={t('organizationRequests.searchLabel')}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as OrgRequestStatus | '');
            setPage(1);
          }}
          className="px-3 py-2 border rounded-lg text-sm"
          aria-label={t('organizationRequests.filterByStatus')}
        >
          <option value="">{t('organizationRequests.allStatuses')}</option>
          {ORG_REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`organizationRequests.status.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500" role="status" aria-live="polite">
          {t('common.loading')}
        </div>
      ) : isError ? (
        <div className="text-center py-12">
          <AlertCircle className="w-12 h-12 text-red-300 mx-auto mb-3" aria-hidden="true" />
          <p className="text-red-600 font-medium">{t('common.error')}</p>
          <p className="text-sm text-gray-500 mt-1">{handleApiError(error)}</p>
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-12">
          <ClipboardList className="w-12 h-12 text-gray-300 mx-auto mb-3" aria-hidden="true" />
          <p className="text-gray-500">{t('organizationRequests.noRequests')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" role="table">
            <caption className="sr-only">{t('organizationRequests.title')}</caption>
            <thead>
              <tr className="border-b text-left text-sm text-gray-500">
                <th className="pb-3 font-medium">{t('organizationRequests.columns.company')}</th>
                <th className="pb-3 font-medium">{t('organizationRequests.columns.contact')}</th>
                <th className="pb-3 font-medium">{t('organizationRequests.columns.subdomain')}</th>
                <th className="pb-3 font-medium">{t('organizationRequests.columns.region')}</th>
                <th className="pb-3 font-medium">{t('organizationRequests.columns.status')}</th>
                <th className="pb-3 font-medium">{t('organizationRequests.columns.date')}</th>
                <th className="pb-3 font-medium">{t('organizationRequests.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.id} className="border-b hover:bg-gray-50">
                  <td className="py-3 pr-4">
                    <div className="font-medium text-sm">{req.company_name}</div>
                    {req.message && (
                      <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[200px]">
                        {req.message}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="text-sm">{req.contact_name}</div>
                    <div className="text-xs text-gray-400">{req.contact_email}</div>
                  </td>
                  <td className="py-3 pr-4 text-sm text-gray-600">{req.subdomain}</td>
                  <td className="py-3 pr-4 text-sm text-gray-600 uppercase">
                    {req.data_residency_region}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
                        STATUS_COLORS[req.status] || 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {t(`organizationRequests.status.${req.status}`)}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-sm text-gray-500">
                    {new Date(req.created_at).toLocaleDateString('en-CA')}
                  </td>
                  <td className="py-3">
                    <div className="flex gap-1">
                      {req.status === 'verified' && (
                        <>
                          <button
                            onClick={() => approveMutation.mutate(req.id)}
                            disabled={
                              approveMutation.isPending && approveMutation.variables === req.id
                            }
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                            title={t('organizationRequests.approve.button')}
                            aria-label={t('organizationRequests.approve.button')}
                          >
                            <Check className="w-4 h-4" aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => setRejectDialogId(req.id)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                            title={t('organizationRequests.reject.button')}
                            aria-label={t('organizationRequests.reject.button')}
                          >
                            <X className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </>
                      )}
                      {req.status !== 'approved' && (
                        <button
                          onClick={() => setDeleteDialogId(req.id)}
                          disabled={deleteMutation.isPending}
                          className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"
                          title={t('organizationRequests.deleteButton')}
                          aria-label={t('organizationRequests.deleteButton')}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            {t('common.page')} {pagination.page} / {pagination.totalPages} ({pagination.total}{' '}
            {t('common.total')})
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
            >
              {t('common.previous')}
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= (pagination.totalPages ?? 1)}
              className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
            >
              {t('common.next')}
            </button>
          </div>
        </div>
      )}

      {/* Reject Dialog */}
      {rejectDialogId && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget && !rejectMutation.isPending) {
              closeRejectDialog();
            }
          }}
          role="presentation"
        >
          <div
            ref={rejectDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-dialog-title"
            tabIndex={-1}
            className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl"
          >
            <h2 id="reject-dialog-title" className="text-lg font-semibold mb-4">
              {t('organizationRequests.reject.title')}
            </h2>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder={t('organizationRequests.reject.reasonPlaceholder')}
              className="w-full border rounded-lg p-3 text-sm mb-4 h-24 resize-none"
              aria-label={t('organizationRequests.reject.reasonLabel')}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={closeRejectDialog}
                disabled={rejectMutation.isPending}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  const reason = rejectionReason.trim();
                  if (!reason) {
                    toast.error(t('organizationRequests.reject.reasonRequired'));
                    return;
                  }
                  if (!rejectDialogId) {
                    return;
                  }
                  rejectMutation.mutate({
                    id: rejectDialogId,
                    reason,
                  });
                }}
                disabled={rejectMutation.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {t('organizationRequests.reject.button')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteDialogId}
        onClose={() => setDeleteDialogId(null)}
        onConfirm={() => {
          if (deleteDialogId) {
            deleteMutation.mutate(deleteDialogId);
          }
        }}
        title={t('organizationRequests.deleteButton')}
        message={t('organizationRequests.deleteConfirm')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
