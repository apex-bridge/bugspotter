/**
 * Storage URL generation endpoints
 * Generates fresh presigned URLs from storage keys on-demand
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { IStorageService } from '../../storage/types.js';
import { getLogger } from '../../logger.js';
import { DEFAULT_SIGNED_URL_EXPIRATION_SECONDS } from '../../storage/constants.js';
import { AppError } from '../middleware/error.js';
import { checkProjectAccess } from '../utils/resource.js';
import { getThumbnailKey } from '../utils/storage-helpers.js';
import {
  getStorageUrlSchema,
  postStorageUrlSchema,
  batchGenerateUrlsSchema,
} from '../schemas/storage-urls-schema.js';

const logger = getLogger();

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Verify access to bug report(s) using shareToken or standard auth
 * Centralizes auth verification logic used by both single and batch endpoints
 *
 * @param bugReportIds - IDs of bug reports to verify access for
 * @param bugReports - Fetched bug report objects (for project access)
 * @param request - Fastify request with auth context
 * @param db - Database client for access checks
 * @throws {AppError} 403 if access denied, handled by error middleware
 */
async function verifyBugReportAccess(
  bugReportIds: string[],
  bugReports: Array<{ id: string; project_id: string }>,
  request: FastifyRequest,
  db: DatabaseClient
): Promise<void> {
  if (request.authShareToken) {
    // ShareToken auth: verify all requested bug reports match the token's bug_report_id
    // ShareToken grants access to ONLY ONE bug report for security
    if (bugReportIds.length > 1) {
      throw new AppError('Share token only allows access to a single bug report', 403, 'Forbidden');
    }

    // Verify the single requested bug report matches the token
    if (bugReportIds[0] !== request.authShareToken.bug_report_id) {
      throw new AppError('Invalid share token for requested bug report', 403, 'Forbidden');
    }
  } else {
    // Standard auth: verify project access for all bug reports
    const projectIds = [...new Set(bugReports.map((r) => r.project_id))];
    for (const projectId of projectIds) {
      await checkProjectAccess(projectId, request.authUser, request.authProject, db, 'Bug report', {
        apiKey: request.apiKey,
        minProjectRole: 'viewer',
      });
    }
  }
}

/**
 * Resolve storage key for a given bug report and type
 * Centralizes key resolution logic used by both single and batch endpoints
 *
 * @param bugReport - Bug report containing storage keys
 * @param type - Type of resource to fetch
 * @returns Storage key or null if not available
 */
function resolveStorageKey(
  bugReport: { screenshot_key: string | null; replay_key: string | null; metadata?: unknown },
  type: 'screenshot' | 'replay' | 'thumbnail'
): string | null {
  if (type === 'replay') {
    return bugReport.replay_key;
  }

  // Both screenshot and thumbnail need screenshot_key
  const screenshotKey = bugReport.screenshot_key;
  if (!screenshotKey) {
    return null;
  }

  if (type === 'screenshot') {
    return screenshotKey;
  }

  // Thumbnail: check metadata first, then generate
  const metadata = bugReport.metadata as Record<string, unknown> | undefined;
  if (metadata?.thumbnailKey && typeof metadata.thumbnailKey === 'string') {
    return metadata.thumbnailKey;
  }

  return getThumbnailKey(screenshotKey);
}

/**
 * Generate presigned URL for a bug report resource
 * Shared logic used by both GET and POST endpoints
 *
 * @param bugReportId - ID of the bug report
 * @param type - Type of resource (screenshot/replay/thumbnail)
 * @param db - Database client
 * @param storage - Storage service
 * @param request - Fastify request (for auth context)
 * @returns URL response data
 * @throws {AppError} If bug report not found, no resource available, or URL generation fails
 */
