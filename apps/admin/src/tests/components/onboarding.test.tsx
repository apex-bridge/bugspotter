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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import OnboardingPage from '../../pages/onboarding';
import type { User } from '../../types';

const mockNavigate = vi.fn();
const mockLogin = vi.fn();

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
  // Field names match the `POST /api/v1/auth/signup` response exactly
  // (snake_case). If these drift from the backend shape the page
  // silently redirects to /login in production — keep them in lockstep
  // with `packages/backend/src/api/routes/signup.ts`.
  access_token: 'jwt-access-token',
  api_key: 'bgs_abc123',
  user: {
    id: 'user-1',
    email: 'alice@example.com',
    name: 'Alice',
    role: 'admin' as const,
    created_at: '2026-04-24T00:00:00Z',
    updated_at: '2026-04-24T00:00:00Z',
  } satisfies User,
  organization: {
    id: 'org-1',
    name: 'Acme',
    subdomain: 'acme',
    trial_ends_at: '2026-05-08T00:00:00Z',
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
  // `vi.spyOn` on `window.history.replaceState` captures the original
  // for us and restores it automatically when we call `mockRestore()`
  // in afterEach — no leak into other test files.
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  // Capture jsdom's original navigator.clipboard descriptor so the
  // copy-test override doesn't leak into other test files that share
  // the navigator global. jsdom doesn't ship a clipboard by default,
  // so `getOwnPropertyDescriptor` may return `undefined` — restore
  // by deleting the property in that case.
  const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  beforeEach(() => {
    vi.clearAllMocks();
    replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
      // Intentionally a no-op — we only want to observe calls, not
      // actually mutate jsdom's URL across tests.
    });
  });

  afterEach(() => {
    replaceStateSpy.mockRestore();
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (navigator as any).clipboard;
    }
  });

  it('renders the API key and install snippet after decoding a valid handoff', async () => {
    renderWithHandoff(encodeHandoff(validHandoff));

    expect(await screen.findByTestId('onboarding-api-key-value')).toHaveTextContent('bgs_abc123');
    // Default import — matches README.md. A user copy-pasting this
    // snippet needs it to work against the real SDK (which ships a
    // default export, not a named one).
    expect(screen.getByTestId('onboarding-install-snippet')).toHaveTextContent(
      "import BugSpotter from '@bugspotter/sdk'"
    );
    // `JSON.stringify` emits double-quotes — belt-and-braces defense
    // against special chars breaking the generated snippet.
    expect(screen.getByTestId('onboarding-install-snippet')).toHaveTextContent(
      'apiKey: "bgs_abc123"'
    );
    expect(screen.getByTestId('onboarding-install-snippet')).toHaveTextContent(
      'projectId: "proj-1"'
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
    // Strip logic reads from `window.location.href`, not MemoryRouter.
    // Stub the whole `location` object (setting `href` directly is a
    // no-op in jsdom's location) so `new URL(...)` sees our planted
    // query. `keep=yes` tests that unrelated params survive the strip.
    const encoded = encodeHandoff(validHandoff);
    const originalLocation = window.location;
    const plantedUrl = `http://localhost:3000/onboarding?handoff=${encoded}&keep=yes`;
    Object.defineProperty(window, 'location', {
      value: new URL(plantedUrl),
      configurable: true,
      writable: true,
    });

    try {
      renderWithHandoff(encoded);

      await waitFor(() => {
        expect(replaceStateSpy).toHaveBeenCalled();
      });
      const stripped = replaceStateSpy.mock.calls[0][2] as string;
      expect(stripped).not.toContain('handoff=');
      expect(stripped).toContain('keep=yes');
    } finally {
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        configurable: true,
        writable: true,
      });
    }
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
      // missing api_key, user, organization, project
      access_token: 'jwt-access-token',
    });
    renderWithHandoff(incomplete);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it.each([
    ['access_token as non-string', { ...validHandoff, access_token: 42 }],
    ['api_key as object', { ...validHandoff, api_key: {} }],
    ['user.email as number', { ...validHandoff, user: { ...validHandoff.user, email: 123 } }],
    [
      'organization.subdomain as null',
      {
        ...validHandoff,
        organization: { ...validHandoff.organization, subdomain: null },
      },
    ],
    ['project.id as array', { ...validHandoff, project: { id: [], name: 'x' } }],
    // The admin `User` type requires `name`. If validation doesn't
    // check it, `as OnboardingHandoff` is a lie and downstream code
    // gets a structurally invalid user.
    ['user.name missing', { ...validHandoff, user: { ...validHandoff.user, name: undefined } }],
    ['project.name missing', { ...validHandoff, project: { id: 'proj-1' } }],
  ])('redirects to /login when %s (type-mismatched shape)', async (_label, payload) => {
    // Truthy-only validation would accept these (truthy numbers,
    // objects, arrays) and crash later at render or feed garbage
    // to `login()`. Strict typeof checks must reject them.
    renderWithHandoff(encodeHandoff(payload));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('redirects to /login when handoff is missing user.email (renderable-shape check)', async () => {
    const incompleteUser = encodeHandoff({
      ...validHandoff,
      user: { id: 'user-1', name: 'Alice' },
    });
    renderWithHandoff(incompleteUser);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
  });

  it('decodes UTF-8 names (Cyrillic) correctly', async () => {
    const payload = {
      ...validHandoff,
      user: { ...validHandoff.user, name: 'Ерлан' },
    };
    const json = JSON.stringify(payload);
    // Encode via TextEncoder → btoa(binaryString) so the UTF-8 bytes
    // survive the atob → TextDecoder round trip on the read side.
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const b of bytes) {
      binary += String.fromCharCode(b);
    }
    renderWithHandoff(btoa(binary));

    expect(await screen.findByText(/Ерлан/)).toBeInTheDocument();
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

  it('decodes handoff from URL fragment (#handoff=) as the preferred source', async () => {
    // Fragment stays client-side — never leaks to servers or Referer
    // headers — so it's the preferred location for the plaintext API
    // key. The page must read it before falling back to the query.
    const encoded = encodeHandoff(validHandoff);
    const originalHash = window.location.hash;
    window.location.hash = `#handoff=${encoded}`;
    try {
      render(
        <MemoryRouter initialEntries={['/onboarding']}>
          <OnboardingPage />
        </MemoryRouter>
      );
      expect(await screen.findByTestId('onboarding-api-key-value')).toHaveTextContent('bgs_abc123');
    } finally {
      window.location.hash = originalHash;
    }
  });

  it('Go-to-Dashboard button navigates to root', async () => {
    const user = userEvent.setup();
    renderWithHandoff(encodeHandoff(validHandoff));
    await screen.findByTestId('onboarding-page');

    await user.click(screen.getByTestId('onboarding-go-to-dashboard'));
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });
});
