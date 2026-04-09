/**
 * Intelligence Enrichment Routes
 *
 * Endpoints for retrieving and triggering AI enrichment data for bug reports:
 *   GET  /api/v1/intelligence/bugs/:bugId/enrichment — get enrichment data
 *   POST /api/v1/intelligence/bugs/:bugId/enrich     — manually trigger enrichment
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { QueueManager } from '../../queue/queue-manager.js';
import { requireUser } from '../middleware/auth.js';
import { sendSuccess } from '../utils/response.js';
import { successResponseSchema } from '../schemas/common-schema.js';
import { IntelligenceEnrichmentService } from '../../services/intelligence/enrichment-service.js';
import { triggerBugEnrichment } from '../utils/enrichment-trigger.js';
import { AppError } from '../middleware/error.js';
import { checkProjectAccess } from '../utils/resource.js';

// ============================================================================
// Schemas
// ============================================================================

const bugIdParams = {
  type: 'object',
  required: ['bugId'],
  properties: {
    bugId: { type: 'string', format: 'uuid' },
  },
} as const;

// ============================================================================
// Route registration
// ============================================================================

export function intelligenceEnrichmentRoutes(
  fastify: FastifyInstance,
  db: DatabaseClient,
  queueManager?: QueueManager
): void {
  const enrichmentService = new IntelligenceEnrichmentService(db);

  // GET /api/v1/intelligence/bugs/:bugId/enrichment
  fastify.get<{ Params: { bugId: string } }>(
    '/api/v1/intelligence/bugs/:bugId/enrichment',
    {
      preHandler: [requireUser],
      schema: {
        params: bugIdParams,
        response: { 200: successResponseSchema },
      },
    },
    async (request, reply) => {
      const { bugId } = request.params;

      // Verify bug report exists and user has access to its project
      const bugReport = await db.bugReports.findById(bugId);
      if (!bugReport) {
        throw new AppError('Bug report not found', 404, 'NotFound');
      }

      await checkProjectAccess(
        bugReport.project_id,
        request.authUser,
        request.authProject,
        db,
        'Bug report'
      );

      const enrichment = await enrichmentService.getEnrichment(bugId);
      if (!enrichment) {
        throw new AppError('Enrichment not found for this bug report', 404, 'NotFound');
      }

      return sendSuccess(reply, enrichment);
    }
  );

  // POST /api/v1/intelligence/bugs/:bugId/enrich
  fastify.post<{ Params: { bugId: string } }>(
    '/api/v1/intelligence/bugs/:bugId/enrich',
    {
      preHandler: [requireUser],
      schema: {
        params: bugIdParams,
        response: { 202: successResponseSchema },
      },
    },
    async (request, reply) => {
      const { bugId } = request.params;

      // Verify bug report exists and user has access to its project
      const bugReport = await db.bugReports.findById(bugId);
      if (!bugReport) {
        throw new AppError('Bug report not found', 404, 'NotFound');
      }

      await checkProjectAccess(
        bugReport.project_id,
        request.authUser,
        request.authProject,
        db,
        'Bug report'
      );

      const queued = await triggerBugEnrichment(bugReport, bugReport.project_id, queueManager, {
        organizationId: bugReport.organization_id ?? undefined,
        db,
        manualTrigger: true,
      });

      if (!queued) {
        throw new AppError('Intelligence is currently unavailable.', 503, 'ServiceUnavailable');
      }

      return sendSuccess(reply, { queued: true }, 202);
    }
  );
}
