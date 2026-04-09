/**
 * Intelligence Trigger
 *
 * Fire-and-forget function that queues a bug for intelligence analysis.
 * Called after bug report creation — errors are logged but never thrown
 * to ensure bug creation always succeeds.
 */

import { randomUUID } from 'crypto';
import type { QueueManager } from '../../queue/queue-manager.js';
import type { DatabaseClient } from '../../db/client.js';
import type { BugReport } from '../../db/types.js';
import { getLogger } from '../../logger.js';
import { QUEUE_NAMES } from '../../queue/types.js';
import { INTELLIGENCE_JOB_NAME } from '../../queue/jobs/intelligence-job.js';
import { getIntelligenceConfig } from '../../config/intelligence.config.js';
import { getOrgIntelligenceSettings } from '../../services/intelligence/tenant-config.js';
import type { AnalyzeBugRequest, IntelligenceJobData } from '../../services/intelligence/types.js';

const logger = getLogger();

// TODO: Add unit tests (queueManager undefined, intelligence disabled, successful enqueue, error swallowing)

/**
 * Options for per-org intelligence gating.
 */
export interface TriggerBugAnalysisOptions {
  organizationId?: string;
  db?: DatabaseClient;
}

/**
 * Trigger intelligence analysis for a bug report.
 *
 * Queues a job that will:
 * 1. Submit the bug to the intelligence service for embedding generation
 * 2. Check for similar/duplicate bugs
 *
 * When organizationId and db are provided, per-org settings are checked
 * (intelligence_enabled, intelligence_auto_analyze). Otherwise only the
 * global INTELLIGENCE_ENABLED flag is consulted.
 *
 * This is fire-and-forget — errors are logged but never thrown.
 */
export async function triggerBugAnalysis(
  bugReport: BugReport,
  projectId: string,
  queueManager: QueueManager | undefined,
  options?: TriggerBugAnalysisOptions
): Promise<void> {
  if (!queueManager) {
    logger.debug('Queue manager not available, skipping intelligence analysis', {
      bugReportId: bugReport.id,
      projectId,
    });
    return;
  }

  const config = getIntelligenceConfig();
  if (!config.enabled) {
    logger.debug('Intelligence disabled, skipping analysis', {
      bugReportId: bugReport.id,
    });
    return;
  }

  // Per-org gating: check org-level intelligence_enabled and auto_analyze
  if (options?.organizationId && !options?.db) {
    logger.warn('organizationId provided without db — skipping per-org intelligence gating', {
      bugReportId: bugReport.id,
      organizationId: options.organizationId,
    });
  }
  if (options?.organizationId && options?.db) {
    try {
      const orgSettings = await getOrgIntelligenceSettings(options.db, options.organizationId);
      if (!orgSettings.intelligence_enabled) {
        logger.debug('Intelligence disabled for organization, skipping analysis', {
          bugReportId: bugReport.id,
          organizationId: options.organizationId,
        });
        return;
      }
      if (!orgSettings.intelligence_auto_analyze) {
        logger.debug('Auto-analyze disabled for organization, skipping analysis', {
          bugReportId: bugReport.id,
          organizationId: options.organizationId,
        });
        return;
      }
    } catch (error) {
      // Fail closed: if we can't verify org settings, skip queueing.
      // This prevents bypassing an org-level kill switch during partial outages.
      logger.warn('Failed to check org intelligence settings, skipping analysis (fail closed)', {
        bugReportId: bugReport.id,
        organizationId: options.organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  try {
    const metadata = bugReport.metadata as Record<string, unknown> | null;

    const analyzePayload: AnalyzeBugRequest = {
      bug_id: bugReport.id,
      title: bugReport.title,
      description: bugReport.description,
      console_logs: Array.isArray(metadata?.console) ? metadata.console : null,
      network_logs: Array.isArray(metadata?.network) ? metadata.network : null,
      metadata:
        metadata?.metadata &&
        typeof metadata.metadata === 'object' &&
        !Array.isArray(metadata.metadata)
          ? (metadata.metadata as Record<string, unknown>)
          : null,
    };

    const jobData: IntelligenceJobData = {
      type: 'analyze',
      bugReportId: bugReport.id,
      projectId,
      organizationId: options?.organizationId,
      payload: analyzePayload,
    };

    const jobId = `intelligence-${bugReport.id}-${randomUUID()}`;

    await queueManager.addJob(QUEUE_NAMES.INTELLIGENCE, INTELLIGENCE_JOB_NAME, jobData, {
      jobId,
      priority: 10, // Lower priority than integrations
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    logger.info('Intelligence analysis queued', {
      bugReportId: bugReport.id,
      projectId,
      organizationId: options?.organizationId,
      jobId,
    });
  } catch (error) {
    logger.error('Failed to queue intelligence analysis', {
      bugReportId: bugReport.id,
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Never throw — bug creation must succeed even if intelligence queueing fails
  }
}
