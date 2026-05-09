import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AdminOrgFilter } from '../../components/admin-org-filter';
import { organizationService } from '../../services/organization-service';

const useAuthMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('../../contexts/auth-context', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../../services/organization-service', () => ({
  organizationService: { list: vi.fn() },
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

const wrapper = makeWrapper(['/projects']);

const adminUser = {
  id: 'admin',
  email: 'admin@x.com',
  role: 'admin',
  security: { is_platform_admin: true },
};

describe('<AdminOrgFilter>', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    vi.mocked(organizationService.list).mockReset();
    vi.mocked(organizationService.list).mockResolvedValue({
      data: [
        { id: 'acme', name: 'Acme', subdomain: 'acme' } as never,
        { id: 'initech', name: 'Initech', subdomain: 'initech' } as never,
      ],
      pagination: { page: 1, limit: 100, total: 2, totalPages: 1 },
    });
  });

  it('renders nothing for non-platform-admin users', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u', email: 'u@x.com', role: 'user' },
    });
    const { container } = render(<AdminOrgFilter />, { wrapper });
    expect(container.firstChild).toBeNull();
    // Also: shouldn't have fired the org-list query for non-admins
    // (saves a round-trip on every page load).
    expect(organizationService.list).not.toHaveBeenCalled();
  });

  it('renders the dropdown for platform admins', () => {
    useAuthMock.mockReturnValue({ user: adminUser });
    render(<AdminOrgFilter />, { wrapper });
    expect(screen.getByTestId('admin-org-filter')).toBeDefined();
    expect(screen.getByLabelText('adminOrgFilter.label')).toBeDefined();
  });

  // The synthetic disabled "Unknown organization (id)" item is the
  // ONLY UI recovery path for a platform admin who deep-links to an
  // org outside the fetched window — orgs past index 100 (after
  // ORG_LIST_LIMIT was capped to match the backend schema), or orgs
  // that have since been deleted. Without it the trigger renders
  // blank and the user is stuck. These two tests pin the contract
  // until the >100-tenant case gets a real fix (issue #120).

  it('renders the synthetic "Unknown organization" item once the query resolves with the deep-linked org missing', async () => {
    useAuthMock.mockReturnValue({ user: adminUser });
    render(<AdminOrgFilter />, {
      wrapper: makeWrapper(['/projects?organizationId=ghost']),
    });

    // The trigger uses <SelectValue> which displays the matched
    // <SelectItem>'s text content for the current value. A synthetic
    // item with value="ghost" renders the unknown-org label, so the
    // trigger ends up showing it. If the synthetic item were never
    // rendered (regression), the trigger would be blank.
    await waitFor(() => {
      const trigger = screen.getByLabelText('adminOrgFilter.label');
      expect(trigger.textContent).toContain('adminOrgFilter.unknownOrg');
    });
  });

  it('does NOT flash the synthetic item while the query is pending', () => {
    // Pending forever — orgsResponse stays undefined, `selectedIsMissing`
    // must be false until the fetch resolves. Without the `!!orgsResponse`
    // gate, EVERY initial render with a deep-linked org would briefly
    // show the synthetic item even for valid orgs that just haven't
    // arrived yet.
    vi.mocked(organizationService.list).mockReturnValue(new Promise(() => {}));
    useAuthMock.mockReturnValue({ user: adminUser });

    render(<AdminOrgFilter />, {
      wrapper: makeWrapper(['/projects?organizationId=acme']),
    });

    const trigger = screen.getByLabelText('adminOrgFilter.label');
    expect(trigger.textContent).not.toContain('adminOrgFilter.unknownOrg');
  });
});
