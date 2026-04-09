/**
 * Audit Log API Routes
 * Provides read-only access to audit logs for administrators
 *
 * Security Features:
 * - Fastify schema validation for all query parameters
 * - Dual-level access: platform admin (all logs) or org admin/owner (org-scoped)
 * - Whitelisted sort_by values to prevent SQL injection
 * - Validated date formats (ISO 8601)
 * - Clamped pagination limits (max 100 per page)
 * - UUID format validation for IDs
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type {
  AuditLogFilters,
  AuditLogSortOptions,
} from '../../db/repositories/audit-log.repository.js';
import { requireUser, isPlatformAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { getLogger } from '../../logger.js';
import {
  listAuditLogsSchema,
  getAuditLogByIdSchema,
  getAuditLogStatisticsSchema,
  getRecentAuditLogsSchema,
  getAuditLogsByUserSchema,
} from '../schemas/audit-log-schema.js';

const logger = getLogger();

/**
 * Parse and validate date string
 * Returns null if invalid to allow fallback behavior
 */
function parseDate(dateString: string | undefined): Date | null {
  if (!dateString) {
    return null;
  }
  const date = new Date(dateString);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Register audit log routes
 */
export function auditLogRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  /**
   * Dual-level access: platform admin sees all, org owner/admin sees their org.
   * Sets request.auditOrgScope: null (all) or string (org-scoped).
   */
  async function requireAuditAccess(
    request: import('fastify').FastifyRequest,
    _reply: import('fastify').FastifyReply
  ) {
    const user = request.authUser;
    if (!user) {
      throw new AppError('Authentication required', 401, 'Unauthorized');
    }

    // Optional org filter from query param (available to all authorized users)
    const query = request.query as Record<string, unknown>;
    const requestedOrgId = query.organization_id as string | undefined;

    // Platform admin: full access by default, can optionally filter by org
    if (isPlatformAdmin(user)) {
      request.auditOrgScope = requestedOrgId ?? null; // null = all orgs
      return;
    }

    // Get user's org memberships with admin/owner role
    const memberships = await db.organizationMembers.findByUserId(user.id);
    const adminMemberships = (memberships || []).filter(
      (m) => m.role === 'owner' || m.role === 'admin'
    );

    if (adminMemberships.length === 0) {
      throw new AppError(
        'Insufficient permissions. Required role: org admin or platform admin',
        403,
        'Forbidden'
      );
    }

    if (requestedOrgId) {
      // Verify user is admin/owner of the requested org
      const match = adminMemberships.find((m) => m.organization_id === requestedOrgId);
      if (!match) {
        throw new AppError('You do not have admin access to this organization', 403, 'Forbidden');
      }
      request.auditOrgScope = requestedOrgId;
    } else if (adminMemberships.length === 1) {
      // Single admin org — auto-scope
      request.auditOrgScope = adminMemberships[0].organization_id;
    } else {
      // Multiple admin orgs, no org specified — require explicit selection
      throw new AppError(
        'You are admin of multiple organizations. Specify organization_id query parameter.',
        400,
        'BadRequest'
      );
    }
  }
  /**
   * GET /api/v1/audit-logs
   * List audit logs with filtering, sorting, and pagination
   * Schema validates all inputs and prevents injection attacks
   */
  fastify.get<{
    Querystring: {
      user_id?: string;
      action?: string;
      resource?: string;
      success?: string;
      start_date?: string;
      end_date?: string;
      sort_by?: 'timestamp' | 'action' | 'resource';
      sort_order?: 'asc' | 'desc';
      page?: number;
      limit?: number;
    };
  }>(
    '/api/v1/audit-logs',
    {
      schema: listAuditLogsSchema,
      preHandler: [requireUser, requireAuditAccess],
    },
    async (request, reply) => {
      try {
        const {
          user_id,
          action,
          resource,
          success,
          start_date,
          end_date,
          sort_by = 'timestamp',
          sort_order = 'desc',
          page = 1,
          limit = 50,
        } = request.query;

        // Apply org scope (set by requireAuditAccess middleware)
        const orgScope = request.auditOrgScope ?? null;

        // Build filters - schema already validated format
        const filters: AuditLogFilters = {};
        if (orgScope) {
          filters.organization_id = orgScope;
        }
        if (user_id) {
          filters.user_id = user_id;
        }
        if (action) {
          filters.action = action;
        }
        if (resource) {
          filters.resource = resource;
        }
        if (success !== undefined) {
          filters.success = success === 'true';
        }

        // Parse dates with validation
        const startDate = parseDate(start_date);
        const endDate = parseDate(end_date);

        if (start_date && !startDate) {
          return reply.status(400).send({
            success: false,
            error: 'Invalid start_date format. Use ISO 8601 format.',
          });
        }
        if (end_date && !endDate) {
          return reply.status(400).send({
            success: false,
            error: 'Invalid end_date format. Use ISO 8601 format.',
          });
        }

        if (startDate) {
          filters.start_date = startDate;
        }
        if (endDate) {
          filters.end_date = endDate;
        }

        // Schema already validated page/limit ranges
        const pageNum = page;
        const pageSize = limit;

        // Build sort options - schema already whitelisted values
        const sortOptions: AuditLogSortOptions = {
          sort_by,
          order: sort_order,
        };

        // Fetch audit logs
        const result = await db.auditLogs.list(filters, sortOptions, pageNum, pageSize);

        logger.debug('Audit logs retrieved', {
          filters,
          total: result.pagination.total,
          page: pageNum,
          limit: pageSize,
        });

        return reply.send({
          success: true,
          ...result,
        });
      } catch (error) {
        logger.error('Failed to retrieve audit logs', { error });
        return reply.status(500).send({
          success: false,
          error: 'Failed to retrieve audit logs',
        });
      }
    }
  );

  /**
   * GET /api/v1/audit-logs/:id
   * Get a specific audit log entry by ID
   * Schema validates UUID format
   */
  fastify.get<{
    Params: {
      id: string;
    };
  }>(
    '/api/v1/audit-logs/:id',
    {
      schema: getAuditLogByIdSchema,
      preHandler: [requireUser, requireAuditAccess],
    },
    async (request, reply) => {
      try {
        const { id } = request.params;

        const orgScope = request.auditOrgScope ?? null;

        const auditLog = await db.auditLogs.findById(id);

        if (!auditLog) {
          return reply.status(404).send({
            success: false,
            error: 'Audit log not found',
          });
        }

        // Org-scoped users can only see their org's logs
        if (orgScope && auditLog.organization_id !== orgScope) {
          return reply.status(404).send({
            success: false,
            error: 'Audit log not found',
          });
        }

        return reply.send({
          success: true,
          data: auditLog,
        });
      } catch (error) {
        logger.error('Failed to retrieve audit log', { error, id: request.params.id });
        return reply.status(500).send({
          success: false,
          error: 'Failed to retrieve audit log',
        });
      }
    }
  );

  /**
   * GET /api/v1/audit-logs/statistics
   * Get audit log statistics (totals by action, user, success/failure)
   */
  fastify.get(
    '/api/v1/audit-logs/statistics',
    {
      schema: getAuditLogStatisticsSchema,
      preHandler: [requireUser, requireAuditAccess],
    },
    async (request, reply) => {
      try {
        const orgScope = request.auditOrgScope ?? null;
        const stats = await db.auditLogs.getStatistics(undefined, undefined, orgScope || undefined);

        return reply.send({
          success: true,
          data: stats,
        });
      } catch (error) {
        logger.error('Failed to retrieve audit log statistics', { error });
        return reply.status(500).send({
          success: false,
          error: 'Failed to retrieve statistics',
        });
      }
    }
  );

  /**
   * GET /api/v1/audit-logs/recent
   * Get the most recent audit logs (up to 500)
   * Schema validates and clamps limit parameter
   */
  fastify.get<{
    Querystring: {
      limit?: number;
    };
  }>(
    '/api/v1/audit-logs/recent',
    {
      schema: getRecentAuditLogsSchema,
      preHandler: [requireUser, requireAuditAccess],
    },
    async (request, reply) => {
      try {
        const { limit = 100 } = request.query;

        const orgScope = request.auditOrgScope ?? null;

        // Schema already validated range (1-500)
        const auditLogs = await db.auditLogs.getRecent(limit, orgScope || undefined);

        return reply.send({
          success: true,
          data: auditLogs,
          count: auditLogs.length,
        });
      } catch (error) {
        logger.error('Failed to retrieve recent audit logs', { error });
        return reply.status(500).send({
          success: false,
          error: 'Failed to retrieve recent audit logs',
        });
      }
    }
  );

  /**
   * GET /api/v1/audit-logs/user/:userId
   * Get all audit logs for a specific user
   * Schema validates UUID format for userId
   */
  fastify.get<{
    Params: {
      userId: string;
    };
    Querystring: {
      limit?: number;
    };
  }>(
    '/api/v1/audit-logs/user/:userId',
    {
      schema: getAuditLogsByUserSchema,
      preHandler: [requireUser, requireAuditAccess],
    },
    async (request, reply) => {
      try {
        const { userId } = request.params;
        const { limit = 100 } = request.query;

        const orgScope = request.auditOrgScope ?? null;

        // Schema already validated range (1-500)
        const logs = await db.auditLogs.findByUserId(userId, limit, orgScope || undefined);

        return reply.send({
          success: true,
          data: logs,
          count: logs.length,
        });
      } catch (error) {
        logger.error('Failed to retrieve user audit logs', {
          error,
          userId: request.params.userId,
        });
        return reply.status(500).send({
          success: false,
          error: 'Failed to retrieve user audit logs',
        });
      }
    }
  );

  logger.info('Audit log routes registered');
}
