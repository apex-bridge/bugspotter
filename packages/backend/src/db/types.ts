/**
 * Database types for PostgreSQL schema
 */

import { BugStatus, BugPriority } from '@bugspotter/types';
import type {
  ApiKeyType,
  ApiKeyStatus,
  PermissionScope,
  RateLimitWindow,
  ApiKeyAuditAction,
} from '@bugspotter/types';
import type { Session } from '../services/session-service.js';

/**
 * Upload status values for both screenshot and replay uploads
 * Matches database CHECK constraints in migration 001_initial_schema.sql
 */
export const UPLOAD_STATUS = {
  NONE: 'none',
  PENDING: 'pending',
  UPLOADING: 'uploading',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type UploadStatus = (typeof UPLOAD_STATUS)[keyof typeof UPLOAD_STATUS];

// Alias for backward compatibility
export const REPLAY_UPLOAD_STATUS = UPLOAD_STATUS;
export type ReplayUploadStatus = UploadStatus;

export interface Project {
  id: string;
  name: string;
  settings: Record<string, unknown>;
  created_by: string | null;
  organization_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  created_at: Date;
}

export interface UserPreferences {
  language?: 'en' | 'ru' | 'kk';
  theme?: 'light' | 'dark' | 'system';
  [key: string]: unknown; // Allow additional custom preferences
}

export interface UserSecurity {
  is_platform_admin?: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  password_hash: string | null;
  role: 'admin' | 'user' | 'viewer'; // Deprecated — use security.is_platform_admin instead
  security: UserSecurity;
  oauth_provider: string | null;
  oauth_id: string | null;
  preferences: UserPreferences;
  created_at: Date;
}

export interface BugReport {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  screenshot_url: string | null;
  replay_url: string | null;
  metadata: Record<string, unknown>;
  status: BugStatus;
  priority: BugPriority;
  deleted_at: Date | null;
  deleted_by: string | null;
  legal_hold: boolean;
  organization_id: string | null;
  duplicate_of: string | null;
  created_at: Date;
  updated_at: Date;
  // Presigned URL columns
  screenshot_key: string | null;
  thumbnail_key: string | null;
  replay_key: string | null;
  upload_status: UploadStatus;
  replay_upload_status: ReplayUploadStatus;
}

/**
 * Ticket status values
 */
export const TICKET_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
  REOPENED: 'reopened',
} as const;

export type TicketStatus = (typeof TICKET_STATUS)[keyof typeof TICKET_STATUS];

/**
 * Result of an attachment upload attempt for auto-created tickets
 */
export interface AttachmentResult {
  type: 'screenshot' | 'consoleLogs' | 'networkLogs' | 'replay';
  success: boolean;
  filename?: string;
  error?: string;
  size?: number;
}

export const TICKET_SYNC_STATUS = {
  PENDING: 'pending',
  SYNCED: 'synced',
  FAILED: 'failed',
} as const;

export type TicketSyncStatus = (typeof TICKET_SYNC_STATUS)[keyof typeof TICKET_SYNC_STATUS];

export interface Ticket {
  id: string;
  bug_report_id: string;
  external_id: string;
  platform: string;
  status: TicketStatus | null;
  created_at: Date;
  // Auto-ticket creation fields
  integration_id: string | null;
  rule_id: string | null;
  created_automatically: boolean;
  external_url: string | null;
  sync_status: TicketSyncStatus;
  last_sync_error: string | null;
  attachment_results: AttachmentResult[] | null;
}

/**
 * Share Token for public replay access
 * Enables time-limited, optionally password-protected sharing of session replays
 */
