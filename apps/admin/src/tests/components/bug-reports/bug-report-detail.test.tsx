/**
 * Component-level coverage for the platform-admin intelligence-visibility fix
 * (issue #337). Hook-level tests in `tests/hooks/use-intelligence-status.test.tsx`
 * prove the hook's override semantics in isolation; these tests prove
 * `BugReportDetail` actually wires the bug's project org into the hook and
 * renders the right UI for each resolved state — including the crux
 * no-silent-fallback-while-loading behavior (test case G).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BugReportDetail } from '../../../components/bug-reports/bug-report-detail';
import { bugReportService } from '../../../services/api';
import { projectService } from '../../../services/project-service';
import { intelligenceService } from '../../../services/intelligence-service';

vi.mock('../../../services/api', () => ({
  bugReportService: { getById: vi.fn() },
  storageService: { downloadResource: vi.fn() },
}));
vi.mock('../../../services/project-service', () => ({
  projectService: { getById: vi.fn() },
}));
vi.mock('../../../services/intelligence-service', () => ({
  intelligenceService: { getStatus: vi.fn() },
}));
// Heavy/unrelated children — out of scope for this test; replaced with
// detectable markers so we can assert on wiring without their own data fetches.
vi.mock('../../../components/bug-reports/session-replay-player', () => ({
  SessionReplayPlayer: () => null,
}));
vi.mock('../../../components/bug-reports/share-token-manager', () => ({
  ShareTokenManager: () => null,
}));
vi.mock('../../../components/bug-reports/ai-enrichment-card', () => ({
  AIEnrichmentCard: () => <div data-testid="ai-enrichment-card" />,
}));
vi.mock('../../../components/bug-reports/similar-bugs-widget', () => ({
  SimilarBugsWidget: () => <div data-testid="similar-bugs-widget" />,
}));
vi.mock('../../../components/bug-reports/suggest-fix-button', () => ({
  SuggestFixButton: () => <div data-testid="suggest-fix-button" />,
}));

const mockReport = {
  id: 'bug-1',
  project_id: 'proj-1',
  title: 'Crash on submit',
  description: null,
  screenshot_url: null,
  screenshot_key: null,
  replay_url: null,
  replay_key: null,
  replay_upload_status: 'none',
  metadata: {},
  status: 'open',
  priority: 'high',
  duplicate_of: null,
  deleted_at: null,
  deleted_by: null,
  legal_hold: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function openDetailsTab() {
  await screen.findByText('Crash on submit');
  fireEvent.click(screen.getByRole('button', { name: /Details & Metadata/i }));
}

beforeEach(() => {
  vi.mocked(bugReportService.getById)
    .mockReset()
    .mockResolvedValue(mockReport as never);
  vi.mocked(projectService.getById).mockReset();
  vi.mocked(intelligenceService.getStatus).mockReset();
});

describe('BugReportDetail — intelligence UI wiring', () => {
  it('renders AI Enrichment, Similar Bugs, and Suggest Fix once the project org resolves as enabled', async () => {
    vi.mocked(projectService.getById).mockResolvedValue({
      id: 'proj-1',
      organization_id: 'org-enabled',
    } as never);
    vi.mocked(intelligenceService.getStatus).mockResolvedValue({ intelligence_enabled: true });

    render(<BugReportDetail reportId="bug-1" onClose={() => {}} />, { wrapper });
    await openDetailsTab();

    expect(await screen.findByTestId('ai-enrichment-card')).toBeInTheDocument();
    expect(screen.getByTestId('similar-bugs-widget')).toBeInTheDocument();
    expect(screen.getByTestId('suggest-fix-button')).toBeInTheDocument();
    expect(intelligenceService.getStatus).toHaveBeenCalledWith('org-enabled');
  });

  it('does not call intelligenceService.getStatus while the project org is unresolved', async () => {
    vi.mocked(projectService.getById).mockResolvedValue({
      id: 'proj-1',
      organization_id: null,
    } as never);

    render(<BugReportDetail reportId="bug-1" onClose={() => {}} />, { wrapper });
    await openDetailsTab();

    expect(intelligenceService.getStatus).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ai-enrichment-card')).not.toBeInTheDocument();
  });

  it('renders the intelligence-disabled notice when the project org has intelligence disabled', async () => {
    vi.mocked(projectService.getById).mockResolvedValue({
      id: 'proj-1',
      organization_id: 'org-disabled',
    } as never);
    vi.mocked(intelligenceService.getStatus).mockResolvedValue({ intelligence_enabled: false });

    render(<BugReportDetail reportId="bug-1" onClose={() => {}} />, { wrapper });
    await openDetailsTab();

    expect(
      await screen.findByText(
        /AI enrichment, similar-bug detection, and fix suggestions are disabled/i
      )
    ).toBeInTheDocument();
    expect(screen.queryByTestId('ai-enrichment-card')).not.toBeInTheDocument();
  });
});
