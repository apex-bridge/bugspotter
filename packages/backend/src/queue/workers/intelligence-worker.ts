/**
 * Intelligence Worker
 *
 * Processes bug analysis jobs via the bugspotter-intelligence service.
 * Submits bugs for embedding generation and checks for duplicates.
 *
 * Processing Pipeline:
 * 1. Validate job data
 * 2. Submit bug to intelligence service for analysis (embedding + storage)
 * 3. Check for similar/duplicate bugs
 * 4. Return analysis result
 */

import type { IJobHandle } from '@bugspotter/message-broker';
import type { Redis } from 'ioredis';
import { getLogger } from '../../logger.js';
import {
  validateIntelligenceJobData,
  createIntelligenceJobResult,
} from '../jobs/intelligence-job.js';
import { QUEUE_NAMES } from '../types.js';
import { JobProcessingError } from '../errors.js';
import type { IWorkerHost } from '@bugspotter/message-broker';
import { attachStandardEventHandlers } from './worker-events.js';
import { ProgressTracker } from './progress-tracker.js';
import { createWorker } from './worker-factory.js';
import type { IntelligenceClient } from '../../services/intelligence/intelligence-client.js';
import { IntelligenceError } from '../../services/intelligence/intelligence-client.js';
import type { DatabaseClient } from '../../db/client.js';
import type { IntelligenceClientFactory } from '../../services/intelligence/tenant-config.js';
import { IntelligenceEnrichmentService } from '../../services/intelligence/enrichment-service.js';
import { IntelligenceMitigationService } from '../../services/intelligence/mitigation-service.js';
import { IntelligenceDedupService } from '../../services/intelligence/dedup-service.js';
import type {
  IntelligenceJobData,
  IntelligenceJobResult,
  AnalyzeBugRequest,
  UpdateResolutionRequest,
  EnrichBugRequest,
  MitigationJobPayload,
  DedupAction,
} from '../../services/intelligence/types.js';

const logger = getLogger();

// TODO: Add unit tests (processAnalyzeJob, processResolutionJob, validation failure, error handling)

/**
 * Resolve the IntelligenceClient for a job.
 *
 * If the job carries an organizationId, attempts to get the per-org client
 * from the factory. Falls back to the global client for self-hosted mode
 * or when organizationId is absent.
 */
interface ResolvedClientContext {
  client: IntelligenceClient;
  orgId: string | undefined;
}

async function resolveClient(
  job: IJobHandle<IntelligenceJobData, IntelligenceJobResult>,
  clientFactory: IntelligenceClientFactory,
  db: DatabaseClient
): Promise<ResolvedClientContext> {
  const { organizationId, projectId, bugReportId } = job.data;

  // Always verify the project exists and check org relationship
  const project = await db.projects.findById(projectId);
  if (!project) {
    throw new JobProcessingError(job.id || 'unknown', `Project not found: ${projectId}`, {
      projectId,
      bugReportId,
    });
  }

  let orgId = organizationId;

  if (orgId) {
    // Verify the project belongs to the claimed organization
    if (project.organization_id !== orgId) {
      throw new JobProcessingError(
        job.id || 'unknown',
        'Project does not belong to the specified organization',
        { projectId, organizationId: orgId, projectOrgId: project.organization_id, bugReportId }
      );
    }
  } else if (project.organization_id) {
    // No organizationId in job data — resolve from project
    orgId = project.organization_id;
  } else {
    // Project exists but has no org — self-hosted mode, fall through to global client
    logger.debug('Project has no organization_id (self-hosted mode)', { projectId, bugReportId });
  }

  if (orgId) {
    const orgClient = await clientFactory.getClientForOrg(orgId);
    if (orgClient) {
      logger.debug('Using per-org intelligence client', { orgId, bugReportId });
      return { client: orgClient, orgId };
    }
    // Org context exists but no per-org client available (disabled or no key).
    // Do NOT fall back to global client — that would bypass tenant isolation
    // and process tenant data with a shared API key.
    throw new JobProcessingError(
      job.id || 'unknown',
      'No intelligence client available for organization: intelligence is disabled or no API key provisioned',
      { organizationId: orgId, bugReportId }
    );
  }

  // No org context (self-hosted mode) — use global client
  const globalClient = clientFactory.getGlobalClient();
  if (!globalClient) {
    throw new JobProcessingError(
      job.id || 'unknown',
      'No intelligence client available: no org context and no global client configured',
      { bugReportId }
    );
  }

  logger.debug('Using global intelligence client (self-hosted mode)', { bugReportId });
  return { client: globalClient, orgId: undefined };
}

