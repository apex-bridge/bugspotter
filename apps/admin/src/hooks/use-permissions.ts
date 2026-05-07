import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/auth-context';
import { useOrganization } from '../contexts/organization-context';
import { isPlatformAdmin } from '../types';
import { api, API_ENDPOINTS } from '../lib/api-client';

/**
 * Shape returned by `GET /api/v1/permissions/me`. The backend computes
 * permissions from the user's system + org role and returns the booleans
 * directly so the client doesn't have to recompute them.
 */
export interface PermissionsResponse {
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
 * Canonical hook for the `permissions/me` query. Single source of truth
 * for the query key, endpoint, types, and `staleTime` — all three
 * historical call sites (`useOrgPermissions`, `dashboard-layout`,
 * `useOnboardingStatus`) now consume this so a future endpoint change
 * is a one-file edit.
 *
 * Returns the raw response plus the most-used derived booleans
 * (`isSystemAdmin`, `orgRole`) so callers don't each duplicate the
 * platform-admin fallback logic.
 */
export function usePermissions() {
  const { user } = useAuth();
  const { currentOrganization } = useOrganization();

  const { data, isLoading } = useQuery({
    queryKey: ['permissions', undefined, currentOrganization?.id],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const response = await api.get<{ data: PermissionsResponse }>(
        API_ENDPOINTS.permissions.me(),
        { params: { organizationId: currentOrganization?.id } }
      );
      return response.data.data;
    },
    enabled: !!currentOrganization?.id && !!user,
  });

  return {
    /** Raw permissions response (undefined while loading). */
    permissionsData: data,
    isLoading,
    /**
     * True when the user is a platform admin. Backend is the source of
     * truth once `permissionsData` resolves; falls back to the local
     * `isPlatformAdmin(user)` check on the JWT before then.
     */
    isSystemAdmin: data?.system.isAdmin ?? isPlatformAdmin(user),
    /** The user's role in the active organization (null if none). */
    orgRole: data?.organization?.role ?? null,
  };
}
