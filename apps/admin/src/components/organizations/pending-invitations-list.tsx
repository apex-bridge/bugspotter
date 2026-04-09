/**
 * Pending Invitations List
 * Displays pending invitations with cancel action.
 */

import { useTranslation } from 'react-i18next';
import { X, Mail, Clock } from 'lucide-react';
import type { OrganizationInvitation } from '../../types/organization';

interface Props {
  invitations: OrganizationInvitation[];
  onCancel: (invitationId: string) => void;
  isCanceling?: boolean;
}

export function PendingInvitationsList({ invitations, onCancel, isCanceling }: Props) {
  const { t } = useTranslation();

  if (!invitations.length) {
    return null;
  }

  return (
    <div className="mt-4">
      <h4 className="text-sm font-medium text-gray-700 mb-2">
        {t('organizations.invitations.pending')} ({invitations.length})
      </h4>
      <div className="space-y-2">
        {invitations.map((inv) => (
          <div
            key={inv.id}
            className="flex items-center justify-between p-3 bg-yellow-50 border border-yellow-200 rounded-lg"
          >
            <div className="flex items-center gap-3">
              <Mail className="w-4 h-4 text-yellow-600" aria-hidden="true" />
              <div>
                <span className="text-sm font-medium">{inv.email}</span>
                <span className="text-xs text-gray-500 ml-2 capitalize">{inv.role}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Clock className="w-3 h-3" aria-hidden="true" />
                {t('organizations.invitations.expiresOn', {
                  date: new Date(inv.expires_at).toLocaleDateString('en-CA'),
                })}
              </span>
              <button
                onClick={() => onCancel(inv.id)}
                disabled={isCanceling}
                className="p-1 text-gray-400 hover:text-red-600 rounded disabled:opacity-50"
                title={t('organizations.invitations.cancel')}
                aria-label={t('organizations.invitations.cancel')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
