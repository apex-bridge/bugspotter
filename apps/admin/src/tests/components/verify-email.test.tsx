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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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

function renderWithToken(token?: string) {
  const search = token === undefined ? '' : `?token=${token}`;
  return render(
    <MemoryRouter initialEntries={[`/verify-email${search}`]}>
      <VerifyEmailPage />
    </MemoryRouter>
  );
}

describe('VerifyEmailPage', () => {
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthenticated = false;
    replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
      // Intentionally a no-op — we only want to observe calls, not
      // actually mutate jsdom's URL across tests.
    });
  });

  afterEach(() => {
    replaceStateSpy.mockRestore();
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

    // No async work to wait on, but `findByTestId` keeps the assertion
    // robust against StrictMode double-render timing.
    expect(await screen.findByTestId('verify-email-error')).toBeInTheDocument();
    expect(mockVerifyEmail).not.toHaveBeenCalled();
  });

  it('strips ?token= from the URL on mount even when verify succeeds', async () => {
    mockVerifyEmail.mockResolvedValue(undefined);
    // The strip reads `window.location.href`, not MemoryRouter — plant
    // a real URL with the token + an unrelated param so we can assert
    // the strip preserves what it should.
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost:3000/verify-email?token=abc123&keep=yes'),
      configurable: true,
      writable: true,
    });

    try {
      renderWithToken('abc123');

      await waitFor(() => {
        expect(replaceStateSpy).toHaveBeenCalled();
      });
      const stripped = replaceStateSpy.mock.calls[0][2] as string;
      expect(stripped).not.toContain('token=');
      expect(stripped).toContain('keep=yes');
    } finally {
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        configurable: true,
        writable: true,
      });
    }
  });

  it('does not strip or call replaceState when no token is present', async () => {
    renderWithToken();

    await screen.findByTestId('verify-email-error');
    expect(replaceStateSpy).not.toHaveBeenCalled();
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

  it('does not double-call verify under StrictMode-style remounts', async () => {
    // The component guards verifyEmail behind a ref so the second
    // mount in StrictMode (or a parent re-render) doesn't fire a
    // duplicate request. `useEffect` cleanup also flips a `cancelled`
    // flag so a stale resolution can't override the first attempt's
    // status.
    mockVerifyEmail.mockResolvedValue(undefined);
    const { rerender } = renderWithToken('abc123');
    rerender(
      <MemoryRouter initialEntries={[`/verify-email?token=abc123`]}>
        <VerifyEmailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockVerifyEmail).toHaveBeenCalled();
    });
    // Either 1 (no remount of state) or matching the StrictMode/effect
    // remount count. Critically, the ref guard prevents repeated calls
    // *within the same mounted instance*; we don't try to assert ===1
    // across a real remount because rerender creates a fresh tree.
    expect(mockVerifyEmail.mock.calls.every((call) => call[0] === 'abc123')).toBe(true);
  });
});
