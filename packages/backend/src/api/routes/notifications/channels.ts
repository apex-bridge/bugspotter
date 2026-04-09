/**
 * Notification channel routes
 * CRUD operations for notification channels
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../../db/client.js';
import type { ChannelConfig } from '../../../types/notifications.js';
import type {
  ChannelQuerystring,
  CreateChannelBody,
  UpdateChannelBody,
  TestChannelBody,
} from './types.js';
import {
  listChannelsSchema,
  createChannelSchema,
  getChannelSchema,
  updateChannelSchema,
  deleteChannelSchema,
  testChannelSchema,
} from '../../schemas/notification-schema.js';
import { requireAuth } from '../../middleware/auth.js';
import { sendSuccess, sendCreated } from '../../utils/response.js';
import { checkProjectAccess } from '../../utils/resource.js';
import { buildPagination, buildEmptyPagination } from '../../utils/query-builder.js';
import { testChannelDelivery, findChannelAndCheckAccess, logResourceOperation } from './helpers.js';

/**
 * Register notification channel routes
 */
export function registerChannelRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  /**
   * GET /api/v1/notifications/channels
   * List notification channels with filtering and pagination
   */
  fastify.get<{ Querystring: ChannelQuerystring }>(
    '/api/v1/notifications/channels',
    {
      schema: listChannelsSchema,
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const { project_id, type, active, page, limit } = request.query;
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
              channels: [],
              pagination: buildEmptyPagination(pagination),
            });
          }
          filters.project_id = project_id;
        } else {
          // No specific project requested - return channels from all allowed projects
          filters.project_id = request.apiKey.allowed_projects;
        }
      } else if (project_id) {
        filters.project_id = project_id;
      }

      if (type) {
        filters.type = type;
      }
      if (active !== undefined) {
        filters.active = active;
      }

      const result = await db.notificationChannels.list(filters, pagination);

      return sendSuccess(reply, {
        channels: result.data,
        pagination: result.pagination,
      });
    }
  );

  /**
   * POST /api/v1/notifications/channels
   * Create a new notification channel
   */
  fastify.post<{ Body: CreateChannelBody }>(
    '/api/v1/notifications/channels',
    {
      schema: createChannelSchema,
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const { project_id, name, type, config, active = true } = request.body;

      // Verify project access — creating channels requires admin
      await checkProjectAccess(project_id, request.authUser, request.authProject, db, 'Project', {
        apiKey: request.apiKey,
        minProjectRole: 'admin',
      });

      const channel = await db.notificationChannels.create({
        project_id,
        name,
        type,
        config: config as unknown as ChannelConfig, // Schema validates structure
        active,
      });

      logResourceOperation('created', 'channel', channel.id, request.authUser?.id, {
        projectId: project_id,
        type,
      });

      return sendCreated(reply, channel);
    }
  );

  /**
   * GET /api/v1/notifications/channels/:id
   * Get a specific notification channel
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/notifications/channels/:id',
    {
      schema: getChannelSchema,
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const { id } = request.params;

      const channel = await findChannelAndCheckAccess(
        id,
        request.authUser,
        request.authProject,
        request.apiKey,
        db,
        'viewer'
      );

      return sendSuccess(reply, channel);
    }
  );

  /**
   * PATCH /api/v1/notifications/channels/:id
   * Update a notification channel
   */
  fastify.patch<{ Params: { id: string }; Body: UpdateChannelBody }>(
    '/api/v1/notifications/channels/:id',
    {
      schema: updateChannelSchema,
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const { id } = request.params;
      const updates = request.body;

      await findChannelAndCheckAccess(
        id,
        request.authUser,
        request.authProject,
        request.apiKey,
        db,
        'admin'
      );

      const updatedChannel = await db.notificationChannels.update(id, {
        ...updates,
        config: updates.config as unknown as ChannelConfig | undefined,
      });

      logResourceOperation('updated', 'channel', id, request.authUser?.id, {
        updates: Object.keys(updates),
      });

      return sendSuccess(reply, updatedChannel);
    }
  );

  /**
   * DELETE /api/v1/notifications/channels/:id
   * Delete a notification channel
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/notifications/channels/:id',
    {
      schema: deleteChannelSchema,
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const { id } = request.params;

      await findChannelAndCheckAccess(
        id,
        request.authUser,
        request.authProject,
        request.apiKey,
        db,
        'admin'
      );

      await db.notificationChannels.delete(id);

      logResourceOperation('deleted', 'channel', id, request.authUser?.id);

      return sendSuccess(reply, {
        message: 'Notification channel deleted successfully',
      });
    }
  );

  /**
   * POST /api/v1/notifications/channels/:id/test
   * Test a notification channel delivery
   */
  fastify.post<{ Params: { id: string }; Body: TestChannelBody }>(
    '/api/v1/notifications/channels/:id/test',
    {
      schema: testChannelSchema,
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const { id } = request.params;
      const { test_message = 'Test notification from BugSpotter' } = request.body;

      await findChannelAndCheckAccess(
        id,
        request.authUser,
        request.authProject,
        request.apiKey,
        db,
        'admin'
      );

      const result = await testChannelDelivery(id, test_message, db);

      return sendSuccess(reply, result);
    }
  );
}
