/**
 * VerifyEmailPage component tests.
 *
 * The page's job is narrow: read `?token=` on mount, call
 * `POST /auth/verify-email`, and render one of four terminal states:
 * success / invalid (terminal 4xx) / transientError (5xx / 429 /
 * network) / noToken. These tests lock down the verify-once
 * contract, the unconditional URL strip (so the token doesn't sit in
 * the address bar after the page loads), and the recovery branches
 * (signed-in user gets resend; signed-out user gets a sign-in CTA).
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

// `react-i18next` is mocked globally in `apps/admin/src/tests/setup.ts`
// (resolves keys from en.json + `{{var}}` interpolation), so we don't
// re-mock it here.

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

  it('renders the invalid state on a 4xx response (token genuinely dead)', async () => {
    const axiosLikeError = Object.assign(new Error('400'), {
      isAxiosError: true,
      response: { status: 400 },
    });
    mockVerifyEmail.mockRejectedValue(axiosLikeError);
    renderWithToken('abc123');

    expect(await screen.findByTestId('verify-email-error')).toBeInTheDocument();
    expect(screen.getByText('Verification link is invalid or expired')).toBeInTheDocument();
    // `auth.signIn` CTA is the unauth recovery — visible because
    // `isAuthenticated` defaults to false in this test suite.
    expect(screen.getByTestId('verify-email-sign-in')).toBeInTheDocument();
    expect(screen.queryByTestId('verify-email-resend')).not.toBeInTheDocument();
  });

  it('renders the transientError state on a 5xx response', async () => {
    // 5xx means the server hiccupped — the token may still be valid.
    // The user should see retry-oriented copy instead of "your link
    // is dead."
    const axiosLikeError = Object.assign(new Error('503'), {
      isAxiosError: true,
      response: { status: 503 },
    });
    mockVerifyEmail.mockRejectedValue(axiosLikeError);
    renderWithToken('abc123');

    expect(await screen.findByTestId('verify-email-error')).toBeInTheDocument();
    expect(screen.getByText("Couldn't verify your email")).toBeInTheDocument();
  });

  it('renders the transientError state on a 429 response (rate limit)', async () => {
    // The verify-email route is rate-limited at 5/min per IP. A user
    // who triggers the cap (e.g., flaky network → page re-mounts
    // multiple times) shouldn't be told their link is dead — they
    // just need to wait.
    const axiosLikeError = Object.assign(new Error('429'), {
      isAxiosError: true,
      response: { status: 429 },
    });
    mockVerifyEmail.mockRejectedValue(axiosLikeError);
    renderWithToken('abc123');

    expect(await screen.findByTestId('verify-email-error')).toBeInTheDocument();
    expect(screen.getByText("Couldn't verify your email")).toBeInTheDocument();
  });

  it('renders the transientError state when the request never reaches the server', async () => {
    // No `response` field on the error → axios couldn't get a reply
    // (CORS, DNS, offline). Treat as retryable rather than terminal.
    const axiosLikeError = Object.assign(new Error('Network Error'), {
      isAxiosError: true,
    });
    mockVerifyEmail.mockRejectedValue(axiosLikeError);
    renderWithToken('abc123');

    expect(await screen.findByTestId('verify-email-error')).toBeInTheDocument();
    expect(screen.getByText("Couldn't verify your email")).toBeInTheDocument();
  });

  it('defaults to transientError for non-axios errors of unknown shape', async () => {
    // The conservative default — we don't know whether the token is
    // dead, so don't tell the user it is. "Couldn't verify, try
    // again" is correct under uncertainty.
    mockVerifyEmail.mockRejectedValue(new Error('something weird'));
    renderWithToken('abc123');

    expect(await screen.findByTestId('verify-email-error')).toBeInTheDocument();
    expect(screen.getByText("Couldn't verify your email")).toBeInTheDocument();
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

  it('strips ?token= from the URL on mount, before verify resolves', async () => {
    // Strip is unconditional — runs as soon as the page sees a
    // `?token=` param, regardless of the verify outcome. The token
    // is auth-equivalent and shouldn't linger in the address bar
    // (browser history, Referer leaks). Recovery from transient
    // failures is via re-clicking the email link, not refreshing.
    mockVerifyEmail.mockResolvedValue(undefined);
    const { locations } = renderWithRouter('/verify-email?token=abc123&keep=yes');

    await waitFor(() => {
      const last = locations[locations.length - 1];
      expect(last.search).not.toContain('token=');
      // Unrelated params survive the strip — the prev-function form
      // of `setSearchParams` preserves any keys other than `token`.
      expect(last.search).toContain('keep=yes');
    });
  });

  it('strips ?token= even when verify fails (terminal 400)', async () => {
    // A 4xx means the token is dead, no point keeping it in the URL.
    const axiosLikeError = Object.assign(new Error('400'), {
      isAxiosError: true,
      response: { status: 400 },
    });
    mockVerifyEmail.mockRejectedValue(axiosLikeError);
    const { locations } = renderWithRouter('/verify-email?token=bogus');

    await screen.findByTestId('verify-email-error');

    await waitFor(() => {
      const last = locations[locations.length - 1];
      expect(last.search).not.toContain('token');
    });
  });

  it('strips ?token= even when verify fails transiently (5xx)', async () => {
    // Even when the token might still be valid (server hiccup), we
    // strip rather than leak it via history/referrer. Recovery is by
    // re-clicking the email link.
    const axiosLikeError = Object.assign(new Error('502'), {
      isAxiosError: true,
      response: { status: 502 },
    });
    mockVerifyEmail.mockRejectedValue(axiosLikeError);
    const { locations } = renderWithRouter('/verify-email?token=abc123');

    await screen.findByTestId('verify-email-error');

    await waitFor(() => {
      const last = locations[locations.length - 1];
      expect(last.search).not.toContain('token');
    });
  });

  it('does not modify the URL when no token param is present', async () => {
    const { locations } = renderWithRouter('/verify-email?keep=yes');

    await screen.findByTestId('verify-email-error');

    // Wait for at least one location snapshot before iterating —
    // the for-of loop would pass vacuously if `LocationCapture`'s
    // effect hadn't fired yet, so the assertions below would
    // silently skip.
    await waitFor(() => {
      expect(locations.length).toBeGreaterThan(0);
    });

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

    const cta = await screen.findByTestId('verify-email-success-cta');
    expect(cta).toHaveTextContent('Continue to dashboard');
    await user.click(cta);
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('routes the success CTA to /login and labels it Sign in when unauthenticated', async () => {
    // Label must match the action — "Continue to dashboard" would
    // mislead an unauth user about where the click takes them.
    mockVerifyEmail.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithToken('abc123');

    const cta = await screen.findByTestId('verify-email-success-cta');
    expect(cta).toHaveTextContent('Sign in');
    await user.click(cta);
    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('shows the resend button for authenticated users on an error state', async () => {
    mockIsAuthenticated = true;
    mockVerifyEmail.mockRejectedValue(
      Object.assign(new Error('400'), { isAxiosError: true, response: { status: 400 } })
    );
    mockResendVerification.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithToken('abc123');

    await user.click(await screen.findByTestId('verify-email-resend'));
    expect(mockResendVerification).toHaveBeenCalledTimes(1);

    const { toast } = await import('sonner');
    // toast.success fires after `await authService.resendVerification()`
    // resolves on a later microtask. Wrap in waitFor so the assertion
    // doesn't race the async handler.
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
  });

  it('surfaces an error toast when resend fails', async () => {
    mockIsAuthenticated = true;
    mockVerifyEmail.mockRejectedValue(
      Object.assign(new Error('400'), { isAxiosError: true, response: { status: 400 } })
    );
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
    mockVerifyEmail.mockRejectedValue(
      Object.assign(new Error('400'), { isAxiosError: true, response: { status: 400 } })
    );
    const user = userEvent.setup();
    renderWithToken('abc123');

    await user.click(await screen.findByTestId('verify-email-sign-in'));
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });

  it('fires verify exactly once even when wrapped in StrictMode', async () => {
    // StrictMode double-invokes effects on mount in dev. Without
    // the `startedRef` guard, the second invocation would issue a
    // duplicate POST /auth/verify-email. With backend idempotency
    // landed (PR #52) the duplicate would still resolve 200, so
    // the page wouldn't visibly break — but the redundant call
    // wastes a DB transaction and burns a slot in the route's
    // 5/min per-IP rate limit. This test locks the perf
    // optimization in.
    mockVerifyEmail.mockResolvedValue(undefined);
    renderWithRouter('/verify-email?token=abc123', { strictMode: true });

    await screen.findByTestId('verify-email-success');
    expect(mockVerifyEmail).toHaveBeenCalledTimes(1);
    expect(mockVerifyEmail).toHaveBeenCalledWith('abc123');
  });
});
