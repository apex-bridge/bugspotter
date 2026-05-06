import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/auth-context';
import { useOrganization } from '../contexts/organization-context';
import { isPlatformAdmin } from '../types';
import { api, API_ENDPOINTS } from '../lib/api-client';
import { integrationService } from '../services/integration-service';
import { projectService, bugReportService } from '../services/api';

/**
 * Hook that derives whether the freshly-created-tenant quick-setup CTAs
 * should be visible. Composes the existing permissions, projects,
 * integrations and bug-reports queries so React Query de-duplicates with
 * pages that already load the same data.
 *
 * Visibility rule: only org admins/owners (or platform admins) on a
 * tenant that has 0 integrations AND 0 bug reports yet. Once either
 * condition is no longer true, the CTAs disappear for good.
 */
export function useOnboardingStatus() {
  const { user } = useAuth();
  const { currentOrganization, hasOrganization } = useOrganization();

  // Reuse the same query key as `useOrgPermissions` so a single network
  // round-trip backs both — see `src/hooks/use-org-permissions.ts`.
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
  // Platform admins always pass; org admins/owners do too. Other roles
  // (member, viewer) cannot configure integrations and so should not see
  // the CTAs even when the rest of the empty-state shape matches.
  const isSystemAdmin = permissionsData?.system.isAdmin ?? isPlatformAdmin(user);
  const canConfigure = isSystemAdmin || orgRole === 'admin' || orgRole === 'owner';

  // Gate the remaining queries on `canConfigure` so the typical
  // member/viewer never pays the cost of two extra requests on every
  // page load.
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

  const noIntegrations = integrations.length === 0;
  const noBugReports = (bugReports?.pagination?.total ?? 0) === 0;
  // The tenant has to have at least one project for the SDK snippet CTA
  // to make sense — without a project there's nothing to send reports to.
  const hasProject = projects.length >= 1;

  return {
    shouldShowQuickSetup: canConfigure && hasProject && noIntegrations && noBugReports,
    primaryProjectId,
    canConfigure,
  };
}
