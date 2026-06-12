import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  IntelligenceServiceStatus,
  statusRefetchInterval,
} from '../../../components/intelligence/intelligence-service-status';
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
    getServiceStatus: vi.fn(),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const HEALTHY = {
  version: '0.1.0',
  llm_provider: 'ollama',
  llm_model: 'llama3.2:3b',
  anthropic_key_configured: false,
  openai_key_configured: true,
  similarity_threshold: 0.68,
  duplicate_threshold: 0.85,
  embeddings: {
    provider: 'local',
    model: 'BAAI/bge-m3',
    total: 100,
    nulls: 0,
    min_dim: 1024,
    healthy: true,
  },
};

describe('<IntelligenceServiceStatus>', () => {
  beforeEach(() => {
    vi.mocked(intelligenceService.getServiceStatus).mockReset();
  });

  it('renders provider, model, version, key badges, and a healthy indicator', async () => {
    vi.mocked(intelligenceService.getServiceStatus).mockResolvedValueOnce(HEALTHY);

    render(<IntelligenceServiceStatus />, { wrapper });

    expect(await screen.findByText('ollama')).toBeInTheDocument();
    expect(screen.getByText('llama3.2:3b')).toBeInTheDocument();
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    // One key configured, one not.
    expect(screen.getByText('Configured')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('flags degraded with a NULL-embedding count when nulls > 0', async () => {
    vi.mocked(intelligenceService.getServiceStatus).mockResolvedValueOnce({
      ...HEALTHY,
      embeddings: { ...HEALTHY.embeddings, nulls: 3, healthy: false },
    });

    render(<IntelligenceServiceStatus />, { wrapper });

    expect(await screen.findByText('Degraded')).toBeInTheDocument();
    expect(screen.getByText(/3 of 100 missing/)).toBeInTheDocument();
  });

  it('shows a quiet "not configured" note on 503, not an error', async () => {
    const err = Object.assign(new Error('not configured'), {
      response: { status: 503 },
    });
    vi.mocked(intelligenceService.getServiceStatus).mockRejectedValueOnce(err);

    render(<IntelligenceServiceStatus />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('AI service is not configured.')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('statusRefetchInterval', () => {
  it('polls every 30s when there is no error', () => {
    expect(statusRefetchInterval(null)).toBe(30000);
  });

  it('stops polling on a 503 (not configured, permanent)', () => {
    expect(statusRefetchInterval({ response: { status: 503 } })).toBe(false);
  });

  it('keeps polling on transient errors so the card self-heals', () => {
    expect(statusRefetchInterval({ response: { status: 502 } })).toBe(30000);
    expect(statusRefetchInterval({ response: { status: 504 } })).toBe(30000);
    // Network error — no response object.
    expect(statusRefetchInterval(new Error('ECONNREFUSED'))).toBe(30000);
  });
});
