import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { IntelligenceEventFeedback } from '../../../components/intelligence/intelligence-event-feedback';
import { intelligenceService } from '../../../services/intelligence-service';
import { toast } from 'sonner';

const useAuthMock = vi.fn();

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
      t: (key: string) => get(key) ?? key,
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('../../../contexts/auth-context', () => ({ useAuth: () => useAuthMock() }));

vi.mock('../../../services/intelligence-service', () => ({
  intelligenceService: { submitEventFeedback: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/api-client', () => ({
  handleApiError: (e: unknown) => (e as { message?: string } | null)?.message ?? 'error',
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const EVENT = 'e1b2c3d4-0000-4000-8000-000000000001';
const PROJECT = 'p1b2c3d4-0000-4000-8000-000000000002';
const USER = 'u-42';

describe('IntelligenceEventFeedback', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useAuthMock.mockReturnValue({ user: { id: USER } });
    vi.mocked(intelligenceService.submitEventFeedback).mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('renders both thumb buttons initially enabled', () => {
    render(<IntelligenceEventFeedback eventId={EVENT} projectId={PROJECT} />, { wrapper });
    const up = screen.getByLabelText('Mark as helpful');
    const down = screen.getByLabelText('Mark as not helpful');
    expect(up).not.toBeDisabled();
    expect(down).not.toBeDisabled();
  });

  it('thumbs-up sends verdict=correct with user_ref=user.id and disables both buttons after success', async () => {
    vi.mocked(intelligenceService.submitEventFeedback).mockResolvedValueOnce({
      feedback_id: 'f1',
    });
    render(<IntelligenceEventFeedback eventId={EVENT} projectId={PROJECT} />, { wrapper });

    await userEvent.click(screen.getByLabelText('Mark as helpful'));

    await waitFor(() => {
      expect(intelligenceService.submitEventFeedback).toHaveBeenCalledWith({
        project_id: PROJECT,
        event_id: EVENT,
        verdict: 'correct',
        user_ref: USER,
      });
    });
    expect(toast.success).toHaveBeenCalled();
    expect(screen.getByLabelText('Mark as helpful')).toBeDisabled();
    expect(screen.getByLabelText('Mark as not helpful')).toBeDisabled();
  });

  it('thumbs-down sends verdict=incorrect', async () => {
    vi.mocked(intelligenceService.submitEventFeedback).mockResolvedValueOnce({
      feedback_id: 'f2',
    });
    render(<IntelligenceEventFeedback eventId={EVENT} projectId={PROJECT} />, { wrapper });

    await userEvent.click(screen.getByLabelText('Mark as not helpful'));

    await waitFor(() => {
      const args = vi.mocked(intelligenceService.submitEventFeedback).mock.calls[0][0];
      expect(args.verdict).toBe('incorrect');
    });
  });

  it('falls back to user_ref=null when no auth user', async () => {
    useAuthMock.mockReturnValue({ user: null });
    vi.mocked(intelligenceService.submitEventFeedback).mockResolvedValueOnce({
      feedback_id: 'f3',
    });
    render(<IntelligenceEventFeedback eventId={EVENT} projectId={PROJECT} />, { wrapper });

    await userEvent.click(screen.getByLabelText('Mark as helpful'));

    await waitFor(() => {
      const args = vi.mocked(intelligenceService.submitEventFeedback).mock.calls[0][0];
      expect(args.user_ref).toBeNull();
    });
  });

  it('shows error toast and does NOT lock buttons on submit failure (so user can retry)', async () => {
    vi.mocked(intelligenceService.submitEventFeedback).mockRejectedValueOnce(
      new Error('upstream 500')
    );
    render(<IntelligenceEventFeedback eventId={EVENT} projectId={PROJECT} />, { wrapper });

    await userEvent.click(screen.getByLabelText('Mark as helpful'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    // Failure must leave buttons enabled — locking them would strand the user
    // with no way to retry after a transient network blip.
    expect(screen.getByLabelText('Mark as helpful')).not.toBeDisabled();
    expect(screen.getByLabelText('Mark as not helpful')).not.toBeDisabled();
  });
});
