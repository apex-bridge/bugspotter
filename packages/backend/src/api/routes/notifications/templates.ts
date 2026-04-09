/**
 * Notification template routes
 * CRUD operations for notification templates
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../../db/client.js';
import type { CreateTemplateInput, UpdateTemplateInput } from '../../../types/notifications.js';
import type {
  TemplateQuerystring,
  CreateTemplateBody,
  UpdateTemplateBody,
  PreviewTemplateBody,
} from './types.js';
import {
  listTemplatesSchema,
  createTemplateSchema,
  getTemplateSchema,
  updateTemplateSchema,
  deleteTemplateSchema,
  previewTemplateSchema,
} from '../../schemas/notification-schema.js';
import { requirePlatformAdmin } from '../../middleware/auth.js';
import { sendSuccess, sendCreated } from '../../utils/response.js';
import { findOrThrow } from '../../utils/resource.js';
import { buildPagination } from '../../utils/query-builder.js';
import { renderTemplatePreview, logResourceOperation } from './helpers.js';

/**
 * Register notification template routes
 */
export function registerTemplateRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  /**
   * GET /api/v1/notifications/templates
   * List notification templates with filtering and pagination
   */
  fastify.get<{ Querystring: TemplateQuerystring }>(
    '/api/v1/notifications/templates',
    {
      schema: listTemplatesSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { channel_type, trigger_type, is_active, page, limit } = request.query;
      const pagination = buildPagination(page, limit);

      const filters: Record<string, unknown> = {};
      if (channel_type) {
        filters.channel_type = channel_type;
      }
      if (trigger_type) {
        filters.trigger_type = trigger_type;
      }
      if (is_active !== undefined) {
        filters.is_active = is_active;
      }

      const result = await db.notificationTemplates.list(filters, pagination);

      return sendSuccess(reply, {
        templates: result.data,
        pagination: result.pagination,
      });
    }
  );

  /**
   * POST /api/v1/notifications/templates
   * Create a new notification template
   */
  fastify.post<{ Body: CreateTemplateBody }>(
    '/api/v1/notifications/templates',
    {
      schema: createTemplateSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const templateData = request.body;

      const template = await db.notificationTemplates.create(
        templateData as unknown as CreateTemplateInput
      );

      logResourceOperation('created', 'template', template.id, request.authUser?.id, {
        channelType: templateData.channel_type,
        triggerType: templateData.trigger_type,
      });

      return sendCreated(reply, template);
    }
  );

  /**
   * GET /api/v1/notifications/templates/:id
   * Get a specific notification template
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/notifications/templates/:id',
    {
      schema: getTemplateSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { id } = request.params;

      const template = await findOrThrow(() => db.notificationTemplates.findById(id), 'Template');

      return sendSuccess(reply, template);
    }
  );

  /**
   * PATCH /api/v1/notifications/templates/:id
   * Update a notification template
   */
  fastify.patch<{ Params: { id: string }; Body: UpdateTemplateBody }>(
    '/api/v1/notifications/templates/:id',
    {
      schema: updateTemplateSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { id } = request.params;
      const updates = request.body;

      await findOrThrow(() => db.notificationTemplates.findById(id), 'Template');

      const updatedTemplate = await db.notificationTemplates.update(
        id,
        updates as unknown as UpdateTemplateInput
      );

      logResourceOperation('updated', 'template', id, request.authUser?.id, {
        updates: Object.keys(updates),
      });

      return sendSuccess(reply, updatedTemplate);
    }
  );

  /**
   * DELETE /api/v1/notifications/templates/:id
   * Delete a notification template
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/notifications/templates/:id',
    {
      schema: deleteTemplateSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { id } = request.params;

      await findOrThrow(() => db.notificationTemplates.findById(id), 'Template');

      await db.notificationTemplates.delete(id);

      logResourceOperation('deleted', 'template', id, request.authUser?.id);

      return sendSuccess(reply, {
        message: 'Notification template deleted successfully',
      });
    }
  );

  /**
   * POST /api/v1/notifications/templates/preview
   * Preview a notification template with test data
   */
  fastify.post<{ Body: PreviewTemplateBody }>(
    '/api/v1/notifications/templates/preview',
    {
      schema: previewTemplateSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { template_body, subject, context } = request.body;

      const rendered = renderTemplatePreview(template_body, subject, context);

      return sendSuccess(reply, rendered);
    }
  );
}
