/**
 * Organization Service
 * API client for organization CRUD, membership, quotas, and subscriptions.
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type {
  Organization,
  OrganizationWithMemberCount,
  OrganizationMember,
  Subscription,
  QuotaStatus,
  CreateOrganizationInput,
  AddMemberInput,
  AdminCreateOrganizationInput,
  AdminSetPlanInput,
  CreateInvitationInput,
  OrganizationInvitation,
  SubscriptionStatus,
  DataResidencyRegion,
} from '../types/organization';
import type { PaginationMeta } from '../types';

export interface OrganizationProject {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface PlanConfig {
  name: string;
  prices: Record<string, number>;
  quotas: Record<string, number>;
}

interface ListOrganizationsParams {
  page?: number;
  limit?: number;
  search?: string;
  subscription_status?: SubscriptionStatus;
  data_residency_region?: DataResidencyRegion;
  include_deleted?: boolean;
}

interface ListOrganizationsResponse {
  data: OrganizationWithMemberCount[];
  pagination: PaginationMeta;
}

export const organizationService = {
  /** List all organizations (admin only) */
  list: async (params: ListOrganizationsParams = {}): Promise<ListOrganizationsResponse> => {
    const response = await api.get<{
      success: boolean;
      data: OrganizationWithMemberCount[];
      pagination: PaginationMeta;
    }>(API_ENDPOINTS.organizations.list(), { params });
    return { data: response.data.data, pagination: response.data.pagination };
  },

  /** List organizations the current user belongs to */
  mine: async (): Promise<Organization[]> => {
    const response = await api.get<{ success: boolean; data: Organization[] }>(
      API_ENDPOINTS.organizations.me()
    );
    return response.data.data;
  },

  /** Get organization by ID */
  getById: async (id: string): Promise<Organization> => {
    const response = await api.get<{ success: boolean; data: Organization }>(
      API_ENDPOINTS.organizations.get(id)
    );
    return response.data.data;
  },

  /** Create a new organization */
  create: async (input: CreateOrganizationInput): Promise<Organization> => {
    const response = await api.post<{ success: boolean; data: Organization }>(
      API_ENDPOINTS.organizations.create(),
      input
    );
    return response.data.data;
  },

  /** Update organization */
  update: async (id: string, updates: { name?: string }): Promise<Organization> => {
    const response = await api.patch<{ success: boolean; data: Organization }>(
      API_ENDPOINTS.organizations.update(id),
      updates
    );
    return response.data.data;
  },

  /** Get quota status */
  getQuota: async (id: string): Promise<QuotaStatus> => {
    const response = await api.get<{ success: boolean; data: QuotaStatus }>(
      API_ENDPOINTS.organizations.quota(id)
    );
    return response.data.data;
  },

  /** Get subscription details */
  getSubscription: async (id: string): Promise<Subscription> => {
    const response = await api.get<{ success: boolean; data: Subscription }>(
      API_ENDPOINTS.organizations.subscription(id)
    );
    return response.data.data;
  },

  /** List organization members */
  getMembers: async (id: string): Promise<OrganizationMember[]> => {
    const response = await api.get<{ success: boolean; data: OrganizationMember[] }>(
      API_ENDPOINTS.organizations.members(id)
    );
    return response.data.data;
  },

  /** Add a member to the organization */
  addMember: async (id: string, input: AddMemberInput): Promise<OrganizationMember> => {
    const response = await api.post<{ success: boolean; data: OrganizationMember }>(
      API_ENDPOINTS.organizations.members(id),
      input
    );
    return response.data.data;
  },

  /** Remove a member from the organization */
  removeMember: async (orgId: string, userId: string): Promise<void> => {
    await api.delete(API_ENDPOINTS.organizations.removeMember(orgId, userId));
  },

  /** Fetch available plans with prices and quotas */
  getPlans: async (): Promise<PlanConfig[]> => {
    const response = await api.get<{ success: boolean; data: { plans: PlanConfig[] } }>(
      API_ENDPOINTS.billing.plans()
    );
    return response.data.data.plans;
  },

  /** Create a checkout session for plan upgrade */
  createCheckout: async (
    planName: string,
    returnUrl: string
  ): Promise<{ redirect_url: string }> => {
    const response = await api.post<{ success: boolean; data: { redirect_url: string } }>(
      API_ENDPOINTS.billing.checkout(),
      { plan_name: planName, return_url: returnUrl }
    );
    return response.data.data;
  },

  /** Cancel the current subscription */
  cancelSubscription: async (): Promise<void> => {
    await api.post(API_ENDPOINTS.billing.cancel());
  },

  // --- Admin onboarding ---

  /** Admin: Create organization with owner and plan */
  adminCreate: async (input: AdminCreateOrganizationInput): Promise<Organization> => {
    const response = await api.post<{ success: boolean; data: Organization }>(
      API_ENDPOINTS.adminOrganizations.create(),
      input
    );
    return response.data.data;
  },

  // --- Platform-admin retention window ---

  /**
   * List orgs that are soft-deleted AND have aged past `ORG_RETENTION_DAYS`.
   * These are the candidates the "pending hard-delete" tab shows.
   */
  listPendingHardDelete: async (): Promise<{
    retention_days: number;
    orgs: Array<{
      id: string;
      name: string;
      subdomain: string;
      deleted_at: string;
      deleted_by: string | null;
      project_count: number;
      bug_report_count: number;
      days_since_deleted: number;
    }>;
  }> => {
    const response = await api.get<{
      success: boolean;
      data: {
        retention_days: number;
        orgs: Array<{
          id: string;
          name: string;
          subdomain: string;
          deleted_at: string;
          deleted_by: string | null;
          project_count: number;
          bug_report_count: number;
          days_since_deleted: number;
        }>;
      };
    }>(API_ENDPOINTS.adminOrganizations.pendingHardDelete());
    return response.data.data;
  },

  /**
   * Permanently delete a soft-deleted org. `confirmSubdomain` must match
   * the org's actual subdomain (GitHub-style typed confirmation) or the
   * server 400s before touching any data.
   */
  adminHardDelete: async (
    orgId: string,
    confirmSubdomain: string
  ): Promise<{ id: string; subdomain: string; name: string }> => {
    const response = await api.post<{
      success: boolean;
      data: { id: string; subdomain: string; name: string };
    }>(API_ENDPOINTS.adminOrganizations.hardDelete(orgId), {
      confirm_subdomain: confirmSubdomain,
    });
    return response.data.data;
  },

  /** Admin: Set or change an organization's plan */
  adminSetPlan: async (orgId: string, input: AdminSetPlanInput): Promise<Subscription> => {
    const response = await api.patch<{ success: boolean; data: Subscription }>(
      API_ENDPOINTS.adminOrganizations.setPlan(orgId),
      input
    );
    return response.data.data;
  },

  /** Admin: Set billing method for an organization */
  adminSetBillingMethod: async (
    orgId: string,
    billingMethod: 'card' | 'invoice'
  ): Promise<void> => {
    await api.patch(API_ENDPOINTS.adminOrganizations.setBillingMethod(orgId), {
      billing_method: billingMethod,
    });
  },

  /** List pending invitations for an organization */
  listInvitations: async (orgId: string, asAdmin = false): Promise<OrganizationInvitation[]> => {
    const url = asAdmin
      ? API_ENDPOINTS.adminOrganizations.listInvitations(orgId)
      : API_ENDPOINTS.organizations.invitations(orgId);
    const response = await api.get<{ success: boolean; data: OrganizationInvitation[] }>(url);
    return response.data.data;
  },

  /** Create an invitation (org admin or platform admin) */
  createInvitation: async (
    orgId: string,
    input: CreateInvitationInput,
    asAdmin = false
  ): Promise<{ invitation: OrganizationInvitation; email_sent: boolean }> => {
    const url = asAdmin
      ? API_ENDPOINTS.adminOrganizations.invite(orgId)
      : API_ENDPOINTS.organizations.invitations(orgId);
    const response = await api.post<{
      success: boolean;
      data: { invitation: OrganizationInvitation; email_sent: boolean };
    }>(url, input);
    return response.data.data;
  },

  /** Cancel a pending invitation */
  cancelInvitation: async (orgId: string, invitationId: string, asAdmin = false): Promise<void> => {
    const url = asAdmin
      ? API_ENDPOINTS.adminOrganizations.cancelInvitation(orgId, invitationId)
      : API_ENDPOINTS.organizations.cancelInvitation(orgId, invitationId);
    await api.delete(url);
  },

  /** Admin: List projects belonging to an organization */
  adminListProjects: async (orgId: string): Promise<OrganizationProject[]> => {
    const response = await api.get<{
      success: boolean;
      data: OrganizationProject[];
    }>(API_ENDPOINTS.adminOrganizations.projects(orgId));
    return response.data.data;
  },

  // --- Admin deletion & restore ---

  /** Admin: Get deletion precheck info */
  adminDeletionPrecheck: async (
    orgId: string
  ): Promise<{
    canHardDelete: boolean;
    hasProjects: boolean;
    projectCount: number;
    hasActiveSubscription: boolean;
  }> => {
    const response = await api.get<{
      success: boolean;
      data: {
        canHardDelete: boolean;
        hasProjects: boolean;
        projectCount: number;
        hasActiveSubscription: boolean;
      };
    }>(API_ENDPOINTS.adminOrganizations.deletionPrecheck(orgId));
    return response.data.data;
  },

  /** Admin: Delete an organization (soft or hard) */
  adminDelete: async (orgId: string, permanent = false): Promise<{ mode: 'soft' | 'hard' }> => {
    const response = await api.delete<{
      success: boolean;
      data: { mode: 'soft' | 'hard' };
    }>(API_ENDPOINTS.adminOrganizations.delete(orgId), {
      params: permanent ? { permanent: true } : undefined,
    });
    return response.data.data;
  },

  /** Admin: Check if magic login is enabled for an organization */
  getMagicLoginStatus: async (orgId: string): Promise<{ allowed: boolean }> => {
    const response = await api.get<{ success: boolean; data: { allowed: boolean } }>(
      API_ENDPOINTS.adminOrganizations.magicLoginStatus(orgId)
    );
    return response.data.data;
  },

  /** Admin: Enable or disable magic login for an organization */
  setMagicLoginStatus: async (orgId: string, enabled: boolean): Promise<{ allowed: boolean }> => {
    const response = await api.patch<{ success: boolean; data: { allowed: boolean } }>(
      API_ENDPOINTS.adminOrganizations.setMagicLoginStatus(orgId),
      { enabled }
    );
    return response.data.data;
  },

  /** Admin: Generate a magic login token for a user in an organization */
  generateMagicToken: async (
    orgId: string,
    userId: string,
    expiresIn: string = '30d'
  ): Promise<{ token: string; expires_in: string }> => {
    const response = await api.post<{
      success: boolean;
      data: { token: string; expires_in: string };
    }>(API_ENDPOINTS.adminOrganizations.generateMagicToken(orgId), {
      user_id: userId,
      expires_in: expiresIn,
    });
    return response.data.data;
  },

  /** Admin: Restore a soft-deleted organization */
  adminRestore: async (orgId: string): Promise<Organization> => {
    const response = await api.post<{ success: boolean; data: Organization }>(
      API_ENDPOINTS.adminOrganizations.restore(orgId)
    );
    return response.data.data;
  },
};
