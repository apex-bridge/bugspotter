/**
 * Enrichment Trigger
 *
 * Fire-and-forget function that queues a bug for AI enrichment
 * (categorization, severity, tags, root cause, affected components).
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
import type { EnrichBugRequest, IntelligenceJobData } from '../../services/intelligence/types.js';

const logger = getLogger();

/**
 * Options for per-org enrichment gating.
 */
export interface TriggerBugEnrichmentOptions {
  organizationId?: string;
  db?: DatabaseClient;
  /** When true, skips the intelligence_auto_enrich check (manual trigger). */
  manualTrigger?: boolean;
}

/**
 * Trigger AI enrichment for a bug report.
 *
 * Queues a job that will:
 * 1. Request categorization, severity, tags, root cause, and components from the intelligence service
 * 2. Persist the enrichment data locally
 *
 * When organizationId and db are provided, per-org settings are checked
 * (intelligence_enabled, intelligence_auto_enrich). Otherwise only the
 * global INTELLIGENCE_ENABLED flag is consulted.
 *
 * This is fire-and-forget — errors are logged but never thrown.
 *
 * Returns true if a job was queued, false if skipped or failed.
 */
export async function triggerBugEnrichment(
  bugReport: BugReport,
  projectId: string,
  queueManager: QueueManager | undefined,
  options?: TriggerBugEnrichmentOptions
): Promise<boolean> {
  if (!queueManager) {
    logger.debug('Queue manager not available, skipping intelligence enrichment', {
      bugReportId: bugReport.id,
      projectId,
    });
    return false;
  }

  const config = getIntelligenceConfig();
  if (!config.enabled) {
    logger.debug('Intelligence disabled, skipping enrichment', {
      bugReportId: bugReport.id,
    });
    return false;
  }

  // Per-org gating: check org-level intelligence_enabled and auto_enrich
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
        logger.debug('Intelligence disabled for organization, skipping enrichment', {
          bugReportId: bugReport.id,
          organizationId: options.organizationId,
        });
        return false;
      }
      if (!orgSettings.intelligence_auto_enrich && !options.manualTrigger) {
        logger.debug('Auto-enrich disabled for organization, skipping enrichment', {
          bugReportId: bugReport.id,
          organizationId: options.organizationId,
        });
        return false;
      }
    } catch (error) {
      // Fail closed: if we can't verify org settings, skip queueing.
      // This prevents bypassing an org-level kill switch during partial outages.
      logger.warn('Failed to check org intelligence settings, skipping enrichment (fail closed)', {
        bugReportId: bugReport.id,
        organizationId: options.organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  try {
    const metadata = bugReport.metadata as Record<string, unknown> | null;

    const enrichPayload: EnrichBugRequest = {
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
      type: 'enrich',
      bugReportId: bugReport.id,
      projectId,
      organizationId: options?.organizationId,
      payload: enrichPayload,
    };

    const jobId = `enrich-${bugReport.id}-${randomUUID()}`;

    await queueManager.addJob(QUEUE_NAMES.INTELLIGENCE, INTELLIGENCE_JOB_NAME, jobData, {
      jobId,
      priority: 20, // Lower priority than analysis (10) and resolution sync (15)
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    logger.info('Intelligence enrichment queued', {
      bugReportId: bugReport.id,
      projectId,
      organizationId: options?.organizationId,
      jobId,
    });

    return true;
  } catch (error) {
    logger.error('Failed to queue intelligence enrichment', {
      bugReportId: bugReport.id,
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Never throw — bug creation must succeed even if enrichment queueing fails
    return false;
  }
}
