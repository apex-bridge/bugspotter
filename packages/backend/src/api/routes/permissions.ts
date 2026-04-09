/**
 * Permissions routes
 * Centralized permission resolution for the authenticated user.
 * Returns computed permissions so the frontend doesn't need to re-derive them.
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { ProjectRole } from '../../types/project-roles.js';
import { isProjectRole, hasPermissionLevel } from '../../types/project-roles.js';
import { requireUser, isPlatformAdmin } from '../middleware/auth.js';
import { sendSuccess } from '../utils/response.js';
import { ROLE_LEVEL, ORG_MEMBER_ROLE } from '../../db/types.js';
import type { OrgMemberRole } from '../../db/types.js';

interface ProjectPermissions {
  role: ProjectRole;
  /** True when permissions are computed via system admin bypass, not actual membership */
  isSystemAdmin?: boolean;
  canManageIntegrations: boolean;
  canEditProject: boolean;
  canDeleteProject: boolean;
  canManageMembers: boolean;
  canDeleteReports: boolean;
  canUpload: boolean;
  canView: boolean;
}

interface OrgPermissions {
  role: OrgMemberRole;
  /** True when permissions are computed via system admin bypass, not actual membership */
  isSystemAdmin?: boolean;
  canManageMembers: boolean;
  canManageInvitations: boolean;
  canManageBilling: boolean;
}

interface PermissionsResponse {
  system: {
    role: string;
    isAdmin: boolean;
  };
  project?: ProjectPermissions;
  organization?: OrgPermissions;
}

const permissionsQuerySchema = {
  querystring: {
    type: 'object' as const,
    properties: {
      projectId: { type: 'string', format: 'uuid' },
      organizationId: { type: 'string', format: 'uuid' },
    },
  },
};

function computeProjectPermissions(
  userRole: ProjectRole,
  isSystemAdmin: boolean
): ProjectPermissions {
  return {
    role: userRole,
    ...(isSystemAdmin && { isSystemAdmin: true }),
    canManageIntegrations: isSystemAdmin || hasPermissionLevel(userRole, 'admin'),
    canEditProject: isSystemAdmin || hasPermissionLevel(userRole, 'admin'),
    canDeleteProject: isSystemAdmin || userRole === 'owner',
    canManageMembers: isSystemAdmin || hasPermissionLevel(userRole, 'admin'),
    canDeleteReports: isSystemAdmin || hasPermissionLevel(userRole, 'admin'),
    canUpload: isSystemAdmin || hasPermissionLevel(userRole, 'member'),
    canView: isSystemAdmin || hasPermissionLevel(userRole, 'viewer'),
  };
}

function hasOrgPermissionLevel(userRole: OrgMemberRole, requiredRole: OrgMemberRole): boolean {
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[requiredRole];
}

function computeOrgPermissions(orgRole: OrgMemberRole, isSystemAdmin: boolean): OrgPermissions {
  return {
    role: orgRole,
    ...(isSystemAdmin && { isSystemAdmin: true }),
    canManageMembers: isSystemAdmin || orgRole === ORG_MEMBER_ROLE.OWNER,
    canManageInvitations: isSystemAdmin || hasOrgPermissionLevel(orgRole, ORG_MEMBER_ROLE.ADMIN),
    canManageBilling: isSystemAdmin || orgRole === ORG_MEMBER_ROLE.OWNER,
  };
}

export function permissionRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  /**
   * GET /api/v1/me/permissions
   * Returns computed permissions for the authenticated user.
   * Accepts optional query params to scope to a project and/or organization.
   *
   * Query params:
   *   projectId - Project UUID to compute project-level permissions for
   *   organizationId - Organization UUID to compute org-level permissions for
   */
  fastify.get<{
    Querystring: { projectId?: string; organizationId?: string };
  }>(
    '/api/v1/me/permissions',
    {
      schema: permissionsQuerySchema,
      preHandler: [requireUser],
    },
    async (request, reply) => {
      const user = request.authUser!;
      const isSystemAdmin = isPlatformAdmin(user);
      const { projectId, organizationId } = request.query;

      const result: PermissionsResponse = {
        system: {
          role: user.role,
          isAdmin: isSystemAdmin,
        },
      };

      // Compute project permissions if requested
      if (projectId) {
        if (isSystemAdmin) {
          // System admins get full project permissions without membership
          result.project = computeProjectPermissions('owner', true);
        } else {
          const role = await db.projects.getUserRole(projectId, user.id);
          if (role && isProjectRole(role)) {
            result.project = computeProjectPermissions(role, false);
          }
          // If no role, project field is omitted (user has no access)
        }
      }

      // Compute org permissions if requested
      if (organizationId) {
        if (isSystemAdmin) {
          // System admins get full org permissions without membership
          result.organization = computeOrgPermissions(ORG_MEMBER_ROLE.OWNER, true);
        } else {
          const { membership } = await db.organizationMembers.checkOrganizationAccess(
            organizationId,
            user.id
          );
          if (membership) {
            result.organization = computeOrgPermissions(membership.role, false);
          }
          // If no membership, organization field is omitted
        }
      }

      return sendSuccess(reply, result);
    }
  );
}
