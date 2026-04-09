/**
 * Resolution Sync Trigger
 *
 * Fire-and-forget function that queues a resolution sync job when a bug
 * report's status changes to 'resolved' or 'closed'. The intelligence
 * service updates its knowledge base with resolution data, improving
 * future suggestions.
 *
 * Errors are logged but never thrown to ensure the status update always succeeds.
 */

import { randomUUID } from 'crypto';
import type { QueueManager } from '../../queue/queue-manager.js';
import type { DatabaseClient } from '../../db/client.js';
import { getLogger } from '../../logger.js';
import { QUEUE_NAMES } from '../../queue/types.js';
import { INTELLIGENCE_JOB_NAME } from '../../queue/jobs/intelligence-job.js';
import { getIntelligenceConfig } from '../../config/intelligence.config.js';
import { getOrgIntelligenceSettings } from '../../services/intelligence/tenant-config.js';
import type {
  IntelligenceJobData,
  UpdateResolutionRequest,
} from '../../services/intelligence/types.js';

const logger = getLogger();

/**
 * Options for per-org intelligence gating.
 */
export interface TriggerResolutionSyncOptions {
  organizationId?: string;
  db?: DatabaseClient;
}

/**
 * Trigger resolution sync for a bug report.
 *
 * Queues a job that will send the resolution data to the intelligence service,
 * updating the RAG knowledge base with verified resolution information.
 *
 * When organizationId and db are provided, per-org settings are checked
 * (intelligence_enabled). Otherwise only the global INTELLIGENCE_ENABLED
 * flag is consulted.
 *
 * This is fire-and-forget — errors are logged but never thrown.
 */
export async function triggerResolutionSync(
  bugReportId: string,
  projectId: string,
  status: 'resolved' | 'closed',
  resolutionNotes: string | undefined,
  queueManager: QueueManager | undefined,
  options?: TriggerResolutionSyncOptions
): Promise<void> {
  if (!queueManager) {
    logger.debug('Queue manager not available, skipping resolution sync', {
      bugReportId,
      projectId,
    });
    return;
  }

  const config = getIntelligenceConfig();
  if (!config.enabled) {
    logger.debug('Intelligence disabled, skipping resolution sync', {
      bugReportId,
    });
    return;
  }

  // Per-org gating: check org-level intelligence_enabled
  if (options?.organizationId && !options?.db) {
    logger.warn('organizationId provided without db — skipping per-org intelligence gating', {
      bugReportId,
      organizationId: options.organizationId,
    });
  }
  if (options?.organizationId && options?.db) {
    try {
      const orgSettings = await getOrgIntelligenceSettings(options.db, options.organizationId);
      if (!orgSettings.intelligence_enabled) {
        logger.debug('Intelligence disabled for organization, skipping resolution sync', {
          bugReportId,
          organizationId: options.organizationId,
        });
        return;
      }
    } catch (error) {
      // Fail closed: if we can't verify org settings, skip queueing.
      logger.warn(
        'Failed to check org intelligence settings, skipping resolution sync (fail closed)',
        {
          bugReportId,
          organizationId: options.organizationId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return;
    }
  }

  try {
    const resolutionPayload: UpdateResolutionRequest = {
      resolution: resolutionNotes || status,
      status,
    };

    const jobData: IntelligenceJobData = {
      type: 'resolution',
      bugReportId,
      projectId,
      organizationId: options?.organizationId,
      payload: resolutionPayload,
    };

    const jobId = `resolution-${bugReportId}-${randomUUID()}`;

    await queueManager.addJob(QUEUE_NAMES.INTELLIGENCE, INTELLIGENCE_JOB_NAME, jobData, {
      jobId,
      priority: 15, // Lower priority than analysis (10) and integrations (5)
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    logger.info('Resolution sync queued', {
      bugReportId,
      projectId,
      status,
      organizationId: options?.organizationId,
      jobId,
    });
  } catch (error) {
    logger.error('Failed to queue resolution sync', {
      bugReportId,
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Never throw — status update must succeed even if resolution sync queueing fails
  }
}
