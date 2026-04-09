/**
 * Quota Enforcement Middleware
 * Checks plan quotas before resource creation in SaaS mode.
 * No-op in self-hosted mode or when no organization context is present.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { OrganizationService } from '../services/organization.service.js';
import type { ResourceType } from '../../db/types.js';
import { getDeploymentConfig } from '../config.js';
import { AppError } from '../../api/middleware/error.js';
import { getQuotaForPlan } from '../plans.js';

/**
 * Factory that returns a Fastify preHandler enforcing quota for a resource type.
 * For period-based resources (e.g. BUG_REPORTS), atomically reserves quota
 * (increment + limit check in one SQL statement) to prevent race conditions.
 * For count-based resources (PROJECTS), uses a read-only check.
 *
 * Skips enforcement when:
 * - Deployment mode has quotaEnforcement disabled (self-hosted)
 * - No organizationId on the request (self-hosted project)
 */
export function requireQuota(service: OrganizationService, resourceType: ResourceType) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    /**
     * Skip quota enforcement when:
     * 1. quotaEnforcement is disabled (self-hosted deployment)
     * 2. request.organizationId is undefined
     *
     * request.organizationId is populated by auth middleware in two scenarios:
     * - API Key auth: Extracted from project → organization lookup
     * - JWT auth: Extracted from user's token claims
     *
     * When undefined, it indicates:
     * - Self-hosted project (no organization)
     * - Unauthenticated request on public route
     * - Pre-auth routes (health checks, login)
     *
     * In these cases, quota enforcement doesn't apply because:
     * - Self-hosted mode has no quotas
     * - Public routes don't create resources
     */
    if (!getDeploymentConfig().features.quotaEnforcement || !request.organizationId) {
      return;
    }

    const reserved = await service.reserveQuota(request.organizationId, resourceType);
    if (!reserved) {
      // Fetch subscription info to provide helpful error context
      const subscription = await service.getSubscription(request.organizationId);
      const quotas = getQuotaForPlan(subscription.plan_name);
      const limit = quotas[resourceType];

      // Build user-friendly resource name
      const resourceName = resourceType
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());

      throw new AppError(
        `You have reached your ${subscription.plan_name} plan limit of ${limit} ${resourceName.toLowerCase()}. Upgrade your plan to create more resources.`,
        429,
        'QuotaExceeded',
        {
          resourceType,
          limit,
          planName: subscription.plan_name,
          hint: 'Consider upgrading to a higher plan tier for increased quotas.',
        }
      );
    }
  };
}
