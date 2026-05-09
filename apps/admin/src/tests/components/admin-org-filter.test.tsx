import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <MemoryRouter initialEntries={['/projects']}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

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
    useAuthMock.mockReturnValue({
      user: {
        id: 'admin',
        email: 'admin@x.com',
        role: 'admin',
        security: { is_platform_admin: true },
      },
    });
    render(<AdminOrgFilter />, { wrapper });
    expect(screen.getByTestId('admin-org-filter')).toBeDefined();
    expect(screen.getByLabelText('adminOrgFilter.label')).toBeDefined();
  });
});