export interface ShareToken {
  id: string;
  bug_report_id: string;
  token: string;
  expires_at: Date;
  password_hash: string | null;
  view_count: number;
  created_by: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

export type ShareTokenInsert = Omit<
  ShareToken,
  'id' | 'created_at' | 'view_count' | 'deleted_at'
> & {
  id?: string;
  created_at?: Date;
  view_count?: number;
};

export type ShareTokenUpdate = Partial<
  Omit<ShareToken, 'id' | 'token' | 'bug_report_id' | 'created_at' | 'created_by'>
>;

export interface AuditLog {
  id: string;
  timestamp: Date;
  user_id: string | null;
  organization_id: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  details: Record<string, unknown> | null;
  success: boolean;
  error_message: string | null;
}

export type AuditLogInsert = {
  id?: string;
  user_id?: string | null;
  organization_id?: string | null;
  action: string;
  resource: string;
  resource_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  details?: Record<string, unknown> | null;
  success?: boolean;
  error_message?: string | null;
};

export interface Permission {
  id: string;
  role: string;
  resource: string;
  action: string;
  created_at: Date;
}

export interface ArchivedBugReport {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  screenshot_url: string | null;
  replay_url: string | null;
  metadata: Record<string, unknown>;
  status: BugStatus;
  priority: BugPriority;
  original_created_at: Date;
  original_updated_at: Date;
  deleted_at: Date;
  deleted_by: string | null;
  archived_at: Date;
  archived_reason: string | null;
}

export interface MigrationHistory {
  id: number;
  migration_name: string;
  applied_at: Date;
}

// Insert/Update types (without auto-generated fields)
export type ProjectInsert = {
  id?: string;
  name: string;
  settings?: Record<string, unknown>;
  created_by?: string | null;
  organization_id?: string | null;
};

export type ProjectUpdate = Partial<Omit<Project, 'id' | 'created_at' | 'updated_at'>>;

export type ProjectMemberInsert = {
  id?: string;
  project_id: string;
  user_id: string;
  role?: 'owner' | 'admin' | 'member' | 'viewer';
};

export type BugReportInsert = {
  project_id: string;
  title: string;
  id?: string;
  description?: string | null;
  screenshot_url?: string | null;
  replay_url?: string | null;
  metadata?: Record<string, unknown>;
  status?: BugStatus;
  priority?: BugPriority;
  deleted_at?: Date | null;
  deleted_by?: string | null;
  legal_hold?: boolean;
  // Presigned URL columns
  screenshot_key?: string | null;
  thumbnail_key?: string | null;
  replay_key?: string | null;
  upload_status?: UploadStatus;
  replay_upload_status?: ReplayUploadStatus;
  organization_id?: string | null;
  duplicate_of?: string | null;
};

export type BugReportUpdate = Partial<
  Omit<BugReport, 'id' | 'project_id' | 'created_at' | 'updated_at'>
>;

export type UserInsert = {
  id?: string;
  email: string;
  name?: string | null;
  password_hash?: string | null;
  role?: 'admin' | 'user' | 'viewer';
  oauth_provider?: string | null;
  oauth_id?: string | null;
};

// Query result types with relationships
export interface BugReportWithProject extends BugReport {
  project: Project;
}

export interface BugReportWithSessions extends BugReport {
  sessions: Session[];
}

export interface BugReportWithTickets extends BugReport {
  tickets: Ticket[];
}

// ============================================================================
// API KEY MANAGEMENT TYPES
// ============================================================================

// Re-export shared types from @bugspotter/types
export {
  API_KEY_TYPE,
  API_KEY_STATUS,
  PERMISSION_SCOPE,
  RATE_LIMIT_WINDOW,
  API_KEY_AUDIT_ACTION,
  type ApiKeyType,
  type ApiKeyStatus,
  type PermissionScope,
  type RateLimitWindow,
  type ApiKeyAuditAction,
} from '@bugspotter/types';

/**
 * API Key entity
 */
export interface ApiKey {
  id: string;
  key_hash: string;
  key_prefix: string;
  key_suffix: string;
  name: string;
  description: string | null;
  type: ApiKeyType;
  status: ApiKeyStatus;

  // Permissions
  permission_scope: PermissionScope;
  permissions: string[];
  allowed_projects: string[] | null;
  allowed_environments: string[] | null;

  // Rate Limiting
  rate_limit_per_minute: number;
  rate_limit_per_hour: number;
  rate_limit_per_day: number;
  burst_limit: number;
  per_endpoint_limits: Record<string, number> | null;

  // Security
  ip_whitelist: string[] | null;
  allowed_origins: string[] | null;
  user_agent_pattern: string | null;

  // Lifecycle
  expires_at: Date | null;
  rotate_at: Date | null;
  grace_period_days: number;
  rotated_from: string | null;

  // Audit
  created_by: string | null;
  team_id: string | null;
  tags: string[] | null;

