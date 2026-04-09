/**
 * Org Members Page Tests
 * Verifies role-based visibility of management actions (add member, invite, remove).
 *
 * Backend permissions:
 *  - Add / remove members: owner only
 *  - Invitations (send, list, cancel): admin + owner
 *  - List members: any org member
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OrganizationMember } from '../../types/organization';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockUser = { id: 'user-1' };

vi.mock('../../contexts/auth-context', () => ({
  useAuth: () => ({ user: mockUser }),
}));

const mockOrg = { id: 'org-1', name: 'Test Org' };

vi.mock('../../contexts/organization-context', () => ({
  useOrganization: () => ({ currentOrganization: mockOrg }),
}));

let mockOrgPermissions: {
  members: OrganizationMember[];
  isLoading: boolean;
  canManageMembers: boolean;
  canManageInvitations: boolean;
  canManageBilling: boolean;
  myMembership: OrganizationMember | undefined;
} = {
  members: [],
  isLoading: false,
  canManageMembers: false,
  canManageInvitations: false,
  canManageBilling: false,
  myMembership: undefined,
};

vi.mock('../../hooks/use-org-permissions', () => ({
  useOrgPermissions: () => mockOrgPermissions,
}));

vi.mock('../../hooks/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));

vi.mock('../../lib/locale', () => ({
  getEmailLocale: () => 'en',
}));

// Mock organization service
const mockGetMembers = vi.fn();
const mockListInvitations = vi.fn().mockResolvedValue([]);

vi.mock('../../services/organization-service', () => ({
  organizationService: {
    getMembers: (...args: unknown[]) => mockGetMembers(...args),
    addMember: vi.fn().mockResolvedValue({}),
    removeMember: vi.fn().mockResolvedValue({}),
    listInvitations: (...args: unknown[]) => mockListInvitations(...args),
    createInvitation: vi.fn().mockResolvedValue({}),
    cancelInvitation: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../services/user-service', () => ({
  userService: {
    getAll: vi.fn().mockResolvedValue({ users: [] }),
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────

const MEMBERS: OrganizationMember[] = [
  {
    id: 'm-1',
    organization_id: 'org-1',
    user_id: 'user-1',
    role: 'owner',
    user_email: 'owner@example.com',
    user_name: 'Alice',
    created_at: '2025-06-01T00:00:00Z',
    updated_at: '2025-06-01T00:00:00Z',
  },
  {
    id: 'm-2',
    organization_id: 'org-1',
    user_id: 'user-2',
    role: 'admin',
    user_email: 'admin@example.com',
    user_name: 'Bob',
    created_at: '2025-07-15T00:00:00Z',
    updated_at: '2025-07-15T00:00:00Z',
  },
  {
    id: 'm-3',
    organization_id: 'org-1',
    user_id: 'user-3',
    role: 'member',
    user_email: 'member@example.com',
    user_name: 'Charlie',
    created_at: '2025-08-20T00:00:00Z',
    updated_at: '2025-08-20T00:00:00Z',
  },
];

/** Build a members list where the given role is assigned to user-1 (the current user). */
function membersWithCurrentUserRole(role: 'owner' | 'admin' | 'member'): OrganizationMember[] {
  return MEMBERS.map((m) => (m.user_id === 'user-1' ? { ...m, role } : m));
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

async function renderPage(role: 'owner' | 'admin' | 'member') {
  const membersList = membersWithCurrentUserRole(role);
  mockOrgPermissions = {
    members: membersList,
    isLoading: false,
    canManageMembers: role === 'owner',
    canManageInvitations: role === 'owner' || role === 'admin',
    canManageBilling: role === 'owner',
    myMembership: membersList.find((m) => m.user_id === 'user-1'),
  };

  // Lazy import so mocks are in place before the module loads
  const { default: OrgMembersPage } = await import('../../pages/organization/org-members');

  const qc = createQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <OrgMembersPage />
    </QueryClientProvider>
  );

  // Wait for members table to appear (query resolved)
  await waitFor(() => {
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('OrgMembersPage — role-based visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Owner ----

  describe('when the current user is an owner', () => {
    it('shows the Add Member button', async () => {
      await renderPage('owner');
      expect(screen.getByText('organization.addMember')).toBeInTheDocument();
    });

    it('shows the invite section', async () => {
      await renderPage('owner');
      expect(screen.getByText('organizations.invitations.title')).toBeInTheDocument();
    });

    it('shows the Actions column with delete buttons', async () => {
      await renderPage('owner');
      expect(screen.getByText('common.actions')).toBeInTheDocument();
      // Delete buttons for non-owner members (admin + member)
      const deleteButtons = screen.getAllByTitle('common.delete');
      expect(deleteButtons).toHaveLength(2);
    });

    it('renders all members in the table', async () => {
      await renderPage('owner');
      expect(screen.getByText('owner@example.com')).toBeInTheDocument();
      expect(screen.getByText('admin@example.com')).toBeInTheDocument();
      expect(screen.getByText('member@example.com')).toBeInTheDocument();
    });
  });

  // ---- Admin ----

  describe('when the current user is an admin', () => {
    it('does NOT show the Add Member button (owner-only on backend)', async () => {
      await renderPage('admin');
      expect(screen.queryByText('organization.addMember')).not.toBeInTheDocument();
    });

    it('shows the invite section (backend allows admin)', async () => {
      await renderPage('admin');
      expect(screen.getByText('organizations.invitations.title')).toBeInTheDocument();
    });

    it('does NOT show the Actions column (add/remove is owner-only)', async () => {
      await renderPage('admin');
      expect(screen.queryByText('common.actions')).not.toBeInTheDocument();
    });

    it('renders all members in the table', async () => {
      await renderPage('admin');
      expect(screen.getByText('owner@example.com')).toBeInTheDocument();
      expect(screen.getByText('admin@example.com')).toBeInTheDocument();
      expect(screen.getByText('member@example.com')).toBeInTheDocument();
    });
  });

  // ---- Member ----

  describe('when the current user is a regular member', () => {
    it('does NOT show the Add Member button', async () => {
      await renderPage('member');
      expect(screen.queryByText('organization.addMember')).not.toBeInTheDocument();
    });

    it('does NOT show the invite section', async () => {
      await renderPage('member');
      expect(screen.queryByText('organizations.invitations.title')).not.toBeInTheDocument();
    });

    it('does NOT show the Actions column or delete buttons', async () => {
      await renderPage('member');
      expect(screen.queryByText('common.actions')).not.toBeInTheDocument();
      expect(screen.queryByTitle('common.delete')).not.toBeInTheDocument();
    });

    it('does NOT fetch invitations (would 403)', async () => {
      await renderPage('member');
      expect(mockListInvitations).not.toHaveBeenCalled();
    });

    it('still renders the members table (read-only)', async () => {
      await renderPage('member');
      expect(screen.getByText('owner@example.com')).toBeInTheDocument();
      expect(screen.getByText('admin@example.com')).toBeInTheDocument();
      expect(screen.getByText('member@example.com')).toBeInTheDocument();
    });

    it('shows the team heading and description', async () => {
      await renderPage('member');
      expect(screen.getByText('organization.team')).toBeInTheDocument();
    });
  });
});
