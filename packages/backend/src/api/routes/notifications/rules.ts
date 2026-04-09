/**
 * Notification rule routes
 * CRUD operations for notification rules
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../../db/client.js';
import type { CreateRuleInput, UpdateRuleInput } from '../../../types/notifications.js';
import type { RuleQuerystring, CreateRuleBody, UpdateRuleBody } from './types.js';
import {
  listRulesSchema,
  createRuleSchema,
  getRuleSchema,
  updateRuleSchema,
  deleteRuleSchema,
} from '../../schemas/notification-schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { sendSuccess, sendCreated } from '../../utils/response.js';
import { checkProjectAccess } from '../../utils/resource.js';
import { buildPagination, buildEmptyPagination } from '../../utils/query-builder.js';
import { findRuleAndCheckAccess, logResourceOperation } from './helpers.js';

/**
 * Register notification rule routes
 */
export function registerRuleRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  /**
   * GET /api/v1/notifications/rules
   * List notification rules with filtering and pagination
   */
  fastify.get<{ Querystring: RuleQuerystring }>(
    '/api/v1/notifications/rules',
    {
      schema: listRulesSchema,
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const { project_id, enabled, page, limit } = request.query;
      const pagination = buildPagination(page, limit);

      // If filtering by project, verify access
      if (project_id) {
        await checkProjectAccess(project_id, request.authUser, request.authProject, db, 'Project', {
          apiKey: request.apiKey,
          minProjectRole: 'viewer',
        });
      }

      const filters: Record<string, unknown> = {};

      // Scope to allowed_projects if using API key with restrictions
      if (request.apiKey?.allowed_projects && request.apiKey.allowed_projects.length > 0) {
        // If project_id filter provided, ensure it's in allowed_projects
        if (project_id) {
          if (!request.apiKey.allowed_projects.includes(project_id)) {
            return sendSuccess(reply, {
              rules: [],
              pagination: buildEmptyPagination(pagination),
            });
          }
          filters.project_id = project_id;
        } else {
          // No specific project requested - return rules from all allowed projects
          filters.project_id = request.apiKey.allowed_projects;
        }
      } else if (project_id) {
        filters.project_id = project_id;
      }
      if (enabled !== undefined) {
        filters.enabled = enabled;
      }

      const result = await db.notificationRules.list(filters, pagination);

      return sendSuccess(reply, {
        rules: result.data,
        pagination: result.pagination,
      });
    }
  );

  /**
   * POST /api/v1/notifications/rules
   * Create a new notification rule
   */
  fastify.post<{ Body: CreateRuleBody }>(
    '/api/v1/notifications/rules',
    {
      schema: createRuleSchema,
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const { project_id, channel_ids, ...ruleData } = request.body;

      // Verify project access — creating rules requires admin
      await checkProjectAccess(project_id, request.authUser, request.authProject, db, 'Project', {
        apiKey: request.apiKey,
        minProjectRole: 'admin',
      });

      // Create rule with channel associations
      const rule = await db.notificationRules.createWithChannels({
        project_id,
        ...ruleData,
        enabled: ruleData.enabled ?? true,
        priority: ruleData.priority ?? 5,
        channel_ids,
      } as unknown as CreateRuleInput);

      logResourceOperation('created', 'rule', rule.id, request.authUser?.id, {
        projectId: project_id,
        channelCount: channel_ids.length,
      });

      return sendCreated(reply, rule);
    }
  );

  /**
   * GET /api/v1/notifications/rules/:id
   * Get a specific notification rule
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/notifications/rules/:id',
    {
      schema: getRuleSchema,
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const { id } = request.params;

      const rule = await findRuleAndCheckAccess(
        id,
        request.authUser,
        request.authProject,
        request.apiKey,
        db,
        true,
        'viewer'
      );

      return sendSuccess(reply, rule);
    }
  );

  /**
   * PATCH /api/v1/notifications/rules/:id
   * Update a notification rule
   */
  fastify.patch<{ Params: { id: string }; Body: UpdateRuleBody }>(
    '/api/v1/notifications/rules/:id',
    {
      schema: updateRuleSchema,
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const { id } = request.params;
      const { channel_ids, ...updates } = request.body;

      await findRuleAndCheckAccess(
        id,
        request.authUser,
        request.authProject,
        request.apiKey,
        db,
        false,
        'admin'
      );

      // Update rule and channels if provided
      const updatedRule = await db.notificationRules.updateWithChannels(id, {
        ...updates,
        ...(channel_ids && { channel_ids }),
      } as unknown as UpdateRuleInput);

      logResourceOperation('updated', 'rule', id, request.authUser?.id, {
        updates: Object.keys(updates),
      });

      return sendSuccess(reply, updatedRule);
    }
  );

  /**
   * DELETE /api/v1/notifications/rules/:id
   * Delete a notification rule
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/notifications/rules/:id',
    {
      schema: deleteRuleSchema,
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const { id } = request.params;

      await findRuleAndCheckAccess(
        id,
        request.authUser,
        request.authProject,
        request.apiKey,
        db,
        false,
        'admin'
      );

      await db.notificationRules.delete(id);

      logResourceOperation('deleted', 'rule', id, request.authUser?.id);

      return sendSuccess(reply, {
        message: 'Notification rule deleted successfully',
      });
    }
  );
}
