/**
 * Self-Service Resolution Routes
 *
 * End-user self-service endpoints (API key or JWT authenticated):
 *   POST /api/v1/self-service/check      — check description against known resolutions
 *   POST /api/v1/self-service/deflected   — record a self-resolution deflection
 *   GET  /api/v1/self-service/stats       — deflection stats for dashboard (JWT only)
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { IntelligenceClient } from '../../services/intelligence/intelligence-client.js';
import { requireAuth, requireUser } from '../middleware/auth.js';
import { sendSuccess, sendCreated } from '../utils/response.js';
import { successResponseSchema } from '../schemas/common-schema.js';
import { SelfServiceResolutionService } from '../../services/intelligence/self-service.js';
import { AppError } from '../middleware/error.js';
import { checkProjectAccess } from '../utils/resource.js';

// ============================================================================
// Schemas
// ============================================================================

const checkBodySchema = {
  type: 'object',
  required: ['description', 'project_id'],
  properties: {
    description: { type: 'string', minLength: 10, maxLength: 5000, pattern: '\\S' },
    project_id: { type: 'string', format: 'uuid' },
  },
  additionalProperties: false,
} as const;

const deflectedBodySchema = {
  type: 'object',
  required: ['project_id', 'matched_bug_id', 'description'],
  properties: {
    project_id: { type: 'string', format: 'uuid' },
    matched_bug_id: { type: 'string', format: 'uuid' },
    description: { type: 'string', minLength: 1, maxLength: 5000, pattern: '\\S' },
  },
  additionalProperties: false,
} as const;

const statsQuerySchema = {
  type: 'object',
  required: ['project_id'],
  properties: {
    project_id: { type: 'string', format: 'uuid' },
  },
  additionalProperties: false,
} as const;

// ============================================================================
// Route registration
// ============================================================================

interface CheckBody {
  description: string;
  project_id: string;
}

interface DeflectedBody {
  project_id: string;
  matched_bug_id: string;
  description: string;
}

interface StatsQuery {
  project_id: string;
}

export function selfServiceRoutes(
  fastify: FastifyInstance,
  db: DatabaseClient,
  intelligenceClient: IntelligenceClient
): void {
  const service = new SelfServiceResolutionService(db, intelligenceClient);

  // POST /api/v1/self-service/check
  fastify.post<{ Body: CheckBody }>(
    '/api/v1/self-service/check',
    {
      preHandler: [requireAuth],
      schema: {
        body: checkBodySchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request, reply) => {
      const { description, project_id } = request.body;

      // Verify project exists and caller has access
      const project = await db.projects.findById(project_id);
      if (!project) {
        throw new AppError('Project not found', 404, 'NotFound');
      }

      await checkProjectAccess(project_id, request.authUser, request.authProject, db, 'Project', {
        apiKey: request.apiKey,
      });
      const enabled = await service.isEnabled(project.organization_id);
      if (!enabled) {
        throw new AppError('Self-service is disabled for this organization', 403, 'Forbidden');
      }

      const result = await service.checkForResolutions(description, project_id);
      return sendSuccess(reply, result);
    }
  );

  // POST /api/v1/self-service/deflected
  fastify.post<{ Body: DeflectedBody }>(
    '/api/v1/self-service/deflected',
    {
      preHandler: [requireAuth],
      schema: {
        body: deflectedBodySchema,
        response: { 201: successResponseSchema },
      },
    },
    async (request, reply) => {
      const { project_id, matched_bug_id, description } = request.body;

      // Verify project exists and caller has access
      const project = await db.projects.findById(project_id);
      if (!project) {
        throw new AppError('Project not found', 404, 'NotFound');
      }

      await checkProjectAccess(project_id, request.authUser, request.authProject, db, 'Project', {
        apiKey: request.apiKey,
      });
      const enabled = await service.isEnabled(project.organization_id);
      if (!enabled) {
        throw new AppError('Self-service is disabled for this organization', 403, 'Forbidden');
      }

      // Verify matched bug exists and belongs to the same project
      const bugReport = await db.bugReports.findById(matched_bug_id);
      if (!bugReport) {
        throw new AppError('Matched bug report not found', 404, 'NotFound');
      }

      if (bugReport.project_id !== project_id) {
        throw new AppError(
          'Matched bug report does not belong to this project',
          400,
          'ValidationError'
        );
      }

      const deflection = await service.recordDeflection(
        project_id,
        matched_bug_id,
        description,
        project.organization_id ?? undefined
      );

      return sendCreated(reply, deflection);
    }
  );

  // GET /api/v1/self-service/stats
  fastify.get<{ Querystring: StatsQuery }>(
    '/api/v1/self-service/stats',
    {
      preHandler: [requireUser],
      schema: {
        querystring: statsQuerySchema,
        response: { 200: successResponseSchema },
      },
    },
    async (request, reply) => {
      const { project_id } = request.query;

      // Verify project exists and caller has access (JWT users only)
      const project = await db.projects.findById(project_id);
      if (!project) {
        throw new AppError('Project not found', 404, 'NotFound');
      }

      await checkProjectAccess(project_id, request.authUser, request.authProject, db, 'Project', {
        apiKey: request.apiKey,
      });
      const enabled = await service.isEnabled(project.organization_id);
      if (!enabled) {
        throw new AppError('Self-service is disabled for this organization', 403, 'Forbidden');
      }

      const stats = await service.getStats(project_id);
      return sendSuccess(reply, stats);
    }
  );
}
