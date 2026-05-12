/**
 * useIntegrationConfig — Linear dispatch branches.
 *
 * The hook owns two platform-aware decisions: which default config to
 * seed when an integration is fetched without one, and which validator
 * to run before save. Validators have their own unit tests; this file
 * pins the hook's *integration* with them — the path from
 * `type='linear'` through `getBaseType` to the right branch.
 *
 * Regression risk this guards: someone refactors the `baseType ===
 * 'linear'` branch (e.g. typo in string, swaps order, or the future
 * platform-configurator refactor itself), Linear users silently get
 * the Jira default seed and a validator error they can't act on.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useIntegrationConfig } from '../../hooks/use-integration-config';
import integrationService from '../../services/integration-service';
import { defaultLinearConfig } from '../../integrations/linear';

vi.mock('../../services/integration-service', () => ({
  default: {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    testConnection: vi.fn(),
  },
}));

// `useTranslation` is used inside the hook; the test runner already
// configures i18next via the existing test setup, so no mock needed.
// Toast on the other hand is fire-and-forget; we mock to avoid the
// portal needing a DOM root in the renderHook environment.
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const LINEAR_INTEGRATION = {
  id: 'linear-1',
  type: 'linear',
  name: 'Linear',
  description: '',
  // The hook treats `Object.keys(config).length === 0` as "no config
  // yet" and falls into the default-seed branch. This is the realistic
  // first-time-configuring state.
  config: {},
  status: 'not_configured',
  is_custom: false,
};

describe('useIntegrationConfig — Linear branches', () => {
  beforeEach(() => {
    vi.mocked(integrationService.getConfig).mockReset();
  });

  it('seeds defaultLinearConfig when type=linear and no config exists yet', async () => {
    vi.mocked(integrationService.getConfig).mockResolvedValue(LINEAR_INTEGRATION);

    const { result } = renderHook(() => useIntegrationConfig({ type: 'linear' }), { wrapper });

    await waitFor(() => {
      expect(result.current.localConfig).toEqual(defaultLinearConfig);
    });
  });

  it('strips per-instance suffix (e.g. linear_xxx → linear) when picking default', async () => {
    vi.mocked(integrationService.getConfig).mockResolvedValue({
      ...LINEAR_INTEGRATION,
      type: 'linear_acme_42',
    });

    const { result } = renderHook(() => useIntegrationConfig({ type: 'linear_acme_42' }), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.localConfig).toEqual(defaultLinearConfig);
    });
  });

  it('still seeds Jira default for non-Linear platforms (regression guard)', async () => {
    // If the Linear branch ever broadens (e.g. someone writes
    // `baseType.includes('linear')` instead of `===`), this test
    // catches the Jira-flow being hijacked.
    vi.mocked(integrationService.getConfig).mockResolvedValue({
      id: 'jira-1',
      type: 'jira',
      name: 'Jira',
      description: '',
      config: {},
      status: 'not_configured',
      is_custom: false,
    });

    const { result } = renderHook(() => useIntegrationConfig({ type: 'jira' }), { wrapper });

    await waitFor(() => {
      const c = result.current.localConfig as Record<string, unknown>;
      expect(c.instanceUrl).toBe('');
      expect(c.projectKey).toBe('');
      expect(c.authentication).toEqual({ type: 'basic', email: '', apiToken: '' });
    });
  });

  it('save() refuses an empty Linear config with the Linear-specific validation error', async () => {
    vi.mocked(integrationService.getConfig).mockResolvedValue(LINEAR_INTEGRATION);
    const updateMock = vi.mocked(integrationService.updateConfig);

    const { result } = renderHook(() => useIntegrationConfig({ type: 'linear' }), { wrapper });

    await waitFor(() => {
      expect(result.current.localConfig).toEqual(defaultLinearConfig);
    });

    // Default seed has empty apiKey/teamId/teamKey — validator should
    // reject without ever calling the update endpoint.
    await act(async () => {
      await result.current.save();
    });

    expect(updateMock).not.toHaveBeenCalled();
  });
});
