/**
 * VerifyEmailPage component tests.
 *
 * The page's job is narrow: read `?token=` on mount, call
 * `POST /auth/verify-email`, and render success / invalid / no-token
 * terminal states. These tests lock down the verify-once contract,
 * the URL strip (so a verified token doesn't sit in the address bar),
 * and the recovery branches (signed-in user gets resend; signed-out
 * user gets a sign-in CTA).
 */

import { StrictMode, useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, type Location } from 'react-router-dom';
import VerifyEmailPage from '../../pages/verify-email';

const mockNavigate = vi.fn();
const mockVerifyEmail = vi.fn();
const mockResendVerification = vi.fn();
let mockIsAuthenticated = false;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../contexts/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

vi.mock('../../services/api', () => ({
  authService: {
    verifyEmail: (...args: unknown[]) => mockVerifyEmail(...args),
    resendVerification: (...args: unknown[]) => mockResendVerification(...args),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Resolve keys against en.json with {{var}} interpolation so assertions
// can match rendered user-facing text.
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

/**
 * Captures every `useLocation` snapshot the router reports during the
 * test. We use this instead of spying on `window.history` because
 * `MemoryRouter` keeps an in-memory history and never touches the
 * real `window.history`. The latest snapshot is the page's
 * post-`setSearchParams` URL state.
 */
function LocationCapture({ onLocation }: { onLocation: (loc: Location) => void }) {
  const location = useLocation();
  useEffect(() => {
    onLocation(location);
  }, [location, onLocation]);
  return null;
}

function renderWithRouter(initialEntry: string, options?: { strictMode?: boolean }) {
  const locations: Location[] = [];
  const captureLocation = (loc: Location) => {
    locations.push(loc);
  };
  const tree = (
    <MemoryRouter initialEntries={[initialEntry]}>
      <VerifyEmailPage />
      <LocationCapture onLocation={captureLocation} />
    </MemoryRouter>
  );
  const result = render(options?.strictMode ? <StrictMode>{tree}</StrictMode> : tree);
  return { ...result, locations };
}

function renderWithToken(token?: string) {
  const search = token === undefined ? '' : `?token=${token}`;
  return renderWithRouter(`/verify-email${search}`);
}

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthenticated = false;
  });

  it('renders the success state after a valid verify call', async () => {
    mockVerifyEmail.mockResolvedValue(undefined);
    renderWithToken('abc123');

    expect(await screen.findByTestId('verify-email-success')).toBeInTheDocument();
    expect(mockVerifyEmail).toHaveBeenCalledWith('abc123');
    expect(mockVerifyEmail).toHaveBeenCalledTimes(1);
  });

  it('renders the invalid state when the verify call rejects', async () => {
    mockVerifyEmail.mockRejectedValue(new Error('400'));
    renderWithToken('abc123');

    expect(await screen.findByTestId('verify-email-error')).toBeInTheDocument();
    // `auth.signIn` CTA is the unauth recovery — visible because
    // `isAuthenticated` defaults to false in this test suite.
    expect(screen.getByTestId('verify-email-sign-in')).toBeInTheDocument();
    expect(screen.queryByTestId('verify-email-resend')).not.toBeInTheDocument();
  });

  it('renders the no-token state when ?token= is missing and skips the verify call', async () => {
    renderWithToken();

    expect(await screen.findByTestId('verify-email-error')).toBeInTheDocument();
    expect(mockVerifyEmail).not.toHaveBeenCalled();
  });

  it('renders the invalid state when ?token= is present but empty (no value)', async () => {
    // `searchParams.get('token')` returns '' for `?token=`. Treating
    // that as no-token would silently swallow a malformed link AND
    // leave the empty `?token=` in the address bar. The page should
    // distinguish missing vs. empty: empty becomes invalid, the
    // verify call is skipped, and the strip still runs.
    const { locations } = renderWithRouter('/verify-email?token=');

    expect(await screen.findByTestId('verify-email-error')).toBeInTheDocument();
    expect(mockVerifyEmail).not.toHaveBeenCalled();

    await waitFor(() => {
      const last = locations[locations.length - 1];
      expect(last.search).not.toContain('token');
    });
  });

  it('strips ?token= from the URL on mount even when verify succeeds', async () => {
    mockVerifyEmail.mockResolvedValue(undefined);
    const { locations } = renderWithRouter('/verify-email?token=abc123&keep=yes');

    await screen.findByTestId('verify-email-success');

    const last = locations[locations.length - 1];
    expect(last.search).not.toContain('token=');
    // Unrelated params survive the strip — the prev-function form of
    // `setSearchParams` preserves any keys other than `token`.
    expect(last.search).toContain('keep=yes');
  });

  it('strips ?token= even when verify fails', async () => {
    // The strip is decoupled from the verify outcome — the address
    // bar shouldn't hold a stale token regardless of whether it was
    // valid.
    mockVerifyEmail.mockRejectedValue(new Error('400'));
    const { locations } = renderWithRouter('/verify-email?token=bogus');

    await screen.findByTestId('verify-email-error');

    const last = locations[locations.length - 1];
    expect(last.search).not.toContain('token');
  });

  it('does not modify the URL when no token param is present', async () => {
    const { locations } = renderWithRouter('/verify-email?keep=yes');

    await screen.findByTestId('verify-email-error');

    // Captured locations should all preserve `keep=yes` and never
    // gain or lose any param — the page makes zero URL changes when
    // there's no `?token=` to strip.
    for (const loc of locations) {
      expect(loc.search).toContain('keep=yes');
      expect(loc.search).not.toContain('token');
    }
  });

  it('shows the success CTA and navigates home when authenticated', async () => {
    mockIsAuthenticated = true;
    mockVerifyEmail.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithToken('abc123');

    await user.click(await screen.findByTestId('verify-email-success-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('routes the success CTA to /login when unauthenticated', async () => {
    mockVerifyEmail.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithToken('abc123');

    await user.click(await screen.findByTestId('verify-email-success-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('shows the resend button for authenticated users on the invalid state', async () => {
    mockIsAuthenticated = true;
    mockVerifyEmail.mockRejectedValue(new Error('400'));
    mockResendVerification.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithToken('abc123');

    await user.click(await screen.findByTestId('verify-email-resend'));
    expect(mockResendVerification).toHaveBeenCalledTimes(1);

    const { toast } = await import('sonner');
    expect(toast.success).toHaveBeenCalled();
  });

  it('surfaces an error toast when resend fails', async () => {
    mockIsAuthenticated = true;
    mockVerifyEmail.mockRejectedValue(new Error('400'));
    mockResendVerification.mockRejectedValue(new Error('500'));
    const user = userEvent.setup();
    renderWithToken('abc123');

    await user.click(await screen.findByTestId('verify-email-resend'));

    const { toast } = await import('sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it('navigates to /login from the sign-in CTA when unauthenticated', async () => {
    mockVerifyEmail.mockRejectedValue(new Error('400'));
    const user = userEvent.setup();
    renderWithToken('abc123');

    await user.click(await screen.findByTestId('verify-email-sign-in'));
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });

  it('fires verify exactly once even when wrapped in StrictMode', async () => {
    // StrictMode double-invokes effects on mount in dev to surface
    // missing cleanup. Without the `startedRef` guard, the second
    // invocation would issue a duplicate POST /auth/verify-email,
    // and the user would briefly see success before the second call
    // (now consuming a freshly-invalidated token) flipped the screen
    // to invalid.
    mockVerifyEmail.mockResolvedValue(undefined);
    renderWithRouter('/verify-email?token=abc123', { strictMode: true });

    await screen.findByTestId('verify-email-success');
    expect(mockVerifyEmail).toHaveBeenCalledTimes(1);
    expect(mockVerifyEmail).toHaveBeenCalledWith('abc123');
  });
});
