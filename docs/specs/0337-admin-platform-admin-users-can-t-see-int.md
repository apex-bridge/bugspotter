# Spec: admin: platform-admin users can't see intelligence UI on bug detail view

<!-- This is the AI-generated spec document. .github/ISSUE_TEMPLATE/spec.yml is
     the human issue-filing form — different structure, different purpose. -->

Linked issue: Refs #337
ADR: n/a

**Files touched:**

- `apps/admin/src/hooks/use-intelligence-status.ts` — add an optional `orgIdOverride?: string | null` parameter (`undefined` = no override, fall back to `currentOrganization`; `null` = an override is intended but not yet resolved, stay disabled; a string = use it).
- `apps/admin/src/components/bug-reports/bug-report-detail.tsx` — fetch the bug's project (`projectService.getById`), derive `bugOrgId` from `project.organization_id`, pass it to `useIntelligenceStatus`.
- `apps/admin/src/tests/hooks/use-intelligence-status.test.tsx` (new) — matches the existing `tests/hooks/` layout (see `use-permissions.test.tsx`), not a flat `src/tests/` path.
- `apps/admin/src/tests/components/bug-reports/bug-report-detail.test.tsx` (new) — component-level coverage proving the wiring itself (hook tests alone don't prove `BugReportDetail` passes the right override or renders the right UI).

**Blocking prerequisites:** none

## Problem

Platform-admin users — those with an elevated cross-org role but no personal organization membership row — see no intelligence-related UI on any bug's "Details & Metadata" tab. The AI Enrichment card, Similar Bugs widget, Duplicate match details section (added in #227/#336), and Suggest Fix button are all absent, even when the bug belongs to an organization with intelligence enabled. Critically, not even the "Intelligence disabled" fallback notice renders, so the user receives no signal that intelligence features exist for the organization. The root cause is that `useIntelligenceStatus` derives its `orgId` exclusively from `useOrganization().currentOrganization`, which is populated only from the logged-in user's personal membership list. Platform admins have no membership rows, so `currentOrganization` stays `null`, the hook's internal query never fires (`enabled: !!orgId`), and the hook permanently returns `{ isEnabled: null }` — the "still resolving" state that the detail component renders as nothing.

## Out of scope

- Changing `OrganizationContext`'s global auto-selection logic or the org-switcher UI used in the rest of the app.
- Backend authorization changes — `platformPolicy` in `packages/backend/src/api/authorization/policies/platform.policy.ts` already unconditionally allows platform admins on `GET /api/v1/organizations/:id/intelligence/status`.
- Any call site of `useIntelligenceStatus` outside `bug-report-detail.tsx`.
- Surfacing intelligence UI for bugs whose project has no resolvable `organization_id`.

## Constraints

1. The parameter change to `useIntelligenceStatus` must be backward-compatible — existing callers passing no argument must behave exactly as today, falling back to `currentOrganization?.id`.
2. The derived `orgId` passed from `bug-report-detail.tsx` must come from the bug's own project data, not from `OrganizationContext`, so it resolves independently of viewer membership. Critically, `bug-report-detail.tsx` must **never** let the hook fall back to `currentOrganization` while the project's org is unresolved (query still loading, or `organization_id` is `null`) — that would surface a normal org member's own intelligence status for a bug that isn't in their org. `orgIdOverride` must therefore distinguish "no override supplied" (`undefined`, legacy callers) from "override intended but not yet resolved" (`null`, forces the query disabled) — a plain `string | undefined` parameter can't express that distinction.
3. No new backend routes, schema migrations, or changes to the intelligence service are required.
4. Normal org-member behavior must not regress: their cards must continue to gate off `currentOrganization` when no override is supplied.
5. Confirmed in `apps/admin/src/types/index.ts`: `Project.organization_id?: string | null` (line 291) and `BugReport.project_id: string` (line 310).
6. `bug-report-detail.tsx` does **not** currently fetch the project record — it only fetches the `BugReport` via `bugReportService.getById`. A minimal `projectService.getById(report.project_id)` query must be added; do not restructure unrelated component logic. While that query is loading or errors, `project` is `undefined`, which must map to a `null` override (not `undefined`) per Constraint 2 — never a silent fallback to the viewer's org.

## Acceptance criteria

- [ ] A platform-admin user with no personal org membership who opens a bug in an intelligence-enabled org sees the AI Enrichment card and Similar Bugs widget on the "Details & Metadata" tab — verified by test case A.
- [ ] A platform-admin user opening a bug in an intelligence-disabled org sees the "Intelligence disabled" notice rather than blank space — verified by test case B.
- [ ] `useIntelligenceStatus()` called with no argument continues to use `currentOrganization?.id` as before, returning `{ isEnabled: null }` when `currentOrganization` is `null` — verified by test case D.
- [ ] A normal org-member user sees no regression: intelligence cards still gate correctly off `currentOrganization` — verified by test case C.
- [ ] When `project.organization_id` is available it takes precedence over `currentOrganization?.id` — verified by test case A.
- [ ] While the bug's project org is unresolved (loading, or `organization_id` is `null`), the hook never falls back to `currentOrganization` — a normal org member must not see intelligence status for their own org on a bug outside it — verified by test case E and component test case G.

## Changes

### `apps/admin/src/hooks/use-intelligence-status.ts`

Add an optional `orgIdOverride?: string | null` parameter. `undefined` means "no override" and preserves today's `currentOrganization?.id` fallback; `null` means "an override applies but hasn't resolved yet" and must **not** fall back — it forces `orgId` to `undefined` so the query stays disabled. All other hook logic (query key, `enabled` guard, return shape) remains unchanged.

```ts
// Confirmed current shape (verified in file):
//   export function useIntelligenceStatus(): {...} {
//     const { currentOrganization } = useOrganization();
//     const orgId = currentOrganization?.id;

// New signature and derivation — insert in place of the above:
export function useIntelligenceStatus(orgIdOverride?: string | null) {
  const { currentOrganization } = useOrganization();
  const orgId = orgIdOverride === undefined ? currentOrganization?.id : (orgIdOverride ?? undefined);
  // remainder of hook body unchanged
```

### `apps/admin/src/components/bug-reports/bug-report-detail.tsx`

The component does not fetch project data today — only `report` (via `bugReportService.getById`, confirmed at the existing `useQuery` call). Add a `projectService.getById(report.project_id)` query gated on `report?.project_id`, derive `bugOrgId` from its `organization_id`, and pass it as the override to `useIntelligenceStatus`.

This call site always intends a project-scoped override (Constraint 2), so `bugOrgId` must be typed `string | null` — **never `undefined`** — so the hook can never silently fall back to the viewer's `currentOrganization`. While the project query is loading, or if it resolves with `organization_id: null` (or errors, leaving `project` undefined), `bugOrgId` must be `null`; only a successfully resolved `organization_id` string overrides that.

Note the existing `useIntelligenceStatus()` call currently sits _above_ the `report` query (before it in source order) and above the `if (isLoading || !report) return ...` early return. Since the derived `bugOrgId` depends on `report`, the intelligence-status call must move below both the `report` and new `project` queries — hooks must still run unconditionally before the early return, so this is a reordering, not a conditional call.

```ts
import { projectService } from '../../services/project-service';

// Confirmed current call site (line 39):
//   const { data: report, isLoading } = useQuery({
//     queryKey: ['bugReport', reportId],
//     queryFn: () => bugReportService.getById(reportId),
//   });

// Add immediately after the report query:
const { data: project } = useQuery({
  queryKey: ['project', report?.project_id],
  queryFn: () => projectService.getById(report!.project_id),
  enabled: !!report?.project_id,
});

// null (not undefined) while unresolved/errored/no-org, so the hook never
// falls back to the viewer's own currentOrganization for this call site.
const bugOrgId: string | null = project?.organization_id ?? null;

// Move the existing useIntelligenceStatus() call (currently line 37, above the
// report query) to here, passing the override:
const { isEnabled: intelligenceEnabled } = useIntelligenceStatus(bugOrgId);
```

## Tests

### `apps/admin/src/tests/hooks/use-intelligence-status.test.tsx` (new)

**Mock/fixture updates required:**

Mock `useOrganization` and `intelligenceService.getStatus` at the module level via `vi.mock`, matching the established hook-test pattern (`use-permissions.test.tsx` mocks `api-client` directly; `use-onboarding-status.test.tsx` mocks service modules directly) — this codebase does not use MSW for hook tests (MSW is only wired up in one unrelated integration test).

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useIntelligenceStatus } from '../../hooks/use-intelligence-status';
import { useOrganization } from '../../contexts/organization-context';
import { intelligenceService } from '../../services/intelligence-service';

