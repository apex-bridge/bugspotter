/**
 * Upload routes
 * Presigned URL generation and upload confirmation for direct client-to-storage uploads
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { IStorageService } from '../../storage/types.js';
import type { QueueManager } from '../../queue/queue-manager.js';
import { AppError } from '../middleware/error.js';
import { requireAuth, requireApiKeyPermission } from '../middleware/auth.js';
import { sendSuccess } from '../utils/response.js';
import { checkProjectAccess } from '../utils/resource.js';
import { getLogger } from '../../logger.js';
import { validateSqlIdentifier } from '../../db/repositories/base-repository.js';
import {
  confirmUploadSchema,
  bugReportIdParamsSchema,
  VALID_FILE_TYPES,
} from '../schemas/uploads-schema.js';

const logger = getLogger();

type FileType = (typeof VALID_FILE_TYPES)[number];

/**
 * Request body for upload confirmation
 */
interface ConfirmUploadBody {
  fileType: FileType;
}

/**
 * Mapping from fileType to the corresponding database column name.
 * This prevents SQL injection by ensuring only whitelisted column names are used,
 * even if schema validation is somehow bypassed.
 */
const STATUS_COLUMN_MAP = {
  screenshot: 'upload_status',
  replay: 'replay_upload_status',
} as const;

