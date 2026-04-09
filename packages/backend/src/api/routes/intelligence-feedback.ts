/**
 * Intelligence Feedback Routes
 *
 * Endpoints for submitting and retrieving feedback on intelligence suggestions:
 *   POST /api/v1/intelligence/feedback                           — submit feedback
 *   GET  /api/v1/intelligence/projects/:projectId/feedback/stats — accuracy stats
 *   GET  /api/v1/intelligence/bugs/:bugId/feedback               — feedback for a bug
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import { requireUser } from '../middleware/auth.js';
import { sendSuccess, sendCreated } from '../utils/response.js';
import { successResponseSchema } from '../schemas/common-schema.js';
import { IntelligenceFeedbackService } from '../../services/intelligence/feedback-service.js';
import { AppError } from '../middleware/error.js';
import { checkProjectAccess } from '../utils/resource.js';

// ============================================================================
// Schemas
// ============================================================================

const submitFeedbackBody = {
  type: 'object',
  required: ['bug_report_id', 'suggestion_bug_id', 'project_id', 'rating'],
  properties: {
    bug_report_id: { type: 'string', format: 'uuid' },
    suggestion_bug_id: { type: 'string', minLength: 1, maxLength: 255 },
    project_id: { type: 'string', format: 'uuid' },
    suggestion_type: {
      type: 'string',
      enum: ['similar_bug', 'mitigation', 'duplicate'],
      default: 'similar_bug',
    },
    rating: { type: 'integer', enum: [-1, 1] },
    comment: { type: 'string', maxLength: 2000 },
  },
  additionalProperties: false,
} as const;

const projectIdParams = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: { type: 'string', format: 'uuid' },
  },
} as const;

const bugIdParams = {
  type: 'object',
  required: ['bugId'],
  properties: {
    bugId: { type: 'string', format: 'uuid' },
  },
} as const;

// ============================================================================
// Route types
// ============================================================================

interface SubmitFeedbackBody {
  bug_report_id: string;
  suggestion_bug_id: string;
  project_id: string;
  suggestion_type?: 'similar_bug' | 'mitigation' | 'duplicate';
  rating: -1 | 1;
  comment?: string;
}

// ============================================================================
// Route registration
// ============================================================================

export function intelligenceFeedbackRoutes(fastify: FastifyInstance, db: DatabaseClient): void {
  const feedbackService = new IntelligenceFeedbackService(db);

  // POST /api/v1/intelligence/feedback
  fastify.post<{ Body: SubmitFeedbackBody }>(
    '/api/v1/intelligence/feedback',
    {
      preHandler: [requireUser],
      schema: {
        body: submitFeedbackBody,
        response: { 200: successResponseSchema, 201: successResponseSchema },
      },
    },
    async (request, reply) => {
      const body = request.body;

      // Validate bug report exists and belongs to the specified project
      const bugReport = await db.bugReports.findById(body.bug_report_id);
      if (!bugReport) {
        throw new AppError('Bug report not found', 404, 'NotFound');
      }
      if (bugReport.project_id !== body.project_id) {
        throw new AppError(
          'Bug report does not belong to the specified project',
          400,
          'ValidationError'
        );
      }

      // Verify user has access to the project
      await checkProjectAccess(
        bugReport.project_id,
        request.authUser,
        request.authProject,
        db,
        'Bug report'
      );

      const result = await feedbackService.submitFeedback({
        bugReportId: body.bug_report_id,
        suggestionBugId: body.suggestion_bug_id,
        suggestionType: body.suggestion_type || 'similar_bug',
        rating: body.rating,
        comment: body.comment,
        userId: request.authUser!.id,
        organizationId: bugReport.organization_id ?? undefined,
        projectId: body.project_id,
      });

      if (result.created) {
        return sendCreated(reply, result);
      }
      return sendSuccess(reply, result);
    }
  );

  // GET /api/v1/intelligence/projects/:projectId/feedback/stats
  fastify.get<{ Params: { projectId: string } }>(
    '/api/v1/intelligence/projects/:projectId/feedback/stats',
    {
      preHandler: [requireUser],
      schema: {
        params: projectIdParams,
        response: { 200: successResponseSchema },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;

      // Fetch project first, then verify access
      const project = await db.projects.findById(projectId);
      if (!project) {
        throw new AppError('Project not found', 404, 'NotFound');
      }
      await checkProjectAccess(projectId, request.authUser, request.authProject, db, 'Project');

      const stats = await feedbackService.getStats(projectId, project.organization_id ?? undefined);
      return sendSuccess(reply, stats);
    }
  );

  // GET /api/v1/intelligence/bugs/:bugId/feedback
  fastify.get<{ Params: { bugId: string } }>(
    '/api/v1/intelligence/bugs/:bugId/feedback',
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

      const feedback = await feedbackService.getFeedbackForBug(bugId);
      return sendSuccess(reply, feedback);
    }
  );
}