// At top level (vi.mock must be hoisted):
vi.mock('../../contexts/organization-context', () => ({
  useOrganization: vi.fn(),
}));
vi.mock('../../services/intelligence-service', () => ({
  intelligenceService: { getStatus: vi.fn() },
}));

function queryClientWrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(useOrganization).mockReset();
  vi.mocked(intelligenceService.getStatus).mockReset();
});
```

All test cases below (A-E) render via `renderHook(() => useIntelligenceStatus(...), { wrapper: queryClientWrapper })` and assert against the mocked `useOrganization`/`intelligenceService.getStatus` declared above.

**Test case A — override takes precedence over a different currentOrganization (AC #1, #5):**

```ts
it('uses orgIdOverride and returns isEnabled true when override resolves an enabled org', async () => {
  // currentOrganization is a *different*, real org — proves the override wins
  // rather than merely passing because currentOrganization was null.
  vi.mocked(useOrganization).mockReturnValue({
    currentOrganization: { id: 'org-viewer' },
  } as any);
  vi.mocked(intelligenceService.getStatus).mockResolvedValue({ intelligence_enabled: true });

  const { result } = renderHook(() => useIntelligenceStatus('org-enabled'), {
    wrapper: queryClientWrapper,
  });

  await waitFor(() => expect(result.current.isEnabled).toBe(true));
  expect(intelligenceService.getStatus).toHaveBeenCalledTimes(1);
  expect(intelligenceService.getStatus).toHaveBeenCalledWith('org-enabled');
});
```

**Test case B — platform admin, intelligence-disabled org, override provided (AC #2):**

```ts
it('returns isEnabled false when override resolves a disabled org', async () => {
  vi.mocked(useOrganization).mockReturnValue({ currentOrganization: null } as any);
  vi.mocked(intelligenceService.getStatus).mockResolvedValue({ intelligence_enabled: false });

  const { result } = renderHook(() => useIntelligenceStatus('org-disabled'), {
    wrapper: queryClientWrapper,
  });

  await waitFor(() => expect(result.current.isEnabled).toBe(false));
});
```

**Test case C — normal org member, no override, currentOrganization present (AC #4):**

```ts
it('falls back to currentOrganization.id when no override is provided', async () => {
  vi.mocked(useOrganization).mockReturnValue({
    currentOrganization: { id: 'org-member' },
  } as any);
  vi.mocked(intelligenceService.getStatus).mockResolvedValue({ intelligence_enabled: true });

  const { result } = renderHook(() => useIntelligenceStatus(), {
    wrapper: queryClientWrapper,
  });

  await waitFor(() => expect(result.current.isEnabled).toBe(true));
  expect(intelligenceService.getStatus).toHaveBeenCalledWith('org-member');
});
```

**Test case D — no override, no currentOrganization, query never fires (AC #3):**

```ts
it('returns isEnabled null and does not fire a query when no override and no currentOrganization', () => {
  vi.mocked(useOrganization).mockReturnValue({ currentOrganization: null } as any);

  const { result } = renderHook(() => useIntelligenceStatus(), {
    wrapper: queryClientWrapper,
  });

  expect(intelligenceService.getStatus).not.toHaveBeenCalled();

  expect(result.current.isEnabled).toBeNull();
});
```

**Test case E — override is `null` (project org unresolved), does not fall back to a real currentOrganization (AC #6, Constraint 2):**

```ts
it('does not fall back to currentOrganization when override is explicitly null', () => {
  // currentOrganization is a *real* org here — proves a null override still
  // wins over it, unlike an omitted (undefined) override.
  vi.mocked(useOrganization).mockReturnValue({
    currentOrganization: { id: 'org-viewer' },
  } as any);

  const { result } = renderHook(() => useIntelligenceStatus(null), {
    wrapper: queryClientWrapper,
  });

  expect(intelligenceService.getStatus).not.toHaveBeenCalled();
  expect(result.current.isEnabled).toBeNull();
});
```

### `apps/admin/src/tests/components/bug-reports/bug-report-detail.test.tsx` (new)

Component-level coverage for the wiring itself — the hook tests above don't prove `BugReportDetail` fetches the project, derives `bugOrgId` correctly, or renders the right UI for each state. Mock the three services `bug-report-detail.tsx` depends on (`bugReportService`/`storageService` are both exported from `../../services/api`, confirmed at the component's import line) and stub the heavy/unrelated children as no-ops or detectable markers, following the pattern already used in `apps/admin/src/tests/pages/admin-org-scope-effects.test.tsx`. The global `react-i18next` mock in `apps/admin/src/tests/setup.ts` already resolves real `en.json` strings, so no local i18n mock is needed.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BugReportDetail } from '../../../components/bug-reports/bug-report-detail';
import { bugReportService } from '../../../services/api';
import { projectService } from '../../../services/project-service';
import { intelligenceService } from '../../../services/intelligence-service';

vi.mock('../../../services/api', () => ({
  bugReportService: { getById: vi.fn() },
  storageService: { downloadResource: vi.fn() },
}));
vi.mock('../../../services/project-service', () => ({
  projectService: { getById: vi.fn() },
}));
vi.mock('../../../services/intelligence-service', () => ({
  intelligenceService: { getStatus: vi.fn() },
}));
// Heavy/unrelated children — out of scope for this test; replaced with
// detectable markers so we can assert on wiring without their own data fetches.
vi.mock('../../../components/bug-reports/session-replay-player', () => ({
  SessionReplayPlayer: () => null,
}));
vi.mock('../../../components/bug-reports/share-token-manager', () => ({
  ShareTokenManager: () => null,
}));
vi.mock('../../../components/bug-reports/ai-enrichment-card', () => ({
  AIEnrichmentCard: () => <div data-testid="ai-enrichment-card" />,
}));
vi.mock('../../../components/bug-reports/similar-bugs-widget', () => ({
  SimilarBugsWidget: () => <div data-testid="similar-bugs-widget" />,
}));
vi.mock('../../../components/bug-reports/suggest-fix-button', () => ({
  SuggestFixButton: () => <div data-testid="suggest-fix-button" />,
}));

const mockReport = {
  id: 'bug-1',
  project_id: 'proj-1',
  title: 'Crash on submit',
  description: null,
  screenshot_url: null,
  screenshot_key: null,
  replay_url: null,
  replay_key: null,
  replay_upload_status: 'none',
  metadata: {},
  status: 'open',
  priority: 'high',
  duplicate_of: null,
  deleted_at: null,
  deleted_by: null,
  legal_hold: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function openDetailsTab() {
  await screen.findByText('Crash on submit');
  fireEvent.click(screen.getByRole('button', { name: /Details & Metadata/i }));
}

beforeEach(() => {
  vi.mocked(bugReportService.getById)
    .mockReset()
    .mockResolvedValue(mockReport as never);
  vi.mocked(projectService.getById).mockReset();
  vi.mocked(intelligenceService.getStatus).mockReset();
});
```

