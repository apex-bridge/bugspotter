/**
 * Intelligence Mitigation Routes
 *
 * Async endpoints for AI-generated mitigation suggestions (Suggest Fix):
 *   GET  /api/v1/intelligence/projects/:projectId/bugs/:bugId/mitigation — get cached suggestion
 *   POST /api/v1/intelligence/projects/:projectId/bugs/:bugId/mitigation — trigger async generation
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { QueueManager } from '../../queue/queue-manager.js';
import { requireAuth, requireApiKeyPermission } from '../middleware/auth.js';
import { sendSuccess } from '../utils/response.js';
import { successResponseSchema } from '../schemas/common-schema.js';
import { IntelligenceMitigationService } from '../../services/intelligence/mitigation-service.js';
import { triggerBugMitigation } from '../utils/mitigation-trigger.js';
import { AppError } from '../middleware/error.js';
import { findReportWithAccess } from '../utils/bug-report-helpers.js';

// ============================================================================
// Schemas
// ============================================================================

const mitigationParams = {
  type: 'object',
  required: ['projectId', 'bugId'],
  properties: {
    projectId: { type: 'string', format: 'uuid' },
    bugId: { type: 'string', format: 'uuid' },
  },
} as const;

// ============================================================================
// Route registration
// ============================================================================

export function intelligenceMitigationRoutes(
  fastify: FastifyInstance,
  db: DatabaseClient,
  queueManager?: QueueManager
): void {
  const mitigationService = new IntelligenceMitigationService(db);

  /**
   * GET /api/v1/intelligence/projects/:projectId/bugs/:bugId/mitigation
   * Returns cached mitigation suggestion or 404 if not yet generated.
   */
  fastify.get<{ Params: { projectId: string; bugId: string } }>(
    '/api/v1/intelligence/projects/:projectId/bugs/:bugId/mitigation',
    {
      // Mitigation suggestions can echo bug content (titles, repro steps,
      // surrounding context) into the response. Same disclosure surface as
      // GET /reports/:id, so the same `reports:read` gate applies — keeping
      // ingest-only SDK keys out.
      preHandler: [requireAuth, requireApiKeyPermission('reports:read')],
      schema: {
        params: mitigationParams,
        response: { 200: successResponseSchema },
      },
    },
    async (request, reply) => {
      const { projectId, bugId } = request.params;

      const bugReport = await findReportWithAccess(
        bugId,
        request.authUser,
        request.authProject,
        db,
        request.apiKey
      );
      if (bugReport.project_id !== projectId) {
        throw new AppError('Bug report not found', 404, 'NotFound');
      }

      const mitigation = await mitigationService.getMitigation(bugId);
      if (!mitigation) {
        throw new AppError('Mitigation not found for this bug report', 404, 'NotFound');
      }

      return sendSuccess(reply, {
        bug_id: mitigation.bug_report_id,
        mitigation_suggestion: mitigation.mitigation_suggestion,
        based_on_similar_bugs: mitigation.based_on_similar_bugs,
        mitigation_version: mitigation.mitigation_version,
        created_at: mitigation.created_at,
        updated_at: mitigation.updated_at,
      });
    }
  );

  /**
   * POST /api/v1/intelligence/projects/:projectId/bugs/:bugId/mitigation
   * Triggers async mitigation generation. Returns 202 Accepted.
   */
  fastify.post<{ Params: { projectId: string; bugId: string } }>(
    '/api/v1/intelligence/projects/:projectId/bugs/:bugId/mitigation',
    {
      // Triggering mitigation reads the bug + similar bugs to build the
      // prompt; same disclosure as the GET above.
      preHandler: [requireAuth, requireApiKeyPermission('reports:read')],
      schema: {
        params: mitigationParams,
        response: { 202: successResponseSchema },
      },
    },
    async (request, reply) => {
      const { projectId, bugId } = request.params;

      const bugReport = await findReportWithAccess(
        bugId,
        request.authUser,
        request.authProject,
        db,
        request.apiKey
      );
      if (bugReport.project_id !== projectId) {
        throw new AppError('Bug report not found', 404, 'NotFound');
      }

      const queued = await triggerBugMitigation(bugReport, projectId, queueManager, {
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
