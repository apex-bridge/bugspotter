import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useOnboardingStatus } from '../../hooks/use-onboarding-status';
import { projectService, bugReportService } from '../../services/api';
import { integrationService } from '../../services/integration-service';

// Pin the hook's logic in isolation. The consumer test
// (`quick-setup-actions.test.tsx`) mocks this hook wholesale, so
// without these tests the role-string match, the `enabled` gates,
// and the `primaryProjectId` selection are all unverified.

const useOrganizationMock = vi.fn();
const usePermissionsMock = vi.fn();

vi.mock('../../contexts/organization-context', () => ({
  useOrganization: () => useOrganizationMock(),
}));

vi.mock('../../hooks/use-permissions', () => ({
  usePermissions: () => usePermissionsMock(),
}));

vi.mock('../../services/api', () => ({
  projectService: { getAll: vi.fn() },
  bugReportService: { getAll: vi.fn() },
}));

vi.mock('../../services/integration-service', () => ({
  integrationService: { summary: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ORG = { id: 'org-1' };

describe('useOnboardingStatus', () => {
  beforeEach(() => {
    useOrganizationMock.mockReset();
    usePermissionsMock.mockReset();
    vi.mocked(projectService.getAll).mockReset();
    vi.mocked(integrationService.summary).mockReset();
    vi.mocked(bugReportService.getAll).mockReset();
  });

  // ---- canConfigure (role-string match) ----------------------------------
  // Pinning each role explicitly so a future backend rename of these
  // strings (`'admin'` → `'organization_admin'`, etc.) shows up as a
  // failure here instead of silently stripping CTAs in production.

  it.each([
    ['admin', true],
    ['owner', true],
    ['member', false],
    ['viewer', false],
    ['organization_admin', false], // hypothetical rename — would silently break
    ['organization_owner', false], // hypothetical rename — would silently break
  ] as const)('canConfigure for orgRole=%s → %s', (role, expected) => {
    useOrganizationMock.mockReturnValue({ currentOrganization: ORG, hasOrganization: true });
    usePermissionsMock.mockReturnValue({ isSystemAdmin: false, orgRole: role });
    vi.mocked(projectService.getAll).mockResolvedValue([]);
    vi.mocked(integrationService.summary).mockResolvedValue({ total: 0, by_platform: {} });

    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });

    expect(result.current.canConfigure).toBe(expected);
  });

  it('canConfigure is true for a platform admin even with no orgRole', () => {
    useOrganizationMock.mockReturnValue({ currentOrganization: ORG, hasOrganization: true });
    usePermissionsMock.mockReturnValue({ isSystemAdmin: true, orgRole: null });
    vi.mocked(projectService.getAll).mockResolvedValue([]);
    vi.mocked(integrationService.summary).mockResolvedValue({ total: 0, by_platform: {} });

    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });

    expect(result.current.canConfigure).toBe(true);
  });

  // ---- enabled gate ------------------------------------------------------
  // The integrations + projects queries should NOT fire for users that
  // can't configure (member/viewer) or when no org is active. Otherwise
  // we'd thrash the API on every page load for the typical user.

  it('does not fire downstream queries when canConfigure is false', () => {
    useOrganizationMock.mockReturnValue({ currentOrganization: ORG, hasOrganization: true });
    usePermissionsMock.mockReturnValue({ isSystemAdmin: false, orgRole: 'member' });

    renderHook(() => useOnboardingStatus(), { wrapper });

    expect(projectService.getAll).not.toHaveBeenCalled();
    expect(integrationService.summary).not.toHaveBeenCalled();
  });

  it('does not fire downstream queries when no organization is active', () => {
    useOrganizationMock.mockReturnValue({ currentOrganization: null, hasOrganization: false });
    usePermissionsMock.mockReturnValue({ isSystemAdmin: true, orgRole: null });

    renderHook(() => useOnboardingStatus(), { wrapper });

    expect(projectService.getAll).not.toHaveBeenCalled();
    expect(integrationService.summary).not.toHaveBeenCalled();
  });

  it('fires both downstream queries for an org admin in an active org', async () => {
    useOrganizationMock.mockReturnValue({ currentOrganization: ORG, hasOrganization: true });
    usePermissionsMock.mockReturnValue({ isSystemAdmin: false, orgRole: 'admin' });
    vi.mocked(projectService.getAll).mockResolvedValue([{ id: 'p-1' } as never]);
    vi.mocked(integrationService.summary).mockResolvedValue({ total: 0, by_platform: {} });

    renderHook(() => useOnboardingStatus(), { wrapper });

    await waitFor(() => {
      expect(projectService.getAll).toHaveBeenCalledTimes(1);
      expect(integrationService.summary).toHaveBeenCalledTimes(1);
    });
  });

  // ---- OnboardingState shape after data resolves -------------------------

  it('reports hasProject, projectCount, and primaryProjectId from the first project in the list', async () => {
    useOrganizationMock.mockReturnValue({ currentOrganization: ORG, hasOrganization: true });
    usePermissionsMock.mockReturnValue({ isSystemAdmin: false, orgRole: 'admin' });
    vi.mocked(projectService.getAll).mockResolvedValue([
      { id: 'first' } as never,
      { id: 'second' } as never,
    ]);
    vi.mocked(integrationService.summary).mockResolvedValue({ total: 0, by_platform: {} });

    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasProject).toBe(true);
    });
    // `primaryProjectId` is whatever the list returned first. Pinning
    // this makes any future change to project ordering (server-side
    // or client sort) visible — Connect Jira's single-project
    // shortcut inlines this id into the configure URL, so a silent
    // reordering would land users on a different project's flow.
    expect(result.current.primaryProjectId).toBe('first');
    // `projectCount` drives the single-vs-multi UX branch in
    // `<QuickSetupActions>` Connect Jira routing.
    expect(result.current.projectCount).toBe(2);
  });

  it('reports hasProject=false, projectCount=0, primaryProjectId=null for an empty project list', async () => {
    useOrganizationMock.mockReturnValue({ currentOrganization: ORG, hasOrganization: true });
    usePermissionsMock.mockReturnValue({ isSystemAdmin: false, orgRole: 'admin' });
    vi.mocked(projectService.getAll).mockResolvedValue([]);
    vi.mocked(integrationService.summary).mockResolvedValue({ total: 0, by_platform: {} });

    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasProject).toBe(false);
    });
    expect(result.current.primaryProjectId).toBeNull();
    expect(result.current.projectCount).toBe(0);
  });

  it('reports integrationCount from the summary endpoint total field', async () => {
    useOrganizationMock.mockReturnValue({ currentOrganization: ORG, hasOrganization: true });
    usePermissionsMock.mockReturnValue({ isSystemAdmin: false, orgRole: 'admin' });
    vi.mocked(projectService.getAll).mockResolvedValue([{ id: 'p-1' } as never]);
    vi.mocked(integrationService.summary).mockResolvedValue({
      total: 2,
      by_platform: { jira: 1, slack: 1 },
    });

    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.integrationCount).toBe(2);
    });
  });
});
