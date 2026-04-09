/**
 * Analytics Auth Middleware
 * Deployment-mode-aware authorization for analytics routes.
 * Must be used after requireUser in the preHandler chain.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseClient } from '../db/client.js';
import { ORG_MEMBER_ROLE, ROLE_LEVEL } from '../db/types.js';
import { getDeploymentConfig, DEPLOYMENT_MODE } from '../saas/config.js';
import { AppError } from '../api/middleware/error.js';
import { isPlatformAdmin } from '../api/middleware/auth.js';

const MIN_ANALYTICS_ROLE = ORG_MEMBER_ROLE.ADMIN;

/**
 * Require analytics access based on deployment mode.
 *
 * - Platform admin (any mode): always allowed
 * - Self-hosted non-admin: denied
 * - SaaS + tenant context (subdomain): require admin/owner in that org
 * - SaaS + no tenant context (hub domain): require admin/owner in at least one org
 */
export function requireAnalyticsAccess(db: DatabaseClient) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const user = request.authUser;
    if (!user) {
      throw new AppError('Authentication required', 401, 'Unauthorized');
    }

    // Platform admin bypass — full analytics access in any deployment mode
    if (isPlatformAdmin(user)) {
      return;
    }

    const config = getDeploymentConfig();

    // Self-hosted: only platform admins (handled above)
    if (config.mode !== DEPLOYMENT_MODE.SAAS) {
      throw new AppError('Admin access required for analytics', 403, 'Forbidden');
    }

    // SaaS + tenant context (subdomain resolved by tenant middleware)
    if (request.organizationId) {
      const { organization, membership } = await db.organizationMembers.checkOrganizationAccess(
        request.organizationId,
        user.id
      );

      if (!organization) {
        throw new AppError('Organization not found', 404, 'NotFound');
      }

      if (!membership) {
        throw new AppError('You are not a member of this organization', 403, 'Forbidden');
      }

      if (ROLE_LEVEL[membership.role] < ROLE_LEVEL[MIN_ANALYTICS_ROLE]) {
        throw new AppError('Admin access required for analytics', 403, 'Forbidden');
      }
      return;
    }

    // SaaS + no tenant context (hub domain)
    // Require admin/owner in at least one organization
    const memberships = await db.organizationMembers.findByUserId(user.id);
    const hasAdminAccess = memberships.some(
      (m) => ROLE_LEVEL[m.role] >= ROLE_LEVEL[MIN_ANALYTICS_ROLE]
    );

    if (!hasAdminAccess) {
      throw new AppError(
        'Admin access required for analytics in at least one organization',
        403,
        'Forbidden'
      );
    }
  };
}
