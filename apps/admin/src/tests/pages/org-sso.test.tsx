import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
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
  it('renders the SSO config form for an org admin', () => {
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
      isSaving: false,
    } as ReturnType<typeof useSsoConfig>);

    render(<OrgSsoPage />);

    // useSsoConfig() (#407 / PR #419) takes no arguments - it always
    // fires whenever the org is resolved, regardless of role. See the
    // comment on the page component for why gating it isn't possible
    // without changing that already-merged hook.
    expect(useSsoConfig).toHaveBeenCalledWith();
    expect(screen.getByRole('heading', { name: /sso/i })).toBeInTheDocument();
  });

  it('does not render the SSO config form for a regular member', () => {
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
      isSaving: false,
    } as ReturnType<typeof useSsoConfig>);

    render(<OrgSsoPage />);

    expect(screen.queryByRole('heading', { name: /sso/i })).not.toBeInTheDocument();
  });

  it('surfaces a save error instead of an unhandled rejection when updateConfig fails', async () => {
    const user = userEvent.setup();
    const updateConfig = vi.fn().mockRejectedValue(new Error('network error'));
    vi.mocked(usePermissions).mockReturnValue({
      isSystemAdmin: false,
      orgRole: 'admin',
      isLoading: false,
    } as ReturnType<typeof usePermissions>);
    vi.mocked(useSsoConfig).mockReturnValue({
      config: undefined,
      isLoading: false,
      error: null,
      updateConfig,
      isSaving: false,
    } as ReturnType<typeof useSsoConfig>);

    render(<OrgSsoPage />);

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to save configuration/i);
  });
});
