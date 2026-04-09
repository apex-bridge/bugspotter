/**
 * Ticket Creation Outbox Processor
 * Background worker that processes pending outbox entries and creates tickets on external platforms
 *
 * Implements Transactional Outbox Pattern for reliable ticket creation:
 * 1. Polls for pending outbox entries
 * 2. Creates ticket on external platform (Jira, GitHub, etc.)
 * 3. Marks outbox entry as completed
 * 4. Handles failures with exponential backoff retry
 *
 * Note: Integration services (JiraService, GenericHttpService) handle database updates
 * (tickets table + bug_reports table) via their saveTicketReference() methods.
 * The outbox worker only orchestrates the external API call and tracks completion.
 *
 * Benefits:
 * - Guarantees no orphaned tickets (external API call AFTER db transaction commits)
 * - Automatic retries with exponential backoff (1min, 5min, 30min, 2h, 12h)
 * - Dead letter queue for exhausted retries
 * - Idempotency prevents duplicate tickets
 */

import { Queue } from 'bullmq';
import type { IJobHandle } from '@bugspotter/message-broker';
import { getLogger } from '../../../logger.js';
import type { DatabaseClient } from '../../../db/client.js';
import type { PluginRegistry } from '../../../integrations/plugin-registry.js';
import type { TicketCreationOutboxEntry } from '../../../db/repositories/ticket-creation-outbox.repository.js';

const logger = getLogger();

/**
 * Job data for outbox processor
 */
export interface OutboxProcessorJobData {
  outboxEntryId: string;
}

/**
 * Worker to process ticket creation outbox entries
 */
export class TicketCreationOutboxProcessor {
  constructor(
    private readonly db: DatabaseClient,
    private readonly pluginRegistry: PluginRegistry,
    private readonly queue?: Queue<OutboxProcessorJobData>
  ) {}

