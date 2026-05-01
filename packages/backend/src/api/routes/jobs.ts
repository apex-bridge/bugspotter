/**
 * Job Status routes
 * Query job queue status and job details
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { QueueManager } from '../../queue/queue-manager.js';
import type { QueueName } from '../../queue/types.js';
import { QUEUE_NAMES } from '../../queue/types.js';
import { sendSuccess } from '../utils/response.js';
import { checkProjectAccess, findOrThrow } from '../utils/resource.js';
import { requireUser, requirePlatformAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { getEncryptionService } from '../../utils/encryption.js';
import { QueueNotFoundError } from '../../queue/errors.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

interface JobParams {
  queueName: QueueName;
  id: string;
}

interface ReportJobsParams {
  id: string;
}

/**
 * Strip credential-shaped fields from a job status response. Worker payloads
 * for `process-integration` jobs include decrypted `credentials` and may grow
 * to include other secret-bearing keys; redact defensively so future job
 * shapes don't accidentally leak.
 */
const REDACTED_JOB_DATA_KEYS = new Set([
  'credentials',
  'encrypted_credentials',
  'apiToken',
  'apiKey',
  'token',
  'password',
  'secret',
]);

function redactJobStatus(jobStatus: unknown): unknown {
  if (!jobStatus || typeof jobStatus !== 'object') {
    return jobStatus;
  }
  const status = jobStatus as Record<string, unknown>;
  const data = status.data;
  if (!data || typeof data !== 'object') {
    return status;
  }
  const redactedData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    redactedData[key] = REDACTED_JOB_DATA_KEYS.has(key) ? '[REDACTED]' : value;
  }
  return { ...status, data: redactedData };
}

