import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useIntelligenceStatus } from '../../hooks/use-intelligence-status';
import { useOrganization } from '../../contexts/organization-context';
import { intelligenceService } from '../../services/intelligence-service';

vi.mock('../../contexts/organization-context', () => ({
  useOrganization: vi.fn(),
}));
vi.mock('../../services/intelligence-service', () => ({
  intelligenceService: { getStatus: vi.fn() },
}));

function queryClientWrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(useOrganization).mockReset();
  vi.mocked(intelligenceService.getStatus).mockReset();
});

describe('useIntelligenceStatus', () => {
  it('uses orgIdOverride and returns isEnabled true when override resolves an enabled org', async () => {
    vi.mocked(useOrganization).mockReturnValue({
      currentOrganization: { id: 'org-viewer' },
    } as any);
    vi.mocked(intelligenceService.getStatus).mockResolvedValue({ intelligence_enabled: true });

    const { result } = renderHook(() => useIntelligenceStatus('org-enabled'), {
      wrapper: queryClientWrapper,
    });

    await waitFor(() => expect(result.current.isEnabled).toBe(true));
    expect(intelligenceService.getStatus).toHaveBeenCalledTimes(1);
    expect(intelligenceService.getStatus).toHaveBeenCalledWith('org-enabled');
  });

  it('returns isEnabled false when override resolves a disabled org', async () => {
    vi.mocked(useOrganization).mockReturnValue({ currentOrganization: null } as any);
    vi.mocked(intelligenceService.getStatus).mockResolvedValue({ intelligence_enabled: false });

    const { result } = renderHook(() => useIntelligenceStatus('org-disabled'), {
      wrapper: queryClientWrapper,
    });

    await waitFor(() => expect(result.current.isEnabled).toBe(false));
  });

  it('falls back to currentOrganization.id when no override is provided', async () => {
    vi.mocked(useOrganization).mockReturnValue({
      currentOrganization: { id: 'org-member' },
    } as any);
    vi.mocked(intelligenceService.getStatus).mockResolvedValue({ intelligence_enabled: true });

    const { result } = renderHook(() => useIntelligenceStatus(), {
      wrapper: queryClientWrapper,
    });

    await waitFor(() => expect(result.current.isEnabled).toBe(true));
    expect(intelligenceService.getStatus).toHaveBeenCalledWith('org-member');
  });

  it('returns isEnabled null and does not fire a query when no override and no currentOrganization', () => {
    vi.mocked(useOrganization).mockReturnValue({ currentOrganization: null } as any);

    const { result } = renderHook(() => useIntelligenceStatus(), {
      wrapper: queryClientWrapper,
    });

    expect(intelligenceService.getStatus).not.toHaveBeenCalled();
    expect(result.current.isEnabled).toBeNull();
  });

  it('does not fall back to currentOrganization when override is explicitly null', () => {
    vi.mocked(useOrganization).mockReturnValue({
      currentOrganization: { id: 'org-viewer' },
    } as any);

    const { result } = renderHook(() => useIntelligenceStatus(null), {
      wrapper: queryClientWrapper,
    });

    expect(intelligenceService.getStatus).not.toHaveBeenCalled();
    expect(result.current.isEnabled).toBeNull();
  });
});
