import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { IntelligenceEventFeedback } from '../../../components/intelligence/intelligence-event-feedback';
import { intelligenceService } from '../../../services/intelligence-service';
import { toast } from 'sonner';

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
const EVENT2 = 'e1b2c3d4-0000-4000-8000-000000000099';
const PROJECT = 'p1b2c3d4-0000-4000-8000-000000000002';

describe('IntelligenceEventFeedback', () => {
  beforeEach(() => {
    vi.mocked(intelligenceService.submitEventFeedback).mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('renders both thumb buttons initially enabled and aria-pressed=false', () => {
    render(<IntelligenceEventFeedback eventId={EVENT} projectId={PROJECT} />, { wrapper });
    const up = screen.getByLabelText('Mark as helpful');
    const down = screen.getByLabelText('Mark as not helpful');
    expect(up).not.toBeDisabled();
    expect(down).not.toBeDisabled();
    expect(up).toHaveAttribute('aria-pressed', 'false');
    expect(down).toHaveAttribute('aria-pressed', 'false');
  });

  it('does NOT send user_ref in the request body (server-side attribution)', async () => {
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
      });
    });
    // Belt-and-suspenders: the call payload must not carry user_ref. The
    // backend derives it from getAuditUserId(request) so the body should
    // never advertise it as a client-controllable field.
    const args = vi.mocked(intelligenceService.submitEventFeedback).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(args).not.toHaveProperty('user_ref');
  });

  it('thumbs-up: locks both buttons and reflects aria-pressed=true on success', async () => {
    vi.mocked(intelligenceService.submitEventFeedback).mockResolvedValueOnce({
      feedback_id: 'f1',
    });
    render(<IntelligenceEventFeedback eventId={EVENT} projectId={PROJECT} />, { wrapper });

    await userEvent.click(screen.getByLabelText('Mark as helpful'));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
    const up = screen.getByLabelText('Mark as helpful');
    const down = screen.getByLabelText('Mark as not helpful');
    expect(up).toBeDisabled();
    expect(down).toBeDisabled();
    expect(up).toHaveAttribute('aria-pressed', 'true');
    expect(down).toHaveAttribute('aria-pressed', 'false');
  });

  it('thumbs-down: sends verdict=incorrect and sets aria-pressed=true on the down button', async () => {
    vi.mocked(intelligenceService.submitEventFeedback).mockResolvedValueOnce({
      feedback_id: 'f2',
    });
    render(<IntelligenceEventFeedback eventId={EVENT} projectId={PROJECT} />, { wrapper });

    await userEvent.click(screen.getByLabelText('Mark as not helpful'));

    await waitFor(() => {
      const args = vi.mocked(intelligenceService.submitEventFeedback).mock.calls[0][0];
      expect(args.verdict).toBe('incorrect');
    });
    expect(screen.getByLabelText('Mark as not helpful')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Mark as helpful')).toHaveAttribute('aria-pressed', 'false');
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

  it('rerendering with a different eventId via key= resets the verdict state', async () => {
    vi.mocked(intelligenceService.submitEventFeedback).mockResolvedValueOnce({
      feedback_id: 'f1',
    });
    const { rerender } = render(
      <IntelligenceEventFeedback key={EVENT} eventId={EVENT} projectId={PROJECT} />,
      { wrapper }
    );

    await userEvent.click(screen.getByLabelText('Mark as helpful'));
    await waitFor(() => {
      expect(screen.getByLabelText('Mark as helpful')).toBeDisabled();
    });

    // Same logical position in the tree, but different key — React must
    // unmount + remount, dropping the verdict state. Without key=, the
    // parent would keep the old instance and the buttons would stay locked
    // for the new event.
    rerender(<IntelligenceEventFeedback key={EVENT2} eventId={EVENT2} projectId={PROJECT} />);

    expect(screen.getByLabelText('Mark as helpful')).not.toBeDisabled();
    expect(screen.getByLabelText('Mark as not helpful')).not.toBeDisabled();
    expect(screen.getByLabelText('Mark as helpful')).toHaveAttribute('aria-pressed', 'false');
  });
});
