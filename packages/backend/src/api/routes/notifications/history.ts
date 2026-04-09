/**
 * Notification history routes
 * Query operations for notification delivery history
 *
 * SECURITY: All history endpoints are scoped to a specific organization
 * to prevent cross-tenant data leaks. The organizationId is required in the
 * URL path and validated via requireOrgRole middleware.
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../../db/client.js';
import type { HistoryQuerystring } from './types.js';
import type { NotificationStatus } from '../../../types/notifications.js';
import { listHistorySchema, getHistoryItemSchema } from '../../schemas/notification-schema.js';
import { requireUser } from '../../middleware/auth.js';
import { requireOrgRole } from '../../middleware/org-access.js';
import { ORG_MEMBER_ROLE } from '../../../db/types.js';
import { sendSuccess } from '../../utils/response.js';
import { findOrThrow } from '../../utils/resource.js';
import { buildPagination, buildEmptyPagination } from '../../utils/query-builder.js';
import { AppError } from '../../middleware/error.js';

/**
 * Type guard to validate notification status
 * Ensures runtime type safety beyond schema validation
 */
function isNotificationStatus(value: string): value is NotificationStatus {
  return ['sent', 'failed', 'pending', 'throttled'].includes(value);
}

/**
 * Validate that notification history filter resources belong to organization projects
 * Prevents cross-tenant data leaks by ensuring filter IDs are within scope
 */
async function validateHistoryResourceAccess(
  db: DatabaseClient,
  orgProjectIds: string[],
  filters: { channel_id?: string; rule_id?: string; bug_id?: string }
): Promise<void> {
  const { channel_id, rule_id, bug_id } = filters;

  // Validate channel belongs to organization's projects
  if (channel_id) {
    const channel = await db.notificationChannels.findById(channel_id);
    if (!channel) {
      throw new AppError('Channel not found', 404, 'NotFound');
    }
    if (!orgProjectIds.includes(channel.project_id)) {
      throw new AppError('Access denied to notification history', 403, 'Forbidden');
    }
  }

  // Validate rule belongs to organization's projects
  if (rule_id) {
    const rule = await db.notificationRules.findById(rule_id);
    if (!rule) {
      throw new AppError('Rule not found', 404, 'NotFound');
    }
    if (!orgProjectIds.includes(rule.project_id)) {
      throw new AppError('Access denied to notification history', 403, 'Forbidden');
    }
  }

  // Validate bug report belongs to organization's projects
  if (bug_id) {
    const bug = await db.bugReports.findById(bug_id);
    if (!bug) {
      throw new AppError('Bug report not found', 404, 'NotFound');
    }
    if (!orgProjectIds.includes(bug.project_id)) {
      throw new AppError('Access denied to notification history', 403, 'Forbidden');
    }
  }
}

/**
 * Determine project ID from a history entry via its associated resources
 */
async function getHistoryProjectId(
  db: DatabaseClient,
  historyItem: { channel_id?: string | null; rule_id?: string | null; bug_id?: string | null }
): Promise<string | null> {
  if (historyItem.channel_id) {
    const channel = await db.notificationChannels.findById(historyItem.channel_id);
    return channel?.project_id || null;
  }

  if (historyItem.rule_id) {
    const rule = await db.notificationRules.findById(historyItem.rule_id);
    return rule?.project_id || null;
  }

  if (historyItem.bug_id) {
    const bug = await db.bugReports.findById(historyItem.bug_id);
    return bug?.project_id || null;
  }

  return null;
}

/**
 * Get all project IDs belonging to an organization
 */
async function getOrganizationProjectIds(
  db: DatabaseClient,
  organizationId: string
): Promise<string[]> {
  const projects = await db.projects.findByOrganizationId(organizationId);
  return projects.map((p) => p.id);
}

/**
 * Register notification history routes (organization-scoped)
 */
export function registerHistoryRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  /**
   * GET /api/v1/organizations/:id/notifications/history
   * List notification delivery history with filtering and pagination
   *
   * SECURITY: Scoped to organization - only returns history for projects
   * belonging to the authenticated user's organization.
   */
  fastify.get<{ Params: { id: string }; Querystring: HistoryQuerystring }>(
    '/api/v1/organizations/:id/notifications/history',
    {
      schema: listHistorySchema,
      preHandler: [requireUser, requireOrgRole(db, ORG_MEMBER_ROLE.MEMBER)],
    },
    async (request, reply) => {
      const { id: organizationId } = request.params;
      const { channel_id, rule_id, bug_id, status, created_after, created_before, page, limit } =
        request.query;

      // Get all projects in this organization for filtering
      const orgProjectIds = await getOrganizationProjectIds(db, organizationId);

      // If organization has no projects, return empty result
      if (orgProjectIds.length === 0) {
        const pagination = buildPagination(page, limit);
        return sendSuccess(reply, {
          history: [],
          pagination: buildEmptyPagination(pagination),
        });
      }

      // Security: Validate filter IDs belong to organization's projects
      if (channel_id || rule_id || bug_id) {
        await validateHistoryResourceAccess(db, orgProjectIds, {
          channel_id,
          rule_id,
          bug_id,
        });
      }

      // Build filters including organization project scope
      const filters = {
        ...(channel_id && { channel_id }),
        ...(rule_id && { rule_id }),
        ...(bug_id && { bug_id }),
        ...(status && isNotificationStatus(status) && { status }),
        ...(created_after && { created_after: new Date(created_after) }),
        ...(created_before && { created_before: new Date(created_before) }),
        // SECURITY: Scope to organization's projects via channel/rule/bug joins
        organization_project_ids: orgProjectIds,
      };

      const pagination = buildPagination(page, limit);
      const result = await db.notificationHistory.findAllByOrganization(filters, pagination);

      return sendSuccess(reply, {
        history: result.data,
        pagination: result.pagination,
      });
    }
  );

  /**
   * GET /api/v1/organizations/:id/notifications/history/:historyId
   * Get a specific notification history entry
   *
   * SECURITY: Validates the history entry belongs to a project in the
   * authenticated user's organization before returning.
   */
  fastify.get<{ Params: { id: string; historyId: string } }>(
    '/api/v1/organizations/:id/notifications/history/:historyId',
    {
      schema: getHistoryItemSchema,
      preHandler: [requireUser, requireOrgRole(db, ORG_MEMBER_ROLE.MEMBER)],
    },
    async (request, reply) => {
      const { id: organizationId, historyId } = request.params;

      const historyItem = await findOrThrow(
        () => db.notificationHistory.findByIdWithDetails(historyId),
        'History entry'
      );

      // Get all projects in this organization
      const orgProjectIds = await getOrganizationProjectIds(db, organizationId);

      // Security: Validate history entry belongs to organization
      const projectId = await getHistoryProjectId(db, historyItem);

      if (!projectId || !orgProjectIds.includes(projectId)) {
        throw new AppError('Access denied to notification history', 403, 'Forbidden');
      }

      return sendSuccess(reply, historyItem);
    }
  );
}
