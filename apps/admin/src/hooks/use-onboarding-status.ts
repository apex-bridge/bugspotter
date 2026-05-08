import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '../contexts/organization-context';
import { integrationService } from '../services/integration-service';
import { projectService } from '../services/api';
import { usePermissions } from './use-permissions';

/**
 * Raw signals describing the tenant's onboarding state. Each
 * `<QuickAction>` declares its own `visible(state)` predicate against
 * this shape, so adding a new state signal is a matter of extending
 * this interface, populating it in the hook below, and referencing it
 * from the relevant predicate in `quick-actions.ts`.
 *
 * NOTE: bug-report counts intentionally not included — they don't tell
 * us whether the SDK is installed (the Chrome extension is another
 * source) and the existing list endpoint scopes by project membership
 * rather than org, so the count under-reports for non-creator admins.
 * Use a manual dismiss for the SDK CTA instead.
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
}

/**
 * Hook that fetches the raw onboarding signals used by the quick-setup
 * CTAs in the admin top-bar. Composes the existing permissions /
 * projects / integrations queries so React Query de-duplicates with
 * pages that already load them.
 *
 * Project / integration queries are gated on `canConfigure` so the
 * typical member/viewer pays no extra cost on every page load.
 */
export function useOnboardingStatus(): OnboardingState {
  const { hasOrganization } = useOrganization();

  const { isSystemAdmin, orgRole } = usePermissions();
  const canConfigure = isSystemAdmin || orgRole === 'admin' || orgRole === 'owner';

  // Plain `['projects']` / `['integrations']` keys to dedupe with every
  // other consumer in the admin (api-keys, bug-reports, notifications,
  // integrations overview, …). Org scoping isn't needed in the key
  // because each project / integration belongs to exactly one org
  // (`organization_id` FK), the list endpoints scope server-side by the
  // tenant context, and prod routes orgs to subdomains so an org switch
  // is a full reload (cache resets naturally).
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectService.getAll(),
    enabled: canConfigure && hasOrganization,
    staleTime: 5 * 60 * 1000,
  });

  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations'],
    queryFn: integrationService.list,
    enabled: canConfigure && hasOrganization,
    staleTime: 60 * 1000,
  });

  return {
    canConfigure,
    hasProject: projects.length >= 1,
    primaryProjectId: projects[0]?.id ?? null,
    integrationCount: integrations.length,
  };
}
