import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/auth-context';
import { projectMemberService } from '../services/project-member-service';
import { api, API_ENDPOINTS } from '../lib/api-client';
import { isPlatformAdmin } from '../types';
import type { ProjectMemberRole } from '../types';

interface ProjectPermissionsResponse {
  system: {
    role: string;
    isAdmin: boolean;
  };
  project?: {
    role: ProjectMemberRole;
    canManageIntegrations: boolean;
    canEditProject: boolean;
    canDeleteProject: boolean;
    canManageMembers: boolean;
    canDeleteReports: boolean;
    canUpload: boolean;
    canView: boolean;
  };
}

/**
 * Fetch the current user's project-level permissions from the backend.
 * This is the single source of truth — the backend computes permissions
 * from the user's project role and system role, eliminating client-side duplication.
 *
 * Also fetches project members list for pages that need it (e.g. members management).
 */
export function useProjectPermissions(projectId: string | undefined) {
  const { user } = useAuth();

  // Fetch computed permissions from the backend (single source of truth)
  const { data: permissionsData, isLoading: isLoadingPermissions } = useQuery({
    queryKey: ['permissions', projectId],
    queryFn: async () => {
      const response = await api.get<{ data: ProjectPermissionsResponse }>(
        API_ENDPOINTS.permissions.me(),
        { params: { projectId } }
      );
      return response.data.data;
    },
    enabled: !!projectId && !!user,
  });

  // Backend is the source of truth; fall back to local check before permissions load
  const isSystemAdmin = permissionsData?.system.isAdmin ?? isPlatformAdmin(user);

  // Fetch members list — needed for member management pages
  const { data: members = [], isLoading: isLoadingMembers } = useQuery({
    queryKey: ['projectMembers', projectId],
    queryFn: () => projectMemberService.getMembers(projectId!),
    enabled: !!projectId && !!user && !isSystemAdmin,
  });

  const myMembership = members.find((m) => m.user_id === user?.id);
  const projectPerms = permissionsData?.project;

  return {
    members,
    isLoading: isLoadingPermissions || isLoadingMembers,
    myMembership,
    myRole: projectPerms?.role ?? myMembership?.role,
    isSystemAdmin,
    canManageIntegrations: projectPerms?.canManageIntegrations ?? isSystemAdmin,
    canEditProject: projectPerms?.canEditProject ?? isSystemAdmin,
    canDeleteProject: projectPerms?.canDeleteProject ?? isSystemAdmin,
    canManageMembers: projectPerms?.canManageMembers ?? isSystemAdmin,
    canDeleteReports: projectPerms?.canDeleteReports ?? isSystemAdmin,
    canUpload: projectPerms?.canUpload ?? isSystemAdmin,
    canView: projectPerms?.canView ?? isSystemAdmin,
  };
}
