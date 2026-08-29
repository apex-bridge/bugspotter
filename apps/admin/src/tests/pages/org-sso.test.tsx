import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the SSO config form for an org admin', () => {
    vi.mocked(usePermissions).mockReturnValue({
      isSystemAdmin: false,
      orgRole: 'admin',
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

    // useSsoConfig() (#407 / PR #419) takes no arguments and has no
    // `enabled` option - OrgSsoForm (the only thing that calls it) only
    // mounts once canManageSso is true, which is what actually keeps the
    // query from firing for a non-admin. See the "does not render" test
    // below and the comment on the page component.
    expect(useSsoConfig).toHaveBeenCalledWith();
    expect(screen.getByRole('heading', { name: /sso/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/issuer url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/client id/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('does not render the SSO config form for a regular member, and never mounts the query', () => {
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
    // OrgSsoForm - the only component that calls useSsoConfig() - is never
    // rendered for a non-admin, so the hook (and its query) never mounts.
    expect(useSsoConfig).not.toHaveBeenCalled();
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

  it('omits clientSecret from the update payload when the secret field is left blank', async () => {
    const user = userEvent.setup();
    const updateConfig = vi.fn().mockResolvedValue(undefined);
    vi.mocked(usePermissions).mockReturnValue({
      isSystemAdmin: false,
      orgRole: 'admin',
      isLoading: false,
    } as ReturnType<typeof usePermissions>);
    vi.mocked(useSsoConfig).mockReturnValue({
      config: {
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-123',
        hasClientSecret: true,
        allowedDomains: ['example.com'],
        enforceSso: false,
      },
      isLoading: false,
      error: null,
      updateConfig,
      isSaving: false,
    } as ReturnType<typeof useSsoConfig>);

    render(<OrgSsoPage />);

    // Secret field is left untouched - a secret is already configured
    // (hasClientSecret: true) but the user isn't rotating it.
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(updateConfig).toHaveBeenCalledTimes(1);
    const payload = updateConfig.mock.calls[0][0];
    expect(payload).not.toHaveProperty('clientSecret');
    expect(payload).toEqual({
      issuerUrl: 'https://idp.example.com',
      clientId: 'client-123',
      allowedDomains: ['example.com'],
      enforceSso: false,
    });
  });

  it('includes the typed clientSecret and normalizes allowedDomains when the secret field is filled in', async () => {
    const user = userEvent.setup();
    const updateConfig = vi.fn().mockResolvedValue(undefined);
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

    await user.type(screen.getByLabelText(/issuer url/i), 'https://idp.example.com');
    await user.type(screen.getByLabelText(/client id/i), 'client-123');
    await user.type(
      screen.getByLabelText(/allowed domains/i),
      ' example.com ,  foo.com ,,bar.com '
    );
    await user.type(screen.getByLabelText(/client secret/i), 'shh-secret');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig).toHaveBeenCalledWith({
      issuerUrl: 'https://idp.example.com',
      clientId: 'client-123',
      allowedDomains: ['example.com', 'foo.com', 'bar.com'],
      enforceSso: false,
      clientSecret: 'shh-secret',
    });
  });
});
