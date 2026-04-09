/**
 * Project Integration routes
 * Integration management operations for projects
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { PluginRegistry } from '../../integrations/plugin-registry.js';
import { requireUser } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/project-access.js';
import { sendSuccess } from '../utils/response.js';
import { IntegrationService } from '../../services/integration-service.js';

export function projectIntegrationRoutes(
  fastify: FastifyInstance,
  db: DatabaseClient,
  registry: PluginRegistry
) {
  const integrationService = new IntegrationService(db, registry);

  /**
   * GET /api/v1/projects/:id/integrations
   * List all available integrations for a project
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/projects/:id/integrations',
    {
      preHandler: [requireUser, requireProjectAccess(db)],
    },
    async (request, reply) => {
      const { id } = request.params;

      const integrations = await integrationService.getAvailableIntegrations(id);

      return sendSuccess(reply, integrations);
    }
  );
}
