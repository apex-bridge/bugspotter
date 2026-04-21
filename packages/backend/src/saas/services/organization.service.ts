/**
 * Organization Service
 * Handles organization lifecycle, quota enforcement, and usage tracking.
 */

import type { DatabaseClient } from '../../db/client.js';
import type {
  Organization,
  Subscription,
  CreateOrganizationInput,
  AdminCreateOrganizationInput,
  AdminSetPlanInput,
  QuotaStatus,
  ResourceType,
  OrganizationMemberWithUser,
  OrgMemberRole,
  BillingStatus,
  SubscriptionStatus,
  Project,
  ProjectInsert,
  OrganizationInvitation,
} from '../../db/types.js';
import {
  SUBSCRIPTION_STATUS,
  BILLING_STATUS,
  PLAN_NAME,
  ORG_MEMBER_ROLE,
  RESOURCE_TYPE,
  INVITATION_ROLE,
} from '../../db/types.js';
import { getQuotaForPlan } from '../plans.js';
import { AppError } from '../../api/middleware/error.js';
import { InvitationService } from './invitation.service.js';

const TRIAL_DURATION_DAYS = 14;
const ADMIN_PLAN_DURATION_DAYS = 365;

/**
 * Advisory lock namespace for organization project quota enforcement.
 * Using a two-argument advisory lock prevents hash collisions with other
 * lock types in the system. This classId is dedicated to quota enforcement.
 */
const ORG_QUOTA_LOCK_CLASS = 1001;

export class OrganizationService {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Create a new organization with a trial subscription and the owner as the first member.
   * All three records are created in a single transaction.
   */
  async createOrganization(
    input: CreateOrganizationInput,
    ownerUserId: string
  ): Promise<Organization> {
    return this.db.transaction(async (tx) => {
      const org = await tx.organizations.create({
        name: input.name,
        subdomain: input.subdomain,
        data_residency_region: input.data_residency_region,
        subscription_status: SUBSCRIPTION_STATUS.TRIAL,
        trial_ends_at: this.calculateTrialEndDate(),
      });

      const now = new Date();
      const periodEnd = this.calculateTrialEndDate();

      await tx.subscriptions.create({
        organization_id: org.id,
        plan_name: PLAN_NAME.TRIAL,
        status: BILLING_STATUS.TRIAL,
        current_period_start: now,
        current_period_end: periodEnd,
        quotas: getQuotaForPlan(PLAN_NAME.TRIAL),
      });

      await tx.organizationMembers.create({
        organization_id: org.id,
        user_id: ownerUserId,
        role: ORG_MEMBER_ROLE.OWNER,
      });

      return org;
    });
  }

  /**
   * Check if an organization can perform an action for the given resource type.
   * Returns true if the current usage is below the plan quota limit.
   */
  async canPerformAction(organizationId: string, resourceType: ResourceType): Promise<boolean> {
    const remaining = await this.getRemainingQuota(organizationId, resourceType);
    return remaining > 0;
  }

  /**
   * Get the remaining quota for a specific resource type.
   * Returns 0 if at or over the limit.
   *
   * CRITICAL DESIGN DISTINCTION:
   * - PROJECTS: Uses actual database row count (current = SELECT COUNT(*))
   *   This is the authoritative source. Deletions are automatically reflected.
   * - OTHER RESOURCES: Uses usage_records table (current = SUM(quantity))
   *   Tracked per billing period. Resets each period. Deletions not tracked.
   */
  async getRemainingQuota(organizationId: string, resourceType: ResourceType): Promise<number> {
    const subscription = await this.getSubscription(organizationId);
    const quotas = getQuotaForPlan(subscription.plan_name);
    const limit = quotas[resourceType];

    let current: number;
    if (resourceType === RESOURCE_TYPE.PROJECTS) {
      // Count-based quota: Query actual database rows
      current = await this.db.projects.countByOrganizationId(organizationId);
    } else {
      // Usage-based quota: Query usage_records for current period
      const period = this.getCurrentPeriod(subscription);
      current = await this.getCurrentUsage(organizationId, period.start, resourceType);
    }

    return Math.max(0, limit - current);
  }

