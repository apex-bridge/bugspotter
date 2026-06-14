import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

  it('renders the per-day cost & usage breakdown (with CSV export) when by_day is present', async () => {
    vi.mocked(intelligenceService.getObservabilitySummary).mockResolvedValueOnce({
      tenant_id: 'tenant-1',
      from_ts: null,
      to_ts: null,
      calls: 4,
      cost_micros_usd: 1_200_000,
      p50_ms: 100,
      p95_ms: 200,
      error_rate: 0,
      by_operation: [],
      by_day: [
        {
          day: '2026-06-13',
          calls: 3,
          cost_micros_usd: 1_200_000,
          tokens_in: 500,
          tokens_out: 200,
        },
      ],
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

    expect(await screen.findByText('Cost & usage by day')).toBeInTheDocument();
    expect(screen.getByText('2026-06-13')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument(); // tokens_in
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
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

  it('expands an event row to reveal the AI rationale, and hides the toggle when rationale is null', async () => {
    vi.mocked(intelligenceService.getObservabilitySummary).mockResolvedValueOnce({
      tenant_id: 'tenant-1',
      from_ts: null,
      to_ts: null,
      calls: 2,
      cost_micros_usd: 0,
      p50_ms: 10,
      p95_ms: 20,
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
    const baseEvent = {
      tenant_id: 'tenant-1',
      bug_id: null,
      provider: 'ollama',
      prompt_version: 'v1',
      tokens_in: null,
      tokens_out: null,
      cost_micros_usd: null,
      latency_ms: 42,
      confidence: null,
      status: 'ok',
      error_kind: null,
      cached: false,
      created_at: '2026-06-10T12:00:00Z',
    };
    vi.mocked(intelligenceService.getObservabilityEvents).mockResolvedValueOnce({
      events: [
        {
          ...baseEvent,
          id: 'evt-with',
          operation: 'enrich',
          model: 'llama3.2:3b',
          rationale: 'Marked critical: payment flow blocked for all users.',
        },
        {
          ...baseEvent,
          id: 'evt-without',
          operation: 'ask',
          model: 'llama3.2:3b',
          rationale: null,
        },
      ],
      limit: 50,
      offset: 0,
    });

    render(<ObservabilityPanel orgId={ORG_ID} />, { wrapper });

    // Only the row that has a rationale gets a toggle; the null row has none.
    const toggles = await screen.findAllByRole('button', { name: /AI rationale/ });
    expect(toggles).toHaveLength(1);

    // Rationale stays hidden until the row is expanded.
    expect(screen.queryByText(/payment flow blocked for all users/i)).not.toBeInTheDocument();

    fireEvent.click(toggles[0]);

    expect(await screen.findByText(/payment flow blocked for all users/i)).toBeInTheDocument();
  });
});
