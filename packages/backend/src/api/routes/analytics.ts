/**
 * Analytics Routes
 * Endpoints for dashboard metrics and analytics
 *
 * Two route families:
 * 1. Flat routes (/api/v1/analytics/...) — context-aware, resolve org scope
 *    from deployment mode + request context (self-hosted, SaaS tenant, multi-org)
 * 2. Org-param routes (/api/v1/organizations/:id/analytics/...) — explicit
 *    org scope via URL parameter, backward-compatible
 *
 * SECURITY: All analytics endpoints enforce admin-level access.
 * Flat routes use requireAnalyticsAccess (deployment-mode-aware).
 * Org-param routes use requireOrgRole with ADMIN role minimum.
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import { requireUser } from '../middleware/auth.js';
import { requireOrgRole } from '../middleware/org-access.js';
import { ORG_MEMBER_ROLE } from '../../db/types.js';
import type { AnalyticsService } from '../../analytics/analytics-service.js';
import { resolveAnalyticsScope } from '../../analytics/analytics-scope.js';
import { requireAnalyticsAccess } from '../../analytics/analytics-auth.js';

// Shared response shapes
const objectDataResponse = {
  200: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      data: { type: 'object' },
    },
  },
} as const;

const arrayDataResponse = {
  200: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      data: { type: 'array', items: { type: 'object' } },
    },
  },
} as const;

const orgIdParams = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

const trendQuerystring = {
  type: 'object',
  properties: {
    days: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
  },
} as const;

const analyticsSchemas = {
  dashboard: {
    params: orgIdParams,
    response: objectDataResponse,
  },
  trend: {
    params: orgIdParams,
    querystring: trendQuerystring,
    response: objectDataResponse,
  },
  projectStats: {
    params: orgIdParams,
    response: arrayDataResponse,
  },
  flatDashboard: {
    response: objectDataResponse,
  },
  flatTrend: {
    querystring: trendQuerystring,
    response: objectDataResponse,
  },
  flatProjectStats: {
    response: arrayDataResponse,
  },
};

export function analyticsRoutes(
  fastify: FastifyInstance,
  analytics: AnalyticsService,
  db: DatabaseClient
) {
  // ==========================================================================
  // Flat routes — context-aware org scope resolution
  // ==========================================================================

  // GET /api/v1/analytics/dashboard
  fastify.get(
    '/api/v1/analytics/dashboard',
    {
      preHandler: [requireUser, requireAnalyticsAccess(db)],
      schema: analyticsSchemas.flatDashboard,
    },
    async (request, reply) => {
      const scope = await resolveAnalyticsScope(request, db);
      const data = await analytics.getDashboardMetrics(scope.organizationIds);

      return reply.send({
        success: true,
        data,
      });
    }
  );

  // GET /api/v1/analytics/reports/trend
  fastify.get<{ Querystring: { days?: number } }>(
    '/api/v1/analytics/reports/trend',
    {
      preHandler: [requireUser, requireAnalyticsAccess(db)],
      schema: analyticsSchemas.flatTrend,
    },
    async (request, reply) => {
      const scope = await resolveAnalyticsScope(request, db);
      const { days = 30 } = request.query;
      const data = await analytics.getReportTrend(scope.organizationIds, days);

      return reply.send({
        success: true,
        data,
      });
    }
  );

  // GET /api/v1/analytics/projects/stats
  fastify.get(
    '/api/v1/analytics/projects/stats',
    {
      preHandler: [requireUser, requireAnalyticsAccess(db)],
      schema: analyticsSchemas.flatProjectStats,
    },
    async (request, reply) => {
      const scope = await resolveAnalyticsScope(request, db);
      const data = await analytics.getProjectStats(scope.organizationIds);

      return reply.send({
        success: true,
        data,
      });
    }
  );

  // ==========================================================================
  // Org-param routes — explicit org scope (backward-compatible)
  // ==========================================================================

  // Get dashboard overview (organization-scoped)
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/organizations/:id/analytics/dashboard',
    {
      preHandler: [requireUser, requireOrgRole(db, ORG_MEMBER_ROLE.ADMIN)],
      schema: analyticsSchemas.dashboard,
    },
    async (request, reply) => {
      const { id: orgId } = request.params;
      const data = await analytics.getDashboardMetrics([orgId]);

      return reply.send({
        success: true,
        data,
      });
    }
  );

  // Get report trend data (organization-scoped)
  fastify.get<{ Params: { id: string }; Querystring: { days?: number } }>(
    '/api/v1/organizations/:id/analytics/reports/trend',
    {
      preHandler: [requireUser, requireOrgRole(db, ORG_MEMBER_ROLE.ADMIN)],
      schema: analyticsSchemas.trend,
    },
    async (request, reply) => {
      const { id: orgId } = request.params;
      const { days = 30 } = request.query;

      const data = await analytics.getReportTrend([orgId], days);

      return reply.send({
        success: true,
        data,
      });
    }
  );

  // Get per-project statistics (organization-scoped)
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/organizations/:id/analytics/projects/stats',
    {
      preHandler: [requireUser, requireOrgRole(db, ORG_MEMBER_ROLE.ADMIN)],
      schema: analyticsSchemas.projectStats,
    },
    async (request, reply) => {
      const { id: orgId } = request.params;
      const data = await analytics.getProjectStats([orgId]);

      return reply.send({
        success: true,
        data,
      });
    }
  );
}
