/**
 * Integration Worker
 *
 * Processes external platform integration jobs (Jira, GitHub, Linear, Slack).
 * Routes jobs to platform-specific handlers, manages rate limiting, stores external IDs.
 *
 * Processing Pipeline:
 * 1. Validate job data and credentials
 * 2. Fetch bug report details from database
 * 3. Route to platform-specific handler (Jira/GitHub/Linear/Slack)
 * 4. Create or update issue on external platform
 * 5. Store external ID and URL in database
 * 6. Optionally sync comments and status updates
 *
 * Dependencies:
 * - DatabaseClient: For fetching bug reports and storing external IDs
 * - Platform SDKs: Jira API, GitHub API, Linear SDK, Slack Web API
 */

import type { IJobHandle } from '@bugspotter/message-broker';
import type { Redis } from 'ioredis';
import { getLogger } from '../../logger.js';
import { validateIntegrationJobData, createIntegrationJobResult } from '../jobs/integration-job.js';
import type { IntegrationJobData, IntegrationJobResult } from '../types.js';
import { QUEUE_NAMES } from '../types.js';
import { JobProcessingError } from '../errors.js';
import type { IWorkerHost } from '@bugspotter/message-broker';
import { attachStandardEventHandlers } from './worker-events.js';
import { ProgressTracker } from './progress-tracker.js';
import { createWorker } from './worker-factory.js';
import type { PluginRegistry } from '../../integrations/plugin-registry.js';
import type { BugReportRepository } from '../../db/repositories.js';

const logger = getLogger();

/**
 * Platform-specific integration result
 */
interface PlatformIntegrationResult {
  externalId: string;
  externalUrl: string;
  status: 'created' | 'updated' | 'failed';
  metadata?: Record<string, unknown>;
}

/**
 * Route integration to platform-specific handler using registry
 */
async function routeToPlatform(
  registry: PluginRegistry,
  platform: string,
  bugReportId: string,
  projectId: string,
  integrationId: string,
  bugReportRepo: BugReportRepository
): Promise<PlatformIntegrationResult> {
  // Get service for platform
  const service = registry.get(platform);
  if (!service) {
    // List supported platforms for better error message
    const supported = registry.getSupportedPlatforms().join(', ');
    throw new Error(`Integration platform '${platform}' not supported. Supported: ${supported}`);
  }

  // Fetch bug report
  const bugReport = await bugReportRepo.findById(bugReportId);
  if (!bugReport) {
    throw new Error(`Bug report not found: ${bugReportId}`);
  }

  // Create issue on external platform
  const result = await service.createFromBugReport(bugReport, projectId, integrationId);

  return {
    externalId: result.externalId,
    externalUrl: result.externalUrl,
    status: 'created',
    metadata: result.metadata,
  };
}

/**
 * Process integration job
 */
async function processIntegrationJob(
  job: IJobHandle<IntegrationJobData, IntegrationJobResult>,
  bugReportRepo: BugReportRepository,
  registry: PluginRegistry
): Promise<IntegrationJobResult> {
  const startTime = Date.now();

  // Validate job data
  if (!validateIntegrationJobData(job.data)) {
    throw new JobProcessingError(
      job.id || 'unknown',
      'Invalid integration job data: must provide bugReportId, projectId, and platform',
      { data: job.data }
    );
  }

  const { bugReportId, projectId, platform, integrationId } = job.data;

  logger.info('Processing integration job', {
    jobId: job.id,
    bugReportId,
    projectId,
    platform,
    integrationId,
  });

  const progress = new ProgressTracker(job, 2);

  // Step 1: Route to platform handler
  await progress.update(1, `Creating ${platform} issue`);
  const result = await routeToPlatform(
    registry,
    platform,
    bugReportId,
    projectId,
    integrationId,
    bugReportRepo
  );

  // Step 2: Store external ID in database
  await progress.update(2, 'Updating database');
  const rowsAffected = await bugReportRepo.updateExternalIntegration(
    bugReportId,
    result.externalId,
    result.externalUrl
  );

  if (rowsAffected === 0) {
    throw new JobProcessingError(
      job.id || 'unknown',
      'Failed to update bug report with external integration data',
      { bugReportId, externalId: result.externalId, platform }
    );
  }

  await progress.complete('Done');

  const processingTime = Date.now() - startTime;

  logger.info('Integration job completed', {
    jobId: job.id,
    bugReportId,
    platform,
    externalId: result.externalId,
    status: result.status,
    processingTime,
  });

  return createIntegrationJobResult(
    platform,
    result.externalId,
    result.externalUrl,
    result.status,
    result.metadata
  );
}

/**
 * Create integration worker with concurrency and event handlers
 * Returns a BaseWorker wrapper for consistent interface with other workers
 *
 * @param registry - Shared PluginRegistry instance (initialized at application startup)
 * @param bugReportRepo - BugReportRepository for fetching and updating bug reports
 * @param connection - Redis connection for BullMQ
 */
export function createIntegrationWorker(
  registry: PluginRegistry,
  bugReportRepo: BugReportRepository,
  connection: Redis
): IWorkerHost<IntegrationJobData, IntegrationJobResult> {
  logger.info('Creating integration worker', {
    supportedPlatforms: registry.getSupportedPlatforms(),
  });

  const worker = createWorker<
    IntegrationJobData,
    IntegrationJobResult,
    typeof QUEUE_NAMES.INTEGRATIONS
  >({
    name: QUEUE_NAMES.INTEGRATIONS, // Use queue name, not job name
    processor: async (job) => processIntegrationJob(job, bugReportRepo, registry),
    connection,
    workerType: QUEUE_NAMES.INTEGRATIONS,
  });

  // Attach standard event handlers with job-specific context
  attachStandardEventHandlers(worker, 'Integration', (data, result) => ({
    bugReportId: data.bugReportId,
    platform: data.platform || result?.platform,
    externalId: result?.externalId,
    status: result?.status,
  }));

  logger.info('Integration worker started');

  // Return worker directly (already implements IWorkerHost)
  return worker;
}
