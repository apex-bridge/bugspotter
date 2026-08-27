import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import OrgSsoPage from '../../pages/organization/org-sso';
import { usePermissions } from '../../hooks/use-permissions';
import { useSsoConfig } from '../../hooks/use-sso-config';

vi.mock('../../hooks/use-permissions', () => ({
  usePermissions: vi.fn(),
}));

// useSsoConfig is a @tanstack/react-query hook; mocking the module
// directly avoids needing a QueryClientProvider ancestor, same fix as
// dedup-rules-back-nav.test.tsx uses for useDedupRules().
vi.mock('../../hooks/use-sso-config', () => ({
  useSsoConfig: vi.fn(),
}));

describe('OrgSsoPage', () => {
  it('renders the SSO config form for an org admin and enables the query', () => {
    vi.mocked(usePermissions).mockReturnValue({
      isSystemAdmin: false,
      orgRole: 'admin',
      isLoading: false,
    } as ReturnType<typeof usePermissions>);
    vi.mocked(useSsoConfig).mockReturnValue({
      config: undefined,
      isLoading: true,
      error: null,
      updateConfig: vi.fn(),
    } as ReturnType<typeof useSsoConfig>);

    render(<OrgSsoPage />);

    expect(useSsoConfig).toHaveBeenCalledWith({ enabled: true });
    expect(screen.getByRole('heading', { name: /sso/i })).toBeInTheDocument();
  });

  it('does not render the SSO config form for a regular member, and does not enable the query', () => {
    vi.mocked(usePermissions).mockReturnValue({
      isSystemAdmin: false,
      orgRole: 'member',
      isLoading: false,
    } as ReturnType<typeof usePermissions>);
    vi.mocked(useSsoConfig).mockReturnValue({
      config: undefined,
      isLoading: false,
      error: null,
      updateConfig: vi.fn(),
    } as ReturnType<typeof useSsoConfig>);

    render(<OrgSsoPage />);

    expect(useSsoConfig).toHaveBeenCalledWith({ enabled: false });
    expect(screen.queryByRole('heading', { name: /sso/i })).not.toBeInTheDocument();
  });
});
