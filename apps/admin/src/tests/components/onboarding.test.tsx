/**
 * OnboardingPage component tests.
 *
 * The page's job is narrow: decode a base64 `?handoff=` param, seed
 * the auth context, strip the param from history, and render the
 * API key / install snippet / verification banner. These tests lock
 * down the decode-and-seed flow plus the graceful "missing handoff"
 * redirect, since the landing page is the sole producer of that
 * param and a bad handoff there must never leak the API key to a
 * half-rendered page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import OnboardingPage from '../../pages/onboarding';
import type { User } from '../../types';

const mockNavigate = vi.fn();
const mockLogin = vi.fn();
const mockReplaceState = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../contexts/auth-context', () => ({
  useAuth: () => ({ login: mockLogin }),
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

const validHandoff = {
  accessToken: 'jwt-access-token',
  apiKey: 'bgs_abc123',
  user: {
    id: 'user-1',
    email: 'alice@example.com',
    name: 'Alice',
    role: 'admin' as const,
  } satisfies Pick<User, 'id' | 'email' | 'name' | 'role'>,
  organization: {
    id: 'org-1',
    name: 'Acme',
    subdomain: 'acme',
  },
  project: {
    id: 'proj-1',
    name: 'My First Project',
  },
};

function encodeHandoff(payload: object): string {
  return btoa(JSON.stringify(payload));
}

function renderWithHandoff(raw?: string) {
  const search = raw === undefined ? '' : `?handoff=${raw}`;
  return render(
    <MemoryRouter initialEntries={[`/onboarding${search}`]}>
      <OnboardingPage />
    </MemoryRouter>
  );
}

describe('OnboardingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `window.history.replaceState` is called once on successful mount;
    // spy so we can verify (and prevent it mutating jsdom's URL).
    Object.defineProperty(window.history, 'replaceState', {
      value: mockReplaceState,
      writable: true,
    });
  });

  it('renders the API key and install snippet after decoding a valid handoff', async () => {
    renderWithHandoff(encodeHandoff(validHandoff));

    expect(await screen.findByTestId('onboarding-api-key-value')).toHaveTextContent('bgs_abc123');
    expect(screen.getByTestId('onboarding-install-snippet')).toHaveTextContent(
      "apiKey: 'bgs_abc123'"
    );
    expect(screen.getByTestId('onboarding-install-snippet')).toHaveTextContent(
      "projectId: 'proj-1'"
    );
  });

  it('seeds the auth context with access token and user from the handoff', async () => {
    renderWithHandoff(encodeHandoff(validHandoff));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith(
        'jwt-access-token',
        '',
        expect.objectContaining({ id: 'user-1', email: 'alice@example.com' })
      );
    });
  });

  it('strips the handoff param from history so the API key does not linger in the URL', async () => {
    renderWithHandoff(encodeHandoff(validHandoff));

    await waitFor(() => {
      expect(mockReplaceState).toHaveBeenCalled();
    });
    // The stripped URL must not include `handoff=` — the whole point
    // of the replace is to get the one-time plaintext key out of the
    // browser's address bar and referer chain. We don't assert the
    // exact path because jsdom's `window.location.pathname` and
    // MemoryRouter's route are decoupled.
    const stripped = mockReplaceState.mock.calls[0][2] as string;
    expect(stripped).not.toContain('handoff=');
  });

  it('redirects to /login and renders nothing when handoff is missing', async () => {
    renderWithHandoff();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
    expect(screen.queryByTestId('onboarding-page')).not.toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('redirects to /login when handoff is malformed base64', async () => {
    renderWithHandoff('not!valid!base64@@@');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('redirects to /login when handoff is missing required fields', async () => {
    const incomplete = encodeHandoff({
      // missing apiKey, user, organization, project
      accessToken: 'jwt-access-token',
    });
    renderWithHandoff(incomplete);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('copies the API key to the clipboard when the copy button is clicked', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    // `navigator.clipboard` is a getter-only property on the jsdom
    // navigator prototype — `Object.assign` can't overwrite it, so
    // define it directly with `configurable: true`.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    renderWithHandoff(encodeHandoff(validHandoff));
    await screen.findByTestId('onboarding-api-key-value');

    await user.click(screen.getByTestId('onboarding-api-key-copy'));

    expect(writeText).toHaveBeenCalledWith('bgs_abc123');
  });

  it('Go-to-Dashboard button navigates to root', async () => {
    const user = userEvent.setup();
    renderWithHandoff(encodeHandoff(validHandoff));
    await screen.findByTestId('onboarding-page');

    await user.click(screen.getByTestId('onboarding-go-to-dashboard'));
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });
});