  /**
   * Get the full quota status for all resource types.
   * Uses count-based logic for PROJECTS, usage_records for other resources.
   */
  async getQuotaStatus(organizationId: string): Promise<QuotaStatus> {
    const subscription = await this.getSubscription(organizationId);
    const quotas = getQuotaForPlan(subscription.plan_name);
    const period = this.getCurrentPeriod(subscription);

    const usageRecords = await this.db.usageRecords.findByOrgAndPeriod(
      organizationId,
      period.start
    );

    const usageMap = new Map(usageRecords.map((r) => [r.resource_type, r.quantity]));

    // For PROJECTS, use actual database row count instead of usage_records
    const projectCount = await this.db.projects.countByOrganizationId(organizationId);

    const resources = {} as QuotaStatus['resources'];
    for (const resourceType of Object.values(RESOURCE_TYPE)) {
      resources[resourceType] = {
        current:
          resourceType === RESOURCE_TYPE.PROJECTS
            ? projectCount
            : (usageMap.get(resourceType) ?? 0),
        limit: quotas[resourceType],
      };
    }

    return {
      plan: subscription.plan_name,
      period,
      resources,
    };
  }

  /**
   * Atomically reserve quota for a resource type.
   * Increments usage and checks the limit in a single SQL statement,
   * preventing race conditions from concurrent requests.
   *
   * DESIGN NOTES:
   * - For PROJECTS: Falls back to canPerformAction (checks actual row count).
   *   Project creation should use createProjectWithQuotaCheck() for atomic enforcement.
   * - For OTHER RESOURCES: Uses incrementWithLimit on usage_records table.
   *
   * Returns true if the reservation succeeded (within limit), false if quota is exhausted.
   */
  async reserveQuota(
    organizationId: string,
    resourceType: ResourceType,
    amount: number = 1
  ): Promise<boolean> {
    if (amount <= 0) {
      throw new AppError('Usage amount must be greater than zero', 400, 'BadRequest');
    }

    // PROJECTS uses row-count-based quota, not usage records
    // Actual project creation should use createProjectWithQuotaCheck()
    if (resourceType === RESOURCE_TYPE.PROJECTS) {
      return this.canPerformAction(organizationId, resourceType);
    }

    const subscription = await this.getSubscription(organizationId);
    const quotas = getQuotaForPlan(subscription.plan_name);
    const limit = quotas[resourceType];
    const period = this.getCurrentPeriod(subscription);

    const result = await this.db.usageRecords.incrementWithLimit(
      organizationId,
      period.start,
      period.end,
      resourceType,
      amount,
      limit
    );

    return result.allowed;
  }

  /**
   * Release previously reserved quota.
   * Used when a resource creation fails after quota was reserved via reserveQuota().
   * This prevents quota leaks where failed operations permanently consume quota.
   *
   * DESIGN NOTES:
   * - For PROJECTS: No-op (project quota is count-based, not reservation-based)
   * - For OTHER RESOURCES: Decrements usage_records for current period
   *
   * Returns true if quota was released, false if no record found or already at zero.
   */
  async releaseQuota(
    organizationId: string,
    resourceType: ResourceType,
    amount: number = 1
  ): Promise<boolean> {
    if (amount <= 0) {
      throw new AppError('Usage amount must be greater than zero', 400, 'BadRequest');
    }

    // PROJECTS uses row-count-based quota, no reservation to release
    if (resourceType === RESOURCE_TYPE.PROJECTS) {
      return false;
    }

    const subscription = await this.getSubscription(organizationId);
    const period = this.getCurrentPeriod(subscription);

    const result = await this.db.usageRecords.decrement(
      organizationId,
      period.start,
      resourceType,
      amount
    );

    return result !== null;
  }

