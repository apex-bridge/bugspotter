/**
 * Organization routes
 * CRUD operations for organizations, membership, quotas, and subscriptions.
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { DataResidencyRegion, OrgMemberRole, SubscriptionStatus } from '../../db/types.js';
import { OrganizationService } from '../../saas/services/organization.service.js';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response.js';
import { requirePlatformAdmin, requireUser } from '../middleware/auth.js';
import { guard } from '../authorization/index.js';
import {
  createOrganizationSchema,
  getOrganizationSchema,
  updateOrganizationSchema,
  getQuotaStatusSchema,
  getSubscriptionSchema,
  listMembersSchema,
  addMemberSchema,
  removeMemberSchema,
  listOrganizationsSchema,
  myOrganizationsSchema,
} from '../schemas/organization-schema.js';

interface CreateOrgBody {
  name: string;
  subdomain: string;
  data_residency_region?: DataResidencyRegion;
}

interface UpdateOrgBody {
  name?: string;
}

interface AddMemberBody {
  user_id: string;
  role: Exclude<OrgMemberRole, 'owner'>; // Cannot assign 'owner' role via API
}

interface ListOrgsQuery {
  page?: number;
  limit?: number;
  search?: string;
  subscription_status?: SubscriptionStatus;
  data_residency_region?: DataResidencyRegion;
  include_deleted?: boolean;
}

export function organizationRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  const service = new OrganizationService(db);

  /**
   * GET /api/v1/organizations
   * List all organizations (platform admin only).
   */
  fastify.get<{ Querystring: ListOrgsQuery }>(
    '/api/v1/organizations',
    {
      schema: listOrganizationsSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { page, limit, include_deleted, ...filters } = request.query;
      const result = await db.organizations.listWithMemberCount(
        { ...filters, includeDeleted: include_deleted },
        { page, limit }
      );
      return reply.send({
        success: true,
        data: result.data,
        pagination: result.pagination,
        timestamp: new Date().toISOString(),
      });
    }
  );

  /**
   * GET /api/v1/organizations/me
   * List organizations the authenticated user belongs to.
   */
  fastify.get(
    '/api/v1/organizations/me',
    {
      schema: myOrganizationsSchema,
      preHandler: [requireUser],
    },
    async (request, reply) => {
      const orgs = await db.organizations.findByUserId(request.authUser!.id);
      return reply.send({
        success: true,
        data: orgs,
        timestamp: new Date().toISOString(),
      });
    }
  );

  /**
   * POST /api/v1/organizations
   * Create a new organization. The authenticated user becomes the owner.
   */
  fastify.post<{ Body: CreateOrgBody }>(
    '/api/v1/organizations',
    {
      schema: createOrganizationSchema,
      preHandler: [requireUser],
    },
    async (request, reply) => {
      const org = await service.createOrganization(request.body, request.authUser!.id);
      return sendCreated(reply, org);
    }
  );

  /**
   * GET /api/v1/organizations/:id
   * Get organization details.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/organizations/:id',
    {
      schema: getOrganizationSchema,
      preHandler: [guard(db, { auth: 'user', resource: { type: 'organization' } })],
    },
    async (request, reply) => {
      // Organization already fetched and validated by requireOrgAccess middleware
      return sendSuccess(reply, request.organization!);
    }
  );

  /**
   * PATCH /api/v1/organizations/:id
   * Update organization (owner only).
   */
  fastify.patch<{ Params: { id: string }; Body: UpdateOrgBody }>(
    '/api/v1/organizations/:id',
    {
      schema: updateOrganizationSchema,
      preHandler: [
        guard(db, { auth: 'user', resource: { type: 'organization' }, orgRole: 'owner' }),
      ],
    },
    async (request, reply) => {
      const org = await service.updateOrganization(request.params.id, request.body);
      return sendSuccess(reply, org);
    }
  );

  /**
   * GET /api/v1/organizations/:id/quota
   * Get quota status for all resource types.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/organizations/:id/quota',
    {
      schema: getQuotaStatusSchema,
      preHandler: [guard(db, { auth: 'user', resource: { type: 'organization' } })],
    },
    async (request, reply) => {
      const status = await service.getQuotaStatus(request.params.id);
      return sendSuccess(reply, status);
    }
  );

  /**
   * GET /api/v1/organizations/:id/subscription
   * Get subscription details.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/organizations/:id/subscription',
    {
      schema: getSubscriptionSchema,
      preHandler: [guard(db, { auth: 'user', resource: { type: 'organization' } })],
    },
    async (request, reply) => {
      const subscription = await service.getSubscription(request.params.id);
      return sendSuccess(reply, subscription);
    }
  );

  /**
   * GET /api/v1/organizations/:id/members
   * List organization members with user details.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/organizations/:id/members',
    {
      schema: listMembersSchema,
      preHandler: [guard(db, { auth: 'user', resource: { type: 'organization' } })],
    },
    async (request, reply) => {
      const members = await service.getMembers(request.params.id);
      return sendSuccess(reply, members);
    }
  );

  /**
   * POST /api/v1/organizations/:id/members
   * Add a member to the organization (owner only).
   */
  fastify.post<{ Params: { id: string }; Body: AddMemberBody }>(
    '/api/v1/organizations/:id/members',
    {
      schema: addMemberSchema,
      preHandler: [
        guard(db, { auth: 'user', resource: { type: 'organization' }, orgRole: 'owner' }),
      ],
    },
    async (request, reply) => {
      const { user_id, role } = request.body;
      const member = await service.addMember(request.params.id, user_id, role);
      return sendCreated(reply, member);
    }
  );

  /**
   * DELETE /api/v1/organizations/:id/members/:userId
   * Remove a member from the organization (owner only).
   */
  fastify.delete<{ Params: { id: string; userId: string } }>(
    '/api/v1/organizations/:id/members/:userId',
    {
      schema: removeMemberSchema,
      preHandler: [
        guard(db, { auth: 'user', resource: { type: 'organization' }, orgRole: 'owner' }),
      ],
    },
    async (request, reply) => {
      await service.removeMember(request.params.id, request.params.userId);
      return sendNoContent(reply);
    }
  );
}
