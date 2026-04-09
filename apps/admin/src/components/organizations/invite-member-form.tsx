/**
 * Invite Member Form
 * Inline form for inviting users by email to an organization.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send } from 'lucide-react';
import type { InvitationRole, EmailLocale } from '../../types/organization';
import { getEmailLocale } from '../../lib/locale';

interface Props {
  onSubmit: (email: string, role: InvitationRole, locale: EmailLocale) => Promise<void>;
  isLoading?: boolean;
}

export function InviteMemberForm({ onSubmit, isLoading }: Props) {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitationRole>('member');
  const [locale, setLocale] = useState<EmailLocale>(getEmailLocale(i18n.language));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(email, role, locale);
    setEmail('');
    setRole('member');
    setLocale(getEmailLocale(i18n.language));
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <div className="flex-1">
        <label htmlFor="invite-email" className="block text-xs text-gray-500 mb-1">
          {t('organizations.invitations.email')}
        </label>
        <input
          id="invite-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('organizations.invitations.emailPlaceholder')}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <div>
        <label htmlFor="invite-role" className="block text-xs text-gray-500 mb-1">
          {t('common.role')}
        </label>
        <select
          id="invite-role"
          value={role}
          onChange={(e) => setRole(e.target.value as InvitationRole)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="member">{t('organizations.invitations.roleMember')}</option>
          <option value="admin">{t('organizations.invitations.roleAdmin')}</option>
        </select>
      </div>
      <div>
        <label htmlFor="invite-locale" className="block text-xs text-gray-500 mb-1">
          {t('organizations.invitations.emailLanguage')}
        </label>
        <select
          id="invite-locale"
          value={locale}
          onChange={(e) => setLocale(e.target.value as EmailLocale)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="en">English</option>
          <option value="ru">Русский</option>
          <option value="kk">Қазақша</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={!email || isLoading}
        className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50 hover:bg-primary/90"
      >
        <Send className="w-4 h-4" aria-hidden="true" />
        {t('organizations.invitations.send')}
      </button>
    </form>
  );
}