  /**
   * Create a project with atomic quota enforcement.
   *
   * REQUIRED METHOD for creating projects in SaaS mode. This is the ONLY way
   * to properly enforce project quota with race condition protection.
   *
   * Uses INSERT ... SELECT with a subquery count check so the insert
   * only succeeds if the current project count is below the plan limit.
   * This prevents race conditions from concurrent project creations.
   *
   * CRITICAL: Do NOT call trackUsage(RESOURCE_TYPE.PROJECTS) after this.
   * Project quota is count-based (SELECT COUNT(*)), not usage-based.
   * Deletions are automatically reflected in the count.
   *
   * Returns the created project, or throws 429 if the quota is exceeded.
   */
  async createProjectWithQuotaCheck(
    organizationId: string,
    input: ProjectInsert
  ): Promise<Project> {
    // Validate that input.organization_id matches the parameter if provided
    // This prevents quota bypass attacks where quota is checked for one org
    // but the project is created under a different org
    if (input.organization_id && input.organization_id !== organizationId) {
      throw new AppError(
        'Input organization_id does not match the organizationId parameter',
        400,
        'BadRequest',
        {
          hint: 'organization_id should not be provided in input - it is set from the organizationId parameter',
        }
      );
    }

    const subscription = await this.getSubscription(organizationId);
    const quotas = getQuotaForPlan(subscription.plan_name);
    const limit = quotas[RESOURCE_TYPE.PROJECTS];

    // Use an explicit transaction with an advisory lock to serialize concurrent
    // project creations per organization. pg_advisory_xact_lock blocks concurrent
    // transactions until the lock holder commits, ensuring the COUNT(*) check
    // reflects all prior inserts.
    const result = await this.db.queryWithTransaction(async (client) => {
      // Acquire org-scoped advisory lock (released on commit/rollback)
      // Using two-argument form to namespace the lock and prevent collisions with other lock types
      await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2::text))', [
        ORG_QUOTA_LOCK_CLASS,
        organizationId,
      ]);

      // Insert only if under the limit
      return client.query<Project>(
        `INSERT INTO application.projects (name, settings, created_by, organization_id)
         SELECT $1, $2::jsonb, $3, $4::uuid
         WHERE (
           SELECT COUNT(*)::int FROM application.projects WHERE organization_id = $4::uuid
         ) < $5
         RETURNING *`,
        [
          input.name,
          JSON.stringify(input.settings ?? {}),
          input.created_by ?? null,
          organizationId,
          limit,
        ]
      );
    });

    if (result.rows.length === 0) {
      throw new AppError(
        'Quota exceeded for resource type: ' + RESOURCE_TYPE.PROJECTS,
        429,
        'QuotaExceeded',
        { resourceType: RESOURCE_TYPE.PROJECTS }
      );
    }

    return result.rows[0];
  }

  /**
   * Track usage for a resource type.
   * Increments the usage record for the current billing period.
   *
   * CRITICAL: This method should NOT be called for RESOURCE_TYPE.PROJECTS.
   * Projects use count-based quota (SELECT COUNT(*) from projects table),
   * not usage_records. Calling trackUsage for PROJECTS would create misleading
   * data since project deletions wouldn't decrement the usage count.
   *
   * Use this for: BUG_REPORTS, TEAM_MEMBERS, STORAGE_GB, etc.
   * Do NOT use for: PROJECTS (quota is enforced via createProjectWithQuotaCheck)
   */
  async trackUsage(
    organizationId: string,
    resourceType: ResourceType,
    amount: number = 1
  ): Promise<void> {
    if (amount <= 0) {
      throw new AppError('Usage amount must be greater than zero', 400, 'BadRequest');
    }

    // Prevent misuse: PROJECTS quota is count-based, not usage-based
    if (resourceType === RESOURCE_TYPE.PROJECTS) {
      throw new AppError(
        'PROJECTS quota uses count-based enforcement. Use createProjectWithQuotaCheck() instead of trackUsage().',
        400,
        'BadRequest',
        {
          hint: 'Project quota is automatically enforced by counting database rows. Deletions are automatically reflected.',
        }
      );
    }

    const subscription = await this.getSubscription(organizationId);
    const period = this.getCurrentPeriod(subscription);

    await this.db.usageRecords.increment(
      organizationId,
      period.start,
      period.end,
      resourceType,
      amount
    );
  }

  /**
   * Get an organization by ID.
   * Throws if not found.
   */
  async getOrganization(organizationId: string): Promise<Organization> {
    const org = await this.db.organizations.findById(organizationId);
    if (!org) {
      throw new AppError(`Organization not found: ${organizationId}`, 404, 'NotFound');
    }
    return org;
  }

  /**
   * Update an organization's mutable fields.
   */
  async updateOrganization(
    organizationId: string,
    updates: { name?: string }
  ): Promise<Organization> {
    const org = await this.db.organizations.update(organizationId, updates);
    if (!org) {
      throw new AppError(`Organization not found: ${organizationId}`, 404, 'NotFound');
    }
    return org;
  }

  /**
   * List members of an organization with user details.
   */
  async getMembers(organizationId: string): Promise<OrganizationMemberWithUser[]> {
    return this.db.organizationMembers.findByOrganizationId(organizationId);
  }

  /**
   * Add a user as a member of an organization.
   * Atomically creates the membership and returns user details.
   * Note: Cannot assign 'owner' role - owner is set during organization creation.
   */
  async addMember(
    organizationId: string,
    userId: string,
    role: OrgMemberRole
  ): Promise<OrganizationMemberWithUser> {
    // Enforce business rule: owner role cannot be assigned via addMember
    if (role === ORG_MEMBER_ROLE.OWNER) {
      throw new AppError(
        'Cannot assign owner role. Each organization has exactly one owner, set during creation.',
        400,
        'BadRequest'
      );
    }

    const member = await this.db.organizationMembers.createWithUser(organizationId, userId, role);

    if (!member) {
      throw new AppError('User is already a member of this organization', 409, 'Conflict');
    }

    return member;
  }

  /**
   * Remove a member from an organization.
   * Cannot remove the owner.
   */
  async removeMember(organizationId: string, userId: string): Promise<void> {
    const membership = await this.db.organizationMembers.findMembership(organizationId, userId);
    if (!membership) {
      throw new AppError('User is not a member of this organization', 404, 'NotFound');
    }
    if (membership.role === ORG_MEMBER_ROLE.OWNER) {
      throw new AppError('Cannot remove the organization owner', 403, 'Forbidden');
    }
    await this.db.organizationMembers.removeMember(organizationId, userId);
  }

  /**
   * Get the active subscription for an organization.
   * Throws if no subscription is found.
   */
  async getSubscription(organizationId: string): Promise<Subscription> {
    const subscription = await this.db.subscriptions.findByOrganizationId(organizationId);
    if (!subscription) {
      throw new AppError(
        `No subscription found for organization: ${organizationId}`,
        404,
        'NotFound'
      );
    }
    return subscription;
  }

  /**
   * Admin: Create an organization with a designated owner and specific plan.
   * Provide owner_user_id for an existing user, or owner_email for a pending
   * owner. When a pending owner email is used, the invitation is created
   * atomically within the same transaction as the organization.
   */
  async adminCreateOrganization(
    input: AdminCreateOrganizationInput,
    invitedByUserId?: string
  ): Promise<{
    organization: Organization;
    ownerMemberCreated: boolean;
    invitation: OrganizationInvitation | null;
  }> {
    if (!input.owner_user_id && !input.owner_email) {
      throw new AppError('Either owner_user_id or owner_email must be provided', 400, 'BadRequest');
    }

    // Validate subdomain availability
    const available = await this.db.organizations.isSubdomainAvailable(input.subdomain);
    if (!available) {
      throw new AppError('Subdomain is already taken', 409, 'Conflict');
    }

    // Resolve owner: by ID, or by email lookup
    let resolvedOwnerId: string | null = null;
    let pendingOwnerEmail: string | null = null;

    if (input.owner_user_id) {
      const owner = await this.db.users.findById(input.owner_user_id);
      if (!owner) {
        throw new AppError('Owner user not found', 404, 'NotFound');
      }
      resolvedOwnerId = owner.id;
    } else if (input.owner_email) {
      const normalizedEmail = input.owner_email.toLowerCase().trim();
      const existingUser = await this.db.users.findByEmail(normalizedEmail);
      if (existingUser) {
        resolvedOwnerId = existingUser.id;
      } else {
        if (!invitedByUserId) {
          throw new AppError(
            'invitedByUserId is required when owner_email does not match an existing user',
            400,
            'BadRequest'
          );
        }
        pendingOwnerEmail = normalizedEmail;
      }
    }

    const planName = input.plan_name ?? PLAN_NAME.TRIAL;
    const isTrial = planName === PLAN_NAME.TRIAL;

    return this.db.transaction(async (tx) => {
      const org = await tx.organizations.create({
        name: input.name,
        subdomain: input.subdomain,
        data_residency_region: input.data_residency_region,
        subscription_status: isTrial ? SUBSCRIPTION_STATUS.TRIAL : SUBSCRIPTION_STATUS.ACTIVE,
        trial_ends_at: isTrial ? this.calculateTrialEndDate() : null,
      });

      const now = new Date();
      const periodEnd = new Date(now);
      if (isTrial) {
        periodEnd.setDate(periodEnd.getDate() + TRIAL_DURATION_DAYS);
      } else {
        periodEnd.setDate(periodEnd.getDate() + ADMIN_PLAN_DURATION_DAYS);
      }

      await tx.subscriptions.create({
        organization_id: org.id,
        plan_name: planName,
        status: isTrial ? BILLING_STATUS.TRIAL : BILLING_STATUS.ACTIVE,
        current_period_start: now,
        current_period_end: periodEnd,
        quotas: getQuotaForPlan(planName),
      });

      if (resolvedOwnerId) {
        await tx.organizationMembers.create({
          organization_id: org.id,
          user_id: resolvedOwnerId,
          role: ORG_MEMBER_ROLE.OWNER,
        });
      }

      // Create owner invitation atomically with the org
      let invitation: OrganizationInvitation | null = null;
      if (pendingOwnerEmail && invitedByUserId) {
        invitation = await InvitationService.createInvitationRecord(tx, {
          organizationId: org.id,
          email: pendingOwnerEmail,
          role: INVITATION_ROLE.OWNER,
          invitedByUserId,
        });
      }

      return {
        organization: org,
        ownerMemberCreated: !!resolvedOwnerId,
        invitation,
      };
    });
  }

  /**
   * Admin: Set or change an organization's plan.
   * Bypasses payment flow — admin manually assigns any plan.
   * Updates subscription plan, quotas, status, and period.
   */
  async adminSetPlan(organizationId: string, input: AdminSetPlanInput): Promise<Subscription> {
    const org = await this.db.organizations.findById(organizationId);
    if (!org) {
      throw new AppError('Organization not found', 404, 'NotFound');
    }

    const subscription = await this.getSubscription(organizationId);
    const isTrial = input.plan_name === PLAN_NAME.TRIAL;
    const billingStatus = input.status ?? (isTrial ? BILLING_STATUS.TRIAL : BILLING_STATUS.ACTIVE);

    const now = new Date();
    const periodEnd = new Date(now);
    if (isTrial) {
      periodEnd.setDate(periodEnd.getDate() + TRIAL_DURATION_DAYS);
    } else {
      periodEnd.setDate(periodEnd.getDate() + ADMIN_PLAN_DURATION_DAYS);
    }

    const updated = await this.db.subscriptions.update(subscription.id, {
      plan_name: input.plan_name,
      status: billingStatus,
      quotas: getQuotaForPlan(input.plan_name),
      current_period_start: now,
      current_period_end: periodEnd,
    });

    if (!updated) {
      throw new AppError('Failed to update subscription', 500, 'InternalError');
    }

    // Sync org subscription_status + trial_ends_at from billing status
    const isTrialStatus = billingStatus === BILLING_STATUS.TRIAL;
    await this.db.organizations.update(organizationId, {
      subscription_status: this.billingToOrgStatus(billingStatus),
      trial_ends_at: isTrialStatus ? periodEnd : null,
    });

    return updated;
  }

  private getCurrentPeriod(subscription: Subscription): {
    start: Date;
    end: Date;
  } {
    return {
      start: subscription.current_period_start,
      end: subscription.current_period_end,
    };
  }

  private async getCurrentUsage(
    organizationId: string,
    periodStart: Date,
    resourceType: ResourceType
  ): Promise<number> {
    const record = await this.db.usageRecords.findByOrgPeriodAndType(
      organizationId,
      periodStart,
      resourceType
    );
    return record?.quantity ?? 0;
  }

  private calculateTrialEndDate(): Date {
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + TRIAL_DURATION_DAYS);
    return trialEnd;
  }

  /**
   * Delete an organization (soft or hard).
   * Hard delete is only allowed when the org has no projects and no active subscription.
   * Uses a guarded DELETE to atomically verify no vital data exists before removing.
   */
  async deleteOrganization(
    organizationId: string,
    deletedBy: string,
    permanent: boolean = false
  ): Promise<{ mode: 'soft' | 'hard' }> {
    const org = await this.db.organizations.findByIdIncludeDeleted(organizationId);
    if (!org) {
      throw new AppError('Organization not found', 404, 'NotFound');
    }
    if (org.deleted_at) {
      throw new AppError('Organization is already deleted', 409, 'Conflict');
    }

    if (permanent) {
      // Pre-check for informative error messages (tells user exactly what's blocking)
      const vitalData = await this.db.organizations.hasVitalData(organizationId);
      if (vitalData.hasProjects) {
        throw new AppError(
          `Cannot permanently delete: organization has ${vitalData.projectCount} project(s). Use soft delete instead.`,
          409,
          'Conflict',
          { projectCount: vitalData.projectCount }
        );
      }
      if (vitalData.hasActiveSubscription) {
        throw new AppError(
          'Cannot permanently delete: organization has an active subscription. Cancel it first.',
          409,
          'Conflict'
        );
      }
      // Guarded DELETE atomically rechecks vital data to prevent TOCTOU races
      const deleted = await this.db.organizations.hardDeleteGuarded(organizationId);
      if (!deleted) {
        throw new AppError(
          'Could not delete: organization was modified concurrently. Please retry.',
          409,
          'Conflict'
        );
      }
      return { mode: 'hard' as const };
    }

    const deleted = await this.db.organizations.softDelete(organizationId, deletedBy);
    if (!deleted) {
      throw new AppError(
        'Could not delete: organization was modified concurrently. Please retry.',
        409,
        'Conflict'
      );
    }
    return { mode: 'soft' as const };
  }

  /**
   * List soft-deleted organizations that have aged past the retention window
   * and are eligible for permanent removal by a platform admin.
   *
   * Service layer — the route handler is in `admin-organizations.ts` and is
   * gated by `requirePlatformAdmin`.
   */
  async listPendingHardDelete(retentionDays: number): Promise<
    Array<{
      id: string;
      name: string;
      subdomain: string;
      deleted_at: Date;
      deleted_by: string | null;
      project_count: number;
      bug_report_count: number;
      days_since_deleted: number;
    }>
  > {
    const rows = await this.db.organizations.findExpiredSoftDeleted(retentionDays);
    const now = Date.now();
    return rows.map((row) => ({
      ...row,
      days_since_deleted: Math.floor(
        (now - new Date(row.deleted_at).getTime()) / (24 * 60 * 60 * 1000)
      ),
    }));
  }

  /**
   * Permanently delete a soft-deleted organization that has aged past the
   * retention window. FK cascades handle projects, bug_reports,
   * subscriptions, memberships, invitations, invoices.
   *
   * The audit log is written BEFORE the delete in the same transaction so
   * the record survives the cascade even though `audit_logs.organization_id`
   * is `ON DELETE SET NULL`. Key fields (subdomain, name, project count,
   * bug-report count, original deleted_at) are duplicated into `details`
   * so the trail is readable without joining anything.
   *
   * `confirmSubdomain` is the string the admin typed into the UI's confirm
   * field. Compared case-insensitively (trim + lowercase both sides) to
   * match the UX contract — typing "Acme" works the same as "acme". A
   * mismatch throws 400 here — the server-side check is the authoritative
   * one; the client dialog is mis-click defense, not a trust boundary.
   *
   * Returns the deleted org's identifiers for UI confirmation. Throws:
   *   - 404 if the org doesn't exist
   *   - 400 if `confirmSubdomain` doesn't match
   *   - 409 if the org isn't soft-deleted, or hasn't aged past the window
   */
  async hardDeleteExpired(
    organizationId: string,
    retentionDays: number,
    actorUserId: string,
    confirmSubdomain: string
  ): Promise<{ id: string; subdomain: string; name: string }> {
    const org = await this.db.organizations.findByIdIncludeDeleted(organizationId);
    if (!org) {
      throw new AppError('Organization not found', 404, 'NotFound');
    }
    // Normalize both sides before comparing. Subdomains are enforced
    // lowercase at signup, but a direct API call (bypassing the UI) might
    // send mixed case; the UX contract is that typing "Acme" should work
    // the same as "acme". The UI lowercases input on change, so this is
    // also the server-side mirror of that behavior.
    if (confirmSubdomain.trim().toLowerCase() !== org.subdomain.toLowerCase()) {
      throw new AppError(
        'Subdomain confirmation did not match — refusing hard-delete',
        400,
        'ValidationError'
      );
    }
    if (!org.deleted_at) {
      throw new AppError(
        'Organization is not soft-deleted and cannot be hard-deleted via this route',
        409,
        'Conflict'
      );
    }
    const ageMs = Date.now() - new Date(org.deleted_at).getTime();
    const windowMs = retentionDays * 24 * 60 * 60 * 1000;
    if (ageMs < windowMs) {
      throw new AppError(
        `Organization is inside its retention window (${retentionDays} days). ` +
          `Eligible in ${Math.ceil((windowMs - ageMs) / (24 * 60 * 60 * 1000))} day(s).`,
        409,
        'Conflict'
      );
    }

    // Write audit, then delete, in one tx. If either step fails the other
    // is rolled back — we never log a deletion that didn't happen, nor
    // delete without a trail. Counts are read inside the tx so the audit
    // trail reflects the exact state being cascaded (in theory concurrent
    // writes against a soft-deleted-for-30d org are near-impossible, but
    // the audit log is the whole point of this flow, so we don't cut
    // corners on its accuracy).
    await this.db.transaction(async (tx) => {
      const [projectCount, bugReportCount] = await Promise.all([
        tx.projects.countByOrganizationId(organizationId),
        tx.bugReports.countByOrganizationId(organizationId),
      ]);

      await tx.auditLogs.create({
        action: 'organization.hard_delete',
        resource: 'organization',
        resource_id: org.id,
        user_id: actorUserId,
        // organization_id intentionally omitted — the FK would be nulled
        // by the CASCADE-SET-NULL on audit_logs, so we keep the identity
        // fully inside `details` instead.
        organization_id: null,
        details: {
          subdomain: org.subdomain,
          name: org.name,
          deleted_at_original: org.deleted_at,
          retention_days: retentionDays,
          project_count_at_delete: projectCount,
          bug_report_count_at_delete: bugReportCount,
        },
        success: true,
      });

      const deleted = await tx.organizations.hardDeleteExpiredSoftDeleted(
        organizationId,
        retentionDays
      );
      if (!deleted) {
        // A concurrent restore could have flipped deleted_at back to NULL
        // between our check above and this delete. The guard clause in the
        // DELETE prevents acting on that state; the tx rollback discards
        // the audit we just wrote.
        throw new AppError(
          'Organization state changed during delete (possibly restored). Retry.',
          409,
          'Conflict'
        );
      }
    });

    return { id: org.id, subdomain: org.subdomain, name: org.name };
  }

  /**
   * Restore a soft-deleted organization.
   */
  async restoreOrganization(organizationId: string): Promise<Organization> {
    const org = await this.db.organizations.findByIdIncludeDeleted(organizationId);
    if (!org) {
      throw new AppError('Organization not found', 404, 'NotFound');
    }
    if (!org.deleted_at) {
      throw new AppError('Organization is not deleted', 409, 'Conflict');
    }

    const success = await this.db.organizations.restore(organizationId);
    if (!success) {
      throw new AppError('Failed to restore organization', 500, 'InternalError');
    }

    const restored = await this.db.organizations.findById(organizationId);
    if (!restored) {
      throw new AppError('Failed to fetch restored organization', 500, 'InternalError');
    }
    return restored;
  }

  /**
   * Get precheck info for deletion UI — whether hard delete is available.
   */
  async getOrganizationDeletionPrecheck(organizationId: string): Promise<{
    canHardDelete: boolean;
    hasProjects: boolean;
    projectCount: number;
    hasActiveSubscription: boolean;
  }> {
    const org = await this.db.organizations.findById(organizationId);
    if (!org) {
      throw new AppError('Organization not found', 404, 'NotFound');
    }

    const vitalData = await this.db.organizations.hasVitalData(organizationId);
    return {
      canHardDelete: !vitalData.hasProjects && !vitalData.hasActiveSubscription,
      ...vitalData,
    };
  }

  /**
   * Map billing status → organization subscription_status.
   * Shared statuses (trial, active, past_due, canceled) map 1:1.
   * Billing-only statuses map to the closest org equivalent.
   */
  private billingToOrgStatus(billingStatus: BillingStatus): SubscriptionStatus {
    switch (billingStatus) {
      case BILLING_STATUS.TRIAL:
        return SUBSCRIPTION_STATUS.TRIAL;
      case BILLING_STATUS.ACTIVE:
      case BILLING_STATUS.PAUSED:
        return SUBSCRIPTION_STATUS.ACTIVE;
      case BILLING_STATUS.PAST_DUE:
      case BILLING_STATUS.INCOMPLETE:
        return SUBSCRIPTION_STATUS.PAST_DUE;
      case BILLING_STATUS.CANCELED:
      case BILLING_STATUS.INCOMPLETE_EXPIRED:
        return SUBSCRIPTION_STATUS.CANCELED;
      default:
        return SUBSCRIPTION_STATUS.ACTIVE;
    }
  }
}
