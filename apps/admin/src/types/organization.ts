/**
 * Organization types for SaaS multi-tenant features
 */

/**
 * Organization-level subscription status (simplified, cached for quick access)
 * This is a denormalized field on the Organization model representing the current state.
 * Does NOT include transient payment processing states like 'incomplete' or 'paused'.
 */
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'canceled' | 'trial_expired';

/**
 * Full subscription billing status (includes all payment processing states)
 * Used in the Subscription model. Includes transient states that occur during payment processing.
 */
export type BillingStatus =
  | 'trial'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

export type PlanName = 'trial' | 'starter' | 'professional' | 'enterprise';
export const PLAN_NAMES: PlanName[] = ['trial', 'starter', 'professional', 'enterprise'];
export const PLAN_OPTIONS: { name: PlanName; label: string }[] = [
  { name: 'trial', label: 'Trial (Free)' },
  { name: 'starter', label: 'Starter' },
  { name: 'professional', label: 'Professional' },
  { name: 'enterprise', label: 'Enterprise' },
];

export type DataResidencyRegion = 'kz' | 'rf' | 'eu' | 'us' | 'global';
export const DATA_RESIDENCY_REGIONS: DataResidencyRegion[] = ['kz', 'rf', 'eu', 'us', 'global'];
export type OrgMemberRole = 'owner' | 'admin' | 'member';
export type ResourceType =
  | 'projects'
  | 'bug_reports'
  | 'storage_bytes'
  | 'api_calls'
  | 'screenshots'
  | 'session_replays';

export interface Organization {
  id: string;
  name: string;
  subdomain: string;
  data_residency_region: DataResidencyRegion;
  storage_region: string;
  subscription_status: SubscriptionStatus;
  trial_ends_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  billing_method?: 'card' | 'invoice';
  my_role?: 'owner' | 'admin' | 'member' | 'viewer';
  pending_owner_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationWithMemberCount extends Organization {
  member_count: number;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgMemberRole;
  user_email: string;
  user_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  organization_id: string;
  plan_name: PlanName;
  status: BillingStatus;
  payment_provider: string | null;
  external_subscription_id: string | null;
  external_customer_id: string | null;
  current_period_start: string;
  current_period_end: string;
  quotas: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ResourceQuota {
  current: number;
  limit: number;
}

export interface QuotaStatus {
  plan: PlanName;
  period: {
    start: string;
    end: string;
  };
  resources: Record<ResourceType, ResourceQuota>;
}

export interface CreateOrganizationInput {
  name: string;
  subdomain: string;
  data_residency_region?: DataResidencyRegion;
}

export interface AddMemberInput {
  user_id: string;
  role: Exclude<OrgMemberRole, 'owner'>;
}

// --- Admin onboarding types ---

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'canceled';
export type InvitationRole = 'owner' | 'admin' | 'member';

export interface AdminCreateOrganizationInput {
  name: string;
  subdomain: string;
  owner_user_id?: string;
  owner_email?: string;
  plan_name?: PlanName;
  data_residency_region?: DataResidencyRegion;
  locale?: EmailLocale;
}

export interface AdminSetPlanInput {
  plan_name: PlanName;
  status?: BillingStatus;
}

export type EmailLocale = 'en' | 'ru' | 'kk';

export interface CreateInvitationInput {
  email: string;
  role: InvitationRole;
  locale?: EmailLocale;
}

// --- Organization request types ---

export type OrgRequestStatus =
  | 'pending_verification'
  | 'verified'
  | 'approved'
  | 'rejected'
  | 'expired';

export interface OrganizationRequest {
  id: string;
  company_name: string;
  subdomain: string;
  contact_name: string;
  contact_email: string;
  phone: string | null;
  message: string | null;
  data_residency_region: DataResidencyRegion;
  status: OrgRequestStatus;
  email_verified_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  admin_notes: string | null;
  rejection_reason: string | null;
  organization_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApproveOrgRequestInput {
  plan?: PlanName;
  admin_notes?: string;
}

export interface RejectOrgRequestInput {
  rejection_reason: string;
  admin_notes?: string;
}

export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  email: string;
  role: InvitationRole;
  invited_by: string;
  token: string;
  status: InvitationStatus;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields (present on detailed queries)
  organization_name?: string;
  organization_subdomain?: string;
  inviter_email?: string;
  inviter_name?: string | null;
}
