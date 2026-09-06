/**
 * Setup guidance on the SSO config page (#439).
 *
 * The two things being locked down are the ones a tenant admin cannot recover
 * from on their own: a redirect URI that silently doesn't match, and enabling
 * "Require SSO" against a broken provider - the lockout #408 already shipped
 * to production once.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SsoSetupInstructions } from '../../components/organization/sso-setup-instructions';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// CodeSnippet pulls in sonner + clipboard; the contract under test is the
// string handed to it, so render it as a plain node exposing that. `wrap` is
// surfaced as an attribute because whether this particular value wraps is a
// deliberate decision, not styling incidental to the test.
vi.mock('../../components/ui/code-snippet', () => ({
  CodeSnippet: ({ code, testId, wrap }: { code: string; testId?: string; wrap?: boolean }) => (
    <pre data-testid={testId} data-wrap={String(Boolean(wrap))}>
      {code}
    </pre>
  ),
}));

describe('SsoSetupInstructions', () => {
  it("shows the callback path with the tenant's own organization id", () => {
    render(<SsoSetupInstructions organizationId="org_abc123" />);

    expect(screen.getByTestId('sso-callback-path')).toHaveTextContent(
      '/api/v1/auth/oidc/org_abc123/callback'
    );
  });

  it('shows a placeholder rather than a malformed path when the org has not loaded', () => {
    render(<SsoSetupInstructions organizationId={undefined} />);

    const snippet = screen.getByTestId('sso-callback-path');
    // The failure this guards against is rendering ".../undefined/callback",
    // which looks copyable and is not.
    expect(snippet).not.toHaveTextContent('undefined');
    expect(snippet).toHaveTextContent('<organization-id>');
  });

  it('shows the path only, never a guessed fully-qualified URI', () => {
    render(<SsoSetupInstructions organizationId="org_abc123" />);

    const snippet = screen.getByTestId('sso-callback-path');
    expect(snippet.textContent?.startsWith('/api/')).toBe(true);
    expect(snippet).not.toHaveTextContent('http');
  });

  it("prefers the server's redirect URI over the locally-built path", () => {
    // #438 returns the exact string the login route sends as `redirect_uri`.
    // Showing anything else risks a mismatch the tenant cannot diagnose.
    render(
      <SsoSetupInstructions
        organizationId="org_abc123"
        redirectUri="https://api.example.com/api/v1/auth/oidc/org_abc123/callback"
      />
    );

    expect(screen.getByTestId('sso-callback-path')).toHaveTextContent(
      'https://api.example.com/api/v1/auth/oidc/org_abc123/callback'
    );
    // The "append this to your API base URL" hint must not survive alongside a
    // value that already has the host, or the reader doubles it up.
    expect(screen.getByText('sso.setup.redirectUriExact')).toBeInTheDocument();
    expect(screen.queryByText('sso.setup.redirectUriHint')).not.toBeInTheDocument();
  });

  it('falls back to the path when the server reports no redirect URI', () => {
    // OIDC_REDIRECT_BASE_URL unset: SSO login cannot work yet, and inventing a
    // host here would be a guess.
    render(<SsoSetupInstructions organizationId="org_abc123" redirectUri={null} />);

    expect(screen.getByTestId('sso-callback-path')).toHaveTextContent(
      '/api/v1/auth/oidc/org_abc123/callback'
    );
    expect(screen.getByText('sso.setup.redirectUriHint')).toBeInTheDocument();
  });

  it('warns about the password-login lockout before the switch is reachable', () => {
    render(<SsoSetupInstructions organizationId="org_abc123" />);

    expect(screen.getByRole('note')).toHaveTextContent('sso.setup.lockoutWarning');
  });

  it('wraps the redirect URI rather than letting it scroll under the copy button', () => {
    // The scrolling variant slides content beneath the absolutely-positioned,
    // 90%-opaque copy button, hiding part of a value that has to be checked
    // character for character against the IdP.
    render(<SsoSetupInstructions organizationId="org_abc123" />);

    expect(screen.getByTestId('sso-callback-path')).toHaveAttribute('data-wrap', 'true');
  });

  it('starts expanded when the org has no SSO config yet', () => {
    render(<SsoSetupInstructions organizationId="org_abc123" isConfigured={false} />);

    // jsdom reflects <details open> on the element itself.
    expect(screen.getByRole('group')).toHaveAttribute('open');
  });

  it('starts collapsed once a config exists, but still shows the redirect URI', () => {
    // Returning to change one field should not mean scrolling past six steps;
    // the URI is the thing people come back for, so it stays outside the
    // collapsible region.
    render(<SsoSetupInstructions organizationId="org_abc123" isConfigured />);

    expect(screen.getByRole('group')).not.toHaveAttribute('open');
    expect(screen.getByTestId('sso-callback-path')).toBeInTheDocument();
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('renders every setup step', () => {
    render(<SsoSetupInstructions organizationId="org_abc123" />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items[1]).toHaveTextContent('sso.setup.steps.registerRedirect');
    // Enforcing SSO is deliberately last - it must follow the verify step.
    expect(items[items.length - 1]).toHaveTextContent('sso.setup.steps.enforce');
  });
});
