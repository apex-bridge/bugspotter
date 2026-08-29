/**
 * Login Page Tests (#408, #424)
 *
 * Note: Uses standard vitest assertions (not jest-dom matchers like
 * toBeInTheDocument) because @testing-library/jest-dom matchers have a
 * known setup issue in this project — see register.test.tsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import LoginPage from '../../pages/login';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../components/language-switcher', () => ({
  LanguageSwitcher: () => <div data-testid="language-switcher" />,
}));

const mockNavigate = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [mockSearchParams],
  };
});

vi.mock('../../services/api', () => ({
  authService: {
    login: vi.fn(),
    magicLogin: vi.fn(),
    getRegistrationStatus: vi.fn().mockResolvedValue({
      allowed: false,
      requireInvitation: false,
      passwordResetEnabled: false,
    }),
    getSsoStatus: vi.fn().mockResolvedValue({ enforceSso: false, tenantId: null }),
  },
  setupService: {
    getStatus: vi.fn(),
  },
  invitationService: {
    preview: vi.fn().mockRejectedValue(new Error('Not mocked')),
  },
}));

vi.mock('../../lib/api-client', () => ({
  handleApiError: vi.fn((error: Error) => error.message),
  API_BASE_URL: 'https://api.example.com',
  API_ENDPOINTS: {
    auth: {
      ssoLogin: (tenantId: string) => `/api/v1/auth/oidc/${tenantId}/login`,
    },
  },
}));

const mockLogin = vi.fn();

vi.mock('../../contexts/auth-context', () => ({
  useAuth: () => ({
    login: mockLogin,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { authService, setupService } from '../../services/api';
import { toast } from 'sonner';

function renderLoginPage() {
  return render(
    <BrowserRouter>
      <LoginPage />
    </BrowserRouter>
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setupService.getStatus).mockResolvedValue({
      initialized: true,
      requiresSetup: false,
      setupMode: 'minimal' as const,
    });
    vi.mocked(authService.getRegistrationStatus).mockResolvedValue({
      allowed: false,
      requireInvitation: false,
      passwordResetEnabled: false,
    });
    vi.mocked(authService.getSsoStatus).mockResolvedValue({ enforceSso: false, tenantId: null });
  });

  // Test case D (spec #408, AC #1): SSO button always present.
  it.each([true, false])(
    'always renders the Sign in with SSO button (enforceSso: %s)',
    async (enforceSso) => {
      vi.mocked(authService.getSsoStatus).mockResolvedValue({ enforceSso, tenantId: null });
      renderLoginPage();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'auth.signInWithSso' })).toBeDefined();
      });
    }
  );

  // Test case E (spec #408, AC #2): password fields hidden when enforced.
  it('hides password fields when the tenant enforces SSO', async () => {
    const mockedGetSsoStatus = vi
      .mocked(authService.getSsoStatus)
      .mockResolvedValue({ enforceSso: true, tenantId: 'org-abc-123' });
    renderLoginPage();
    // isInitialized (from useSetupGuard's own async getStatus() call)
    // must resolve before login.tsx's effect calls getSsoStatus() at
    // all, so wait for the call before awaiting its result.
    await waitFor(() => expect(mockedGetSsoStatus).toHaveBeenCalled());
    // Awaiting the mock's own returned promise (rather than a bare
    // waitFor) forces the effect's .then() and its state update to land
    // before the assertion below runs — a bare waitFor would also pass
    // on the very first synchronous render (enforceSso still null),
    // before a broken resolved-branch implementation had any chance to
    // (incorrectly) reveal the fields.
    await act(async () => {
      await mockedGetSsoStatus.mock.results[0].value;
    });
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });

  // Test case F (spec #408, AC #3): password fields shown when not enforced or absent.
  it('shows password fields when SSO is not enforced', async () => {
    vi.mocked(authService.getSsoStatus).mockResolvedValue({ enforceSso: false, tenantId: null });
    renderLoginPage();
    await waitFor(() => expect(screen.getByLabelText(/password/i)).toBeDefined());
  });

  it('shows password fields when enforceSso is absent from the response', async () => {
    vi.mocked(authService.getSsoStatus).mockResolvedValue({} as never);
    renderLoginPage();
    await waitFor(() => expect(screen.getByLabelText(/password/i)).toBeDefined());
  });

  // Regression test for claude[bot] review comment 3886849512 on PR #424:
  // selfhosted mode (and the saas hub domain) always resolves `tenantId`
  // to `null` — see getSsoStatus()'s doc comment — so `enforceSso: true`
  // there previously hid the password form while the always-rendered SSO
  // button had no login target to redirect to (handleSsoLogin just toasts
  // an error), a total login lockout. The password form must stay
  // available whenever there's no working SSO redirect target, regardless
  // of `enforceSso`, so there's always at least one path to authenticate —
  // the backend's assertSsoNotEnforced (enforce-sso.ts) remains the real
  // fail-closed gate on submit.
  it('shows the password form when SSO is enforced but no SSO login target is resolved (selfhosted lockout)', async () => {
    const mockedGetSsoStatus = vi
      .mocked(authService.getSsoStatus)
      .mockResolvedValue({ enforceSso: true, tenantId: null });
    renderLoginPage();
    await waitFor(() => expect(mockedGetSsoStatus).toHaveBeenCalled());
    await act(async () => {
      await mockedGetSsoStatus.mock.results[0].value;
    });
    expect(screen.getByLabelText(/password/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'auth.loginButton' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'auth.signInWithSso' })).toBeDefined();
  });

  // Regression test for CodeRabbit review comment 3886860805 on PR #424:
  // the SSO status probe's rejection handler used to call
  // `setEnforceSso(false)`, which rendered the password form as though
  // SSO were confirmed off even though the backend might still 403 the
  // submit via assertSsoNotEnforced if SSO really is enforced — a
  // misleading dead end. On a failed probe, `enforceSso` must stay
  // unresolved (`null`), which renders the same as the pre-resolution
  // state: no password form, no submit button, SSO button only.
  it('does not render the password form when the SSO status probe fails', async () => {
    const mockedGetSsoStatus = vi
      .mocked(authService.getSsoStatus)
      .mockRejectedValue(new Error('network error'));
    renderLoginPage();
    await waitFor(() => expect(mockedGetSsoStatus).toHaveBeenCalled());
    await act(async () => {
      await mockedGetSsoStatus.mock.results[0].value.catch(() => {});
    });
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'auth.loginButton' })).toBeNull();
    expect(screen.getByRole('button', { name: 'auth.signInWithSso' })).toBeDefined();
  });

  // Regression test for CodeRabbit review comment 3886860807 on PR #424:
  // the email input's placeholder must come from i18n, not a hardcoded
  // English string, so it can be localized like every other user-facing
  // string on this page.
  it('localizes the email input placeholder', async () => {
    renderLoginPage();
    const emailInput = await screen.findByLabelText(/email/i);
    expect(emailInput.getAttribute('placeholder')).toBe('auth.emailPlaceholder');
  });

  // Test cases G/H (#424 — fix for Copilot review comment 3886667718 on
  // PR #424): clicking "Sign in with SSO" must trigger a real browser
  // navigation to the backend's OIDC login-initiation route, not a no-op.
  describe('SSO login button click', () => {
    let originalLocation: Location;

    beforeEach(() => {
      originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        value: { href: '' },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    });

    it('navigates the browser to the OIDC login-initiation URL for the resolved tenant', async () => {
      vi.mocked(authService.getSsoStatus).mockResolvedValue({
        enforceSso: false,
        tenantId: 'org-abc-123',
      });
      renderLoginPage();

      const button = await screen.findByRole('button', { name: 'auth.signInWithSso' });
      // Wait for the effect's setSsoTenantId to have landed — password
      // fields rendering (enforceSso: false) is proof the same .then()
      // callback already ran.
      await waitFor(() => expect(screen.getByLabelText(/password/i)).toBeDefined());

      fireEvent.click(button);

      expect(window.location.href).toBe(
        'https://api.example.com/api/v1/auth/oidc/org-abc-123/login'
      );
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('shows an error and does not navigate when no tenant is resolved (selfhosted / hub domain)', async () => {
      vi.mocked(authService.getSsoStatus).mockResolvedValue({
        enforceSso: false,
        tenantId: null,
      });
      renderLoginPage();

      const button = await screen.findByRole('button', { name: 'auth.signInWithSso' });
      await waitFor(() => expect(screen.getByLabelText(/password/i)).toBeDefined());

      fireEvent.click(button);

      expect(window.location.href).toBe('');
      expect(toast.error).toHaveBeenCalledWith('auth.ssoLoginUnavailable');
    });
  });
});
