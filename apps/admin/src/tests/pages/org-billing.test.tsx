/**
 * Org Billing Page Tests
 * Verifies role-based visibility of billing management actions (cancel subscription, upgrade).
 *
 * Backend permissions:
 *  - Checkout / cancel subscription: owner only
 *  - View plans + subscription: any org member
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OrganizationMember } from '../../types/organization';
import type { PlanConfig } from '../../services/organization-service';

// ── Mocks ──────────────────────────────────────────────────────────────

// react-i18next is mocked globally in setup.ts

let mockCanManageBilling = false;

vi.mock('../../hooks/use-org-permissions', () => ({
  useOrgPermissions: () => ({
    members: [],
    isLoading: false,
    canManageMembers: false,
    canManageInvitations: false,
    canManageBilling: mockCanManageBilling,
    myMembership: undefined,
  }),
}));

const mockUser = { id: 'user-1' };

vi.mock('../../contexts/auth-context', () => ({
  useAuth: () => ({ user: mockUser }),
}));

const mockOrg = { id: 'org-1', name: 'Test Org' };

vi.mock('../../contexts/organization-context', () => ({
  useOrganization: () => ({ currentOrganization: mockOrg }),
}));

// ── Service mocks ──────────────────────────────────────────────────────

const mockGetMembers = vi.fn();
const mockGetPlans = vi.fn();
const mockGetSubscription = vi.fn();

vi.mock('../../services/organization-service', () => ({
  organizationService: {
    getMembers: (...args: unknown[]) => mockGetMembers(...args),
    getPlans: (...args: unknown[]) => mockGetPlans(...args),
    getSubscription: (...args: unknown[]) => mockGetSubscription(...args),
    createCheckout: vi.fn().mockResolvedValue({ redirect_url: 'https://example.com/checkout' }),
    cancelSubscription: vi.fn().mockResolvedValue({}),
  },
}));

// ── Test data ──────────────────────────────────────────────────────────

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

const PLANS: PlanConfig[] = [
  {
    name: 'starter',
    prices: { monthly: 10 },
    quotas: { projects: 5, bug_reports: 100, storage_bytes: 1073741824, api_calls: 1000 },
  },
  {
    name: 'professional',
    prices: { monthly: 30 },
    quotas: { projects: 20, bug_reports: 500, storage_bytes: 5368709120, api_calls: 5000 },
  },
  {
    name: 'enterprise',
    prices: { monthly: 100 },
    quotas: { projects: 100, bug_reports: 5000, storage_bytes: 53687091200, api_calls: 50000 },
  },
];

const ACTIVE_SUBSCRIPTION = {
  plan_name: 'starter',
  status: 'active' as const,
  payment_provider: 'stripe',
};

// ── Helpers ────────────────────────────────────────────────────────────

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
  mockCanManageBilling = role === 'owner';
  mockGetMembers.mockResolvedValue(membersWithCurrentUserRole(role));
  mockGetPlans.mockResolvedValue(PLANS);
  mockGetSubscription.mockResolvedValue(ACTIVE_SUBSCRIPTION);

  const { default: OrgBillingPage } = await import('../../pages/organization/org-billing');

  const qc = createQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <OrgBillingPage />
    </QueryClientProvider>
  );

  // Wait for plan cards to render (queries resolved)
  // 'starter' appears twice: once in the current-plan header and once as a plan card title
  await waitFor(() => {
    expect(screen.getByText('professional')).toBeInTheDocument();
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('OrgBillingPage — role-based visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Owner ----

  describe('when the current user is an owner', () => {
    it('shows the Cancel Subscription button', async () => {
      await renderPage('owner');
      expect(screen.getByText('Cancel Subscription')).toBeInTheDocument();
    });

    it('shows Upgrade buttons on non-current plans', async () => {
      await renderPage('owner');
      // starter is the current plan, so professional and enterprise should have Upgrade
      const upgradeButtons = screen.getAllByText('Upgrade');
      expect(upgradeButtons).toHaveLength(2);
    });

    it('shows the current plan label on the active plan card', async () => {
      await renderPage('owner');
      // "Current Plan" appears as both heading and label on active card
      expect(screen.getAllByText('Current Plan').length).toBeGreaterThanOrEqual(1);
    });

    it('renders all plan cards', async () => {
      await renderPage('owner');
      // 'starter' appears twice: current plan header + plan card
      expect(screen.getAllByText('starter')).toHaveLength(2);
      expect(screen.getByText('professional')).toBeInTheDocument();
      expect(screen.getByText('enterprise')).toBeInTheDocument();
    });
  });

  // ---- Admin ----

  describe('when the current user is an admin', () => {
    it('does NOT show the Cancel Subscription button (owner-only on backend)', async () => {
      await renderPage('admin');
      expect(screen.queryByText('Cancel Subscription')).not.toBeInTheDocument();
    });

    it('does NOT show Upgrade buttons (owner-only on backend)', async () => {
      await renderPage('admin');
      expect(screen.queryByText('Upgrade')).not.toBeInTheDocument();
    });

    it('renders all plan cards (read-only)', async () => {
      await renderPage('admin');
      expect(screen.getAllByText('starter')).toHaveLength(2);
      expect(screen.getByText('professional')).toBeInTheDocument();
      expect(screen.getByText('enterprise')).toBeInTheDocument();
    });
  });

  // ---- Member ----

  describe('when the current user is a regular member', () => {
    it('does NOT show the Cancel Subscription button', async () => {
      await renderPage('member');
      expect(screen.queryByText('Cancel Subscription')).not.toBeInTheDocument();
    });

    it('does NOT show any Upgrade buttons', async () => {
      await renderPage('member');
      expect(screen.queryByText('Upgrade')).not.toBeInTheDocument();
    });

    it('still shows the current plan label on the active plan card', async () => {
      await renderPage('member');
      expect(screen.getAllByText('Current Plan').length).toBeGreaterThanOrEqual(1);
    });

    it('renders all plan cards (read-only)', async () => {
      await renderPage('member');
      expect(screen.getAllByText('starter')).toHaveLength(2);
      expect(screen.getByText('professional')).toBeInTheDocument();
      expect(screen.getByText('enterprise')).toBeInTheDocument();
    });

    it('shows billing title and subtitle', async () => {
      await renderPage('member');
      expect(screen.getByText('Billing')).toBeInTheDocument();
      expect(screen.getByText('Manage your subscription and plan')).toBeInTheDocument();
    });

    it('shows the current plan name and status badge', async () => {
      await renderPage('member');
      expect(screen.getAllByText('Current Plan').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('active')).toBeInTheDocument();
    });
  });
});
