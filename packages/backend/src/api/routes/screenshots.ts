/**
 * Screenshot Proxy Routes
 * Provides clean, short URLs for accessing bug report screenshots
 * instead of exposing long presigned R2/S3 URLs
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { IStorageService } from '../../storage/types.js';
import { AppError } from '../middleware/error.js';
import { getLogger } from '../../logger.js';
import { checkProjectAccess } from '../utils/resource.js';

const logger = getLogger();

/**
 * Supported image MIME types by file extension
 */
const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * Schema for screenshot route validation
 */
const getScreenshotSchema = {
  params: {
    type: 'object',
    required: ['bugReportId'],
    properties: {
      bugReportId: { type: 'string', format: 'uuid' },
    },
  },
} as const;

/**
 * Screenshot Proxy Route
 * GET /api/v1/screenshots/:bugReportId
 *
 * Returns screenshot file with proper content-type headers
 * Requires authentication (API key or user session)
 *
 * @throws {404} Bug report or screenshot not found
 * @throws {403} Access denied to project
 */
export async function registerScreenshotRoutes(
  fastify: FastifyInstance,
  db: DatabaseClient,
  storage: IStorageService
) {
  fastify.get<{
    Params: { bugReportId: string };
  }>(
    '/api/v1/screenshots/:bugReportId',
    {
      schema: getScreenshotSchema,
    },
    async (request, reply) => {
      const { bugReportId } = request.params;

      // Get bug report
      const bugReport = await db.bugReports.findById(bugReportId);

      if (!bugReport) {
        throw new AppError('Bug report not found', 404, 'NotFound');
      }

      // Check authorization - verify user/API key has access to the project
      await checkProjectAccess(
        bugReport.project_id,
        request.authUser,
        request.authProject,
        db,
        'Screenshot',
        { apiKey: request.apiKey, minProjectRole: 'viewer' }
      );

      // Check if screenshot exists
      if (!bugReport.screenshot_key) {
        throw new AppError('Screenshot not found for this bug report', 404, 'NotFound');
      }

      try {
        // Stream screenshot directly from storage
        const stream = await storage.getObject(bugReport.screenshot_key);

        // Set content-type based on file extension
        const extension = bugReport.screenshot_key.split('.').pop()?.toLowerCase();
        const contentType =
          extension && MIME_TYPES[extension] ? MIME_TYPES[extension] : 'image/png';

        reply.header('Content-Type', contentType);
        reply.header('Cache-Control', 'public, max-age=86400'); // Cache for 1 day

        return reply.send(stream);
      } catch (error) {
        logger.error('Failed to stream screenshot', {
          bugReportId,
          screenshot_key: bugReport.screenshot_key,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new AppError('Failed to retrieve screenshot', 500, 'InternalError');
      }
    }
  );
}