  // Timestamps
  created_at: Date;
  updated_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

/**
 * API Key usage tracking
 */
export interface ApiKeyUsage {
  id: string;
  api_key_id: string;
  endpoint: string;
  method: string;
  status_code: number | null;
  response_time_ms: number | null;
  ip_address: string | null;
  user_agent: string | null;
  error_message: string | null;
  error_type: string | null;
  timestamp: Date;
}

/**
 * Rate limit tracking
 */
export interface ApiKeyRateLimit {
  api_key_id: string;
  window_type: RateLimitWindow;
  window_start: Date;
  request_count: number;
}

/**
 * API Key audit log
 */
export interface ApiKeyAuditLog {
  id: string;
  api_key_id: string | null;
  action: ApiKeyAuditAction;
  performed_by: string | null;
  ip_address: string | null;
  changes: Record<string, unknown> | null;
  timestamp: Date;
}

// Insert types (without auto-generated fields)
export type ApiKeyInsert = {
  id?: string;
  key_hash: string;
  key_prefix: string;
  key_suffix: string;
  name: string;
  description?: string | null;
  type?: ApiKeyType;
  status?: ApiKeyStatus;
  permission_scope?: PermissionScope;
  permissions?: string[];
  allowed_projects?: string[] | null;
  allowed_environments?: string[] | null;
  rate_limit_per_minute?: number;
  rate_limit_per_hour?: number;
  rate_limit_per_day?: number;
  burst_limit?: number;
  per_endpoint_limits?: Record<string, number> | null;
  ip_whitelist?: string[] | null;
  allowed_origins?: string[] | null;
  user_agent_pattern?: string | null;
  expires_at?: Date | null;
  rotate_at?: Date | null;
  grace_period_days?: number;
  rotated_from?: string | null;
  created_by?: string | null;
  team_id?: string | null;
  tags?: string[] | null;
};

export type ApiKeyUpdate = Partial<
  Omit<ApiKey, 'id' | 'key_hash' | 'created_at' | 'updated_at' | 'created_by'>
>;

export type ApiKeyUsageInsert = {
  id?: string;
  api_key_id: string;
  endpoint: string;
  method: string;
  status_code?: number | null;
  response_time_ms?: number | null;
  ip_address?: string | null;
  user_agent?: string | null;
  error_message?: string | null;
  error_type?: string | null;
  timestamp?: Date;
};

export type ApiKeyAuditLogInsert = {
  id?: string;
  api_key_id?: string | null;
  action: ApiKeyAuditAction;
  performed_by?: string | null;
  ip_address?: string | null;
  changes?: Record<string, unknown> | null;
  timestamp?: Date;
};

// Query types
export interface ApiKeyWithUsageStats extends ApiKey {
  usage_stats: {
    total_requests: number;
    requests_today: number;
    requests_this_month: number;
    last_request_at: Date | null;
    unique_ips: number;
    client_error_rate: number; // 4xx errors (client mistakes)
    server_error_rate: number; // 5xx errors (server failures)
  };
}

export interface ApiKeyFilters {
  status?: ApiKeyStatus;
  type?: ApiKeyType;
  team_id?: string;
  created_by?: string;
  /** Show keys created by this user OR scoped to projects in their org */
  accessible_by_user_id?: string;
  tag?: string;
  expires_before?: Date;
  expires_after?: Date;
  search?: string; // Search by name or description
}

// API Key sort fields (single source of truth)
export const API_KEY_SORT_FIELDS = [
  'created_at',
  'updated_at',
  'last_used_at',
  'name',
  'expires_at',
] as const;

export interface ApiKeySortOptions {
  sort_by?: (typeof API_KEY_SORT_FIELDS)[number];
  order?: 'asc' | 'desc';
}

// ============================================================================
// PAGINATION & FILTER TYPES
// ============================================================================

export interface PaginationOptions {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Filter types
export interface BugReportFilters {
  project_id?: string;
  project_ids?: string[]; // For filtering by multiple projects (user access control)
  user_id?: string; // For filtering by user's accessible projects (via JOIN to project_members)
  organization_id?: string; // For org-scoped filtering in SaaS mode
  status?: BugStatus;
  priority?: BugPriority;
  created_after?: Date;
  created_before?: Date;
}

export interface BugReportSortOptions {
  sort_by?: 'created_at' | 'updated_at' | 'priority';
  order?: 'asc' | 'desc';
}

// ============================================================================
// SAAS MULTI-TENANT TYPES
// ============================================================================

/**
 * Organization subscription status values
 * Matches database CHECK constraint on saas.organizations
 */
export const SUBSCRIPTION_STATUS = {
  TRIAL: 'trial',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  TRIAL_EXPIRED: 'trial_expired',
} as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

/**
 * Organization member role values
 * Matches database CHECK constraint on saas.organization_members
 */
export const ORG_MEMBER_ROLE = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
} as const;

export type OrgMemberRole = (typeof ORG_MEMBER_ROLE)[keyof typeof ORG_MEMBER_ROLE];

/**
 * Role hierarchy levels for access control comparisons.
 * Higher number = more privilege. Used by org-access middleware and analytics auth.
 */
export const ROLE_LEVEL: Record<OrgMemberRole, number> = {
  [ORG_MEMBER_ROLE.OWNER]: 3,
  [ORG_MEMBER_ROLE.ADMIN]: 2,
  [ORG_MEMBER_ROLE.MEMBER]: 1,
};

/**
 * Subscription plan names
 * Matches database CHECK constraint on saas.subscriptions
 */
export const PLAN_NAME = {
  TRIAL: 'trial',
  STARTER: 'starter',
  PROFESSIONAL: 'professional',
  ENTERPRISE: 'enterprise',
} as const;

export type PlanName = (typeof PLAN_NAME)[keyof typeof PLAN_NAME];

/**
 * Subscription billing status values
 * Matches database CHECK constraint on saas.subscriptions
 */
export const BILLING_STATUS = {
  TRIAL: 'trial',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  INCOMPLETE: 'incomplete',
  INCOMPLETE_EXPIRED: 'incomplete_expired',
  PAUSED: 'paused',
} as const;

export type BillingStatus = (typeof BILLING_STATUS)[keyof typeof BILLING_STATUS];

/**
 * Payment provider identifiers
 * Validated at the application level (no DB constraint).
 */
export const PAYMENT_PROVIDER = {
  STRIPE: 'stripe',
  YOOKASSA: 'yookassa',
  KASPI: 'kaspi',
  INVOICE: 'invoice',
} as const;

/**
 * Billing method — how an organization pays.
 * Matches database CHECK constraint on saas.organizations.billing_method
 */
export const BILLING_METHOD = {
  INVOICE: 'invoice',
  CARD: 'card',
} as const;

export type BillingMethod = (typeof BILLING_METHOD)[keyof typeof BILLING_METHOD];

export type PaymentProviderName = (typeof PAYMENT_PROVIDER)[keyof typeof PAYMENT_PROVIDER];

/**
 * Usage record resource types
 * Matches database CHECK constraint on saas.usage_records
 */
export const RESOURCE_TYPE = {
  PROJECTS: 'projects',
  BUG_REPORTS: 'bug_reports',
  STORAGE_BYTES: 'storage_bytes',
  API_CALLS: 'api_calls',
  SCREENSHOTS: 'screenshots',
  SESSION_REPLAYS: 'session_replays',
} as const;

export type ResourceType = (typeof RESOURCE_TYPE)[keyof typeof RESOURCE_TYPE];

/**
 * Data residency region values
 * Matches database CHECK constraint on saas.organizations
 */
export const DATA_RESIDENCY_REGION = {
  KZ: 'kz',
  RF: 'rf',
  EU: 'eu',
  US: 'us',
  GLOBAL: 'global',
} as const;

export type DataResidencyRegion =
  (typeof DATA_RESIDENCY_REGION)[keyof typeof DATA_RESIDENCY_REGION];

// --- Entity interfaces ---

export interface OrganizationSettings {
  magic_login_enabled?: boolean;
  // Intelligence settings (R3: Multi-Tenant Keys)
  intelligence_enabled?: boolean;
  intelligence_api_key?: string | null; // encrypted blob via CredentialEncryption
  intelligence_provider?: string | null;
  intelligence_auto_analyze?: boolean;
  intelligence_similarity_threshold?: number | null;
  intelligence_dedup_enabled?: boolean;
  intelligence_dedup_action?: 'flag' | 'auto_close' | null;
  intelligence_self_service_enabled?: boolean;
  intelligence_api_key_provisioned_at?: string | null;
  intelligence_api_key_provisioned_by?: string | null;
  intelligence_auto_enrich?: boolean;
}

export interface Organization {
  id: string;
  name: string;
  subdomain: string;
  data_residency_region: DataResidencyRegion;
  storage_region: string;
  subscription_status: SubscriptionStatus;
  billing_method: BillingMethod;
  settings: OrganizationSettings;
  trial_ends_at: Date | null;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export type OrganizationInsert = {
  id?: string;
  name: string;
  subdomain: string;
  data_residency_region?: DataResidencyRegion;
  storage_region?: string;
  subscription_status?: SubscriptionStatus;
  billing_method?: BillingMethod;
  settings?: OrganizationSettings;
  trial_ends_at?: Date | null;
};

export type OrganizationUpdate = Partial<Omit<Organization, 'id' | 'created_at' | 'updated_at'>>;

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgMemberRole;
  created_at: Date;
  updated_at: Date;
}

export type OrganizationMemberInsert = {
  id?: string;
  organization_id: string;
  user_id: string;
  role: OrgMemberRole;
};

export type OrganizationMemberUpdate = {
  role: OrgMemberRole;
};

export interface Subscription {
  id: string;
  organization_id: string;
  plan_name: PlanName;
  status: BillingStatus;
  payment_provider: string | null;
  external_subscription_id: string | null;
  external_customer_id: string | null;
  current_period_start: Date;
  current_period_end: Date;
  quotas: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export type SubscriptionInsert = {
  id?: string;
  organization_id: string;
  plan_name: PlanName;
  status: BillingStatus;
  payment_provider?: string | null;
  external_subscription_id?: string | null;
  external_customer_id?: string | null;
  current_period_start: Date;
  current_period_end: Date;
  quotas?: Record<string, unknown>;
};

export type SubscriptionUpdate = Partial<
  Omit<Subscription, 'id' | 'organization_id' | 'created_at' | 'updated_at'>
>;

export interface UsageRecord {
  id: string;
  organization_id: string;
  period_start: Date;
  period_end: Date;
  resource_type: ResourceType;
  quantity: number;
  created_at: Date;
  updated_at: Date;
}

export type UsageRecordInsert = {
  id?: string;
  organization_id: string;
  period_start: Date;
  period_end: Date;
  resource_type: ResourceType;
  quantity?: number;
};

export type UsageRecordUpdate = {
  quantity: number;
};

// --- Query/filter types ---

export interface OrganizationFilters {
  subscription_status?: SubscriptionStatus;
  data_residency_region?: DataResidencyRegion;
  search?: string;
  includeDeleted?: boolean;
}

export interface OrganizationWithMemberCount extends Organization {
  member_count: number;
}

export interface OrganizationMemberWithUser extends OrganizationMember {
  user_email: string;
  user_name: string | null;
}

// ============================================================================
// ORGANIZATION INVITATIONS
// ============================================================================

/**
 * Invitation status values
 * Matches database CHECK constraint on saas.organization_invitations
 */
export const INVITATION_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  EXPIRED: 'expired',
  CANCELED: 'canceled',
} as const;

export type InvitationStatus = (typeof INVITATION_STATUS)[keyof typeof INVITATION_STATUS];

/**
 * Roles assignable via invitation.
 * Owner invitations are used when admin creates an org for a non-existing user.
 */
export const INVITATION_ROLE = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
} as const;

export type InvitationRole = (typeof INVITATION_ROLE)[keyof typeof INVITATION_ROLE];

export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  email: string;
  role: InvitationRole;
  invited_by: string;
  token: string;
  status: InvitationStatus;
  expires_at: Date;
  accepted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type OrganizationInvitationInsert = {
  id?: string;
  organization_id: string;
  email: string;
  role: InvitationRole;
  invited_by: string;
  token: string;
  status?: InvitationStatus;
  expires_at: Date;
};

export type OrganizationInvitationUpdate = Partial<
  Pick<OrganizationInvitation, 'status' | 'accepted_at'>
>;

/**
 * Invitation with joined organization and inviter details
 * Used in listing and accept flows
 */
export interface OrganizationInvitationWithDetails extends OrganizationInvitation {
  organization_name: string;
  organization_subdomain: string;
  inviter_email: string;
  inviter_name: string | null;
}

// --- Service input/output types ---

export interface CreateOrganizationInput {
  name: string;
  subdomain: string;
  data_residency_region?: DataResidencyRegion;
}

/**
 * Input for admin-driven organization creation.
 * Provide owner_user_id for an existing user, or owner_email to send an
 * invitation (pending owner flow). At least one must be supplied.
 */
export interface AdminCreateOrganizationInput {
  name: string;
  subdomain: string;
  owner_user_id?: string;
  owner_email?: string;
  plan_name?: PlanName;
  data_residency_region?: DataResidencyRegion;
}

/**
 * Input for admin plan override (bypass payment flow).
 */
export interface AdminSetPlanInput {
  plan_name: PlanName;
  status?: BillingStatus;
}

export interface QuotaStatus {
  plan: PlanName;
  period: { start: Date; end: Date };
  resources: Record<ResourceType, { current: number; limit: number }>;
}

// ============================================================================
// ORGANIZATION REQUESTS
// ============================================================================

/**
 * Organization request status values
 * Matches database CHECK constraint on saas.organization_requests
 */
export const ORG_REQUEST_STATUS = {
  PENDING_VERIFICATION: 'pending_verification',
  VERIFIED: 'verified',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
} as const;

export type OrgRequestStatus = (typeof ORG_REQUEST_STATUS)[keyof typeof ORG_REQUEST_STATUS];

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
  verification_token: string;
  email_verified_at: Date | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  admin_notes: string | null;
  rejection_reason: string | null;
  organization_id: string | null;
  ip_address: string;
  honeypot: string | null;
  spam_score: number;
  created_at: Date;
  updated_at: Date;
}