/**
 * Process intelligence analysis job
 */
async function processIntelligenceJob(
  job: IJobHandle<IntelligenceJobData, IntelligenceJobResult>,
  clientFactory: IntelligenceClientFactory,
  db: DatabaseClient
): Promise<IntelligenceJobResult> {
  const startTime = Date.now();

  // Validate job data
  if (!validateIntelligenceJobData(job.data)) {
    throw new JobProcessingError(
      job.id || 'unknown',
      'Invalid intelligence job data: must provide type, bugReportId, projectId, and payload',
      { data: job.data }
    );
  }

  const { type, bugReportId, projectId } = job.data;

  logger.info('Processing intelligence job', {
    jobId: job.id,
    type,
    bugReportId,
    projectId,
  });

  const { client, orgId } = await resolveClient(job, clientFactory, db);

  if (type === 'analyze') {
    return processAnalyzeJob(job, client, db, orgId, startTime);
  }

  if (type === 'resolution') {
    return processResolutionJob(job, client, startTime);
  }

  if (type === 'enrich') {
    return processEnrichJob(job, client, db, startTime);
  }

  if (type === 'mitigation') {
    return processMitigationJob(job, client, db, startTime);
  }

  // Unsupported type — shouldn't happen if validation is correct
  throw new JobProcessingError(job.id || 'unknown', `Unsupported intelligence job type: ${type}`, {
    type,
    bugReportId,
  });
}

/**
 * Process bug analysis: submit for embedding then check for duplicates
 */
