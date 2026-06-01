import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ObservabilityPanel } from '../../../components/intelligence/observability-panel';
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
    getObservabilitySummary: vi.fn(),
    getObservabilityEvents: vi.fn(),
    getObservabilityAccuracy: vi.fn(),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ORG_ID = 'org-1';

describe('<ObservabilityPanel>', () => {
  beforeEach(() => {
    vi.mocked(intelligenceService.getObservabilitySummary).mockReset();
    vi.mocked(intelligenceService.getObservabilityEvents).mockReset();
    vi.mocked(intelligenceService.getObservabilityAccuracy).mockReset();
  });

  it('renders summary KPIs (calls, cost, p95) when data loads', async () => {
    vi.mocked(intelligenceService.getObservabilitySummary).mockResolvedValueOnce({
      tenant_id: 'tenant-1',
      from_ts: null,
      to_ts: null,
      calls: 1234,
      cost_micros_usd: 12_500_000,
      p50_ms: 250,
      p95_ms: 980,
      error_rate: 0.02,
      by_operation: [],
    });
    vi.mocked(intelligenceService.getObservabilityAccuracy).mockResolvedValueOnce({
      tenant_id: 'tenant-1',
      operation: null,
      feedback_count: 0,
      correct: 0,
      incorrect: 0,
      partial: 0,
      precision: null,
    });
    vi.mocked(intelligenceService.getObservabilityEvents).mockResolvedValueOnce({
      events: [],
      limit: 50,
      offset: 0,
    });

    render(<ObservabilityPanel orgId={ORG_ID} />, { wrapper });

    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    expect(screen.getByText('980 ms')).toBeInTheDocument();
    expect(screen.getByText('2.0%')).toBeInTheDocument();
  });

  it('shows the "not configured" alert when the summary endpoint returns 503', async () => {
    const err = Object.assign(new Error('not configured'), {
      response: { status: 503 },
    });
    vi.mocked(intelligenceService.getObservabilitySummary).mockRejectedValueOnce(err);
    vi.mocked(intelligenceService.getObservabilityAccuracy).mockRejectedValueOnce(err);
    vi.mocked(intelligenceService.getObservabilityEvents).mockRejectedValueOnce(err);

    render(<ObservabilityPanel orgId={ORG_ID} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Observability is unavailable')).toBeInTheDocument();
    });
    // Sibling sections must not render under the 503 short-circuit.
    expect(screen.queryByText('Ranking accuracy')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent events')).not.toBeInTheDocument();
  });

  it('shows the empty-state copy for accuracy when feedback_count is 0', async () => {
    vi.mocked(intelligenceService.getObservabilitySummary).mockResolvedValueOnce({
      tenant_id: 'tenant-1',
      from_ts: null,
      to_ts: null,
      calls: 5,
      cost_micros_usd: 0,
      p50_ms: 100,
      p95_ms: 200,
      error_rate: 0,
      by_operation: [],
    });
    vi.mocked(intelligenceService.getObservabilityAccuracy).mockResolvedValueOnce({
      tenant_id: 'tenant-1',
      operation: null,
      feedback_count: 0,
      correct: 0,
      incorrect: 0,
      partial: 0,
      precision: null,
    });
    vi.mocked(intelligenceService.getObservabilityEvents).mockResolvedValueOnce({
      events: [],
      limit: 50,
      offset: 0,
    });

    render(<ObservabilityPanel orgId={ORG_ID} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText(/No verdicts recorded yet/i)).toBeInTheDocument();
    });
    // Precision KPI must NOT show when there's no feedback — would mislead.
    expect(screen.queryByText('Precision')).not.toBeInTheDocument();
  });
});
