/**
 * Notifier Interface
 * Common contract for all notification delivery mechanisms
 * Implements Strategy Pattern for pluggable notification providers
 */

/**
 * Bug report context for notifications
 */
export interface NotificationContext {
  bugReportId: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
  priority?: string;
  screenshotUrl?: string;
  replayUrl?: string;
  externalUrl?: string;
  metadata: Record<string, unknown>;
}

/**
 * Result of notification delivery attempt
 */
export interface NotificationResult {
  success: boolean;
  error?: string;
  deliveredAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Base configuration common to all notifiers
 */
export interface BaseNotifierConfig {
  type: string;
  enabled: boolean;
  retryAttempts?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

/**
 * Default configuration values for all notifiers
 */
export const DEFAULT_NOTIFIER_CONFIG = {
  retryAttempts: 3,
  retryDelayMs: 2000,
  timeoutMs: 10000,
} as const;

/**
 * Notifier interface - implemented by all notification providers
 */
export interface INotifier {
  /**
   * Notifier type identifier
   */
  readonly type: string;

  /**
   * Validate notifier configuration
   * @throws Error if configuration is invalid
   */
  validateConfig(): void;

  /**
   * Send notification to single recipient
   * @param recipient - Recipient identifier (email, channel, URL, etc.)
   * @param context - Bug report context
   * @param event - Event type (bug_created, bug_updated, etc.)
   * @returns Delivery result with success status
   */
  send(recipient: string, context: NotificationContext, event: string): Promise<NotificationResult>;

  /**
   * Test connection/credentials (optional)
   * @returns true if notifier is properly configured and can send
   */
  testConnection?(): Promise<boolean>;
}

/**
 * Factory function type for creating notifiers
 */
export type NotifierFactory<TConfig extends BaseNotifierConfig = BaseNotifierConfig> = (
  config: TConfig
) => INotifier;
