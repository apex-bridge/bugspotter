/**
 * Bug Report routes
 * CRUD operations for bug reports
 * Single Responsibility: HTTP request/response handling for bug reports
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { IStorageService } from '../../storage/types.js';
import {
  createBugReportSchema,
  listBugReportsSchema,
  getBugReportSchema,
  updateBugReportSchema,
  deleteBugReportSchema,
  bulkDeleteBugReportsSchema,
  BugStatus,
  BugPriority,
} from '../schemas/bug-report-schema.js';
import { requireProject, requireApiKeyPermission } from '../middleware/auth.js';
import { sendSuccess, sendCreated, sendNoContent, sendPaginated } from '../utils/response.js';
import { AppError } from '../middleware/error.js';
import { buildPagination, buildSort, parseDateFilter } from '../utils/query-builder.js';
import { buildAccessFilters, validateProjectAccess } from '../utils/bug-report-access.js';
import { triggerBugReportNotification } from '../utils/notification-trigger.js';
import { triggerBugReportIntegrations } from '../utils/integration-trigger.js';
import { triggerBugAnalysis } from '../utils/intelligence-trigger.js';
import { triggerBugEnrichment } from '../utils/enrichment-trigger.js';
import { triggerBugMitigation } from '../utils/mitigation-trigger.js';
import { triggerResolutionSync } from '../utils/resolution-sync-trigger.js';
import { prepareUploadUrls } from '../utils/upload-batch-handler.js';
import { findReportWithAccess } from '../utils/bug-report-helpers.js';
import type { NotificationService } from '../../services/notifications/notification-service.js';
import { SessionService } from '../../services/session-service.js';
import type {
  CreateReportBody,
  UpdateReportBody,
  ListReportsQuery,
  BugReportMetadata,
} from '../types/bug-report-types.js';
import { getLogger } from '../../logger.js';
import type { QueueManager } from '../../queue/queue-manager.js';
import type { PluginRegistry } from '../../integrations/plugin-registry.js';
import { OrganizationService } from '../../saas/services/organization.service.js';
import { requireQuota } from '../../saas/middleware/quota.js';
import { RESOURCE_TYPE } from '../../db/types.js';

const logger = getLogger();

export function bugReportRoutes(
  fastify: FastifyInstance,
  db: DatabaseClient,
  storage: IStorageService,
  notificationService?: NotificationService,
  queueManager?: QueueManager,
  pluginRegistry?: PluginRegistry
) {
  // Initialize services
  const sessionService = new SessionService(storage);
  const orgService = new OrganizationService(db);

  /**
   * POST /api/v1/reports
   * Create a new bug report
   */
  fastify.post<{ Body: CreateReportBody }>(
    '/api/v1/reports',
    {
      schema: createBugReportSchema,
      preHandler: [requireProject, requireQuota(orgService, RESOURCE_TYPE.BUG_REPORTS)],
    },
    async (request, reply) => {
      const {
        title,
        description,
        priority,
        report,
        hasScreenshot,
        hasReplay,
        source,
        project_id: bodyProjectId,
      } = request.body;

      // Resolve project from: authProject (single-key), body project_id, or sole allowed project
      const projectId =
        request.authProject?.id ??
        bodyProjectId ??
        (request.apiKey?.allowed_projects?.length === 1
          ? request.apiKey.allowed_projects[0]
          : null);

      if (!projectId) {
        throw new AppError(
          'Could not determine project. Specify project_id in the request body.',
          400,
          'BadRequest'
        );
      }

      // Verify the resolved project is in the key's allowed list
      if (
        request.apiKey?.allowed_projects &&
        !request.apiKey.allowed_projects.includes(projectId)
      ) {
        throw new AppError(
          'API key does not have access to the specified project.',
          403,
          'Forbidden'
        );
      }

      // Fetch full project object (needed for organization_id downstream)
      const project =
        request.authProject?.id === projectId
          ? request.authProject
          : await db.projects.findById(projectId);

      if (!project) {
        throw new AppError('Project not found.', 404, 'NotFound');
      }

      // In SaaS mode, ensure the resolved project belongs to the current tenant
      if (request.organizationId && project.organization_id !== request.organizationId) {
        throw new AppError(
          'Project does not belong to the current organization.',
          403,
          'Forbidden'
        );
      }

      // Log key request details with metadata counts for diagnostics
      logger.info('Creating bug report', {
        title,
        priority,
        hasScreenshot,
        hasReplay,
        consoleCount: report.console?.length ?? 0,
        networkCount: report.network?.length ?? 0,
        hasMetadata: !!report.metadata,
        metadataKeys: report.metadata ? Object.keys(report.metadata) : [],
      });

      // Debug: Log first console entry to verify data structure
      if (report.console && report.console.length > 0) {
        logger.debug('Sample console log', {
          first: report.console[0],
          total: report.console.length,
        });
      }

      // Create bug report with quota leak protection
      // NOTE: Quota is reserved in middleware BEFORE this handler runs.
      // If creation fails, quota is leaked (no compensating decrement yet).
      // TODO: Implement UsageRecordRepository.decrement() and release quota on error.
      let bugReport;
      try {
        bugReport = await db.bugReports.create({
          project_id: projectId,
          title,
          description: description || null,
          priority: priority || BugPriority.MEDIUM,
          status: BugStatus.OPEN,
          metadata: {
            console: report.console,
            network: report.network,
            metadata: report.metadata,
            source: source || 'api',
            apiKeyPrefix: request.apiKey?.key_prefix || null,
          },
          screenshot_url: null,
          replay_url: null,
          screenshot_key: null,
          upload_status: 'none',
          replay_key: null,
          replay_upload_status: 'none',
          organization_id: project.organization_id,
        });
      } catch (error) {
        // Bug report creation failed after quota was reserved in middleware.
        // Release the quota to prevent leaks.
        // Use request.organizationId to match what requireQuota middleware used for reservation.
        const organizationId = request.organizationId;

        logger.error('Bug report creation failed, releasing reserved quota', {
          projectId,
          organizationId,
          error: error instanceof Error ? error.message : String(error),
          title,
        });

        // Release quota if organizationId is available (SaaS mode with quota enforcement)
        if (organizationId) {
          try {
            const released = await orgService.releaseQuota(
              organizationId,
              RESOURCE_TYPE.BUG_REPORTS,
              1
            );
            if (released) {
              logger.info('Successfully released quota after failed bug report creation', {
                organizationId,
                resourceType: RESOURCE_TYPE.BUG_REPORTS,
              });
            } else {
              logger.warn('Could not release quota (no matching record found)', {
                organizationId,
                resourceType: RESOURCE_TYPE.BUG_REPORTS,
              });
            }
          } catch (releaseError) {
            // Log but don't mask the original error
            logger.error('Failed to release quota after bug report creation failure', {
              organizationId,
              releaseError:
                releaseError instanceof Error ? releaseError.message : String(releaseError),
            });
          }
        }

        throw error; // Re-throw to return error to client
      }

      // Debug: Verify metadata was saved correctly
      const metadata = bugReport.metadata as BugReportMetadata;
      logger.debug('Bug report created with metadata', {
        bugId: bugReport.id,
        metadataConsoleCount: metadata.console?.length ?? 0,
        metadataNetworkCount: metadata.network?.length ?? 0,
        metadataKeys: metadata.metadata ? Object.keys(metadata.metadata) : [],
      });

      // Generate presigned URLs if requested
      const presignedUrls = await prepareUploadUrls(
        bugReport,
        hasScreenshot || false,
        hasReplay || false,
        db,
        storage
      );

      // Trigger notification (non-blocking, logs errors)
      await triggerBugReportNotification(
        bugReport,
        project as unknown as Record<string, unknown>,
        notificationService
      );

      // Trigger integrations if configured (non-blocking, logs errors)
      await triggerBugReportIntegrations(bugReport, projectId, queueManager, db, pluginRegistry);

      // Trigger intelligence analysis (non-blocking, logs errors)
      await triggerBugAnalysis(bugReport, projectId, queueManager, {
        organizationId: project.organization_id ?? undefined,
        db,
      });

      // Trigger intelligence enrichment (non-blocking, logs errors)
      await triggerBugEnrichment(bugReport, projectId, queueManager, {
        organizationId: project.organization_id ?? undefined,
        db,
      });

      // Trigger mitigation suggestion (fire-and-forget, never throws)
      triggerBugMitigation(bugReport, projectId, queueManager, {
        organizationId: project.organization_id ?? undefined,
        db,
      });

      // Return bug report with presigned URLs if generated
      const response =
        Object.keys(presignedUrls).length > 0 ? { ...bugReport, presignedUrls } : bugReport;

      return sendCreated(reply, response);
    }
  );

  /**
   * GET /api/v1/reports
   * List bug reports with filtering, sorting, and pagination
   */
  fastify.get<{ Querystring: ListReportsQuery }>(
    '/api/v1/reports',
    {
      schema: listBugReportsSchema,
      // Enforce API-key permission: an ingest-only key (e.g. from
      // self-service signup) must NOT be able to list reports. User JWT
      // requests pass through (handled by the middleware).
      preHandler: [requireApiKeyPermission('reports:read')],
    },
    async (request, reply) => {
      const {
        page,
        limit,
        status,
        priority,
        project_id,
        created_after,
        created_before,
        sort_by,
        order,
      } = request.query;

      // Parse date filters with validation
      const createdAfterDate = parseDateFilter(created_after, 'created_after');
      const createdBeforeDate = parseDateFilter(created_before, 'created_before');

      // Build access control filters based on authentication type
      const { filters, requiresValidation } = buildAccessFilters(
        request.authUser,
        request.authProject,
        project_id,
        {
          status,
          priority,
          created_after: createdAfterDate,
          created_before: createdBeforeDate,
        }
      );

      // Validate project access if required (regular user + specific project_id)
      if (requiresValidation && project_id && request.authUser) {
        await validateProjectAccess(project_id, request.authUser.id, db);
      }

      const sort = buildSort(sort_by, order, 'created_at' as const);
      const pagination = buildPagination(page, limit);
      const result = await db.bugReports.list(filters, sort, pagination);

      return sendPaginated(reply, result.data, result.pagination);
    }
  );

  /**
   * GET /api/v1/reports/:id
   * Get a single bug report by ID
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/reports/:id',
    {
      schema: getBugReportSchema,
      preHandler: [requireApiKeyPermission('reports:read')],
    },
    async (request, reply) => {
      const { id } = request.params;

      const bugReport = await findReportWithAccess(
        id,
        request.authUser,
        request.authProject,
        db,
        request.apiKey
      );

      // Type assertion for metadata field
      const typedReport = {
        ...bugReport,
        metadata: bugReport.metadata as BugReportMetadata,
      };

      return sendSuccess(reply, typedReport);
    }
  );

  /**
   * PATCH /api/v1/reports/:id
   * Update a bug report (status, priority, description)
   */
  fastify.patch<{ Params: { id: string }; Body: UpdateReportBody }>(
    '/api/v1/reports/:id',
    {
      schema: updateBugReportSchema,
    },
    async (request, reply) => {
      const { id } = request.params;
      const { resolution_notes, ...dbUpdates } = request.body;

      const report = await findReportWithAccess(
        id,
        request.authUser,
        request.authProject,
        db,
        request.apiKey
      );
      const updated = await db.bugReports.update(id, dbUpdates);

      // Trigger resolution sync only on actual status transition to resolved/closed
      if (
        (dbUpdates.status === 'resolved' || dbUpdates.status === 'closed') &&
        report.status !== dbUpdates.status
      ) {
        await triggerResolutionSync(
          id,
          report.project_id,
          dbUpdates.status,
          resolution_notes,
          queueManager,
          {
            organizationId: report.organization_id ?? undefined,
            db,
          }
        );
      }

      return sendSuccess(reply, updated);
    }
  );

  /**
   * DELETE /api/v1/reports/:id
   * Soft-delete a bug report (requires project admin+ role, respects legal hold)
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/reports/:id',
    {
      schema: deleteBugReportSchema,
    },
    async (request, reply) => {
      const { id } = request.params;

      const report = await findReportWithAccess(
        id,
        request.authUser,
        request.authProject,
        db,
        request.apiKey,
        'admin'
      );

      // Already deleted — treat DELETE as idempotent
      if (report.deleted_at) {
        return sendNoContent(reply);
      }

      if (report.legal_hold) {
        throw new AppError('Report is under legal hold and cannot be deleted', 409, 'Conflict');
      }

      const userId = request.authUser?.id ?? null;
      await db.bugReports.softDelete([id], userId);

      return sendNoContent(reply);
    }
  );

  /**
   * POST /api/v1/reports/bulk-delete
   * Soft-delete multiple bug reports (requires project admin+ role, respects legal hold)
   */
  fastify.post<{ Body: { ids: string[] } }>(
    '/api/v1/reports/bulk-delete',
    {
      schema: bulkDeleteBugReportsSchema,
    },
    async (request, reply) => {
      const { ids } = request.body;

      // Verify access to each report (admin+ required for deletion)
      for (const id of ids) {
        await findReportWithAccess(
          id,
          request.authUser,
          request.authProject,
          db,
          request.apiKey,
          'admin'
        );
      }

      const userId = request.authUser?.id ?? null;
      const deleted = await db.bugReports.softDelete(ids, userId);

      return sendSuccess(reply, { deleted });
    }
  );

  /**
   * GET /api/v1/reports/:id/sessions
   * Get session data (console logs, network requests, replay events) for a bug report
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/reports/:id/sessions',
    {
      // Sessions are a child resource of bug reports — the existing implicit
      // model is "if you can read the report, you can see its session data".
      // We enforce `reports:read` (not `sessions:read`) so legitimate callers
      // with a reports-read-only key keep working, while an ingest-only
      // signup key (which has neither `reports:read` nor `sessions:read`) is
      // still blocked.
      preHandler: [requireApiKeyPermission('reports:read')],
    },
    async (request, reply) => {
      const { id } = request.params;

      const bugReport = await findReportWithAccess(
        id,
        request.authUser,
        request.authProject,
        db,
        request.apiKey
      );

      // Delegate to SessionService for data aggregation
      const sessions = await sessionService.getSessions(bugReport);

      return sendSuccess(reply, sessions);
    }
  );
}
