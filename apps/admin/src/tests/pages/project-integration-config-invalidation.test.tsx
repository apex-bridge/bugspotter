/**
 * Regression test for the QuickSetup CTA invalidation contract added
 * in PR #123 follow-up.
 *
 * `useOnboardingStatus` reads `integrationCount` from a React Query
 * cache entry keyed `['integrations-summary']` with a 60s `staleTime`.
 * When a user saves a project integration on this page, the on-success
 * handler must invalidate that key — otherwise the QuickSetup
 * "Connect Jira" CTA stays visible for up to 60s after they connect
 * Jira (the exact failure mode PR #123 was meant to close).
 *
 * Pin only the `project-integration-config.tsx` save handler — the
 * three other mutation sites (`integrations/edit.tsx`, `integrations/
 * overview.tsx`, `use-integration-config.ts`) follow the same pattern
 * and are covered by code review. This is the org-onboarding entry
 * point — the path the PR exists to fix — so it's the highest-value
 * place to anchor the contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ReactNode } from 'react';
import ProjectIntegrationConfigPage from '../../pages/project-integration-config';
import { projectIntegrationService } from '../../services/project-integration-service';

// Mocks ---------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  Trans: ({ children, i18nKey }: { children?: ReactNode; i18nKey?: string }) =>
    (children as ReactNode) ?? i18nKey ?? null,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Single shared service object backing both the named and default
// exports — the page imports the default export, this test asserts on
// the named one. Without sharing they'd be different vi.fn() instances
// and the test would never see the page's call. `vi.hoisted` so the
// declaration survives vitest's mock-factory hoisting.
const serviceMock = vi.hoisted(() => ({
  get: vi.fn(),
  configure: vi.fn(),
  delete: vi.fn(),
  testConnection: vi.fn(),
}));
vi.mock('../../services/project-integration-service', () => ({
  projectIntegrationService: serviceMock,
  default: serviceMock,
}));

vi.mock('../../hooks/use-project-permissions', () => ({
  useProjectPermissions: () => ({ canManageIntegrations: true }),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// ---------------------------------------------------------------------

describe('ProjectIntegrationConfigPage — QuickSetup invalidation contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No existing config — page renders the empty form. The default
    // export is what the page imports; the named export is what this
    // test imports for assertion. Both the named and default mocks
    // share the same vi.fn() instances per the mock factory above.
    vi.mocked(projectIntegrationService.get).mockResolvedValue(null as never);
    vi.mocked(projectIntegrationService.configure).mockResolvedValue({
      success: true,
    } as never);
  });

  it('invalidates the [integrations-summary] cache on successful save', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Spy on the live instance — the page reads it via `useQueryClient()`
    // from the same provider, so our spy is exactly the method the
    // on-success handler calls.
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/projects/proj-1/integrations/jira/configure']}>
          <Routes>
            <Route
              path="/projects/:projectId/integrations/:platform/configure"
              element={<ProjectIntegrationConfigPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Wait for the save button (only renders after the loading branch
    // resolves — `useQuery` resolves to `null` per the mock above).
    const saveButton = await screen.findByTestId('save-config-button');
    await user.click(saveButton);

    // configure() resolves → onSuccess runs → invalidateQueries fires.
    await waitFor(() => {
      expect(projectIntegrationService.configure).toHaveBeenCalled();
    });
    await waitFor(() => {
      const calls = invalidateSpy.mock.calls.map((call) => call[0]);
      expect(calls).toContainEqual({ queryKey: ['integrations-summary'] });
    });
  });
});
