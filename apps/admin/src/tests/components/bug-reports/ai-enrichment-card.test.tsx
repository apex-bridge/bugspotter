import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AIEnrichmentCard } from '../../../components/bug-reports/ai-enrichment-card';
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
        if (!opts) {
          return raw;
        }
        return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
      },
      i18n: { language: 'en-US' },
    }),
  };
});

vi.mock('../../../services/intelligence-service', () => ({
  intelligenceService: {
    getEnrichment: vi.fn(),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const BASE = {
  id: 'enr-1',
  bug_report_id: 'bug-1',
  project_id: 'proj-1',
  organization_id: 'org-1',
  category: 'ui_rendering',
  suggested_severity: 'medium',
  tags: [],
  root_cause_summary: 'CSS overflow',
  affected_components: [],
  confidence_category: 0.9,
  confidence_severity: 0.8,
  confidence_tags: 0.7,
  confidence_root_cause: 0.8,
  confidence_components: 0.7,
  enrichment_version: 1,
  created_at: '2026-03-16T00:00:00Z',
  updated_at: '2026-03-16T00:00:00Z',
};

describe('<AIEnrichmentCard> rationale accordion', () => {
  beforeEach(() => {
    vi.mocked(intelligenceService.getEnrichment).mockReset();
  });

  it('reveals the rationale only after the "Why AI decided this" toggle is clicked', async () => {
    vi.mocked(intelligenceService.getEnrichment).mockResolvedValueOnce({
      ...BASE,
      rationale: 'Marked critical: payment flow blocked for all users.',
    });

    render(<AIEnrichmentCard bugReportId="bug-1" />, { wrapper });

    const toggle = await screen.findByRole('button', { name: /Why AI decided this/i });
    // Collapsed by default.
    expect(screen.queryByText(/payment flow blocked/i)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText(/payment flow blocked/i)).toBeInTheDocument();
  });

  it('renders no rationale toggle when rationale is null', async () => {
    vi.mocked(intelligenceService.getEnrichment).mockResolvedValueOnce({
      ...BASE,
      rationale: null,
    });

    render(<AIEnrichmentCard bugReportId="bug-1" />, { wrapper });

    expect(await screen.findByText('AI Enrichment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Why AI decided this/i })).not.toBeInTheDocument();
  });
});
