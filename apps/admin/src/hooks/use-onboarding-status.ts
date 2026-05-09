import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '../contexts/organization-context';
import { integrationService } from '../services/integration-service';
import { projectService } from '../services/api';
import { usePermissions } from './use-permissions';
import { useOrgFilter } from './use-org-filter';

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

  // When a platform admin has narrowed the cross-org view via the
  // sidebar widget, the QuickSetup CTAs need to reflect THAT org's
  // state — not the global firehose. Without threading the scope
  // through, the CTAs would show "no integrations" globally even
  // when the filtered org has them, and vice versa.
  const { selectedOrgId: adminOrgScope } = useOrgFilter();

  // Use a dedicated `onboarding-projects` namespace rather than the
  // shared `['projects']` key. The shared key is intentionally
  // unscoped (notification dialogs / channels-list / etc. dedup
  // through it); reshaping it here would fragment that contract.
  // The mutations in `projects.tsx` invalidate both namespaces
  // explicitly so a created/deleted project still flushes the
  // onboarding cache. Backend ignores `organization_id` for
  // non-admins (PR #115 security boundary), so passing
  // `adminOrgScope` from the hook is safe for all users — the
  // param is dropped server-side when not applicable.
  const { data: projects = [] } = useQuery({
    queryKey: ['onboarding-projects', adminOrgScope],
    queryFn: () => projectService.getAll(adminOrgScope),
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
    projectCount: projects.length,
    primaryProjectId: projects[0]?.id ?? null,
    integrationCount: integrations.length,
  };
}
