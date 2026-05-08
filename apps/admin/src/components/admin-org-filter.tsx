import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/auth-context';
import { isPlatformAdmin } from '../types';
import { organizationService } from '../services/organization-service';
import { useOrgFilter } from '../hooks/use-org-filter';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select-radix';

const ALL_ORGS_VALUE = '__all__';

/**
 * Sidebar widget that lets a platform admin scope the four cross-org
 * list pages (Projects, API Keys, Users, Bug Reports) to a single
 * tenant via the `organizationId` URL query param. Selection is
 * persisted in the URL so deep links survive reload and two tabs can
 * investigate two orgs independently.
 *
 * Returns `null` for non-platform-admin users — they have no
 * cross-org context to filter from. The backend ignores the param
 * for them anyway, so even if a regular user manually sets
 * `?organizationId=` in the URL, list pages still scope by their
 * actual access (verified by PR #115's security-boundary tests).
 */
export function AdminOrgFilter() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = isPlatformAdmin(user);
  const { selectedOrgId, setSelectedOrgId } = useOrgFilter();

  // Skip the fetch entirely for non-admins so we don't waste a
  // round-trip on every page load for the typical user.
  const { data: orgsResponse } = useQuery({
    queryKey: ['organizations', 'admin-filter'],
    queryFn: () => organizationService.list({ limit: 100 }),
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  if (!isAdmin) {
    return null;
  }

  const orgs = orgsResponse?.data ?? [];

  return (
    <div className="px-4 py-3 border-b border-gray-200" data-testid="admin-org-filter">
      <label
        htmlFor="admin-org-filter-select"
        className="block text-xs font-medium text-gray-600 mb-1"
      >
        {t('adminOrgFilter.label')}
      </label>
      <Select
        value={selectedOrgId ?? ALL_ORGS_VALUE}
        onValueChange={(value) => {
          setSelectedOrgId(value === ALL_ORGS_VALUE ? null : value);
        }}
      >
        <SelectTrigger id="admin-org-filter-select" className="w-full">
          <SelectValue placeholder={t('adminOrgFilter.placeholder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_ORGS_VALUE}>{t('adminOrgFilter.allOrgs')}</SelectItem>
          {orgs.map((org) => (
            <SelectItem key={org.id} value={org.id}>
              {org.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
