import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { usePermissions } from '../../hooks/use-permissions';
import { api } from '../../lib/api-client';

// We mock auth/org contexts so the hook runs without a full provider
// tree; everything else flows through React Query as in production.
const useAuthMock = vi.fn();
const useOrganizationMock = vi.fn();

vi.mock('../../contexts/auth-context', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../../contexts/organization-context', () => ({
  useOrganization: () => useOrganizationMock(),
}));

vi.mock('../../lib/api-client', () => ({
  api: { get: vi.fn() },
  API_ENDPOINTS: { permissions: { me: () => '/api/v1/permissions/me' } },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('usePermissions', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useOrganizationMock.mockReset();
    vi.mocked(api.get).mockReset();
  });

  it('falls back to JWT-derived isPlatformAdmin while the query is loading', () => {
    // Platform admin per the JWT, no permissionsData yet.
    useAuthMock.mockReturnValue({ user: { id: 'u-1', role: 'admin' } });
    useOrganizationMock.mockReturnValue({ currentOrganization: { id: 'org-1' } });
    vi.mocked(api.get).mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => usePermissions(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isSystemAdmin).toBe(true);
    expect(result.current.orgRole).toBeNull();
    expect(result.current.permissionsData).toBeUndefined();
  });

  it('uses backend-computed isAdmin once the query resolves', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u-1', role: 'user' } });
    useOrganizationMock.mockReturnValue({ currentOrganization: { id: 'org-1' } });
    vi.mocked(api.get).mockResolvedValue({
      data: {
        data: {
          system: { role: 'platform_admin', isAdmin: true },
          organization: {
            role: 'admin',
            canManageMembers: true,
            canManageInvitations: true,
            canManageBilling: false,
          },
        },
      },
    });

    const { result } = renderHook(() => usePermissions(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isSystemAdmin).toBe(true);
    expect(result.current.orgRole).toBe('admin');
    expect(result.current.permissionsData?.organization?.canManageBilling).toBe(false);
  });

  it('returns orgRole=null when the user has no org membership', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u-1', role: 'user' } });
    useOrganizationMock.mockReturnValue({ currentOrganization: { id: 'org-1' } });
    vi.mocked(api.get).mockResolvedValue({
      data: {
        data: {
          system: { role: 'user', isAdmin: false },
          // organization deliberately omitted
        },
      },
    });

    const { result } = renderHook(() => usePermissions(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isSystemAdmin).toBe(false);
    expect(result.current.orgRole).toBeNull();
  });

  it('does not fire the query when no organization is active', () => {
    useAuthMock.mockReturnValue({ user: { id: 'u-1', role: 'user' } });
    useOrganizationMock.mockReturnValue({ currentOrganization: null });

    const { result } = renderHook(() => usePermissions(), { wrapper });

    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.permissionsData).toBeUndefined();
    // Falls back to JWT (non-admin user → false)
    expect(result.current.isSystemAdmin).toBe(false);
  });

  it('does not fire the query when no user is logged in', () => {
    useAuthMock.mockReturnValue({ user: null });
    useOrganizationMock.mockReturnValue({ currentOrganization: { id: 'org-1' } });

    renderHook(() => usePermissions(), { wrapper });

    expect(api.get).not.toHaveBeenCalled();
  });
});
