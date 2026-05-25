/**
 * Regression tests for the admin-org-scope effects added in PR #119.
 *
 * Each list page (bug-reports, api-keys, users) resets its `page` state
 * to 1 when the platform-admin org filter changes, so an admin paging
 * through org A doesn't land on `?page=5&organization_id=B` and see a
 * misleading empty view. bug-reports also strips `project_id` from its
 * filters object using destructure-and-rest (NOT `{ ...prev, project_id:
 * undefined }`) — the comment in bug-reports.tsx is explicit that
 * leaving the key in place would mislead `Object.keys(filters).length > 0`
 * checks downstream.
 *
 * projects.tsx auto-seeds the Create form's `selectedOrgId` from the
 * sidebar filter, but ONLY when the org actually exists in the page's
 * own `organizations` list. Without that gate, a non-admin pasting a
 * foreign `?organizationId=` (or an admin deep-linking past the page's
 * own 100-org window) would set `selectedOrgId` to a value with no
 * matching `<SelectItem>` — silent bad form state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, act, waitFor, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useOrgFilter } from '../../hooks/use-org-filter';
import {
  bugReportService,
  userService,
  projectService,
  analyticsService,
} from '../../services/api';
import { apiKeyService } from '../../services/api-key-service';
import { organizationService } from '../../services/organization-service';
import BugReportsPage from '../../pages/bug-reports';
import ApiKeysPage from '../../pages/api-keys';
import UsersPage from '../../pages/users';
import ProjectsPage from '../../pages/projects';
import DashboardPage from '../../pages/dashboard';

// ---- Service mocks. Each test resets the relevant spy. -------------------
//
// Pages import services from a mix of paths — some via the `api.ts`
// re-export aggregator, others directly from the source module
// (e.g. `api-keys.tsx` imports `apiKeyService` from
// `../services/api-key-service`). Vitest mocks are per-module, so we
// have to intercept BOTH paths or the page hits the real axios client
// and ECONNREFUSEs against the dev API.

vi.mock('../../services/api', () => ({
  bugReportService: { getAll: vi.fn(), delete: vi.fn() },
  userService: { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  analyticsService: {
    getDashboard: vi.fn(),
    getReportTrend: vi.fn(),
    getProjectStats: vi.fn(),
  },
  projectService: {
    getAll: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  projectMemberService: {
    list: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    listForUser: vi.fn(),
  },
}));

vi.mock('../../services/api-key-service', () => ({
  apiKeyService: { getAll: vi.fn() },
}));

vi.mock('../../services/organization-service', () => ({
  organizationService: {
    list: vi.fn(),
    mine: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Auth — non-admin by default; tests that need platform-admin override.
const useAuthMock = vi.fn();
vi.mock('../../contexts/auth-context', () => ({
  useAuth: () => useAuthMock(),
}));

// Heavy child components — out of scope for these effect tests.
vi.mock('../../components/bug-reports/bug-report-filters', () => ({
  BugReportFilters: () => null,
}));
vi.mock('../../components/bug-reports/semantic-search-bar', () => ({
  SemanticSearchBar: () => null,
}));
vi.mock('../../components/bug-reports/bug-report-list', () => ({
  BugReportList: () => null,
}));
vi.mock('../../components/bug-reports/bug-report-detail', () => ({
  BugReportDetail: () => null,
}));
vi.mock('../../components/api-keys/api-key-table', () => ({
  ApiKeyTable: () => null,
}));
vi.mock('../../components/api-keys/create-api-key-dialog', () => ({
  CreateApiKeyDialog: () => null,
}));
vi.mock('../../components/api-keys/show-api-key-dialog', () => ({
  ShowApiKeyDialog: () => null,
}));
vi.mock('../../components/api-keys/api-key-usage-dialog', () => ({
  ApiKeyUsageDialog: () => null,
}));

function makeWrapper(initialEntries: string[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

/**
 * Renders both the page under test AND a tiny harness component that
 * exposes the `useOrgFilter` setter. Tests trigger URL changes by
 * calling the setter (mirrors what the actual sidebar dropdown does)
 * — MemoryRouter doesn't expose external navigation post-mount, so
 * doing this from inside the tree is the cleanest path.
 */
