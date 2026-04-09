/**
 * Job Queue Types
 * Type definitions for all job queues and their data
 */

// ============================================================================
// Queue Names
// ============================================================================

export const QUEUE_NAMES = {
  SCREENSHOTS: 'screenshots',
  REPLAYS: 'replays',
  INTEGRATIONS: 'integrations',
  NOTIFICATIONS: 'notifications',
  OUTBOX: 'outbox',
  PAYMENTS: 'payments',
  PAYMENT_EVENTS: 'payment-events',
  INTELLIGENCE: 'intelligence',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// Job ID prefixes for different queue types
export const JOB_ID_PREFIXES = {
  SCREENSHOT: 'screenshot-',
  REPLAY: 'replay-',
  INTEGRATION: 'integration-',
  NOTIFICATION: 'notification-',
} as const;

// ============================================================================
// Job Data Interfaces
// ============================================================================

export interface ScreenshotJobData {
  bugReportId: string;
  projectId: string;
  // Presigned URL flow: Storage key where client uploaded the file
  screenshotKey: string;
  originalFilename?: string;
}

export interface ReplayJobData {
  bugReportId: string;
  projectId: string;
  // Presigned URL flow: Storage key where client uploaded compressed replay (required)
  replayKey: string;
  duration?: number; // milliseconds
  eventCount?: number;
}

export interface IntegrationJobData {
  bugReportId: string;
  projectId: string;
  platform: 'jira' | 'github' | 'linear' | 'slack';
  integrationId: string;
  credentials: {
    apiKey?: string;
    token?: string;
    url?: string;
    projectKey?: string;
    repository?: string;
    teamId?: string;
  };
  config: {
    autoCreate: boolean;
    syncStatus: boolean;
    syncComments: boolean;
    customFields?: Record<string, unknown>;
  };
}

export interface NotificationJobData {
  bugReportId: string;
  projectId: string;
  type: 'email' | 'slack' | 'webhook';
  recipients: string[];
  event: 'created' | 'updated' | 'resolved' | 'deleted';
  metadata?: Record<string, unknown>;
}

export interface PaymentJobData {
  action: 'checkout' | 'cancel';
  organizationId: string;
  planName?: string;
  returnUrl?: string;
  externalSubscriptionId?: string;
  price?: number;
  currency?: string;
}

export interface PaymentEventJobData {
  type: 'payment.succeeded' | 'payment.failed' | 'subscription.canceled' | 'subscription.updated';
  externalSubscriptionId: string;
  externalCustomerId?: string;
  organizationId?: string;
  planName?: string;
  provider: string;
}

// ============================================================================
// Job Results
// ============================================================================

export interface ScreenshotJobResult {
  originalUrl: string;
  thumbnailUrl: string;
  originalSize: number;
  thumbnailSize: number;
  width: number;
  height: number;
  processingTimeMs: number;
}

export interface ReplayJobResult {
  replayUrl: string;
  metadataUrl: string;
  chunkCount: number;
  totalSize: number;
  duration: number;
  eventCount: number;
  processingTimeMs: number;
}

export interface IntegrationJobResult {
  platform: string;
  externalId: string;
  externalUrl: string;
  status: 'created' | 'updated' | 'failed';
  metadata?: Record<string, unknown>;
}

export interface NotificationJobResult {
  type: string;
  recipientCount: number;
  successCount: number;
  failureCount: number;
  errors?: string[];
}

export interface PaymentJobResult {
  checkoutUrl?: string;
  externalSubscriptionId?: string;
  externalCustomerId?: string;
}

// ============================================================================
// Job Status and Progress
// ============================================================================

/**
 * BullMQ Job States
 * All possible states a job can be in during its lifecycle.
 * Matches BullMQ's JobState type exactly.
 *
 * Note: 'paused' is a QUEUE state, not a JOB state in BullMQ.
 */
export type JobState =
  | 'waiting' // Job is waiting to be processed
  | 'active' // Job is currently being processed
  | 'completed' // Job has completed successfully
  | 'failed' // Job has failed
  | 'delayed' // Job is delayed (scheduled for future)
  | 'waiting-children' // Job is waiting for child jobs to complete
  | 'prioritized' // Job has been prioritized
  | 'unknown'; // Job state is unknown (returned by BullMQ when state cannot be determined)

export interface JobProgress {
  current: number;
  total: number;
  percentage: number;
  message?: string;
}

export interface JobStatus<TData = unknown, TResult = unknown> {
  id: string;
  name: string;
  data: TData;
  progress: JobProgress | null;
  returnValue: TResult | null;
  failedReason: string | null;
  stacktrace: string[] | null;
  attemptsMade: number;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  state: JobState;
}

// ============================================================================
// Queue Statistics
// ============================================================================

export interface QueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

export interface QueueStats {
  [queueName: string]: QueueMetrics;
}

// ============================================================================
// Worker Configuration
// ============================================================================

export interface WorkerConfig {
  concurrency: number;
  limiter?: {
    max: number;
    duration: number;
  };
  settings?: {
    backoffStrategy?: (attemptsMade: number) => number;
    maxStalledCount?: number;
    stalledInterval?: number;
  };
}

// ============================================================================
// Job Options
// ============================================================================

export interface JobOptions {
  priority?: number;
  delay?: number;
  attempts?: number;
  backoff?: number | { type: string; delay: number };
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
  jobId?: string;
}
