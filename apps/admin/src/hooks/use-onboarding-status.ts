import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/auth-context';
import { useOrganization } from '../contexts/organization-context';
import { isPlatformAdmin } from '../types';
import { api, API_ENDPOINTS } from '../lib/api-client';
import { integrationService } from '../services/integration-service';
import { projectService, bugReportService } from '../services/api';

/**
 * Raw signals describing the tenant's onboarding state. Each
 * `<QuickAction>` declares its own `visible(state)` predicate against
 * this shape, so adding a new state signal is a matter of extending
 * this interface, populating it in the hook below, and referencing it
 * from the relevant predicate in `quick-actions.ts`.
 */
export interface OnboardingState {
  /** True iff the user can configure integrations / view secrets. */
  canConfigure: boolean;
  /** True iff there is at least one project in the active organization. */
  hasProject: boolean;
  /** First project's id (used as the SDK snippet's projectId). Null when no project. */
  primaryProjectId: string | null;
  /** Number of integrations enabled in the active organization. */
  integrationCount: number;
  /** Number of bug reports for `primaryProjectId`. */
  bugReportCount: number;
}

/**
 * Hook that fetches the raw onboarding signals used by the quick-setup
 * CTAs in the admin top-bar. Composes the existing permissions /
 * projects / integrations / bug-reports queries so React Query
 * de-duplicates with pages that already load them.
 *
 * The downstream queries (integrations + bug reports) are gated on
 * `canConfigure` so the typical member/viewer pays no extra cost on
 * every page load.
 */
export function useOnboardingStatus(): OnboardingState {
  const { user } = useAuth();
  const { currentOrganization, hasOrganization } = useOrganization();

  // Reuse the same query key as `useOrgPermissions` and the inline
  // query in dashboard-layout.tsx so a single round-trip backs all of
  // them — see `src/hooks/use-org-permissions.ts`.
  const { data: permissionsData } = useQuery({
    queryKey: ['permissions', undefined, currentOrganization?.id],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const response = await api.get<{
        data: {
          system: { isAdmin: boolean };
          organization?: { role: string };
        };
      }>(API_ENDPOINTS.permissions.me(), {
        params: { organizationId: currentOrganization?.id },
      });
      return response.data.data;
    },
    enabled: !!currentOrganization?.id && !!user,
  });

  const orgRole = permissionsData?.organization?.role;
  const isSystemAdmin = permissionsData?.system.isAdmin ?? isPlatformAdmin(user);
  const canConfigure = isSystemAdmin || orgRole === 'admin' || orgRole === 'owner';

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: projectService.getAll,
    enabled: canConfigure && hasOrganization,
    staleTime: 5 * 60 * 1000,
  });

  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations'],
    queryFn: integrationService.list,
    enabled: canConfigure && hasOrganization,
    staleTime: 60 * 1000,
  });

  const primaryProjectId = projects[0]?.id ?? null;

  const { data: bugReports } = useQuery({
    queryKey: ['bug-reports', 'count', primaryProjectId],
    queryFn: () =>
      bugReportService.getAll(
        primaryProjectId ? { project_id: primaryProjectId } : undefined,
        1,
        1
      ),
    enabled: canConfigure && hasOrganization && !!primaryProjectId,
    staleTime: 60 * 1000,
  });

  return {
    canConfigure,
    hasProject: projects.length >= 1,
    primaryProjectId,
    integrationCount: integrations.length,
    bugReportCount: bugReports?.pagination?.total ?? 0,
  };
}