async function generatePresignedUrl(
  bugReportId: string,
  type: 'screenshot' | 'replay' | 'thumbnail',
  db: DatabaseClient,
  storage: IStorageService,
  request: FastifyRequest
): Promise<{ url: string; key: string; expiresIn: number; generatedAt: string }> {
  // Fetch bug report
  const bugReport = await db.bugReports.findById(bugReportId);
  if (!bugReport) {
    throw new AppError('Bug report not found', 404, 'NotFound');
  }

  // Verify access (shareToken or standard auth) - throws on failure
  await verifyBugReportAccess([bugReportId], [bugReport], request, db);

  // Resolve storage key using centralized logic
  const storageKey = resolveStorageKey(bugReport, type);
  if (!storageKey) {
    throw new AppError(`No ${type} available for this bug report`, 404, 'NotFound');
  }

  try {
    // Generate fresh presigned URL (default expiration: 6 days)
    const url = await storage.getSignedUrl(storageKey);

    logger.info('Generated fresh presigned URL', {
      bugReportId,
      type,
      key: storageKey,
    });

    return {
      url,
      key: storageKey,
      expiresIn: DEFAULT_SIGNED_URL_EXPIRATION_SECONDS,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Failed to generate presigned URL', {
      bugReportId,
      type,
      key: storageKey,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new AppError('Failed to generate presigned URL', 500, 'InternalServerError');
  }
}

interface UrlParams {
  bugReportId: string;
  type: 'screenshot' | 'replay' | 'thumbnail';
}

export function storageUrlRoutes(
  fastify: FastifyInstance,
  db: DatabaseClient,
  storage: IStorageService
) {
  /**
   * Shared handler for presigned URL generation
   * Used by both GET and POST endpoints to avoid duplication
   */
  const urlGenerationHandler = async (
    request: FastifyRequest<{ Params: UrlParams }>,
    reply: FastifyReply
  ) => {
    const { bugReportId, type } = request.params;
    const data = await generatePresignedUrl(bugReportId, type, db, storage, request);
    return reply.send(data);
  };

  /**
   * Generate fresh presigned URL for public shares (token only, no password)
   * GET /api/v1/storage/url/:bugReportId/:type?shareToken=xxx
   *
   * This endpoint generates a fresh presigned URL from the stored storage key.
   * Useful when stored URLs have expired (after 6 days by default).
   * For password-protected shares, use POST endpoint instead.
   */
  fastify.get<{
    Params: UrlParams;
    Querystring: { shareToken?: string };
  }>(
    '/api/v1/storage/url/:bugReportId/:type',
    {
      schema: getStorageUrlSchema,
    },
    urlGenerationHandler
  );

  /**
   * Generate fresh presigned URL for password-protected shares (POST for security)
   * POST /api/v1/storage/url/:bugReportId/:type
   * Body: { shareToken: string, shareTokenPassword?: string }
   *
   * Uses POST to avoid exposing passwords in URL query strings, browser history,
   * server logs, or referrer headers. More secure than GET for password-protected shares.
   */
  fastify.post<{
    Params: UrlParams;
    Body: { shareToken: string; shareTokenPassword?: string };
  }>(
    '/api/v1/storage/url/:bugReportId/:type',
    {
      schema: postStorageUrlSchema,
    },
    urlGenerationHandler
  );

  /**
   * Batch generate URLs for multiple bug reports
   * POST /api/v1/storage/urls/batch
   *
   * Body: { bugReportIds: string[], types: string[] }
   */
  fastify.post<{
    Body: {
      bugReportIds: string[];
      types: ('screenshot' | 'replay' | 'thumbnail')[];
    };
    Querystring: { shareToken?: string };
  }>(
    '/api/v1/storage/urls/batch',
    {
      schema: batchGenerateUrlsSchema,
    },
    async (request, reply) => {
      const { bugReportIds, types } = request.body;

      // Fetch all bug reports in a single query (avoids N+1 problem)
      const bugReports = await db.bugReports.findByIds(bugReportIds);

      // Verify access (shareToken or standard auth) - throws on failure
      await verifyBugReportAccess(bugReportIds, bugReports, request, db);

      // Create a map for fast lookup by ID
      const bugReportMap = new Map(bugReports.map((report) => [report.id, report]));

      // Build list of all URLs to generate (for parallel processing)
      interface UrlRequest {
        bugReportId: string;
        type: 'screenshot' | 'replay' | 'thumbnail';
        storageKey: string;
      }

      const urlRequests: UrlRequest[] = [];

      for (const bugReportId of bugReportIds) {
        const bugReport = bugReportMap.get(bugReportId);
        if (!bugReport) {
          continue; // Skip missing reports
        }

        for (const type of types) {
          const storageKey = resolveStorageKey(bugReport, type);
          if (storageKey) {
            urlRequests.push({ bugReportId, type, storageKey });
          }
        }
      }

      // Generate all URLs in parallel (significant performance improvement)
      const urlPromises = urlRequests.map(async (req) => {
        try {
          const url = await storage.getSignedUrl(req.storageKey);
          return { ...req, url, error: null };
        } catch (error) {
          return {
            ...req,
            url: null,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      const results = await Promise.all(urlPromises);

      // Build response object and collect errors for logging
      const urls: Record<
        string,
        { screenshot?: string | null; replay?: string | null; thumbnail?: string | null }
      > = {};

      const errors: Array<{ bugReportId: string; type: string; key: string; error: string }> = [];

      // Initialize all requested bug reports
      for (const bugReportId of bugReportIds) {
        if (bugReportMap.has(bugReportId)) {
          urls[bugReportId] = {};
          // Pre-populate with null for all requested types
          for (const type of types) {
            urls[bugReportId][type] = null;
          }
        }
      }

      // Fill in successful URLs and collect errors
      for (const result of results) {
        if (result.url) {
          urls[result.bugReportId][result.type] = result.url;
        } else if (result.error) {
          errors.push({
            bugReportId: result.bugReportId,
            type: result.type,
            key: result.storageKey,
            error: result.error,
          });
        }
      }

      // Log errors in batch (more efficient than individual logs)
      if (errors.length > 0) {
        logger.error('Failed to generate some URLs in batch', {
          failedCount: errors.length,
          totalRequested: urlRequests.length,
          errors,
        });
      }

      logger.info('Generated batch presigned URLs', {
        requested: bugReportIds.length,
        found: bugReports.length,
        successful: results.filter((r) => r.url).length,
        failed: errors.length,
        types,
      });

      return reply.send({
        urls,
        generatedAt: new Date().toISOString(),
      });
    }
  );
}
