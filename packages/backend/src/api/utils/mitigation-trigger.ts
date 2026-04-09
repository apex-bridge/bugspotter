/**
 * Mitigation Trigger
 *
 * Fire-and-forget function that queues a bug for AI mitigation suggestion.
 * Called after bug report creation — errors are logged but never thrown
 * to ensure bug creation always succeeds.
 */

import type { QueueManager } from '../../queue/queue-manager.js';
import type { DatabaseClient } from '../../db/client.js';
import type { BugReport } from '../../db/types.js';
import { getLogger } from '../../logger.js';
import { QUEUE_NAMES } from '../../queue/types.js';
import { INTELLIGENCE_JOB_NAME } from '../../queue/jobs/intelligence-job.js';
import { getIntelligenceConfig } from '../../config/intelligence.config.js';
import { getOrgIntelligenceSettings } from '../../services/intelligence/tenant-config.js';
import type {
  MitigationJobPayload,
  IntelligenceJobData,
} from '../../services/intelligence/types.js';

const logger = getLogger();

export interface TriggerBugMitigationOptions {
  organizationId?: string;
  db?: DatabaseClient;
  /** When true, skips the intelligence_auto_enrich check (manual trigger). */
  manualTrigger?: boolean;
}

/**
 * Trigger AI mitigation suggestion for a bug report.
 *
 * Queues a job that will:
 * 1. Call the intelligence service to generate a mitigation suggestion (LLM)
 * 2. Persist the suggestion to the bug_mitigations table
 *
 * This is fire-and-forget — errors are logged but never thrown.
 * Returns true if a job was queued, false if skipped or failed.
 */
export async function triggerBugMitigation(
  bugReport: BugReport,
  projectId: string,
  queueManager: QueueManager | undefined,
  options?: TriggerBugMitigationOptions
): Promise<boolean> {
  if (!queueManager) {
    logger.debug('Queue manager not available, skipping mitigation', {
      bugReportId: bugReport.id,
      projectId,
    });
    return false;
  }

  const config = getIntelligenceConfig();
  if (!config.enabled) {
    logger.debug('Intelligence disabled, skipping mitigation', {
      bugReportId: bugReport.id,
    });
    return false;
  }

  // Per-org gating (reuse the same auto_enrich setting)
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
        logger.debug('Intelligence disabled for organization, skipping mitigation', {
          bugReportId: bugReport.id,
          organizationId: options.organizationId,
        });
        return false;
      }
      if (!orgSettings.intelligence_auto_enrich && !options.manualTrigger) {
        logger.debug('Auto-enrich disabled for organization, skipping mitigation', {
          bugReportId: bugReport.id,
          organizationId: options.organizationId,
        });
        return false;
      }
    } catch (error) {
      logger.warn('Failed to check org intelligence settings, skipping mitigation (fail closed)', {
        bugReportId: bugReport.id,
        organizationId: options.organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  try {
    const payload: MitigationJobPayload = {
      bug_id: bugReport.id,
      use_similar_bugs: true,
    };

    const jobData: IntelligenceJobData = {
      type: 'mitigation',
      bugReportId: bugReport.id,
      projectId,
      organizationId: options?.organizationId,
      payload,
    };

    // Auto-trigger: deterministic ID deduplicates concurrent triggers.
    // Manual trigger: unique ID so re-generation always queues a fresh job.
    // removeOnComplete/removeOnFail: true — clean up so deterministic IDs can be reused.
    const jobId = options?.manualTrigger
      ? `mitigation-${bugReport.id}-${Date.now()}`
      : `mitigation-${bugReport.id}`;

    try {
      await queueManager.addJob(QUEUE_NAMES.INTELLIGENCE, INTELLIGENCE_JOB_NAME, jobData, {
        jobId,
        priority: 25, // Lowest: after analyze (10), resolution (15), enrich (20)
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: true,
      });
    } catch (addError) {
      // BullMQ throws if a job with the same deterministic ID already exists.
      // Treat as successful dedup — a job is already queued for this bug.
      const msg = addError instanceof Error ? addError.message : String(addError);
      if (msg.includes('already exists') || msg.includes('Job is already')) {
        logger.debug('Mitigation job already queued (dedup)', {
          bugReportId: bugReport.id,
          jobId,
        });
        return true;
      }
      throw addError; // Re-throw unexpected errors to the outer catch
    }

    logger.info('Intelligence mitigation queued', {
      bugReportId: bugReport.id,
      projectId,
      organizationId: options?.organizationId,
      jobId,
    });

    return true;
  } catch (error) {
    logger.error('Failed to queue intelligence mitigation', {
      bugReportId: bugReport.id,
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
