/**
 * Admin Organization Request Routes
 * Platform admin endpoints for reviewing, approving, and rejecting
 * organization registration requests. All routes require platform admin.
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { OrganizationRequest, PlanName } from '../../db/types.js';
import { ORG_REQUEST_STATUS } from '../../db/types.js';
import { OrganizationService } from '../../saas/services/organization.service.js';
import { requirePlatformAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { sendSuccess, sendNoContent, sendPaginated } from '../utils/response.js';
import {
  listOrgRequestsSchema,
  getOrgRequestSchema,
  approveOrgRequestSchema,
  rejectOrgRequestSchema,
  deleteOrgRequestSchema,
} from '../schemas/organization-request-schema.js';
import { getLogger } from '../../logger.js';
import type { OrgRequestEmailService } from '../../saas/services/org-request-email.service.js';

const logger = getLogger();

interface ListQuery {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  sort_by?: string;
  order?: 'asc' | 'desc';
}

interface ApproveBody {
  plan?: PlanName;
  admin_notes?: string;
}

interface RejectBody {
  rejection_reason: string;
  admin_notes?: string;
}

export function adminOrganizationRequestRoutes(
  fastify: FastifyInstance,
  db: DatabaseClient,
  emailService?: OrgRequestEmailService
) {
  const orgService = new OrganizationService(db);

  /**
   * GET /api/v1/admin/organization-requests
   * List organization requests with filtering and pagination
   */
  fastify.get<{ Querystring: ListQuery }>(
    '/api/v1/admin/organization-requests',
    {
      schema: listOrgRequestsSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const {
        page = 1,
        limit = 20,
        status,
        search,
        sort_by = 'created_at',
        order = 'desc',
      } = request.query;

      const result = await db.organizationRequests.listForAdmin(
        {
          status: status as
            | (typeof ORG_REQUEST_STATUS)[keyof typeof ORG_REQUEST_STATUS]
            | undefined,
          search,
        },
        { limit, offset: (page - 1) * limit },
        { sort_by, order }
      );

      return sendPaginated(reply, result.data, result.pagination);
    }
  );

  /**
   * GET /api/v1/admin/organization-requests/:id
   * Get a single organization request
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/admin/organization-requests/:id',
    {
      schema: getOrgRequestSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { id } = request.params;
      const orgRequest = await db.organizationRequests.findById(id);

      if (!orgRequest) {
        throw new AppError('Organization request not found', 404, 'Not Found');
      }

      return sendSuccess(reply, orgRequest);
    }
  );

  /**
   * PATCH /api/v1/admin/organization-requests/:id/approve
   * Approve a request — creates the organization and sends approval email
   */
  fastify.patch<{ Params: { id: string }; Body: ApproveBody }>(
    '/api/v1/admin/organization-requests/:id/approve',
    {
      schema: approveOrgRequestSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { id } = request.params;
      const { plan, admin_notes } = request.body ?? {};
      const adminUser = request.authUser!;

      // Atomically claim the request to prevent concurrent approvals.
      // Only one admin can succeed — the WHERE clause ensures the row
      // must be 'verified' and not yet claimed by another admin.
      const claimResult = await db.query<OrganizationRequest>(
        `UPDATE saas.organization_requests
         SET reviewed_by = $2, reviewed_at = NOW(), admin_notes = $3
         WHERE id = $1 AND status = 'verified' AND reviewed_by IS NULL
         RETURNING *`,
        [id, adminUser.id, admin_notes || null]
      );

      if (claimResult.rowCount === 0) {
        const orgRequest = await db.organizationRequests.findById(id);
        if (!orgRequest) {
          throw new AppError('Organization request not found', 404, 'Not Found');
        }
        throw new AppError(
          `Cannot approve request with status "${orgRequest.status}". Only verified requests can be approved.`,
          409,
          'Conflict'
        );
      }

      const orgRequest = claimResult.rows[0];

      // Create the organization via existing admin flow.
      // Pass adminUser.id so an invitation can be created when the owner email
      // doesn't yet have an account in the system.
      let createResult;
      try {
        createResult = await orgService.adminCreateOrganization(
          {
            name: orgRequest.company_name,
            subdomain: orgRequest.subdomain,
            owner_email: orgRequest.contact_email,
            plan_name: plan,
            data_residency_region: orgRequest.data_residency_region,
          },
          adminUser.id
        );
      } catch (error) {
        // Rollback the claim so another admin can retry
        await db.query(
          `UPDATE saas.organization_requests
           SET reviewed_by = NULL, reviewed_at = NULL, admin_notes = NULL
           WHERE id = $1`,
          [id]
        );
        throw error;
      }

      // Finalize: set status to approved and link the created organization
      const updated = await db.organizationRequests.updateStatus(id, ORG_REQUEST_STATUS.APPROVED, {
        organization_id: createResult.organization.id,
      });

      if (!updated) {
        throw new AppError(
          'Failed to finalize approval — request may have been deleted',
          500,
          'Internal Server Error'
        );
      }

      // Send approval email (non-blocking)
      if (emailService) {
        await emailService.sendApprovalEmail({
          recipientEmail: orgRequest.contact_email,
          contactName: orgRequest.contact_name,
          companyName: orgRequest.company_name,
          subdomain: orgRequest.subdomain,
        });
      }

      logger.info('Organization request approved', {
        requestId: id,
        organizationId: createResult.organization.id,
        approvedBy: adminUser.id,
      });

      return sendSuccess(reply, updated);
    }
  );

  /**
   * PATCH /api/v1/admin/organization-requests/:id/reject
   * Reject a request with a reason, and send rejection email
   */
  fastify.patch<{ Params: { id: string }; Body: RejectBody }>(
    '/api/v1/admin/organization-requests/:id/reject',
    {
      schema: rejectOrgRequestSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { id } = request.params;
      const { rejection_reason, admin_notes } = request.body;
      const adminUser = request.authUser!;

      // Atomically reject to prevent race with concurrent approval.
      const rejectResult = await db.query<OrganizationRequest>(
        `UPDATE saas.organization_requests
         SET status = 'rejected',
             reviewed_by = $2,
             reviewed_at = NOW(),
             rejection_reason = $3,
             admin_notes = $4
         WHERE id = $1 AND status IN ('pending_verification', 'verified') AND reviewed_by IS NULL
         RETURNING *`,
        [id, adminUser.id, rejection_reason, admin_notes || null]
      );

      if (rejectResult.rowCount === 0) {
        const orgRequest = await db.organizationRequests.findById(id);
        if (!orgRequest) {
          throw new AppError('Organization request not found', 404, 'Not Found');
        }
        throw new AppError(
          `Cannot reject request with status "${orgRequest.status}".`,
          409,
          'Conflict'
        );
      }

      const updated = rejectResult.rows[0];

      // Send rejection email (non-blocking)
      if (emailService) {
        await emailService.sendRejectionEmail({
          recipientEmail: updated.contact_email,
          contactName: updated.contact_name,
          companyName: updated.company_name,
          rejectionReason: rejection_reason,
        });
      }

      logger.info('Organization request rejected', {
        requestId: id,
        rejectedBy: adminUser.id,
        reason: rejection_reason,
      });

      return sendSuccess(reply, updated);
    }
  );

  /**
   * DELETE /api/v1/admin/organization-requests/:id
   * Hard-delete a spam/junk request
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/admin/organization-requests/:id',
    {
      schema: deleteOrgRequestSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { id } = request.params;

      const orgRequest = await db.organizationRequests.findById(id);
      if (!orgRequest) {
        throw new AppError('Organization request not found', 404, 'Not Found');
      }

      if (orgRequest.status === ORG_REQUEST_STATUS.APPROVED) {
        throw new AppError(
          'Cannot delete an approved request (organization already created)',
          409,
          'Conflict'
        );
      }

      await db.organizationRequests.delete(id);

      logger.info('Organization request deleted', {
        requestId: id,
        deletedBy: request.authUser!.id,
      });

      return sendNoContent(reply);
    }
  );
}
