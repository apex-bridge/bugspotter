/**
 * Platform Admin — Organization Retention
 *
 * Lists soft-deleted organizations that have aged past the configured
 * retention window (`ORG_RETENTION_DAYS`, default 30) and are eligible
 * for permanent deletion. Each row has a hard-delete action that
 * triggers a typed-subdomain confirmation dialog before calling the
 * server (which re-validates the same confirmation server-side).
 *
 * No automatic cron job — every hard-delete is a human click recorded
 * in the audit log with the admin's user_id.
 */

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Trash2, AlertTriangle, Building2 } from 'lucide-react';
import { organizationService } from '../../services/organization-service';
import { handleApiError } from '../../lib/api-client';
import { useModalFocus } from '../../hooks/use-modal-focus';

interface PendingOrg {
  id: string;
  name: string;
  subdomain: string;
  deleted_at: string;
  deleted_by: string | null;
  project_count: number;
  bug_report_count: number;
  days_since_deleted: number;
}

export default function OrgRetentionPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<PendingOrg | null>(null);
  const [confirmInput, setConfirmInput] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'pending-hard-delete'],
    queryFn: () => organizationService.listPendingHardDelete(),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, confirm }: { id: string; confirm: string }) =>
      organizationService.adminHardDelete(id, confirm),
    onSuccess: (deleted) => {
      toast.success(
        t('orgRetention.deleted', {
          subdomain: deleted.subdomain,
          defaultValue: 'Permanently deleted {{subdomain}}',
        })
      );
      queryClient.invalidateQueries({ queryKey: ['admin', 'pending-hard-delete'] });
      setTarget(null);
      setConfirmInput('');
    },
    onError: (err: unknown) => {
      // Route through the app's shared axios-error unpacker so the admin
      // sees the backend's actual message (e.g. "Subdomain confirmation
      // did not match...") instead of axios's generic "Request failed
      // with status code 400". The i18n key is the fallback for the
      // non-axios case (network error, unexpected shape).
      toast.error(
        handleApiError(err) || t('orgRetention.deleteFailed', { defaultValue: 'Delete failed' })
      );
    },
  });

  const orgs: PendingOrg[] = data?.orgs ?? [];
  const retentionDays = data?.retention_days ?? 30;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {t('orgRetention.title', { defaultValue: 'Pending permanent deletion' })}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {t('orgRetention.description', {
            retentionDays,
            defaultValue:
              'Soft-deleted organizations that have been inactive longer than {{retentionDays}} days. Permanent deletion cascades to all projects, bug reports, subscriptions, and memberships — it cannot be undone.',
          })}
        </p>
      </div>

      {isLoading ? (
        <div role="status" aria-live="polite" className="text-center py-12 text-gray-500">
          {t('common.loading', { defaultValue: 'Loading...' })}
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {t('orgRetention.loadFailed', { defaultValue: 'Failed to load pending deletions' })}
        </div>
      ) : orgs.length === 0 ? (
        <div className="text-center py-12">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" aria-hidden="true" />
          <p className="text-gray-500">
            {t('orgRetention.empty', {
              defaultValue: 'No organizations are ready for permanent deletion.',
            })}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <caption className="sr-only">
              {t('orgRetention.tableCaption', {
                defaultValue: 'Organizations eligible for permanent deletion',
              })}
            </caption>
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  {t('orgRetention.col.subdomain', { defaultValue: 'Subdomain' })}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  {t('orgRetention.col.name', { defaultValue: 'Name' })}
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  {t('orgRetention.col.daysDeleted', { defaultValue: 'Days deleted' })}
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  {t('orgRetention.col.projects', { defaultValue: 'Projects' })}
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  {t('orgRetention.col.reports', { defaultValue: 'Bug reports' })}
                </th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {orgs.map((org) => (
                <tr key={org.id}>
                  <td className="px-6 py-4 text-sm font-mono text-gray-900">{org.subdomain}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">{org.name}</td>
                  <td className="px-6 py-4 text-sm text-right text-gray-700">
                    {org.days_since_deleted}
                  </td>
                  <td className="px-6 py-4 text-sm text-right text-gray-700">
                    {org.project_count}
                  </td>
                  <td className="px-6 py-4 text-sm text-right text-gray-700">
                    {org.bug_report_count}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setTarget(org);
                        setConfirmInput('');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-700 border border-red-200 rounded-md hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                      {t('orgRetention.action.delete', { defaultValue: 'Delete permanently' })}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {target && (
        <ConfirmDialog
          target={target}
          confirmInput={confirmInput}
          onConfirmInputChange={setConfirmInput}
          onCancel={() => {
            setTarget(null);
            setConfirmInput('');
          }}
          onConfirm={() => deleteMutation.mutate({ id: target.id, confirm: confirmInput })}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

interface ConfirmDialogProps {
  target: PendingOrg;
  confirmInput: string;
  onConfirmInputChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

/**
 * GitHub-style typed-confirmation dialog. The admin must retype the
 * org's exact subdomain before the delete button unlocks. The server
 * ALSO checks the same string — the dialog's job is to prevent a
 * muscle-memory mis-click, not to be the only line of defense.
 *
 * The dialog needs a custom body (an input field inline with the
 * confirmation prompt), so it can't reuse the generic
 * `components/ui/confirm-dialog.tsx` directly. It does share the same
 * `useModalFocus` hook for the accessibility wiring (ESC-to-close,
 * focus restoration on close, body scroll lock).
 */
function ConfirmDialog({
  target,
  confirmInput,
  onConfirmInputChange,
  onCancel,
  onConfirm,
  isDeleting,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Apply the same normalization the server does (trim + lowercase) so the
  // button enable state matches what the server would accept. Subdomains
  // are enforced lowercase at signup, so `target.subdomain` is always
  // lowercase. Without the trim, an admin who pastes "acme " with a
  // trailing space would see the button stay disabled even though the
  // backend would accept the submission — confusing.
  const matches = confirmInput.trim().toLowerCase() === target.subdomain;

  // ESC-to-close, body scroll lock, focus trap — same hook the app's other
  // modals use (see `components/ui/confirm-dialog.tsx`). Disabled while the
  // mutation is in flight so Escape doesn't rip the dialog out mid-request.
  useModalFocus(dialogRef, !isDeleting, onCancel);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) {
          onCancel();
        }
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="org-retention-confirm-title"
        tabIndex={-1}
        className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
      >
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h2 id="org-retention-confirm-title" className="text-lg font-semibold text-gray-900">
              {t('orgRetention.confirm.title', { defaultValue: 'Permanently delete?' })}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {t('orgRetention.confirm.warning', {
                defaultValue:
                  'This deletes the organization and cascades to all {{projects}} project(s) and {{reports}} bug report(s). It cannot be undone.',
                projects: target.project_count,
                reports: target.bug_report_count,
              })}
            </p>
          </div>
        </div>

        <label htmlFor="org-retention-confirm-input" className="block text-sm text-gray-700 mb-2">
          {t('orgRetention.confirm.prompt', {
            defaultValue: 'Type the subdomain to confirm:',
          })}
          <span className="block font-mono text-gray-900 mt-1">{target.subdomain}</span>
        </label>
        <input
          id="org-retention-confirm-input"
          type="text"
          value={confirmInput}
          onChange={(e) => onConfirmInputChange(e.target.value.toLowerCase())}
          aria-label={t('orgRetention.confirm.inputLabel', {
            defaultValue: 'Subdomain confirmation',
          })}
          autoFocus
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500"
        />

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!matches || isDeleting}
            className="px-4 py-2 text-sm text-white bg-red-600 rounded-md hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed"
          >
            {isDeleting
              ? t('orgRetention.confirm.deleting', { defaultValue: 'Deleting...' })
              : t('orgRetention.confirm.submit', { defaultValue: 'Delete permanently' })}
          </button>
        </div>
      </div>
    </div>
  );
}
