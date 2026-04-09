/**
 * Invitation Routes
 * Organization-scoped invitation management + public token acceptance.
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { InvitationRole } from '../../db/types.js';
import { ORG_MEMBER_ROLE } from '../../db/types.js';
import { InvitationService } from '../../saas/services/invitation.service.js';
import type { EmailLocale } from '../../saas/services/invitation-email.service.js';
import { InvitationEmailService } from '../../saas/services/invitation-email.service.js';
import { AppError } from '../middleware/error.js';
import { requireOrgRole } from '../middleware/org-access.js';
import { requireUser } from '../middleware/auth.js';
import { sendSuccess, sendCreated, sendNoContent, sendError } from '../utils/response.js';

interface CreateInvitationBody {
  email: string;
  role: InvitationRole;
  locale?: EmailLocale;
}

interface AcceptInvitationBody {
  token: string;
}

const createInvitationSchema = {
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

const listInvitationsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
};

const cancelInvitationSchema = {
  params: {
    type: 'object',
    required: ['id', 'invitationId'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      invitationId: { type: 'string', format: 'uuid' },
    },
  },
};

const acceptInvitationSchema = {
  body: {
    type: 'object',
    required: ['token'],
    properties: {
      token: { type: 'string', minLength: 64, maxLength: 64, pattern: '^[0-9a-f]{64}$' },
    },
    additionalProperties: false,
  },
};

const previewInvitationSchema = {
  querystring: {
    type: 'object',
    required: ['token'],
    properties: {
      token: { type: 'string', minLength: 64, maxLength: 64, pattern: '^[0-9a-f]{64}$' },
    },
    additionalProperties: false,
  },
};

export function invitationRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  const invitationService = new InvitationService(db);
  const emailService = new InvitationEmailService();

  /**
   * POST /api/v1/organizations/:id/invitations
   * Org admin/owner invites a user by email.
   */
  fastify.post<{ Params: { id: string }; Body: CreateInvitationBody }>(
    '/api/v1/organizations/:id/invitations',
    {
      schema: createInvitationSchema,
      preHandler: [requireUser, requireOrgRole(db, ORG_MEMBER_ROLE.ADMIN)],
    },
    async (request, reply) => {
      const { email, role, locale } = request.body;
      const invitation = await invitationService.createInvitation(
        request.params.id,
        email,
        role,
        request.authUser!.id
      );

      // Send email — org is guaranteed by requireOrgRole middleware
      const emailSent = await emailService.sendForInvitation({
        organizationName: request.organization!.name,
        invitation,
        inviter: request.authUser!,
        locale,
      });

      return sendCreated(reply, { invitation, email_sent: emailSent });
    }
  );

  /**
   * GET /api/v1/organizations/:id/invitations
   * List pending invitations for an organization.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/organizations/:id/invitations',
    {
      schema: listInvitationsSchema,
      preHandler: [requireUser, requireOrgRole(db, ORG_MEMBER_ROLE.ADMIN)],
    },
    async (request, reply) => {
      const invitations = await invitationService.listPendingInvitations(request.params.id);
      return sendSuccess(reply, invitations);
    }
  );

  /**
   * DELETE /api/v1/organizations/:id/invitations/:invitationId
   * Cancel a pending invitation.
   */
  fastify.delete<{ Params: { id: string; invitationId: string } }>(
    '/api/v1/organizations/:id/invitations/:invitationId',
    {
      schema: cancelInvitationSchema,
      preHandler: [requireUser, requireOrgRole(db, ORG_MEMBER_ROLE.ADMIN)],
    },
    async (request, reply) => {
      await invitationService.cancelInvitation(request.params.invitationId, request.params.id);
      return sendNoContent(reply);
    }
  );

  /**
   * GET /api/v1/invitations/preview
   * Public endpoint — returns display-safe invitation details by token.
   * Used by the frontend to pre-fill email and show org name on login/register.
   */
  fastify.get<{ Querystring: { token: string } }>(
    '/api/v1/invitations/preview',
    {
      schema: previewInvitationSchema,
      config: { public: true },
    },
    async (request, reply) => {
      const preview = await invitationService.previewInvitation(request.query.token);
      return sendSuccess(reply, preview);
    }
  );

  /**
   * POST /api/v1/invitations/accept
   * Accept an invitation by token. Requires authentication.
   * Auto-joins the authenticated user to the organization.
   * Enforces that the authenticated user's email matches the invitation email.
   */
  fastify.post<{ Body: AcceptInvitationBody }>(
    '/api/v1/invitations/accept',
    {
      schema: acceptInvitationSchema,
      preHandler: [requireUser],
    },
    async (request, reply) => {
      try {
        const { invitation, joined } = await invitationService.acceptInvitation(
          request.body.token,
          request.authUser!.id,
          request.authUser!.email
        );
        return sendSuccess(reply, { invitation, joined });
      } catch (error) {
        // Intentionally bypass the global error handler for EmailMismatch.
        // The global handler strips `details` from AppError in production as a
        // safety net against leaking sensitive data. Here we use sendError()
        // directly because: (1) the details only contain { invitation_email,
        // current_user_email } which the user already knows (they're logged in,
        // and the invitation email was shown on the preview page), and (2) the
        // frontend needs these details to render the mismatch UI.
        if (error instanceof AppError && error.error === 'EmailMismatch') {
          const details = error.details as Record<string, unknown> | undefined;
          request.log.warn(
            {
              invitation_email: details?.invitation_email,
              current_user_email: details?.current_user_email,
            },
            'Invitation email mismatch — possible misconfigured flow or intercepted token'
          );
          return sendError(reply, 403, 'EmailMismatch', error.message, request.id, error.details);
        }
        throw error;
      }
    }
  );
}
