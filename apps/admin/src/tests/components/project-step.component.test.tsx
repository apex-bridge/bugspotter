/**
 * ProjectStep component tests.
 *
 * Covers the interactive surface — keyboard nav, Enter selection,
 * manual-entry escape hatch, Next-button gating — that isn't
 * exercised by the pure-helper tests in `project-step.test.ts`.
 *
 * Follows the same RTL + mocked-react-i18next pattern as
 * `rule-builder.test.tsx` and wraps the component in a fresh
 * `QueryClient` per render, per `jira-user-picker.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ProjectStep } from '../../components/integrations/project-step';
import type { JiraConfig } from '../../types';
import { projectIntegrationService } from '../../services/project-integration-service';

// react-i18next: resolve keys against en.json with minimal {{var}}
// interpolation so rendered text matches what users would see.
vi.mock('react-i18next', async () => {
  const en = (await import('../../i18n/locales/en.json')).default;
  const getTranslation = (key: string): string | undefined => {
    const result = key
      .split('.')
      .reduce<unknown>(
        (obj, part) =>
          obj != null && typeof obj === 'object'
            ? (obj as Record<string, unknown>)[part]
            : undefined,
        en
      );
    return typeof result === 'string' ? result : undefined;
  };
  return {
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        const raw = getTranslation(key) ?? key;
        if (!opts) {
          return raw;
        }
        return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
      },
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock('../../services/project-integration-service', () => ({
  projectIntegrationService: {
    searchProjects: vi.fn(),
  },
}));

// Fresh QueryClient per render so cache from one test doesn't leak
// into the next.
function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const baseConfig: JiraConfig = {
  instanceUrl: 'https://example.atlassian.net',
  authentication: {
    type: 'basic',
    email: 'user@example.com',
    apiToken: 'tok-xyz',
  },
  projectKey: '',
  issueType: 'Bug',
};

const sampleProjects = [
  { id: '10000', key: 'ALPHA', name: 'Alpha Project' },
  { id: '10001', key: 'BETA', name: 'Beta Project' },
  { id: '10002', key: 'GAMMA', name: 'Gamma Project' },
];

describe('ProjectStep', () => {
  const mockSetLocalConfig = vi.fn();
  const mockOnBack = vi.fn();
  const mockOnNext = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectIntegrationService.searchProjects).mockResolvedValue(sampleProjects);
  });

  const renderStep = (overrides: Partial<JiraConfig> = {}) =>
    renderWithQuery(
      <ProjectStep
        localConfig={{ ...baseConfig, ...overrides } as unknown as Record<string, unknown>}
        setLocalConfig={mockSetLocalConfig}
        onBack={mockOnBack}
        onNext={mockOnNext}
      />
    );

  it('renders fetched projects from the query', async () => {
    renderStep();
    await waitFor(() => {
      expect(screen.getByTestId('project-option-ALPHA')).toBeInTheDocument();
      expect(screen.getByTestId('project-option-BETA')).toBeInTheDocument();
    });
  });

  it('clicking a project option sets projectKey via setLocalConfig', async () => {
    const user = userEvent.setup();
    renderStep();
    await screen.findByTestId('project-option-BETA');

    await user.click(screen.getByTestId('project-option-BETA'));

    expect(mockSetLocalConfig).toHaveBeenCalledTimes(1);
    // Functional-setter form — invoke with a stub to confirm the updater.
    const updater = mockSetLocalConfig.mock.calls[0][0];
    expect(updater({ existing: true })).toEqual({ existing: true, projectKey: 'BETA' });
  });

  it('ArrowDown + Enter commits the highlighted project', async () => {
    const user = userEvent.setup();
    renderStep();
    await screen.findByTestId('project-option-ALPHA');

    const search = screen.getByTestId('project-search-input');
    await user.click(search);
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(mockSetLocalConfig).toHaveBeenCalledTimes(1);
    const updater = mockSetLocalConfig.mock.calls[0][0];
    expect(updater({})).toEqual({ projectKey: 'ALPHA' });
  });

  it('Enter on an unmatched typed search commits as manual project key', async () => {
    const user = userEvent.setup();
    renderStep();
    await screen.findByTestId('project-option-ALPHA');

    const search = screen.getByTestId('project-search-input');
    await user.type(search, 'CUSTOM-42');
    await user.keyboard('{Enter}');

    expect(mockSetLocalConfig).toHaveBeenCalled();
    const lastCall = mockSetLocalConfig.mock.calls[mockSetLocalConfig.mock.calls.length - 1];
    expect(lastCall[0]({})).toEqual({ projectKey: 'CUSTOM-42' });
  });

  it('renders the manual-entry option when the typed search has no exact-key match', async () => {
    const user = userEvent.setup();
    renderStep();
    await screen.findByTestId('project-option-ALPHA');

    const search = screen.getByTestId('project-search-input');
    await user.type(search, 'NOTREAL');

    expect(screen.getByTestId('project-manual-entry-option')).toBeInTheDocument();
  });

  it('does not render the manual-entry option when the search matches an existing key exactly', async () => {
    const user = userEvent.setup();
    renderStep();
    await screen.findByTestId('project-option-ALPHA');

    const search = screen.getByTestId('project-search-input');
    await user.type(search, 'alpha'); // case-insensitive match on ALPHA

    expect(screen.queryByTestId('project-manual-entry-option')).not.toBeInTheDocument();
  });

  it('Escape clears the search filter and the highlight', async () => {
    const user = userEvent.setup();
    renderStep();
    await screen.findByTestId('project-option-ALPHA');

    const search = screen.getByTestId('project-search-input') as HTMLInputElement;
    await user.type(search, 'al');
    expect(search.value).toBe('al');

    await user.keyboard('{Escape}');
    expect(search.value).toBe('');
  });

  it('Next button is disabled until a project is selected', async () => {
    renderStep();
    await screen.findByTestId('project-option-ALPHA');

    expect(screen.getByTestId('project-next-button')).toBeDisabled();
  });

  it('Next button becomes enabled once projectKey is set', async () => {
    renderStep({ projectKey: 'ALPHA' });
    await screen.findByTestId('project-option-ALPHA');

    expect(screen.getByTestId('project-next-button')).not.toBeDisabled();
  });

  it('falls back to the manual-entry input when auth.type is oauth2', async () => {
    renderStep({
      authentication: {
        type: 'oauth2',
        email: 'user@example.com',
        apiToken: 'tok-xyz',
        accessToken: 'oauth-token',
      },
    });

    // Picker path uses `project-search-input`; fallback uses
    // `project-key-input`. OAuth2 must take the fallback branch.
    expect(screen.queryByTestId('project-search-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-key-input')).toBeInTheDocument();
    expect(screen.getByTestId('project-picker-basic-auth-only')).toBeInTheDocument();
  });
});
