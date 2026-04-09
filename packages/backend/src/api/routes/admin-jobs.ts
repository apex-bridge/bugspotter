/**
 * Admin Jobs Routes
 * Inspect and manage failed/stuck jobs in queues
 */

import type { FastifyInstance } from 'fastify';
import { sendSuccess } from '../utils/response.js';
import { requirePlatformAdmin } from '../middleware/auth.js';
import { QUEUE_NAMES, type QueueName } from '../../queue/types.js';
import { retryJobsSchema, cleanFailedJobsSchema } from '../schemas/admin-jobs-schema.js';

const FAILED_JOBS_FETCH_LIMIT = 50;

interface FailedJobInfo {
  id: string;
  name: string;
  queueName: string;
  timestamp: string;
  attemptsMade: number;
  maxAttempts: number;
  failedReason: string;
  stackTrace?: string[];
  data: unknown;
}

export async function adminJobsRoutes(fastify: FastifyInstance): Promise<void> {
  // Get queue manager singleton once for all route handlers
  const { getQueueManager } = await import('../../queue/index.js');
  const queueManager = getQueueManager();

  /**
   * GET /api/v1/admin/jobs/failed
   * Get all failed jobs across all queues
   * Requires: platform admin
   */
  fastify.get(
    '/api/v1/admin/jobs/failed',
    { onRequest: [requirePlatformAdmin()] },
    async (_request, reply) => {
      const queueNames = Object.values(QUEUE_NAMES);

      // Fetch failed jobs from all queues in parallel for better performance
      const jobsPerQueue = await Promise.all(
        queueNames.map(async (queueName): Promise<FailedJobInfo[]> => {
          try {
            // Use managed queue instance to avoid connection leaks
            const queue = queueManager.getQueue(queueName);
            const jobs = await queue.getFailed(0, FAILED_JOBS_FETCH_LIMIT);

            return jobs
              .filter((job) => !!job.id)
              .map((job) => ({
                id: job.id!,
                name: job.name,
                queueName,
                timestamp: new Date(job.timestamp).toISOString(),
                attemptsMade: job.attemptsMade,
                maxAttempts: job.opts.attempts || 0,
                failedReason: job.failedReason || 'Unknown error',
                stackTrace: job.stacktrace,
                data: job.data,
              }));
          } catch (error) {
            fastify.log.error({ err: error }, `Failed to get jobs for queue ${queueName}`);
            return [];
          }
        })
      );

      const failedJobs = jobsPerQueue.flat();

      return sendSuccess(reply, {
        total: failedJobs.length,
        jobs: failedJobs,
      });
    }
  );

  /**
   * POST /api/v1/admin/jobs/retry
   * Retry specific failed jobs
   * Requires: platform admin
   */
  fastify.post<{ Body: { queueName: string; jobIds: string[] } }>(
    '/api/v1/admin/jobs/retry',
    {
      onRequest: [requirePlatformAdmin()],
      schema: retryJobsSchema,
    },
    async (request, reply) => {
      const { queueName, jobIds } = request.body;

      // Retrieve queue instance (only infrastructure errors caught here)
      let queue;
      try {
        queue = queueManager.getQueue(queueName as QueueName);
      } catch (error) {
        fastify.log.error({ err: error, queueName }, 'Failed to retrieve queue');
        return reply.code(500).send({
          error: error instanceof Error ? error.message : 'Failed to access job queue',
        });
      }

      // Retry jobs in parallel - Promise.allSettled handles job-level failures
      const results = await Promise.allSettled(
        jobIds.map(async (jobId) => {
          const job = await queue.getJob(jobId);
          if (!job) {
            throw new Error(`Job not found: ${jobId}`);
          }
          await job.retry();
          return jobId;
        })
      );

      // Process results
      const retriedJobs: string[] = [];
      const errors: Array<{ jobId: string; error: string }> = [];

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const jobId = jobIds[i];

        if (result.status === 'fulfilled') {
          retriedJobs.push(result.value);
        } else {
          errors.push({
            jobId,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      }

      return sendSuccess(reply, {
        retriedCount: retriedJobs.length,
        retriedJobs,
        errors: errors.length > 0 ? errors : undefined,
      });
    }
  );

  /**
   * DELETE /api/v1/admin/jobs/failed
   * Clear failed jobs from queues
   * Requires: platform admin
   */
  fastify.delete<{ Querystring: { queueName?: string; olderThan?: string } }>(
    '/api/v1/admin/jobs/failed',
    {
      onRequest: [requirePlatformAdmin()],
      schema: cleanFailedJobsSchema,
    },
    async (request, reply) => {
      const { queueName, olderThan: olderThanStr } = request.query;
      const olderThan = olderThanStr ? parseInt(olderThanStr, 10) : undefined;

      const queueNames = queueName ? [queueName] : Object.values(QUEUE_NAMES);

      // Clean queues in parallel for better performance
      const results = await Promise.allSettled(
        queueNames.map(async (name) => {
          // Use managed queue instance to avoid connection leaks
          const queue = queueManager.getQueue(name as QueueName);

          if (olderThan) {
            // Clean failed jobs older than specified age (grace period)
            const cleaned = await queue.clean(olderThan, 0, 'failed');
            return cleaned.length;
          } else {
            // Clean all failed jobs
            const cleaned = await queue.clean(0, 0, 'failed');
            return cleaned.length;
          }
        })
      );

      // Sum up successful results and log errors
      let totalCleaned = 0;
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
          totalCleaned += result.value;
        } else {
          fastify.log.error({ err: result.reason }, `Failed to clean queue ${queueNames[i]}`);
        }
      }

      return sendSuccess(reply, {
        cleaned: totalCleaned,
        queues: queueNames,
      });
    }
  );
}
