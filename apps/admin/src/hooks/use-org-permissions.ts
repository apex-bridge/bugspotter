import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/auth-context';
import { useOrganization } from '../contexts/organization-context';
import { organizationService } from '../services/organization-service';
import { isPlatformAdmin } from '../types';
import { api, API_ENDPOINTS } from '../lib/api-client';

interface OrgPermissionsResponse {
  system: {
    role: string;
    isAdmin: boolean;
  };
  organization?: {
    role: string;
    canManageMembers: boolean;
    canManageInvitations: boolean;
    canManageBilling: boolean;
  };
}

/**
 * Fetch the current user's org-level permissions from the backend.
 * This is the single source of truth — the backend computes permissions
 * from the user's org role and system role, eliminating client-side duplication.
 *
 * Also fetches org members list for pages that need it (e.g. members management).
 */
export function useOrgPermissions() {
  const { user } = useAuth();
  const { currentOrganization } = useOrganization();

  // Fetch computed permissions from the backend (single source of truth)
  const { data: permissionsData, isLoading: isLoadingPermissions } = useQuery({
    queryKey: ['permissions', undefined, currentOrganization?.id],
    queryFn: async () => {
      const response = await api.get<{ data: OrgPermissionsResponse }>(
        API_ENDPOINTS.permissions.me(),
        { params: { organizationId: currentOrganization!.id } }
      );
      return response.data.data;
    },
    enabled: !!currentOrganization?.id && !!user,
  });

  // Fetch members list — needed for member management pages
  const { data: members = [], isLoading: isLoadingMembers } = useQuery({
    queryKey: ['organization-members', currentOrganization?.id],
    queryFn: () => organizationService.getMembers(currentOrganization!.id),
    enabled: !!currentOrganization?.id && !!user,
  });

  // Backend is the source of truth; fall back to local check before permissions load
  const isSystemAdmin = permissionsData?.system.isAdmin ?? isPlatformAdmin(user);

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