export type OrganizationRequestInsert = {
  id?: string;
  company_name: string;
  subdomain: string;
  contact_name: string;
  contact_email: string;
  phone?: string | null;
  message?: string | null;
  data_residency_region?: DataResidencyRegion;
  status?: OrgRequestStatus;
  verification_token: string;
  ip_address: string;
  honeypot?: string | null;
  spam_score?: number;
};

export type OrganizationRequestUpdate = Partial<
  Pick<
    OrganizationRequest,
    | 'status'
    | 'email_verified_at'
    | 'reviewed_by'
    | 'reviewed_at'
    | 'admin_notes'
    | 'rejection_reason'
    | 'organization_id'
    | 'spam_score'
  >
>;

export interface OrganizationRequestFilters {
  status?: OrgRequestStatus;
  contact_email?: string;
  search?: string;
}

// ============================================================================
// INVOICE BILLING (B2B Legal Entities)
// ============================================================================

/**
 * Invoice status values
 * Matches database CHECK constraint on saas.invoices
 */
export const INVOICE_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  PAID: 'paid',
  OVERDUE: 'overdue',
  CANCELED: 'canceled',
} as const;

export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

/**
 * Act status values
 * Matches database CHECK constraint on saas.acts
 */
export const ACT_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  SIGNED: 'signed',
  CANCELED: 'canceled',
} as const;

