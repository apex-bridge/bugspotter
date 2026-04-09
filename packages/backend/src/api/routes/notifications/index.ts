/**
 * Notification routes index
 * Registers all notification-related routes
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../../db/client.js';
import { registerChannelRoutes } from './channels.js';
import { registerRuleRoutes } from './rules.js';
import { registerTemplateRoutes } from './templates.js';
import { registerHistoryRoutes } from './history.js';

/**
 * Register all notification routes
 *
 * Routes organized by resource type:
 * - Channels: /api/v1/notifications/channels
 * - Rules: /api/v1/notifications/rules
 * - Templates: /api/v1/notifications/templates
 * - History: /api/v1/notifications/history
 */
export function notificationRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  registerChannelRoutes(fastify, db);
  registerRuleRoutes(fastify, db);
  registerTemplateRoutes(fastify, db);
  registerHistoryRoutes(fastify, db);
}