  /**
   * Process a single outbox entry (called by Bull queue)
   */
  async process(job: IJobHandle<OutboxProcessorJobData>): Promise<void> {
    const { outboxEntryId } = job.data;

    logger.info('Processing ticket creation outbox entry', {
      jobId: job.id,
      outboxEntryId,
      attemptNumber: job.attemptsMade + 1,
    });

    try {
      // Step 1: Mark entry as processing (prevents duplicate processing)
      await this.db.ticketOutbox.markProcessing(outboxEntryId);

      // Step 2: Fetch outbox entry
      const entry = await this.db.ticketOutbox.findById(outboxEntryId);

      if (!entry) {
        logger.error('Outbox entry not found in database', {
          outboxEntryId,
          jobId: job.id,
        });
        throw new Error(`Outbox entry not found: ${outboxEntryId}`);
      }

      if (entry.status !== 'processing') {
        logger.warn('Outbox entry already processed or failed', {
          outboxEntryId,
          status: entry.status,
        });
        return; // Already handled by another worker
      }

      logger.debug('Fetched outbox entry details', {
        outboxEntryId,
        platform: entry.platform,
        bugReportId: entry.bug_report_id,
        projectId: entry.project_id,
        retryCount: entry.retry_count,
        scheduledAt: entry.scheduled_at,
      });

      // Step 3: Create ticket on external platform
      // Note: Integration service handles database updates (tickets table + bug_reports table)
      const ticketResult = await this.createExternalTicket(entry);

      // Step 4: Mark outbox entry as completed
      await this.db.ticketOutbox.markCompleted(outboxEntryId, {
        external_ticket_id: ticketResult.externalId,
        external_ticket_url: ticketResult.externalUrl,
      });

      logger.info('Ticket creation outbox entry processed successfully', {
        jobId: job.id,
        outboxEntryId,
        externalId: ticketResult.externalId,
        platform: entry.platform,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error('Failed to process ticket creation outbox entry', {
        jobId: job.id,
        outboxEntryId,
        error: errorMessage,
        stack: errorStack,
        attemptNumber: job.attemptsMade + 1,
      });

      // Mark as failed (will schedule retry with exponential backoff)
      // markFailed returns the updated entry, eliminating need for redundant findById
      const updatedEntry = await this.db.ticketOutbox.markFailed(outboxEntryId, errorMessage);

      // Check if entry was moved to dead letter queue (max retries exhausted)
      if (updatedEntry.status === 'dead_letter') {
        logger.error('Max retries exhausted for outbox entry - DEAD LETTER', {
          outboxEntryId,
          platform: updatedEntry.platform,
          retryCount: updatedEntry.retry_count,
          maxRetries: updatedEntry.max_retries,
          error: errorMessage,
          bugReportId: updatedEntry.bug_report_id,
          projectId: updatedEntry.project_id,
        });
      }

      // Re-throw so Bull queue knows job failed (for monitoring)
      throw error;
    }
  }

  /**
   * Create ticket on external platform using plugin registry
   */
  private async createExternalTicket(
    entry: TicketCreationOutboxEntry
  ): Promise<{ externalId: string; externalUrl: string }> {
    const { platform, integration_id, project_id, bug_report_id, rule_id } = entry;

    logger.debug('Creating ticket on external platform', {
      outboxEntryId: entry.id,
      platform,
      integrationId: integration_id,
      bugReportId: bug_report_id,
    });

    // Get platform service from registry
    logger.debug('Looking up integration plugin in registry', {
      platform,
      availablePlatforms: this.pluginRegistry.getSupportedPlatforms(),
    });

    const service = this.pluginRegistry.get(platform);
    if (!service) {
      logger.error('Platform not found in plugin registry', {
        platform,
        outboxEntryId: entry.id,
        availablePlatforms: this.pluginRegistry.getSupportedPlatforms(),
        bugReportId: bug_report_id,
        projectId: project_id,
      });
      throw new Error(`Platform '${platform}' not supported`);
    }

    logger.debug('Found integration plugin, creating ticket', {
      platform,
      outboxEntryId: entry.id,
    });

    // Fetch bug report (needed for full context)
    const bugReport = await this.db.bugReports.findById(bug_report_id);
    if (!bugReport) {
      throw new Error(`Bug report not found: ${bug_report_id}`);
    }

    // Extract field mappings from outbox payload (if present)
    const fieldMappings = entry.payload?.field_mappings as
      | Record<string, unknown>
      | null
      | undefined;

    // Extract description template from outbox payload (if present)
    const descriptionTemplate = entry.payload?.description_template as string | null | undefined;

    // Create ticket with idempotency key (prevents duplicate tickets on retries)
    // The idempotency key is stored in the outbox entry
    // Pass metadata (rule_id, created_automatically, field_mappings, description_template) down the call chain
    const result = await service.createFromBugReport(bugReport, project_id, integration_id, {
      ruleId: rule_id,
      createdAutomatically: true,
      fieldMappings: fieldMappings || null,
      descriptionTemplate: descriptionTemplate || null,
    });

    return {
      externalId: result.externalId,
      externalUrl: result.externalUrl,
    };
  }

  /**
   * Poll for pending outbox entries and schedule jobs
   * This method is called periodically by a cron job or scheduler
   */
  async pollAndScheduleJobs(batchSize: number = 10): Promise<number> {
    logger.debug('Polling for pending ticket creation outbox entries', { batchSize });

    try {
      const pendingEntries = await this.db.ticketOutbox.findPending(batchSize);

      if (pendingEntries.length === 0) {
        logger.debug('No pending outbox entries found');
        return 0;
      }

      logger.info('Found pending outbox entries', {
        count: pendingEntries.length,
        entries: pendingEntries.map((e) => ({
          id: e.id,
          platform: e.platform,
          scheduled_at: e.scheduled_at,
          retry_count: e.retry_count,
        })),
      });

      // Validate platforms before scheduling jobs
      const availablePlatforms = this.pluginRegistry.getSupportedPlatforms();
      const validEntries: typeof pendingEntries = [];
      const invalidEntries: typeof pendingEntries = [];
      const markFailedPromises: Promise<TicketCreationOutboxEntry>[] = [];

      for (const entry of pendingEntries) {
        if (this.pluginRegistry.isSupported(entry.platform)) {
          validEntries.push(entry);
        } else {
          invalidEntries.push(entry);
          logger.error('Skipping outbox entry with invalid platform', {
            outboxEntryId: entry.id,
            platform: entry.platform,
            availablePlatforms,
            bugReportId: entry.bug_report_id,
            projectId: entry.project_id,
            retryCount: entry.retry_count,
          });

          // Collect promise to mark as failed (parallel execution after loop)
          markFailedPromises.push(
            this.db.ticketOutbox.markFailed(
              entry.id,
              `Platform '${entry.platform}' not found in plugin registry. Available platforms: ${availablePlatforms.join(', ')}`
            )
          );
        }
      }

      // Execute all markFailed operations in parallel (using allSettled for resilience)
      if (markFailedPromises.length > 0) {
        const results = await Promise.allSettled(markFailedPromises);

        // Log any individual failures
        const failedMarks = results.filter((r) => r.status === 'rejected');
        if (failedMarks.length > 0) {
          logger.error('Failed to mark some invalid outbox entries as failed', {
            failedCount: failedMarks.length,
            totalInvalid: invalidEntries.length,
            errors: failedMarks.map((r) => (r as PromiseRejectedResult).reason),
          });
        }
      }

      if (invalidEntries.length > 0) {
        logger.warn('Marked invalid outbox entries as failed', {
          count: invalidEntries.length,
          invalidPlatforms: invalidEntries.map((e) => e.platform),
        });
      }

      // Schedule jobs for valid entries only
      let scheduled = 0;

      if (this.queue) {
        // Production: Enqueue jobs to BullMQ for async parallel processing
        const enqueuePromises = validEntries.map((entry) =>
          this.queue!.add(
            'process-outbox',
            { outboxEntryId: entry.id },
            {
              jobId: `outbox-${entry.id}`,
              attempts: 1, // Outbox handles its own retries with exponential backoff
              removeOnComplete: { count: 1000 }, // Keep last 1000 successful jobs
              removeOnFail: { count: 5000 }, // Keep last 5000 failed jobs for debugging
            }
          )
            .then(() => {
              scheduled++;
              return true;
            })
            .catch((error) => {
              logger.error('Failed to enqueue outbox entry', {
                outboxEntryId: entry.id,
                error: error instanceof Error ? error.message : String(error),
              });
              return false;
            })
        );

        // Wait for all enqueue operations to complete
        await Promise.all(enqueuePromises);
      } else {
        // Development/Testing: Process synchronously (blocks poller)
        logger.warn('Queue not configured - processing outbox entries synchronously');
        for (const entry of validEntries) {
          try {
            await this.process(createSyntheticJobHandle(entry.id));

            scheduled++;
          } catch (error) {
            logger.error('Failed to process outbox entry', {
              outboxEntryId: entry.id,
              error: error instanceof Error ? error.message : String(error),
            });
            // Continue with next entry (don't let one failure block others)
          }
        }
      }

      logger.info('Scheduled outbox entries for processing', {
        scheduled,
        total: pendingEntries.length,
      });

      return scheduled;
    } catch (error) {
      logger.error('Failed to poll outbox entries', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}

/**
 * Create a synthetic IJobHandle for synchronous (dev/test) processing.
 * Avoids an unsafe `as` cast — if IJobHandle gains new required members,
 * this function will produce a compile-time error.
 */
function createSyntheticJobHandle(entryId: string): IJobHandle<OutboxProcessorJobData> {
  return {
    id: entryId,
    name: 'process-outbox',
    data: { outboxEntryId: entryId },
    attemptsMade: 0,
    updateProgress: async () => {},
    log: async () => {},
  };
}

/**
 * Create outbox processor worker
 *
 * @param db - Database client for outbox operations
 * @param pluginRegistry - Plugin registry for external platform integrations
 * @param queue - Optional BullMQ queue for async job processing (production)
 *                If not provided, jobs are processed synchronously (dev/test only)
 */
export function createOutboxProcessor(
  db: DatabaseClient,
  pluginRegistry: PluginRegistry,
  queue?: Queue<OutboxProcessorJobData>
): TicketCreationOutboxProcessor {
  return new TicketCreationOutboxProcessor(db, pluginRegistry, queue);
}