export type ActStatus = (typeof ACT_STATUS)[keyof typeof ACT_STATUS];

export interface Invoice {
  id: string;
  invoice_number: string;
  organization_id: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  issued_at: Date | null;
  due_at: Date | null;
  paid_at: Date | null;
  pdf_storage_path: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export type InvoiceInsert = {
  id?: string;
  invoice_number: string;
  organization_id: string;
  amount: number;
  currency?: string;
  status?: InvoiceStatus;
  issued_at?: Date | null;
  due_at?: Date | null;
  notes?: string | null;
};

export type InvoiceUpdate = Partial<
  Omit<Invoice, 'id' | 'invoice_number' | 'organization_id' | 'created_at' | 'updated_at'>
>;

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  description: string;
  plan_name: string | null;
  period_start: Date | null;
  period_end: Date | null;
  quantity: number;
  unit_price: number;
  amount: number;
  created_at: Date;
}

export type InvoiceLineInsert = {
  id?: string;
  invoice_id: string;
  description: string;
  plan_name?: string | null;
  period_start?: Date | null;
  period_end?: Date | null;
  quantity?: number;
  unit_price: number;
  amount: number;
};

export interface LegalEntity {
  id: string;
  organization_id: string;
  company_name: string;
  details: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export type LegalEntityInsert = {
  id?: string;
  organization_id: string;
  company_name: string;
  details?: Record<string, unknown>;
};

export type LegalEntityUpdate = Partial<
  Omit<LegalEntity, 'id' | 'organization_id' | 'created_at' | 'updated_at'>
>;

/**
 * KZ-specific legal entity details (stored in LegalEntity.details JSONB).
 * Validated by KzBillingPlugin.validateLegalEntity().
 */
export interface KzLegalDetails {
  bin: string;
  legal_address: string;
  bank_name: string;
  iik: string;
  bik: string;
  director_name: string;
  phone?: string | null;
  email?: string | null;
}

export interface Act {
  id: string;
  act_number: string;
  invoice_id: string;
  status: ActStatus;
  signed_pdf_path: string | null;
  signed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type ActInsert = {
  id?: string;
  act_number: string;
  invoice_id: string;
  status?: ActStatus;
};

export type ActUpdate = Partial<
  Omit<Act, 'id' | 'act_number' | 'invoice_id' | 'created_at' | 'updated_at'>
>;
