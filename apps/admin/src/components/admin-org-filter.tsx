import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/auth-context';
import { isPlatformAdmin } from '../types';
import { organizationService } from '../services/organization-service';
import { useOrgFilter } from '../hooks/use-org-filter';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select-radix';

const ALL_ORGS_VALUE = '__all__';

/**
 * Capped at 100 because the backend's `GET /api/v1/organizations`
 * schema rejects `limit > 100` with 400 (organization-schema.ts:260,
 * `maximum: 100`). PR #119 originally set this to 500 to cover the
 * realistic mid-term tenant count, but that fired schema-validation
 * 400s in prod and broke the entire admin shell for any platform
 * admin (the sidebar widget is mounted by `<DashboardLayout>` which
 * wraps every admin route).
 *
 * The synthetic disabled item below already covers the case where a
 * deep-linked org is past the fetched window — the trigger renders
 * "Unknown organization (id)" with no crash. Restoring full
 * dropdown access for >100 tenants requires either bumping the
 * backend cap (tracked on issue #120) or adding a search-backed
 * picker; both are follow-ups.
 */
const ORG_LIST_LIMIT = 100;

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
    queryFn: () => organizationService.list({ limit: ORG_LIST_LIMIT }),
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  if (!isAdmin) {
    return null;
  }

  const orgs = orgsResponse?.data ?? [];
  // If the URL deep-links to an org that isn't in the fetched window
  // (more than ORG_LIST_LIMIT total orgs, or the org was deleted),
  // Radix renders the trigger with no label and the user has no way
  // to escape except by hand-editing the URL. Inject a synthetic
  // disabled item so the trigger always shows SOMETHING for the
  // current selection — usually just the id, which is enough for
  // the user to recognise the broken state.
  //
  // Gate on `!!orgsResponse` so the synthetic item only shows up after
  // the fetch has actually returned. Without this, EVERY initial render
  // with a deep-linked org briefly flashes the "Unknown organization (X)"
  // item — `orgs === []` while the query is pending, so any non-null
  // `selectedOrgId` evaluates as missing for one render.
  const selectedIsMissing =
    !!orgsResponse && selectedOrgId !== null && !orgs.some((org) => org.id === selectedOrgId);

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
          {selectedIsMissing && selectedOrgId !== null && (
            // Disabled so the user can't re-pick it, but visible so
            // the trigger isn't blank. The label includes the id so
            // they can see what URL state they're on.
            <SelectItem value={selectedOrgId} disabled>
              {t('adminOrgFilter.unknownOrg', { id: selectedOrgId })}
            </SelectItem>
          )}
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
