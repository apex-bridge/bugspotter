/**
 * Admin Organization Routes
 * Platform admin endpoints for organization lifecycle management.
 * All routes require platform admin.
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type {
  DataResidencyRegion,
  PlanName,
  BillingStatus,
  InvitationRole,
} from '../../db/types.js';
import { OrganizationService } from '../../saas/services/organization.service.js';
import { InvitationService } from '../../saas/services/invitation.service.js';
import type { EmailLocale } from '../../saas/services/invitation-email.service.js';
import { InvitationEmailService } from '../../saas/services/invitation-email.service.js';
import { requirePlatformAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { validateBillingMethodSwitch } from '../../saas/services/billing-method.js';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response.js';
import { generateMagicToken } from './auth.js';
import { config } from '../../config.js';
import { orgHardDeleteTotal } from '../../metrics/registry.js';

interface AdminCreateOrgBody {
  name: string;
  subdomain: string;
  owner_user_id?: string;
  owner_email?: string;
  plan_name?: PlanName;
  data_residency_region?: DataResidencyRegion;
  locale?: EmailLocale;
}

interface AdminSetPlanBody {
  plan_name: PlanName;
  status?: BillingStatus;
}

interface AdminInviteBody {
  email: string;
  role: InvitationRole;
  locale?: EmailLocale;
}

const adminCreateOrgSchema = {
  body: {
    type: 'object',
    required: ['name', 'subdomain'],
    anyOf: [{ required: ['owner_user_id'] }, { required: ['owner_email'] }],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      subdomain: {
        type: 'string',
        minLength: 3,
        maxLength: 63,
        pattern: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$',
      },
      owner_user_id: { type: 'string', format: 'uuid' },
      owner_email: { type: 'string', format: 'email', maxLength: 255 },
      plan_name: { type: 'string', enum: ['trial', 'starter', 'professional', 'enterprise'] },
      data_residency_region: { type: 'string', enum: ['kz', 'rf', 'eu', 'us', 'global'] },
      locale: { type: 'string', enum: ['en', 'ru', 'kk'] },
    },
    additionalProperties: false,
  },
};

const adminSetPlanSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    required: ['plan_name'],
    properties: {
      plan_name: { type: 'string', enum: ['trial', 'starter', 'professional', 'enterprise'] },
      status: {
        type: 'string',
        enum: [
          'trial',
          'active',
          'past_due',
          'canceled',
          'incomplete',
          'incomplete_expired',
          'paused',
        ],
      },
    },
    additionalProperties: false,
  },
};

const adminInviteSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  body: {
    type: 'object',
    required: ['email', 'role'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255 },
      role: { type: 'string', enum: ['admin', 'member'] },
      locale: { type: 'string', enum: ['en', 'ru', 'kk'] },
    },
    additionalProperties: false,
  },
};

const adminListInvitationsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
};

const adminCancelInvitationSchema = {
  params: {
    type: 'object',
    required: ['id', 'invitationId'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      invitationId: { type: 'string', format: 'uuid' },
    },
  },
};

export function adminOrganizationRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  const orgService = new OrganizationService(db);
  const invitationService = new InvitationService(db);
  const emailService = new InvitationEmailService();

  /**
   * POST /api/v1/admin/organizations
   * Create organization with designated owner and specific plan.
   */
  fastify.post<{ Body: AdminCreateOrgBody }>(
    '/api/v1/admin/organizations',
    {
      schema: adminCreateOrgSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { organization, invitation } = await orgService.adminCreateOrganization(
        request.body,
        request.authUser!.id
      );

      // Send invitation email outside the transaction (best-effort).
      // sendForInvitation returns boolean (never throws).
      const emailSent = invitation
        ? await emailService.sendForInvitation({
            organizationName: organization.name,
            invitation,
            inviter: request.authUser!,
            locale: request.body.locale,
          })
        : false;

      return sendCreated(reply, {
        ...organization,
        pending_owner_email: invitation?.email ?? null,
        email_sent: emailSent,
      });
    }
  );

  /**
   * PATCH /api/v1/admin/organizations/:id/subscription
   * Set or change an organization's plan (bypass payment flow).
   */
  fastify.patch<{ Params: { id: string }; Body: AdminSetPlanBody }>(
    '/api/v1/admin/organizations/:id/subscription',
    {
      schema: adminSetPlanSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const subscription = await orgService.adminSetPlan(request.params.id, request.body);
      return sendSuccess(reply, subscription);
    }
  );

  /**
   * PATCH /api/v1/admin/organizations/:id/billing-method
   * Set billing method for an organization (card or invoice).
   */
  fastify.patch<{ Params: { id: string }; Body: { billing_method: 'card' | 'invoice' } }>(
    '/api/v1/admin/organizations/:id/billing-method',
    {
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: { billing_method: { type: 'string', enum: ['card', 'invoice'] } },
          required: ['billing_method'],
          additionalProperties: false,
        },
      },
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const org = await db.organizations.findById(request.params.id);
      if (!org) {
        throw new AppError('Organization not found', 404, 'NotFound');
      }

      // When switching to invoice, block if no legal entity exists
      const entity = await db.legalEntities.findByOrganizationId(request.params.id);
      const validationError = validateBillingMethodSwitch(request.body.billing_method, !!entity);
      if (validationError) {
        throw new AppError(validationError, 400, 'BadRequest');
      }

      await db.organizations.update(request.params.id, {
        billing_method: request.body.billing_method,
      });

      return sendSuccess(reply, { billing_method: request.body.billing_method });
    }
  );

  /**
   * POST /api/v1/admin/organizations/:id/invitations
   * Admin invites a user to any organization (admin override).
   */
  fastify.post<{ Params: { id: string }; Body: AdminInviteBody }>(
    '/api/v1/admin/organizations/:id/invitations',
    {
      schema: adminInviteSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      // Validate org exists before creating invitation (avoids orphaned invitations)
      const org = await db.organizations.findById(request.params.id);
      if (!org) {
        throw new AppError('Organization not found', 404, 'NotFound');
      }

      const { email, role, locale } = request.body;
      const invitation = await invitationService.createInvitation(
        request.params.id,
        email,
        role,
        request.authUser!.id
      );

      const emailSent = await emailService.sendForInvitation({
        organizationName: org.name,
        invitation,
        inviter: request.authUser!,
        locale,
      });

      return sendCreated(reply, { invitation, email_sent: emailSent });
    }
  );

  /**
   * GET /api/v1/admin/organizations/:id/invitations
   * List pending invitations for any organization (admin override).
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/invitations',
    {
      schema: adminListInvitationsSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const invitations = await invitationService.listPendingInvitations(request.params.id);
      return sendSuccess(reply, invitations);
    }
  );

  /**
   * DELETE /api/v1/admin/organizations/:id/invitations/:invitationId
   * Cancel a pending invitation in any organization (admin override).
   */
  fastify.delete<{ Params: { id: string; invitationId: string } }>(
    '/api/v1/admin/organizations/:id/invitations/:invitationId',
    {
      schema: adminCancelInvitationSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      await invitationService.cancelInvitation(request.params.invitationId, request.params.id);
      return sendNoContent(reply);
    }
  );

  // --- Organization deletion & restore ---

  const orgIdParamSchema = {
    params: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', format: 'uuid' } },
    },
  };

  /**
   * GET /api/v1/admin/organizations/:id/projects
   * List all projects belonging to an organization.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/projects',
    {
      schema: orgIdParamSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const org = await db.organizations.findById(request.params.id);
      if (!org) {
        throw new AppError('Organization not found', 404, 'NotFound');
      }
      const projects = await db.projects.findByOrganizationId(request.params.id);
      return sendSuccess(
        reply,
        projects.map(({ id, name, created_at, updated_at, created_by }) => ({
          id,
          name,
          created_at,
          updated_at,
          created_by,
        }))
      );
    }
  );

  /**
   * GET /api/v1/admin/organizations/:id/deletion-precheck
   * Check if an organization can be hard-deleted.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/deletion-precheck',
    {
      schema: orgIdParamSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const precheck = await orgService.getOrganizationDeletionPrecheck(request.params.id);
      return sendSuccess(reply, precheck);
    }
  );

  /**
   * DELETE /api/v1/admin/organizations/:id
   * Soft-delete by default. Pass ?permanent=true for hard delete (only if no vital data).
   */
  fastify.delete<{ Params: { id: string }; Querystring: { permanent?: boolean } }>(
    '/api/v1/admin/organizations/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        querystring: {
          type: 'object',
          properties: { permanent: { type: 'boolean', default: false } },
          additionalProperties: false,
        },
      },
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const result = await orgService.deleteOrganization(
        request.params.id,
        request.authUser!.id,
        request.query.permanent ?? false
      );
      return sendSuccess(reply, result);
    }
  );

  /**
   * POST /api/v1/admin/organizations/:id/restore
   * Restore a soft-deleted organization.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/restore',
    {
      schema: orgIdParamSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const org = await orgService.restoreOrganization(request.params.id);
      return sendSuccess(reply, org);
    }
  );

  /**
   * GET /api/v1/admin/organizations/:id/magic-login-status
   * Check if magic login is enabled for a specific organization.
   * Reads from the organization's JSONB settings column.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/magic-login-status',
    {
      schema: orgIdParamSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const org = await db.organizations.findById(request.params.id);
      if (!org) {
        throw new AppError('Organization not found', 404, 'NotFound');
      }
      return sendSuccess(reply, { allowed: org.settings?.magic_login_enabled === true });
    }
  );

  /**
   * PATCH /api/v1/admin/organizations/:id/magic-login-status
   * Enable or disable magic login for a specific organization.
   * Updates the organization's JSONB settings column.
   */
  fastify.patch<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/api/v1/admin/organizations/:id/magic-login-status',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['enabled'],
          properties: { enabled: { type: 'boolean' } },
          additionalProperties: false,
        },
      },
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const org = await db.organizations.updateSettings(request.params.id, {
        magic_login_enabled: request.body.enabled,
      });
      if (!org) {
        throw new AppError('Organization not found', 404, 'NotFound');
      }
      return sendSuccess(reply, { allowed: org.settings?.magic_login_enabled === true });
    }
  );

  /**
   * POST /api/v1/admin/organizations/:id/magic-token
   * Generate a magic login token for a user in an organization.
   * Requires magic login to be enabled for the organization.
   */
  fastify.post<{ Params: { id: string }; Body: { user_id: string; expires_in?: string } }>(
    '/api/v1/admin/organizations/:id/magic-token',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['user_id'],
          properties: {
            user_id: { type: 'string', format: 'uuid' },
            expires_in: { type: 'string', pattern: '^\\d+[dhms]$', default: '30d' },
          },
          additionalProperties: false,
        },
      },
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const org = await db.organizations.findById(request.params.id);
      if (!org) {
        throw new AppError('Organization not found', 404, 'NotFound');
      }

      if (!org.settings?.magic_login_enabled) {
        throw new AppError(
          'Magic login is not enabled for this organization. Enable it first.',
          400,
          'ValidationError'
        );
      }

      const user = await db.users.findById(request.body.user_id);
      if (!user) {
        throw new AppError('User not found', 404, 'NotFound');
      }

      // Verify user is a member of the organization
      const membership = await db.organizationMembers.findMembership(request.params.id, user.id);
      if (!membership) {
        throw new AppError('User is not a member of this organization', 400, 'ValidationError');
      }

      const expiresIn = request.body.expires_in || '30d';
      const token = generateMagicToken(fastify, user, request.params.id, expiresIn);

      return sendSuccess(reply, { token, expires_in: expiresIn });
    }
  );

  /**
   * GET /api/v1/admin/organizations/pending-hard-delete
   *
   * Platform-admin list of organizations that are soft-deleted AND have
   * aged past `ORG_RETENTION_DAYS`. The admin UI uses this to render the
   * "ready for permanent deletion" tab — each row exposes subdomain, name,
   * days-since-deleted, and counts of cascadable child rows (projects,
   * bug_reports) so the admin knows roughly what they're about to obliterate.
   */
  fastify.get(
    '/api/v1/admin/organizations/pending-hard-delete',
    { preHandler: [requirePlatformAdmin()] },
    async (_request, reply) => {
      const rows = await orgService.listPendingHardDelete(config.orgRetention.retentionDays);
      return sendSuccess(reply, {
        retention_days: config.orgRetention.retentionDays,
        orgs: rows,
      });
    }
  );

  /**
   * POST /api/v1/admin/organizations/:id/hard-delete
   *
   * Permanently delete a soft-deleted org past the retention window, with
   * FK cascade into projects / bug_reports / subscriptions / members /
   * invitations / invoices.
   *
   * Double-confirmation: the request body must echo the org's subdomain
   * (the string the admin typed into the UI's confirm field). If the
   * client lies or typos it, we refuse before touching the DB — matches
   * the GitHub "type the repo name to delete it" pattern.
   */
  fastify.post<{ Params: { id: string }; Body: { confirm_subdomain: string } }>(
    '/api/v1/admin/organizations/:id/hard-delete',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['confirm_subdomain'],
          properties: { confirm_subdomain: { type: 'string', minLength: 1 } },
          additionalProperties: false,
        },
      },
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      // Fetch first so we can compare the confirm string before doing any
      // damage. Service will re-check soft-delete + window.
      const org = await db.organizations.findByIdIncludeDeleted(request.params.id);
      if (!org) {
        throw new AppError('Organization not found', 404, 'NotFound');
      }
      if (request.body.confirm_subdomain !== org.subdomain) {
        throw new AppError(
          'Subdomain confirmation did not match — refusing hard-delete',
          400,
          'ValidationError'
        );
      }

      try {
        const result = await orgService.hardDeleteExpired(
          request.params.id,
          config.orgRetention.retentionDays,
          request.authUser!.id
        );
        orgHardDeleteTotal.inc({ result: 'success' });
        return sendSuccess(reply, result);
      } catch (err) {
        if (err instanceof AppError && err.statusCode === 409) {
          // Window-guard or concurrent-restore — not a bug, just ineligible.
          orgHardDeleteTotal.inc({ result: 'guard_failed' });
        } else {
          orgHardDeleteTotal.inc({ result: 'error' });
        }
        throw err;
      }
    }
  );
}