**Test case F — intelligence-enabled org renders the gated cards (AC #1):**

```tsx
it('renders AI Enrichment, Similar Bugs, and Suggest Fix once the project org resolves as enabled', async () => {
  vi.mocked(projectService.getById).mockResolvedValue({
    id: 'proj-1',
    organization_id: 'org-enabled',
  } as never);
  vi.mocked(intelligenceService.getStatus).mockResolvedValue({ intelligence_enabled: true });

  render(<BugReportDetail reportId="bug-1" onClose={() => {}} />, { wrapper });
  await openDetailsTab();

  expect(await screen.findByTestId('ai-enrichment-card')).toBeInTheDocument();
  expect(screen.getByTestId('similar-bugs-widget')).toBeInTheDocument();
  expect(screen.getByTestId('suggest-fix-button')).toBeInTheDocument();
  expect(intelligenceService.getStatus).toHaveBeenCalledWith('org-enabled');
});
```

**Test case G — unresolved project org never falls back to the viewer's org (AC #6):**

```tsx
it('does not call intelligenceService.getStatus while the project org is unresolved', async () => {
  vi.mocked(projectService.getById).mockResolvedValue({
    id: 'proj-1',
    organization_id: null,
  } as never);

  render(<BugReportDetail reportId="bug-1" onClose={() => {}} />, { wrapper });
  await openDetailsTab();

  expect(intelligenceService.getStatus).not.toHaveBeenCalled();
  expect(screen.queryByTestId('ai-enrichment-card')).not.toBeInTheDocument();
});
```

**Test case H — intelligence-disabled org renders the notice, not blank space (AC #2):**

```tsx
it('renders the intelligence-disabled notice when the project org has intelligence disabled', async () => {
  vi.mocked(projectService.getById).mockResolvedValue({
    id: 'proj-1',
    organization_id: 'org-disabled',
  } as never);
  vi.mocked(intelligenceService.getStatus).mockResolvedValue({ intelligence_enabled: false });

  render(<BugReportDetail reportId="bug-1" onClose={() => {}} />, { wrapper });
  await openDetailsTab();

  expect(
    await screen.findByText(
      /AI enrichment, similar-bug detection, and fix suggestions are disabled/i
    )
  ).toBeInTheDocument();
  expect(screen.queryByTestId('ai-enrichment-card')).not.toBeInTheDocument();
});
```

## Verification

```bash
pnpm --filter @bugspotter/admin build
pnpm --filter @bugspotter/admin test
```

Rollback: all changes are additive — a hook parameter (`orgIdOverride?: string | null`), a new project-fetch query and hook-order change in one component, and two new test files. Reverting the PR fully restores current behavior. No DB changes, no migrations, no irreversible steps.