function renderWithOrgFilterControls(node: ReactNode, initialEntries: string[]) {
  let setSelectedOrgIdRef: ((id: string | null) => void) | null = null;
  function FilterControls() {
    const { setSelectedOrgId } = useOrgFilter();
    setSelectedOrgIdRef = setSelectedOrgId;
    return null;
  }
  const utils = render(
    <>
      <FilterControls />
      {node}
    </>,
    { wrapper: makeWrapper(initialEntries) }
  );
  return {
    ...utils,
    setOrg: (id: string | null) => {
      act(() => {
        setSelectedOrgIdRef!(id);
      });
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({
    user: {
      id: 'admin-1',
      email: 'admin@x.com',
      role: 'admin',
      security: { is_platform_admin: true },
    },
  });
  // Default empty payload so pages render without throwing on undefined data.
  vi.mocked(bugReportService.getAll).mockResolvedValue({
    data: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  vi.mocked(apiKeyService.getAll).mockResolvedValue({
    data: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  vi.mocked(userService.getAll).mockResolvedValue({
    users: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  } as never);
  vi.mocked(projectService.getAll).mockResolvedValue([] as never);
  vi.mocked(analyticsService.getDashboard).mockResolvedValue({
    bug_reports: {
      by_status: { open: 0, in_progress: 0, resolved: 0, closed: 0, total: 0 },
      by_priority: { low: 0, medium: 0, high: 0, critical: 0 },
    },
    projects: { total: 0, total_reports: 0, avg_reports_per_project: 0 },
    users: { total: 0 },
    time_series: [],
    top_projects: [],
  } as never);
  vi.mocked(organizationService.list).mockResolvedValue({
    data: [
      { id: 'acme', name: 'Acme', subdomain: 'acme' } as never,
      { id: 'initech', name: 'Initech', subdomain: 'initech' } as never,
    ],
    pagination: { page: 1, limit: 100, total: 2, totalPages: 1 },
  });
  vi.mocked(organizationService.mine).mockResolvedValue([
    { id: 'acme', name: 'Acme', subdomain: 'acme' } as never,
  ]);
});

describe('admin-org-scope effects — page reset', () => {
  // Each page-reset test follows the same pattern: render with multi-page
  // data so the Next button shows; click Next to advance page state past
  // 1; switch the org scope; assert the next service call is back at
  // page=1. Without the "advance past 1" step the test would be vacuous —
  // page already starts at 1, so the post-effect assertion would pass
  // even if `setPage(1)` were deleted from the effect.

  it('bug-reports: resets page to 1 when the org filter changes', async () => {
    vi.mocked(bugReportService.getAll).mockResolvedValue({
      data: [{ id: 'bug-1', project_id: 'p', title: 't', status: 'open' } as never],
      pagination: { page: 1, limit: 20, total: 100, totalPages: 5 },
    });
    const user = userEvent.setup();
    const { setOrg } = renderWithOrgFilterControls(<BugReportsPage />, [
      '/bug-reports?organizationId=acme',
    ]);

    await waitFor(() => expect(bugReportService.getAll).toHaveBeenCalled());

    // Advance past page 1 via the actual UI control, so the test fails
    // if `setPage(1)` is removed from the scope-change effect. Use
    // `findBy*` (not `getBy*`) so the click waits for the pagination
    // to render after the query resolves.
    await user.click(await screen.findByText('bugReports.next'));
    await waitFor(() => {
      const call = vi.mocked(bugReportService.getAll).mock.calls.at(-1)!;
      expect(call[1]).toBe(2);
    });

    vi.mocked(bugReportService.getAll).mockClear();
    setOrg('initech');

    await waitFor(() => expect(bugReportService.getAll).toHaveBeenCalled());
    const lastCall = vi.mocked(bugReportService.getAll).mock.calls.at(-1)!;
    // Signature: getAll(filters, page, limit, sortBy, order, organizationId)
    expect(lastCall[1]).toBe(1);
    expect(lastCall[5]).toBe('initech');
  });

  it('api-keys: resets page to 1 when the org filter changes', async () => {
    vi.mocked(apiKeyService.getAll).mockResolvedValue({
      data: [{ id: 'k-1', name: 'k', key_prefix: 'bgs' } as never],
      pagination: { page: 1, limit: 20, total: 100, totalPages: 5 },
    });
    const user = userEvent.setup();
    const { setOrg } = renderWithOrgFilterControls(<ApiKeysPage />, [
      '/api-keys?organizationId=acme',
    ]);
    await waitFor(() => expect(apiKeyService.getAll).toHaveBeenCalled());

    await user.click(await screen.findByLabelText('apiKeys.nextPage'));
    await waitFor(() => {
      const call = vi.mocked(apiKeyService.getAll).mock.calls.at(-1)!;
      expect(call[0]).toBe(2);
    });

    vi.mocked(apiKeyService.getAll).mockClear();
    setOrg('initech');

    await waitFor(() => expect(apiKeyService.getAll).toHaveBeenCalled());
    const lastCall = vi.mocked(apiKeyService.getAll).mock.calls.at(-1)!;
    // Signature: getAll(page, limit, status, organizationId)
    expect(lastCall[0]).toBe(1);
    expect(lastCall[3]).toBe('initech');
  });

  it('users: resets page to 1 when the org filter changes', async () => {
    vi.mocked(userService.getAll).mockResolvedValue({
      users: [{ id: 'u-1', email: 'u@x.com', name: 'U' } as never],
      pagination: { page: 1, limit: 20, total: 100, totalPages: 5 },
    } as never);
    const user = userEvent.setup();
    const { setOrg } = renderWithOrgFilterControls(<UsersPage />, ['/users?organizationId=acme']);
    await waitFor(() => expect(userService.getAll).toHaveBeenCalled());

    await user.click(await screen.findByTestId('users-next-page'));
    await waitFor(() => {
      const call = vi.mocked(userService.getAll).mock.calls.at(-1)!;
      expect(call[0]).toMatchObject({ page: 2 });
    });

    vi.mocked(userService.getAll).mockClear();
    setOrg('initech');

    await waitFor(() => expect(userService.getAll).toHaveBeenCalled());
    const lastCall = vi.mocked(userService.getAll).mock.calls.at(-1)!;
    expect(lastCall[0]).toMatchObject({ page: 1, organizationId: 'initech' });
  });
});

describe('admin-org-scope effects — bug-reports project_id strip', () => {
  it('removes the project_id KEY from filters (not just sets it to undefined) on org-scope change', async () => {
    // Start on org A — render and wait for first call.
    const { setOrg } = renderWithOrgFilterControls(<BugReportsPage />, [
      '/bug-reports?organizationId=acme',
    ]);
    await waitFor(() => expect(bugReportService.getAll).toHaveBeenCalled());

    // The scope-change effect runs on every adminOrgScope change. We
    // can't directly inject a `project_id` filter (BugReportFilters is
    // mocked out), but we CAN assert the destructure-and-rest contract
    // by inspecting the filters object passed to bugReportService:
    // after the effect fires, the filters arg must be an object whose
    // own enumerable keys do not include `project_id`. (A future
    // refactor to `{ ...prev, project_id: undefined }` would still
    // include the key — `'project_id' in filters === true` — and this
    // assertion would catch it.)
    vi.mocked(bugReportService.getAll).mockClear();
    setOrg('initech');

    await waitFor(() => expect(bugReportService.getAll).toHaveBeenCalled());
    const lastCall = vi.mocked(bugReportService.getAll).mock.calls.at(-1)!;
    const filtersArg = lastCall[0] as Record<string, unknown>;
    expect(filtersArg).toBeDefined();
    expect('project_id' in filtersArg).toBe(false);
  });
});

describe('projects.tsx auto-seed gate', () => {
  // The real contract is on the form's `selectedOrgId` state, not on
  // any service call — when the deep-linked org IS in the dropdown the
  // form should pre-select it; when it's NOT, the form should stay
  // empty so the user has to pick. Open the create form and inspect
  // the underlying <select> value directly. The select is a native
  // <select> (see projects.tsx:236) so `.value` is the source of truth.

  it('seeds the Create form when the deep-linked org IS in the dropdown', async () => {
    const user = userEvent.setup();
    renderWithOrgFilterControls(<ProjectsPage />, ['/projects?organizationId=acme']);
    await waitFor(() => expect(organizationService.list).toHaveBeenCalled());
    await waitFor(() => expect(projectService.getAll).toHaveBeenCalled());

    await user.click(screen.getByTestId('new-project-button'));
    const form = await screen.findByTestId('create-project-form');
    const select = within(form).getByTestId('project-org-select') as HTMLSelectElement;
    expect(select.value).toBe('acme');
  });

  it('does NOT seed when the deep-linked org is absent from the dropdown', async () => {
    // Foreign org — not in `organizationService.list` payload. Pre-fix,
    // the seed effect would still fire and set selectedOrgId='ghost'
    // even though no <option> with that value exists. Post-fix the
    // `scopeIsKnown` gate bails out, leaving the form blank.
    const user = userEvent.setup();
    renderWithOrgFilterControls(<ProjectsPage />, ['/projects?organizationId=ghost']);
    await waitFor(() => expect(organizationService.list).toHaveBeenCalled());
    await waitFor(() => expect(projectService.getAll).toHaveBeenCalled());

    await user.click(screen.getByTestId('new-project-button'));
    const form = await screen.findByTestId('create-project-form');
    const select = within(form).getByTestId('project-org-select') as HTMLSelectElement;
    // Empty string = the placeholder "Select an organization" option.
    // Crucially NOT 'ghost' — that would mean the gate is broken.
    expect(select.value).toBe('');
  });
});

describe('dashboard.tsx — analyticsService.getDashboard receives the org filter', () => {
  // Unlike the four list pages above, dashboard.tsx has no in-page state
  // (no pagination, no filters) so the only thing to assert is that the
  // service call carries the orgId from useOrgFilter, and re-fires when
  // the URL param changes. Without the wiring, the dashboard would stay
  // on the cross-org aggregate regardless of sidebar selection.

  it('passes the URL ?organizationId= through to analyticsService.getDashboard', async () => {
    renderWithOrgFilterControls(<DashboardPage />, ['/dashboard?organizationId=acme']);

    await waitFor(() => expect(analyticsService.getDashboard).toHaveBeenCalled());
    const lastCall = vi.mocked(analyticsService.getDashboard).mock.calls.at(-1)!;
    expect(lastCall[0]).toBe('acme');
  });

  it('refetches with the new org id when the filter changes', async () => {
    const { setOrg } = renderWithOrgFilterControls(<DashboardPage />, [
      '/dashboard?organizationId=acme',
    ]);
    await waitFor(() => expect(analyticsService.getDashboard).toHaveBeenCalled());
    vi.mocked(analyticsService.getDashboard).mockClear();

    setOrg('initech');

    await waitFor(() => expect(analyticsService.getDashboard).toHaveBeenCalled());
    const lastCall = vi.mocked(analyticsService.getDashboard).mock.calls.at(-1)!;
    expect(lastCall[0]).toBe('initech');
  });

  it('passes null when no org filter is set (cross-org view for platform admin)', async () => {
    renderWithOrgFilterControls(<DashboardPage />, ['/dashboard']);

    await waitFor(() => expect(analyticsService.getDashboard).toHaveBeenCalled());
    const lastCall = vi.mocked(analyticsService.getDashboard).mock.calls.at(-1)!;
    expect(lastCall[0]).toBeNull();
  });
});
