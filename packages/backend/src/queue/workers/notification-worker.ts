/**
 * Notification Worker
 *
 * Processes notification delivery jobs (email, Slack, webhooks).
 * Routes notifications to appropriate delivery mechanism, tracks delivery status.
 *
 * Processing Pipeline:
 * 1. Validate job data
 * 2. Fetch bug report context if needed
 * 3. Route to notification handler (email/Slack/webhook)
 * 4. Send notifications to all recipients
 * 5. Track delivery success/failure rates
 *
 * Dependencies:
 * - BugReportRepository: For fetching bug report context
 * - Email service: For sending email notifications
 * - Slack SDK: For sending Slack messages
 * - HTTP client: For webhook delivery
 */

import type { IJobHandle } from '@bugspotter/message-broker';
import type { Redis } from 'ioredis';
import { getLogger } from '../../logger.js';
import type { DatabaseClient } from '../../db/client.js';
import type { IStorageService } from '../../storage/types.js';
import { NotificationService } from '../../services/notifications/notification-service.js';

import { QUEUE_NAMES } from '../types.js';
import type { IWorkerHost } from '@bugspotter/message-broker';
import { attachStandardEventHandlers } from './worker-events.js';
import { ProgressTracker } from './progress-tracker.js';
import { createWorker } from './worker-factory.js';

// Import NotificationJob type from types
import type { NotificationJob as NotificationJobType } from '../../types/notifications.js';

// Job data structure used by NotificationService
interface NotificationJob {
  rule_id: string;
  bug_id: string;
  channel_ids: string[];
  trigger_event: string;
  timestamp: Date;
}

// Job result structure
interface NotificationJobResult {
  success: boolean;
  channelCount: number;
  errors?: string[];
}

const logger = getLogger();

/**
 * Process notification job
 */
async function processNotificationJob(
  job: IJobHandle<NotificationJob, NotificationJobResult>,
  notificationService: NotificationService
): Promise<NotificationJobResult> {
  const jobData = job.data;

  logger.info('🔔 [NOTIFICATION WORKER] Processing notification job', {
    jobId: job.id,
    jobName: job.name,
    ruleId: jobData.rule_id,
    bugId: jobData.bug_id,
    channelCount: jobData.channel_ids.length,
    channelIds: jobData.channel_ids,
    triggerEvent: jobData.trigger_event,
    timestamp: jobData.timestamp,
  });

  const progress = new ProgressTracker(job, jobData.channel_ids.length);
  const errors: string[] = [];

  try {
    // Send notification using NotificationService
    // This handles fetching channel config from database and sending
    await progress.update(1, 'Sending notifications');
    await notificationService.sendNotification(jobData as NotificationJobType);

    await progress.complete('Done');

    logger.info('🔔 [NOTIFICATION WORKER] Notification job completed successfully', {
      jobId: job.id,
      ruleId: jobData.rule_id,
      bugId: jobData.bug_id,
      channelCount: jobData.channel_ids.length,
    });

    return {
      success: true,
      channelCount: jobData.channel_ids.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('🔔 [NOTIFICATION WORKER] Notification job failed', {
      jobId: job.id,
      ruleId: jobData.rule_id,
      bugId: jobData.bug_id,
      error: errorMessage,
      stack: errorStack,
    });

    errors.push(errorMessage);

    return {
      success: false,
      channelCount: jobData.channel_ids.length,
      errors,
    };
  }
}

/**
 * Create notification worker with concurrency and event handlers
 */
export function createNotificationWorker(
  db: DatabaseClient,
  _storage: IStorageService,
  connection: Redis
): IWorkerHost<NotificationJob, NotificationJobResult> {
  logger.info('🔔 [NOTIFICATION WORKER] Initializing notification worker', {
    queueName: QUEUE_NAMES.NOTIFICATIONS,
    redisHost: connection.options?.host,
    redisPort: connection.options?.port,
  });

  // Create NotificationService - it loads channel config from database
  logger.info('🔔 [NOTIFICATION WORKER] Creating NotificationService', {
    dbProvided: !!db,
    dbType: typeof db,
    dbKeys: db ? Object.keys(db).slice(0, 5) : [],
  });

  const notificationService = new NotificationService(db);
  logger.info('🔔 [NOTIFICATION WORKER] NotificationService created');

  const worker = createWorker<
    NotificationJob,
    NotificationJobResult,
    typeof QUEUE_NAMES.NOTIFICATIONS
  >({
    name: QUEUE_NAMES.NOTIFICATIONS, // MUST match queue name!
    processor: async (job) => {
      logger.info('🔔 [NOTIFICATION WORKER] Processor function called', { jobId: job.id });
      return processNotificationJob(job, notificationService);
    },
    connection,
    workerType: QUEUE_NAMES.NOTIFICATIONS,
  });

  // Attach standard event handlers with job-specific context
  attachStandardEventHandlers(worker, 'Notification', (data, result) => ({
    ruleId: data.rule_id,
    bugId: data.bug_id,
    channelCount: data.channel_ids?.length,
    success: result?.success,
  }));

  logger.info('🔔 [NOTIFICATION WORKER] Worker registered and listening for jobs', {
    queueName: QUEUE_NAMES.NOTIFICATIONS,
  });

  // Return worker directly (already implements IWorkerHost)
  logger.info('🔔 [NOTIFICATION WORKER] Worker ready to process jobs');

  return worker;
}
