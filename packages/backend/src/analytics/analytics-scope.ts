/**
 * Analytics Scope Resolution
 * Determines the organization filter for analytics queries based on
 * deployment mode and request context.
 */

import type { FastifyRequest } from 'fastify';
import type { DatabaseClient } from '../db/client.js';
import { ORG_MEMBER_ROLE, ROLE_LEVEL } from '../db/types.js';
import { getDeploymentConfig, DEPLOYMENT_MODE } from '../saas/config.js';
import { AppError } from '../api/middleware/error.js';
import { isPlatformAdmin } from '../api/middleware/auth.js';

const MIN_ANALYTICS_ROLE = ORG_MEMBER_ROLE.ADMIN;

export interface AnalyticsScope {
  /** null = no org filter (self-hosted), array = filter to these org IDs */
  organizationIds: string[] | null;
}

/**
 * Resolve the analytics scope from the current request context.
 *
 * Resolution priority:
 * 1. Self-hosted mode → null (no filter, all data)
 * 2. SaaS mode with request.organizationId (from tenant middleware) → [orgId]
 * 3. SaaS mode, no org context → aggregate across user's org memberships
 * 4. SaaS mode, no org context, no memberships → throw 403
 */
export async function resolveAnalyticsScope(
  request: FastifyRequest,
  db: DatabaseClient
): Promise<AnalyticsScope> {
  const config = getDeploymentConfig();

  // Self-hosted: no org filter, return all data
  if (config.mode !== DEPLOYMENT_MODE.SAAS) {
    return { organizationIds: null };
  }

  // SaaS mode: tenant middleware set organizationId from subdomain
  if (request.organizationId) {
    return { organizationIds: [request.organizationId] };
  }

  // Platform admin on hub domain: full analytics access (no org filter)
  if (isPlatformAdmin(request)) {
    return { organizationIds: null };
  }

  // SaaS mode but no org context (hub domain / no subdomain)
  // Aggregate across orgs where user has admin/owner role only —
  // a member-role user should not see analytics for orgs they don't administer
  const userId = request.authUser?.id;
  if (!userId) {
    throw new AppError('Authentication required', 401, 'Unauthorized');
  }

  const memberships = await db.organizationMembers.findByUserId(userId);
  const adminOrgs = memberships.filter((m) => ROLE_LEVEL[m.role] >= ROLE_LEVEL[MIN_ANALYTICS_ROLE]);

  if (adminOrgs.length === 0) {
    throw new AppError('You are not an admin of any organization', 403, 'Forbidden');
  }

  return {
    organizationIds: adminOrgs.map((m) => m.organization_id),
  };
}
