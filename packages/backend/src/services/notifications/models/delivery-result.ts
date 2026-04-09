/**
 * Delivery Result Domain Model
 * Represents the outcome of a notification delivery attempt
 */

export type DeliveryStatus = 'success' | 'failure' | 'skipped' | 'throttled' | 'scheduled';

export interface DeliveryResultInput {
  status: DeliveryStatus;
  channelId: string;
  triggerId: string;
  projectId: string;
  bugId: string;
  message?: string;
  error?: Error | string;
  metadata?: Record<string, unknown>;
  retryable?: boolean;
}

export class DeliveryResult {
  readonly status: DeliveryStatus;
  readonly channelId: string;
  readonly triggerId: string;
  readonly projectId: string;
  readonly bugId: string;
  readonly message: string;
  readonly error: string | null;
  readonly metadata: Record<string, unknown>;
  readonly retryable: boolean;
  readonly timestamp: Date;

  constructor(input: DeliveryResultInput) {
    this.status = input.status;
    this.channelId = input.channelId;
    this.triggerId = input.triggerId;
    this.projectId = input.projectId;
    this.bugId = input.bugId;
    this.message = input.message || this.getDefaultMessage();
    this.error = input.error ? this.formatError(input.error) : null;
    this.metadata = input.metadata || {};
    this.retryable = input.retryable ?? false;
    this.timestamp = new Date();
  }

  /**
   * Creates a successful delivery result
   */
  static success(
    channelId: string,
    triggerId: string,
    projectId: string,
    bugId: string,
    message?: string,
    metadata?: Record<string, unknown>
  ): DeliveryResult {
    return new DeliveryResult({
      status: 'success',
      channelId,
      triggerId,
      projectId,
      bugId,
      message,
      metadata,
      retryable: false,
    });
  }

  /**
   * Creates a failed delivery result
   */
  static failure(
    channelId: string,
    triggerId: string,
    projectId: string,
    bugId: string,
    error: Error | string,
    retryable = true,
    metadata?: Record<string, unknown>
  ): DeliveryResult {
    return new DeliveryResult({
      status: 'failure',
      channelId,
      triggerId,
      projectId,
      bugId,
      error,
      retryable,
      metadata,
    });
  }

  /**
   * Creates a skipped delivery result
   */
  static skipped(
    channelId: string,
    triggerId: string,
    projectId: string,
    bugId: string,
    reason: string,
    metadata?: Record<string, unknown>
  ): DeliveryResult {
    return new DeliveryResult({
      status: 'skipped',
      channelId,
      triggerId,
      projectId,
      bugId,
      message: reason,
      metadata,
      retryable: false,
    });
  }

  /**
   * Creates a throttled delivery result
   */
  static throttled(
    channelId: string,
    triggerId: string,
    projectId: string,
    bugId: string,
    metadata?: Record<string, unknown>
  ): DeliveryResult {
    return new DeliveryResult({
      status: 'throttled',
      channelId,
      triggerId,
      projectId,
      bugId,
      message: 'Delivery throttled due to rate limiting',
      metadata,
      retryable: true,
    });
  }

  /**
   * Creates a scheduled delivery result
   */
  static scheduled(
    channelId: string,
    triggerId: string,
    projectId: string,
    bugId: string,
    scheduledTime: Date,
    metadata?: Record<string, unknown>
  ): DeliveryResult {
    return new DeliveryResult({
      status: 'scheduled',
      channelId,
      triggerId,
      projectId,
      bugId,
      message: `Scheduled for ${scheduledTime.toISOString()}`,
      metadata: { ...metadata, scheduledTime: scheduledTime.toISOString() },
      retryable: false,
    });
  }

  /**
   * Checks if the delivery was successful
   */
  isSuccess(): boolean {
    return this.status === 'success';
  }

  /**
   * Checks if the delivery failed
   */
  isFailure(): boolean {
    return this.status === 'failure';
  }

  /**
   * Checks if delivery should be retried
   */
  shouldRetry(): boolean {
    return this.retryable && this.isFailure();
  }

  /**
   * Gets a summary for logging
   */
  getSummary(): string {
    const base = `${this.status.toUpperCase()}: Channel ${this.channelId}`;
    if (this.error) {
      return `${base} - ${this.error}`;
    }
    if (this.message) {
      return `${base} - ${this.message}`;
    }
    return base;
  }

  /**
   * Converts to history record format
   */
  toHistoryRecord(): {
    channel_id: string;
    trigger_id: string;
    project_id: string;
    bug_id: string;
    status: DeliveryStatus;
    message: string | null;
    error_message: string | null;
    metadata: Record<string, unknown>;
    delivered_at: Date;
  } {
    return {
      channel_id: this.channelId,
      trigger_id: this.triggerId,
      project_id: this.projectId,
      bug_id: this.bugId,
      status: this.status,
      message: this.message || null,
      error_message: this.error,
      metadata: this.metadata,
      delivered_at: this.timestamp,
    };
  }

  private getDefaultMessage(): string {
    switch (this.status) {
      case 'success':
        return 'Notification delivered successfully';
      case 'failure':
        return 'Notification delivery failed';
      case 'skipped':
        return 'Notification delivery skipped';
      case 'throttled':
        return 'Notification delivery throttled';
      case 'scheduled':
        return 'Notification scheduled for later delivery';
      default:
        return 'Unknown status';
    }
  }

  private formatError(error: Error | string): string {
    if (typeof error === 'string') {
      return error;
    }
    return error.message || 'Unknown error';
  }
}
