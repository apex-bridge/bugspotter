/**
 * Organization Access Middleware
 * Fastify preHandler middleware for organization-level access control.
 * Must be used after requireUser in the preHandler chain.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { OrgMemberRole } from '../../db/types.js';
import { ROLE_LEVEL, ORG_MEMBER_ROLE } from '../../db/types.js';
import { AppError, ConfigurationError } from './error.js';
import { extractRouteParam, requireAuthContext } from './helpers.js';
import { isAdmin } from './auth/assertions.js';

/** Subset of OrganizationMember fields used by middleware for access decisions. */
type OrgMembershipInfo = {
  organization_id: string;
  user_id: string;
  role: OrgMemberRole;
};

/**
 * Core helper: resolve organization membership for a given org ID.
 * Validates the org exists, checks membership, and applies platform admin bypass.
 * Attaches the found organization to request.organization for reuse in handlers.
 *
 * Platform admins bypass the membership check — they receive synthetic
 * owner-level access to any organization for administrative purposes.
 */
async function resolveOrgMembership(
  db: DatabaseClient,
  request: FastifyRequest,
  orgId: string
): Promise<OrgMembershipInfo> {
  const { organization, membership } = await db.organizationMembers.checkOrganizationAccess(
    orgId,
    request.authUser!.id
  );

  if (!organization) {
    throw new AppError(`Organization not found: ${orgId}`, 404, 'NotFound');
  }

  request.organizationId = orgId;
  request.organization = organization;

  // Platform admins bypass membership check — synthetic owner-level access
  if (!membership && isAdmin(request)) {
    return {
      organization_id: orgId,
      user_id: request.authUser!.id,
      role: ORG_MEMBER_ROLE.OWNER,
    };
  }

  if (!membership) {
    throw new AppError('You are not a member of this organization', 403, 'Forbidden');
  }

  return membership;
}

/**
 * Validate org access for routes with an :id param.
 * Extracts the org ID from the route, then delegates to resolveOrgMembership.
 */
async function validateOrgMembership(
  db: DatabaseClient,
  request: FastifyRequest
): Promise<OrgMembershipInfo> {
  requireAuthContext(request, 'requireOrgAccess', 'user');
  const id = extractRouteParam(request, 'id', 'requireOrgAccess');
  return resolveOrgMembership(db, request, id);
}

/**
 * Require the authenticated user to be a member of the organization
 * identified by the :id route parameter.
 */
export function requireOrgAccess(db: DatabaseClient) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    await validateOrgMembership(db, request);
  };
}

/**
 * Require the authenticated user to have a specific role (or higher) in the organization.
 * Role hierarchy: owner > admin > member.
 */
export function requireOrgRole(db: DatabaseClient, minRole: OrgMemberRole) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const membership = await validateOrgMembership(db, request);

    if (ROLE_LEVEL[membership.role] < ROLE_LEVEL[minRole]) {
      throw new AppError(
        'You do not have sufficient permissions to perform this action',
        403,
        'Forbidden'
      );
    }
  };
}

/**
 * Require the authenticated user to have a specific role in the organization
 * resolved by the tenant middleware (request.organizationId).
 * Use this for routes without an :id param (e.g. billing endpoints in SaaS mode).
 */
export function requireTenantOrgRole(db: DatabaseClient, minRole: OrgMemberRole) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    requireAuthContext(request, 'requireTenantOrgRole', 'user');

    const orgId = request.organizationId;
    if (!orgId) {
      throw new ConfigurationError(
        'requireTenantOrgRole requires tenant middleware to set request.organizationId.',
        'requireTenantOrgRole'
      );
    }

    const membership = await resolveOrgMembership(db, request, orgId);

    if (ROLE_LEVEL[membership.role] < ROLE_LEVEL[minRole]) {
      throw new AppError(
        'You do not have sufficient permissions to perform this action',
        403,
        'Forbidden'
      );
    }
  };
}