export function jobRoutes(
  fastify: FastifyInstance,
  db: DatabaseClient,
  queueManager?: QueueManager
) {
  logger.info('Registering job routes', { queueManagerProvided: !!queueManager });
  /**
   * GET /api/v1/queues/:queueName/jobs/:id
   * Get status of a specific job in a queue
   *
   * Platform-admin only: a process-integration job's `data` carries decrypted
   * Jira/GitHub credentials (see /admin/integrations/:platform/trigger below
   * where the worker payload is constructed). Without this gate, any
   * authenticated caller — including the public-facing SDK ingest key —
   * could fetch any job by id and read another tenant's integration creds.
   * Even with the gate, we redact credential-shaped fields below as
   * defense-in-depth.
   */
  fastify.get<{ Params: JobParams }>(
    '/api/v1/queues/:queueName/jobs/:id',
    {
      preHandler: [requireUser, requirePlatformAdmin()],
    },
    async (request, reply) => {
      if (!queueManager) {
        throw new AppError('Queue system not available', 503, 'ServiceUnavailable');
      }

      const { queueName, id } = request.params;

      try {
        const jobStatus = await queueManager.getJob(queueName, id);

        if (!jobStatus) {
          throw new AppError(`Job ${id} not found in ${queueName} queue`, 404, 'NotFound');
        }

        return sendSuccess(reply, redactJobStatus(jobStatus));
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        // Handle queue not found errors as 404
        if (error instanceof QueueNotFoundError) {
          throw new AppError(error.message, 404, 'NotFound');
        }
        throw new AppError(
          'Failed to fetch job status',
          500,
          'InternalServerError',
          error instanceof Error ? error : undefined
        );
      }
    }
  );

  /**
   * GET /api/v1/reports/:id/jobs
   * Get all jobs associated with a bug report
   * Note: This is a simplified version - in production you'd track job IDs in metadata
   */
  fastify.get<{ Params: ReportJobsParams }>('/api/v1/reports/:id/jobs', async (request, reply) => {
    if (!queueManager) {
      throw new AppError('Queue system not available', 503, 'ServiceUnavailable');
    }

    const { id: bugReportId } = request.params;

    // Check if report exists and user has access
    const bugReport = await findOrThrow(() => db.bugReports.findById(bugReportId), 'Bug report');

    await checkProjectAccess(
      bugReport.project_id,
      request.authUser,
      request.authProject,
      db,
      'Bug report',
      { apiKey: request.apiKey, minProjectRole: 'viewer' }
    );

    // Return placeholder response
    // In production, you'd store job IDs in bug_reports.metadata and query them
    return sendSuccess(reply, {
      bugReportId,
      message: 'Job tracking requires storing job IDs in bug report metadata',
      note: 'Use GET /api/v1/queues/:queueName/jobs/:jobId to check specific jobs',
    });
  });

  /**
   * GET /api/v1/queues/metrics
   * Get metrics for all queues (admin/monitoring endpoint)
   */
  fastify.get('/api/v1/queues/metrics', async (_request, reply) => {
    if (!queueManager) {
      throw new AppError('Queue system not available', 503, 'ServiceUnavailable');
    }

    try {
      const metrics = await Promise.all(
        Object.values(QUEUE_NAMES).map(async (queueName) => {
          try {
            const queueMetrics = await queueManager.getQueueMetrics(queueName);
            return { queue: queueName, ...queueMetrics };
          } catch (error) {
            return {
              queue: queueName,
              error: error instanceof Error ? error.message : 'Unknown error',
            };
          }
        })
      );

      return sendSuccess(reply, { queues: metrics });
    } catch (error) {
      throw new AppError(
        'Failed to fetch queue metrics',
        500,
        'InternalServerError',
        error instanceof Error ? error : undefined
      );
    }
  });

  /**
   * GET /api/v1/queues/health
   * Health check for queue system
   */
  fastify.get('/api/v1/queues/health', { config: { public: true } }, async (_request, reply) => {
    if (!queueManager) {
      return reply.status(503).send({
        success: false,
        error: 'ServiceUnavailable',
        message: 'Queue system not available',
        statusCode: 503,
        timestamp: new Date().toISOString(),
      });
    }

    try {
      const isHealthy = await queueManager.healthCheck();

      if (isHealthy) {
        return sendSuccess(reply, { status: 'healthy', queues: 'operational' });
      } else {
        return reply.status(503).send({
          success: false,
          error: 'ServiceUnavailable',
          message: 'Queue system unhealthy',
          statusCode: 503,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      return reply.status(503).send({
        success: false,
        error: 'ServiceUnavailable',
        message: 'Queue health check failed',
        statusCode: 503,
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * POST /api/v1/admin/integrations/:platform/trigger
   * Manually trigger an integration job for a bug report
   * Admin-only endpoint for testing and manual triggers
   */
  fastify.post<{
    Params: { platform: string };
    Body: { bugReportId: string; projectId: string };
  }>('/api/v1/admin/integrations/:platform/trigger', async (request, reply) => {
    if (!request.authUser) {
      throw new AppError('Authentication required', 401, 'Unauthorized');
    }

    if (!queueManager) {
      throw new AppError('Queue system not available', 503, 'ServiceUnavailable');
    }

    const { platform } = request.params;
    const { bugReportId, projectId } = request.body;

    // Validate platform
    const validPlatforms = ['jira', 'github', 'linear', 'slack'];
    if (!validPlatforms.includes(platform)) {
      throw new AppError(
        `Invalid platform '${platform}'. Must be one of: ${validPlatforms.join(', ')}`,
        400,
        'BadRequest'
      );
    }

    // Check project access — manual trigger requires admin
    await checkProjectAccess(projectId, request.authUser, request.authProject, db, 'Project', {
      apiKey: request.apiKey,
      minProjectRole: 'admin',
    });

    // Verify bug report exists and belongs to project
    const bugReport = await findOrThrow(() => db.bugReports.findById(bugReportId), 'Bug report');
    if (bugReport.project_id !== projectId) {
      throw new AppError('Bug report does not belong to specified project', 403, 'Forbidden');
    }

    // Get integration config
    const integration = await db.projectIntegrations.findByProjectAndPlatform(projectId, platform);
    if (!integration) {
      throw new AppError(`No ${platform} integration configured for project`, 404, 'NotFound');
    }

    if (!integration.enabled) {
      throw new AppError(`${platform} integration is disabled for project`, 400, 'BadRequest');
    }

    // Queue integration job with proper job name
    const jobId = `${platform}-${bugReportId}-${Date.now()}`;
    const INTEGRATION_JOB_NAME = 'process-integration'; // Must match worker registration

    // Decrypt credentials for the worker
    const encryptionService = getEncryptionService();
    let credentials: Record<string, unknown> = {};
    if (integration.encrypted_credentials) {
      try {
        const decryptedString = encryptionService.decrypt(integration.encrypted_credentials);
        credentials = JSON.parse(decryptedString);
      } catch (error) {
        throw new AppError(
          'Failed to decrypt integration credentials',
          500,
          'InternalServerError',
          error instanceof Error ? error : undefined
        );
      }
    }

    await queueManager.addJob(
      QUEUE_NAMES.INTEGRATIONS,
      INTEGRATION_JOB_NAME, // Job type name that worker listens for
      {
        bugReportId,
        projectId,
        platform,
        integrationId: integration.id,
        credentials,
        config: integration.config || {},
      },
      { jobId } // Pass custom jobId in options
    );

    return sendSuccess(reply, {
      message: `${platform} integration job queued`,
      jobId,
      bugReportId,
      projectId,
    });
  });

  logger.info('Job routes registered successfully', {
    routes: [
      'GET /api/v1/queues/:queueName/jobs/:id',
      'GET /api/v1/reports/:id/jobs',
      'POST /api/v1/admin/integrations/:platform/trigger',
    ],
  });
}
