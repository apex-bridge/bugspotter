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
  /** Total number of projects in the active org (drives single-vs-multi UX branches). */
  projectCount: number;
  /**
   * First project's id, used to short-circuit single-project flows
   * (e.g. routing Connect Jira straight to the project's configure
   * page instead of dumping the user on a project picker). Null when
   * no project. Don't rely on this for multi-project tenants — server
   * order isn't documented.
   */
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
  // other consumer in the admin (notification dialogs, channels-list,
  // integrations overview, …). Both queries reflect the user's CURRENT
  // tenant context (subdomain on SaaS), not the platform-admin sidebar
  // filter — the QuickSetup CTAs that consume this hook are tied to
  // "what does THIS tenant have set up", and threading the sidebar
  // filter only into the projects query was internally inconsistent
  // (integrationService.list takes no org arg, so `integrationCount`
  // would stay global, breaking predicates like
  // `hasProject && integrationCount === 0` for any platform admin
  // with the sidebar filter set). Either both signals follow the
  // filter or neither does; "neither" is the only option without a
  // backend change to `integrationService.list`.
  // Wrap `getAll()` in an arrow to drop React Query's context arg —
  // the service's first param is `organizationId?: string`, so passing
  // the query context through would be a type error and (worse) send
  // a junk org id to the backend.
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectService.getAll(),
    enabled: canConfigure && hasOrganization,
    staleTime: 5 * 60 * 1000,
  });

  // `integrationService.summary()` is the org-admin-accessible sibling
  // of `list()` — same tenant scope, but `list()` hits the
  // platform-admin-only `/admin/integrations` and silently 403s for
  // org owners. That used to leave `integrationCount === 0` permanently
  // for any non-platform-admin user, so the "Connect Jira" CTA never
  // disappeared after they actually connected Jira. The summary endpoint
  // projects through `getUserAccessibleProjects` so the count reflects
  // what the caller can see.
  const { data: integrationSummary } = useQuery({
    queryKey: ['integrations-summary'],
    queryFn: integrationService.summary,
    enabled: canConfigure && hasOrganization,
    staleTime: 60 * 1000,
  });

  return {
    canConfigure,
    hasProject: projects.length >= 1,
    projectCount: projects.length,
    primaryProjectId: projects[0]?.id ?? null,
    integrationCount: integrationSummary?.total ?? 0,
  };
}