export function uploadsRoutes(
  fastify: FastifyInstance,
  db: DatabaseClient,
  storage: IStorageService,
  queueManager: QueueManager
) {
  // NOTE: POST /api/v1/uploads/presigned-url route removed (dead code)
  // Presigned URLs are now generated during bug report creation via POST /api/v1/reports
  // See upload-batch-handler.ts for the implementation used in reports.ts
  //
  // CRITICAL SECURITY: Content-type validation happens in upload-batch-handler.ts via
  // validateContentType() which enforces the ALLOWED_CONTENT_TYPES allowlist ('image/png'
  // for screenshots, 'application/gzip' for replays). This blocks dangerous MIME types
  // (e.g., text/html, image/svg+xml) that could enable XSS attacks. The validated
  // content type is then included in the S3 presigned URL signature as defense-in-depth.

  /**
   * POST /api/v1/reports/:id/confirm-upload
   * Confirm successful upload and update bug report status
   */
  fastify.post<{
    Params: { id: string };
    Body: ConfirmUploadBody;
  }>(
    '/api/v1/reports/:id/confirm-upload',
    {
      preHandler: requireAuth,
      schema: confirmUploadSchema,
    },
    async (request, reply) => {
      const { id: bugId } = request.params;
      const { fileType } = request.body;

      // Schema already validates UUID format
      const bugReport = await db.bugReports.findById(bugId);
      if (!bugReport) {
        throw new AppError('Bug report not found', 404);
      }

      await checkProjectAccess(
        bugReport.project_id,
        request.authUser,
        request.authProject,
        db,
        'Upload confirmation',
        { apiKey: request.apiKey, minProjectRole: 'member' }
      );

      const storageKey =
        fileType === 'screenshot' ? bugReport.screenshot_key : bugReport.replay_key;

      if (!storageKey) {
        throw new AppError(
          `No ${fileType} upload initiated - request presigned URL first`,
          400,
          'BadRequest'
        );
      }

      const currentStatus =
        fileType === 'screenshot' ? bugReport.upload_status : bugReport.replay_upload_status;

      if (currentStatus !== 'pending') {
        throw new AppError(
          `Upload cannot be confirmed - current status: ${currentStatus}`,
          400,
          'BadRequest'
        );
      }

      const fileMetadata = await storage.headObject(storageKey);
      if (!fileMetadata) {
        throw new AppError(`Upload file not found in storage at key: ${storageKey}`, 400);
      }

      // Use whitelist mapping for column name to prevent SQL injection
      // (defense in depth - schema validation already restricts fileType)
      const statusColumn = STATUS_COLUMN_MAP[fileType];

      // Additional defense-in-depth: validate column name pattern
      // (protects against accidental STATUS_COLUMN_MAP modifications)
      validateSqlIdentifier(statusColumn);

      const result = await db.query(
        `UPDATE bug_reports
         SET ${statusColumn} = $1
         WHERE id = $2 AND ${statusColumn} = 'pending'
         RETURNING id`,
        ['completed', bugId]
      );

      if (result.rowCount === 0) {
        throw new AppError('Upload confirmation failed - status may have changed', 409);
      }

      // Queue worker to process the uploaded file
      if (fileType === 'screenshot') {
        await queueManager.addJob('screenshots', 'process-screenshot', {
          bugReportId: bugId,
          projectId: bugReport.project_id,
          screenshotKey: storageKey,
        });
      } else if (fileType === 'replay') {
        await queueManager.addJob('replays', 'process-replay', {
          bugReportId: bugId,
          projectId: bugReport.project_id,
          replayKey: storageKey,
        });
      }

      logger.info('Upload confirmed and processing queued', {
        bugId,
        fileType,
        storageKey,
        fileSize: fileMetadata.size,
      });

      // Fetch updated bug report to get the new status
      const updatedReport = await db.bugReports.findById(bugId);
      if (!updatedReport) {
        throw new AppError('Bug report not found after update', 500);
      }

      // Build response with appropriate status field name
      const responseData: Record<string, unknown> = {
        message: 'Upload confirmed successfully',
        bugId,
        fileType,
        storageKey,
        fileSize: fileMetadata.size,
      };

      // Add status field based on file type
      if (fileType === 'screenshot') {
        responseData.upload_status = updatedReport.upload_status;
      } else if (fileType === 'replay') {
        responseData.replay_upload_status = updatedReport.replay_upload_status;
      }

      return sendSuccess(reply, responseData);
    }
  );

  /**
   * GET /api/v1/reports/:id/screenshot-url
   * Get presigned URL for viewing screenshot
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/reports/:id/screenshot-url',
    {
      // Why `reports:read` (not a distinct `assets:read`): the screenshot is
      // a render of the report. Whoever can GET /reports/:id should be able
      // to load its screenshot, and whoever cannot, should not — same audience,
      // same gate. Adding it here closes a gap where ingest-only SDK keys
      // (permissions: ['reports:write','sessions:write']) bypassed the
      // permission check via requireAuth and pulled presigned URLs for any
      // bug-report asset in their allowed project.
      preHandler: [requireAuth, requireApiKeyPermission('reports:read')],
      schema: bugReportIdParamsSchema,
    },
    async (request, reply) => {
      const { id: bugId } = request.params;

      // Schema already validates UUID format
      const bugReport = await db.bugReports.findById(bugId);
      if (!bugReport) {
        throw new AppError('Bug report not found', 404);
      }

      await checkProjectAccess(
        bugReport.project_id,
        request.authUser,
        request.authProject,
        db,
        'Screenshot access',
        { apiKey: request.apiKey, minProjectRole: 'viewer' }
      );

      const screenshotKey = bugReport.screenshot_key;
      if (!screenshotKey) {
        if (bugReport.screenshot_url) {
          return sendSuccess(reply, { url: bugReport.screenshot_url });
        }
        throw new AppError('Screenshot not available', 404, 'NotFound');
      }

      // CRITICAL SECURITY: Override Content-Type and set inline disposition
      // to prevent XSS if malicious content was uploaded (displays image in browser)
      const url = await storage.getSignedUrl(screenshotKey, {
        expiresIn: 900,
        responseContentType: 'image/png',
        responseContentDisposition: 'inline; filename="screenshot.png"',
      });

      return sendSuccess(reply, { url, expiresIn: 900 });
    }
  );

  /**
   * GET /api/v1/reports/:id/replay-url
   * Get presigned URL for viewing session replay
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/reports/:id/replay-url',
    {
      // See screenshot-url above for the rationale; replays carry the same
      // PII surface (and more — full DOM, console, network).
      preHandler: [requireAuth, requireApiKeyPermission('reports:read')],
      schema: bugReportIdParamsSchema,
    },
    async (request, reply) => {
      const { id: bugId } = request.params;

      // Schema already validates UUID format
      const bugReport = await db.bugReports.findById(bugId);
      if (!bugReport) {
        throw new AppError('Bug report not found', 404);
      }

      await checkProjectAccess(
        bugReport.project_id,
        request.authUser,
        request.authProject,
        db,
        'Replay access',
        { apiKey: request.apiKey, minProjectRole: 'viewer' }
      );

      const replayKey = bugReport.replay_key;
      if (!replayKey) {
        if (bugReport.replay_url) {
          return sendSuccess(reply, { url: bugReport.replay_url });
        }
        throw new AppError('Session replay not available', 404, 'NotFound');
      }

      // CRITICAL SECURITY: Override Content-Type and force attachment download
      // to prevent XSS if malicious content was uploaded
      const url = await storage.getSignedUrl(replayKey, {
        expiresIn: 900,
        responseContentType: 'application/gzip',
        responseContentDisposition: 'attachment; filename="replay.gz"',
      });

      return sendSuccess(reply, { url, expiresIn: 900 });
    }
  );
}
