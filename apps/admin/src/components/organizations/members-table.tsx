import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { RoleBadge } from './role-badge';
import type { OrganizationMember } from '../../types/organization';

interface Props {
  members: OrganizationMember[];
  onRemove?: (userId: string) => void;
}

export function MembersTable({ members, onRemove }: Props) {
  const { t } = useTranslation();

  if (!members.length) {
    return <div className="text-center py-8 text-gray-500">{t('organizations.noMembers')}</div>;
  }

  return (
    <table className="w-full">
      <caption className="sr-only">{t('organizations.membersTableCaption')}</caption>
      <thead className="bg-gray-50 border-b border-gray-200">
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
            {t('common.email')}
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
            {t('common.name')}
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
            {t('common.role')}
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
            {t('common.joined')}
          </th>
          {onRemove && (
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              {t('common.actions')}
            </th>
          )}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {members.map((member) => (
          <tr key={member.id} className="hover:bg-gray-50">
            <td className="px-6 py-4 text-sm">{member.user_email}</td>
            <td className="px-6 py-4 text-sm text-gray-500">{member.user_name || '—'}</td>
            <td className="px-6 py-4">
              <RoleBadge role={member.role} />
            </td>
            <td className="px-6 py-4 text-sm text-gray-500">
              {new Date(member.created_at).toLocaleDateString('en-CA')}
            </td>
            {onRemove && (
              <td className="px-6 py-4">
                {member.role !== 'owner' && (
                  <button
                    onClick={() => onRemove(member.user_id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                    title={t('common.delete')}
                    aria-label={t('common.delete')}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
