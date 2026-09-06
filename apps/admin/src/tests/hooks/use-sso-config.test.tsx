import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSsoConfig } from '../../hooks/use-sso-config';
import { useOrganization } from '../../contexts/organization-context';
import { ssoService } from '../../services/sso-service';

vi.mock('../../contexts/organization-context', () => ({
  useOrganization: vi.fn(),
}));
vi.mock('../../services/sso-service', () => ({
  ssoService: { getSettings: vi.fn(), updateSettings: vi.fn() },
}));

function queryClientWrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const orgId = 'org-sso-test';

beforeEach(() => {
  vi.mocked(useOrganization).mockReset();
  vi.mocked(ssoService.getSettings).mockReset();
  vi.mocked(ssoService.updateSettings).mockReset();
  vi.mocked(useOrganization).mockReturnValue({
    currentOrganization: { id: orgId },
  } as unknown as ReturnType<typeof useOrganization>);
});

describe('useSsoConfig', () => {
  it('never populates a secret value from the GET response', async () => {
    // Include a raw clientSecret even though SsoConfig's type declares no
    // such field — proves the hook actively strips it rather than merely
    // relying on a type that a backend regression could silently violate.
    vi.mocked(ssoService.getSettings).mockResolvedValue({
      issuerUrl: 'https://idp.example.com',
      clientId: 'abc',
      hasClientSecret: true,
      redirectUri: null,
      allowedDomains: [],
      enforceSso: false,
      clientSecret: 'leaked-secret',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const { result } = renderHook(() => useSsoConfig(), { wrapper: queryClientWrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.config).not.toHaveProperty('clientSecret');
    expect(result.current.config?.hasClientSecret).toBe(true);
  });

  it('omits clientSecret from the update payload when not edited', async () => {
    vi.mocked(ssoService.getSettings).mockResolvedValue({
      issuerUrl: 'https://idp.example.com',
      clientId: 'abc',
      hasClientSecret: false,
      redirectUri: null,
      allowedDomains: [],
      enforceSso: false,
    });
    vi.mocked(ssoService.updateSettings).mockResolvedValue({
      issuerUrl: 'https://idp.example.com',
      clientId: 'abc',
      hasClientSecret: false,
      redirectUri: null,
      allowedDomains: [],
      enforceSso: false,
    });
    const { result } = renderHook(() => useSsoConfig(), { wrapper: queryClientWrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.updateConfig({
      issuerUrl: 'https://idp.example.com',
      clientId: 'abc',
      allowedDomains: [],
      enforceSso: false,
    });
    const [, payload] = vi.mocked(ssoService.updateSettings).mock.calls[0];
    expect(payload).not.toHaveProperty('clientSecret');
  });

  it('includes clientSecret in the update payload when provided', async () => {
    vi.mocked(ssoService.getSettings).mockResolvedValue({
      issuerUrl: 'https://idp.example.com',
      clientId: 'abc',
      hasClientSecret: true,
      redirectUri: null,
      allowedDomains: [],
      enforceSso: false,
    });
    vi.mocked(ssoService.updateSettings).mockResolvedValue({
      issuerUrl: 'https://idp.example.com',
      clientId: 'abc',
      hasClientSecret: true,
      redirectUri: null,
      allowedDomains: [],
      enforceSso: false,
    });
    const { result } = renderHook(() => useSsoConfig(), { wrapper: queryClientWrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.updateConfig({
      issuerUrl: 'https://idp.example.com',
      clientId: 'abc',
      clientSecret: 'new-secret',
      allowedDomains: [],
      enforceSso: false,
    });
    expect(ssoService.updateSettings).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({ clientSecret: 'new-secret' })
    );
  });

  it('rejects updateConfig instead of sending an undefined orgId when no org is selected', async () => {
    vi.mocked(useOrganization).mockReturnValue({
      currentOrganization: null,
    } as unknown as ReturnType<typeof useOrganization>);
    const { result } = renderHook(() => useSsoConfig(), { wrapper: queryClientWrapper });

    await expect(
      result.current.updateConfig({
        issuerUrl: 'https://idp.example.com',
        clientId: 'abc',
        allowedDomains: [],
        enforceSso: false,
      })
    ).rejects.toThrow('No organization selected.');
    expect(ssoService.updateSettings).not.toHaveBeenCalled();
  });
});
