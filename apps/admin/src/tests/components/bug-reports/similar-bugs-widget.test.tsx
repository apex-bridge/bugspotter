import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { SimilarBugsWidget } from '../../../components/bug-reports/similar-bugs-widget';
import { intelligenceService } from '../../../services/intelligence-service';

vi.mock('react-i18next', async () => {
  const en = (await import('../../../i18n/locales/en.json')).default;
  const get = (key: string): string | undefined =>
    key
      .split('.')
      .reduce<unknown>(
        (obj, part) =>
          obj != null && typeof obj === 'object'
            ? (obj as Record<string, unknown>)[part]
            : undefined,
        en
      ) as string | undefined;
  return {
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        const raw = get(key) ?? key;
        return opts ? raw.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? '')) : raw;
      },
      i18n: { language: 'en-US' },
    }),
  };
});

// Each row in the similar-bugs list renders SuggestionFeedback, which pulls
// in useAuth() (needs a user for its "did I already rate this" check) and
// intelligenceService.getBugFeedback() (its own useQuery) - neither is
// exercised by this widget's own logic, but both must be mocked or the
// widget can't render at all.
vi.mock('../../../contexts/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('../../../services/intelligence-service', () => ({
  intelligenceService: {
    getSimilarBugs: vi.fn(),
    getBugFeedback: vi.fn().mockResolvedValue([]),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const mockSimilarData = {
  bug_id: 'bug-x',
  is_duplicate: true,
  similar_bugs: [
    {
      bug_id: 'bug-1',
      title: 'Login page crash',
      description: null,
      status: 'closed',
      resolution: 'duplicate',
      similarity: 0.92,
    },
    {
      bug_id: 'bug-2',
      title: 'Auth timeout',
      description: null,
      status: 'open',
      resolution: null,
      similarity: 0.81,
    },
    {
      bug_id: 'bug-3',
      title: 'Session expiry',
      description: null,
      status: 'open',
      resolution: null,
      similarity: 0.74,
    },
  ],
  threshold_used: 0.85,
};

beforeEach(() => {
  vi.mocked(intelligenceService.getSimilarBugs).mockReset();
});

it('renders duplicate match details section when duplicateOf is set', async () => {
  vi.mocked(intelligenceService.getSimilarBugs).mockResolvedValueOnce(mockSimilarData);
  render(<SimilarBugsWidget bugReportId="bug-x" projectId="proj-1" duplicateOf="bug-1" />, {
    wrapper,
  });
  expect(await screen.findByText(/duplicate match details/i)).toBeInTheDocument();
});

describe('score, threshold, and top-3 bugs', () => {
  it('shows current score, threshold, and top-3 similar bugs', async () => {
    vi.mocked(intelligenceService.getSimilarBugs).mockResolvedValueOnce(mockSimilarData);
    render(<SimilarBugsWidget bugReportId="bug-x" projectId="proj-1" duplicateOf="bug-1" />, {
      wrapper,
    });
    expect(
      await screen.findByText(/current match: 0\.92 \(threshold: 0\.85\)/i)
    ).toBeInTheDocument();
    // Each title appears twice: once in the widget's existing general list,
    // once in the new section's top-3 list - getAllByText, not getByText.
    expect(screen.getAllByText(/login page crash/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/auth timeout/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/session expiry/i).length).toBeGreaterThan(0);
  });

  it("prefers the matched bug's own similarity over the top result when they differ", async () => {
    vi.mocked(intelligenceService.getSimilarBugs).mockResolvedValueOnce(mockSimilarData);
    // duplicateOf points at the #2 result (0.81), not the top result (0.92)
    render(<SimilarBugsWidget bugReportId="bug-x" projectId="proj-1" duplicateOf="bug-2" />, {
      wrapper,
    });
    expect(
      await screen.findByText(/current match: 0\.81 \(threshold: 0\.85\)/i)
    ).toBeInTheDocument();
  });
});

it('does not render the section when duplicateOf is null', async () => {
  vi.mocked(intelligenceService.getSimilarBugs).mockResolvedValueOnce(mockSimilarData);
  render(<SimilarBugsWidget bugReportId="bug-x" projectId="proj-1" duplicateOf={null} />, {
    wrapper,
  });
  await screen.findByText(/login page crash/i); // wait for the (still-rendered) general list
  expect(screen.queryByText(/duplicate match details/i)).not.toBeInTheDocument();
});

it("shows the widget's existing loading indicator while the shared query is in flight", () => {
  vi.mocked(intelligenceService.getSimilarBugs).mockReturnValue(new Promise(() => {})); // never resolves
  render(<SimilarBugsWidget bugReportId="bug-x" projectId="proj-1" duplicateOf="bug-1" />, {
    wrapper,
  });
  expect(screen.getByText(/finding similar bugs/i)).toBeInTheDocument();
});

it("shows the widget's existing error message and no score data when the request fails", async () => {
  vi.mocked(intelligenceService.getSimilarBugs).mockRejectedValueOnce(new Error('HTTP 500'));
  render(<SimilarBugsWidget bugReportId="bug-x" projectId="proj-1" duplicateOf="bug-1" />, {
    wrapper,
  });
  expect(await screen.findByText(/failed to find similar bugs/i)).toBeInTheDocument();
  expect(screen.queryByText(/current match/i)).not.toBeInTheDocument();
});
