/**
 * Sidebar visibility of the SSO config entry (#432).
 *
 * `ORG_NAV_ITEMS` filtered on `saasOnly` alone until this entry landed, so
 * every org page was offered to every member. `OrgSsoPage` is the first that
 * fails closed and renders nothing for a member, which makes an unfiltered
 * link a dead end. These tests drive the real `ORG_NAV_ITEMS` map in
 * `DashboardLayout` rather than asserting on the array, so a regression in the
 * filter - not just in the data - is what fails them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardLayout from '../../components/dashboard-layout';
import { usePermissions } from '../../hooks/use-permissions';

vi.mock('../../hooks/use-permissions', () => ({
  usePermissions: vi.fn(),
}));

vi.mock('../../contexts/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'member@example.com' }, logout: vi.fn() }),
}));

vi.mock('../../contexts/organization-context', () => ({
  useOrganization: () => ({ hasOrganization: true }),
}));

vi.mock('../../contexts/deployment-context', () => ({
  useIsSaaS: () => true,
}));

vi.mock('../../hooks/use-org-filter', () => ({
  useOrgFilter: () => ({ selectedOrgId: null, setSelectedOrgId: vi.fn() }),
}));

// Chrome around the nav that pulls in its own queries/contexts. None of it
// participates in the filter under test.
vi.mock('../../components/admin-org-filter', () => ({
  AdminOrgFilter: () => null,
}));
vi.mock('../../components/onboarding/quick-setup-actions', () => ({
  QuickSetupActions: () => null,
}));
vi.mock('../../components/language-switcher', () => ({
  LanguageSwitcher: () => null,
}));

// `isPlatformAdmin` reads the JWT; the nav entry deliberately uses
// `usePermissions().isSystemAdmin` instead, so pin this false throughout to
// prove the entry is driven by the permissions query and not the token.
vi.mock('../../types', async () => {
  const actual = await vi.importActual<typeof import('../../types')>('../../types');
  return { ...actual, isPlatformAdmin: () => false };
});

const ssoLink = () => screen.queryByRole('link', { name: /sso/i });

const renderLayout = () =>
  render(
    <MemoryRouter>
      <DashboardLayout />
    </MemoryRouter>
  );

describe('DashboardLayout - SSO nav entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['admin', 'owner'])('shows the SSO link to an org %s', (orgRole) => {
    vi.mocked(usePermissions).mockReturnValue({
      isSystemAdmin: false,
      orgRole,
      isLoading: false,
    } as ReturnType<typeof usePermissions>);

    renderLayout();

    expect(ssoLink()).toHaveAttribute('href', '/my-organization/sso');
  });

  it('shows the SSO link to a platform admin with no org role', () => {
    vi.mocked(usePermissions).mockReturnValue({
      isSystemAdmin: true,
      orgRole: null,
      isLoading: false,
    } as ReturnType<typeof usePermissions>);

    renderLayout();

    expect(ssoLink()).toHaveAttribute('href', '/my-organization/sso');
  });

  it('hides the SSO link from a plain org member', () => {
    vi.mocked(usePermissions).mockReturnValue({
      isSystemAdmin: false,
      orgRole: 'member',
      isLoading: false,
    } as ReturnType<typeof usePermissions>);

    renderLayout();

    // The rest of the org section still renders - this asserts the SSO entry
    // is filtered out, not that the whole nav failed to mount.
    expect(screen.getByRole('link', { name: /team/i })).toBeInTheDocument();
    expect(ssoLink()).not.toBeInTheDocument();
  });

  it('hides the SSO link while permissions are still loading', () => {
    vi.mocked(usePermissions).mockReturnValue({
      isSystemAdmin: false,
      orgRole: null,
      isLoading: true,
    } as ReturnType<typeof usePermissions>);

    renderLayout();

    expect(ssoLink()).not.toBeInTheDocument();
  });
});
