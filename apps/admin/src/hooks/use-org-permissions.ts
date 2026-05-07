import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/auth-context';
import { useOrganization } from '../contexts/organization-context';
import { organizationService } from '../services/organization-service';
import { usePermissions } from './use-permissions';

/**
 * Org-scoped permissions + members list for management pages.
 *
 * The permissions query is shared with `dashboard-layout` and
 * `useOnboardingStatus` via `usePermissions()` (single source of
 * truth). The members list is kept here because it's only needed by
 * member-management pages — pulling it on every page load (which
 * would happen if `useOnboardingStatus` consumed this hook directly)
 * would be wasteful for big orgs.
 */
export function useOrgPermissions() {
  const { user } = useAuth();
  const { currentOrganization } = useOrganization();

  const { permissionsData, isLoading: isLoadingPermissions, isSystemAdmin } = usePermissions();

  // Members list — only fetched here because the management pages
  // are the sole consumers.
  const { data: members = [], isLoading: isLoadingMembers } = useQuery({
    queryKey: ['organization-members', currentOrganization?.id],
    queryFn: () => organizationService.getMembers(currentOrganization!.id),
    enabled: !!currentOrganization?.id && !!user,
  });

  const myMembership = members.find((m) => m.user_id === user?.id);
  const orgPerms = permissionsData?.organization;

  return {
    members,
    isLoading: isLoadingPermissions || isLoadingMembers,
    myMembership,
    canManageMembers: orgPerms?.canManageMembers ?? isSystemAdmin,
    canManageInvitations: orgPerms?.canManageInvitations ?? isSystemAdmin,
    canManageBilling: orgPerms?.canManageBilling ?? isSystemAdmin,
  };
}