async function processAnalyzeJob(
  job: IJobHandle<IntelligenceJobData, IntelligenceJobResult>,
  client: IntelligenceClient,
  db: DatabaseClient,
  resolvedOrgId: string | undefined,
  startTime: number
): Promise<IntelligenceJobResult> {
  const { bugReportId, projectId } = job.data;
  const payload = job.data.payload as AnalyzeBugRequest;

  // Ensure payload bug_id matches job-level bugReportId
  if (payload.bug_id !== bugReportId) {
    throw new JobProcessingError(job.id || 'unknown', 'payload.bug_id does not match bugReportId', {
      bugReportId,
      payloadBugId: payload.bug_id,
    });
  }

  const progress = new ProgressTracker(job, 3);

  // Step 1: Submit bug for analysis (embedding generation + storage)
  await progress.update(1, 'Analyzing bug');
  const analyzeResult = await client.analyzeBug(payload);

  logger.info('Bug analyzed', {
    jobId: job.id,
    bugReportId,
    embeddingGenerated: analyzeResult.embedding_generated,
    stored: analyzeResult.stored,
  });

  // Step 2: Check for similar/duplicate bugs (scoped to project)
  await progress.update(2, 'Checking for duplicates');
  const similarResult = await client.getSimilarBugs(bugReportId, { projectId });

  logger.info('Similarity check completed', {
    jobId: job.id,
    bugReportId,
    isDuplicate: similarResult.is_duplicate,
    similarCount: similarResult.similar_bugs.length,
  });

  // Step 3: Apply dedup action if duplicate detected (errors caught, never thrown)
  let dedupAction: DedupAction | undefined;
  let dedupApplied = false;
  let duplicateOf: string | null = null;

  if (similarResult.is_duplicate && similarResult.similar_bugs.length > 0) {
    try {
      await progress.update(3, 'Applying dedup action');

      const dedupService = new IntelligenceDedupService(db);
      const dedupResult = await dedupService.applyDedupAction(
        bugReportId,
        similarResult.is_duplicate,
        similarResult.similar_bugs,
        resolvedOrgId
      );

      dedupAction = dedupResult.action;
      dedupApplied = dedupResult.applied;
      duplicateOf = dedupResult.duplicateOf;

      if (dedupResult.applied) {
        logger.info('Dedup action applied', {
          jobId: job.id,
          bugReportId,
          action: dedupResult.action,
          duplicateOf: dedupResult.duplicateOf,
          statusChanged: dedupResult.statusChanged,
        });
      }
    } catch (error) {
      // Never throw from dedup — analysis result must still be returned
      logger.error('Failed to apply dedup action', {
        jobId: job.id,
        bugReportId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    await progress.update(
      3,
      similarResult.is_duplicate ? 'No similar bugs to compare' : 'No duplicates found'
    );
  }

  await progress.complete('Done');

  const processingTime = Date.now() - startTime;

  logger.info('Intelligence job completed', {
    jobId: job.id,
    bugReportId,
    isDuplicate: similarResult.is_duplicate,
    similarCount: similarResult.similar_bugs.length,
    dedupAction,
    dedupApplied,
    processingTime,
  });

  return createIntelligenceJobResult('analyze', bugReportId, true, {
    isDuplicate: similarResult.is_duplicate,
    similarBugs: similarResult.similar_bugs,
    dedupAction,
    dedupApplied,
    duplicateOf,
  });
}

/**
 * Process resolution sync: update the intelligence service with resolution data
 */
async function processResolutionJob(
  job: IJobHandle<IntelligenceJobData, IntelligenceJobResult>,
  client: IntelligenceClient,
  startTime: number
): Promise<IntelligenceJobResult> {
  const { bugReportId } = job.data;
  const payload = job.data.payload as UpdateResolutionRequest;
  const progress = new ProgressTracker(job, 1);

  // Step 1: Send resolution to intelligence service
  await progress.update(1, 'Syncing resolution');
  await client.updateResolution(bugReportId, payload);

  await progress.complete('Done');

  const processingTime = Date.now() - startTime;

  logger.info('Resolution sync completed', {
    jobId: job.id,
    bugReportId,
    status: payload.status,
    processingTime,
  });

  return createIntelligenceJobResult('resolution', bugReportId, true);
}

/**
 * Process enrichment: request AI categorization, severity, tags, root cause, components.
 * Gracefully degrades when the intelligence service hasn't implemented the endpoint yet (404/405).
 */
async function processEnrichJob(
  job: IJobHandle<IntelligenceJobData, IntelligenceJobResult>,
  client: IntelligenceClient,
  db: DatabaseClient,
  startTime: number
): Promise<IntelligenceJobResult> {
  const { bugReportId, projectId, organizationId } = job.data;
  const payload = job.data.payload as EnrichBugRequest;

  // Ensure payload bug_id matches job-level bugReportId
  if (payload.bug_id !== bugReportId) {
    throw new JobProcessingError(job.id || 'unknown', 'payload.bug_id does not match bugReportId', {
      bugReportId,
      payloadBugId: payload.bug_id,
    });
  }

  const progress = new ProgressTracker(job, 2);

  // Step 1: Request enrichment from intelligence service
  await progress.update(1, 'Enriching bug');

  let enrichResponse;
  try {
    enrichResponse = await client.enrichBug(payload);
  } catch (error) {
    // Graceful degradation: if the endpoint doesn't exist yet, succeed without enrichment
    if (
      error instanceof IntelligenceError &&
      (error.statusCode === 404 || error.statusCode === 405)
    ) {
      logger.info('Enrichment endpoint not available, skipping', {
        jobId: job.id,
        bugReportId,
        statusCode: error.statusCode,
      });

      await progress.complete('Done (endpoint not available)');

      return createIntelligenceJobResult('enrich', bugReportId, true, {
        enriched: false,
      });
    }
    throw error;
  }

  // Step 2: Persist enrichment data
  await progress.update(2, 'Saving enrichment');
  const enrichmentService = new IntelligenceEnrichmentService(db);
  const row = await enrichmentService.saveEnrichment(
    bugReportId,
    projectId,
    organizationId ?? undefined,
    enrichResponse
  );

  await progress.complete('Done');

  const processingTime = Date.now() - startTime;

  logger.info('Enrichment job completed', {
    jobId: job.id,
    bugReportId,
    category: enrichResponse.category,
    enrichmentVersion: row.enrichment_version,
    processingTime,
  });

  return createIntelligenceJobResult('enrich', bugReportId, true, {
    enriched: true,
    enrichmentId: row.id,
  });
}

// ============================================================================
// Mitigation Job
// ============================================================================

async function processMitigationJob(
  job: IJobHandle<IntelligenceJobData, IntelligenceJobResult>,
  client: IntelligenceClient,
  db: DatabaseClient,
  startTime: number
): Promise<IntelligenceJobResult> {
  const { bugReportId, projectId, organizationId } = job.data;
  const payload = job.data.payload as MitigationJobPayload;

  if (payload.bug_id !== bugReportId) {
    throw new JobProcessingError(job.id || 'unknown', 'payload.bug_id does not match bugReportId', {
      bugReportId,
      payloadBugId: payload.bug_id,
    });
  }

  const progress = new ProgressTracker(job, 2);

  // Step 1: Call intelligence service (the slow Ollama call)
  await progress.update(1, 'Generating mitigation suggestion');
  let mitigationResponse;
  try {
    mitigationResponse = await client.getMitigation(bugReportId, {
      useSimilarBugs: payload.use_similar_bugs ?? true,
      projectId, // Use validated job.data.projectId, not optional payload field
    });
  } catch (error) {
    // Only swallow 405 (method not allowed = endpoint not deployed yet).
    // 404 may mean the bug hasn't been analyzed — let it retry.
    if (error instanceof IntelligenceError && error.statusCode === 405) {
      await progress.complete('Done (endpoint not available)');
      return createIntelligenceJobResult('mitigation', bugReportId, true, {
        mitigationGenerated: false,
      });
    }
    throw error;
  }

  // Step 2: Persist to bug_mitigations table
  await progress.update(2, 'Saving mitigation');
  const mitigationService = new IntelligenceMitigationService(db);
  const row = await mitigationService.saveMitigation(
    bugReportId,
    projectId,
    organizationId ?? undefined,
    mitigationResponse
  );

  await progress.complete('Done');

  const processingTime = Date.now() - startTime;

  logger.info('Mitigation job completed', {
    jobId: job.id,
    bugReportId,
    basedOnSimilar: mitigationResponse.based_on_similar_bugs,
    mitigationVersion: row.mitigation_version,
    processingTime,
  });

  return createIntelligenceJobResult('mitigation', bugReportId, true, {
    mitigationGenerated: true,
    mitigationId: row.id,
  });
}

/**
 * Create intelligence worker
 *
 * @param clientFactory - Factory for resolving per-org IntelligenceClient instances
 * @param db - Database client for resolving org context from projects
 * @param connection - Redis connection for BullMQ
 */
export function createIntelligenceWorker(
  clientFactory: IntelligenceClientFactory,
  db: DatabaseClient,
  connection: Redis
): IWorkerHost<IntelligenceJobData, IntelligenceJobResult> {
  logger.info('Creating intelligence worker');

  const worker = createWorker<
    IntelligenceJobData,
    IntelligenceJobResult,
    typeof QUEUE_NAMES.INTELLIGENCE
  >({
    name: QUEUE_NAMES.INTELLIGENCE,
    processor: async (job) => processIntelligenceJob(job, clientFactory, db),
    connection,
    workerType: QUEUE_NAMES.INTELLIGENCE,
  });

  // Attach standard event handlers with job-specific context
  attachStandardEventHandlers(worker, 'Intelligence', (data, result) => ({
    bugReportId: data.bugReportId,
    type: data.type,
    isDuplicate: result?.isDuplicate,
    similarCount: result?.similarBugs?.length,
  }));

  logger.info('Intelligence worker started');

  return worker;
}
