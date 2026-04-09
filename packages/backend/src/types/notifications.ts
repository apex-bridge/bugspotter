/**
 * Notification System Types
 *
 * Type definitions for notification channels, rules, templates, and delivery tracking.
 */

// ============================================================================
// CHANNEL TYPES
// ============================================================================

/**
 * Valid notification channel types
 * Single source of truth for all channel type validation
 */
export const CHANNEL_TYPES = ['email', 'slack', 'webhook', 'discord', 'teams'] as const;

export type ChannelType = (typeof CHANNEL_TYPES)[number];

/**
 * Type guard to check if a value is a valid ChannelType
 */
export function isChannelType(value: unknown): value is ChannelType {
  return typeof value === 'string' && CHANNEL_TYPES.includes(value as ChannelType);
}

export interface BaseNotificationChannel {
  id: string;
  project_id: string;
  name: string;
  type: ChannelType;
  active: boolean;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  failure_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface NotificationChannel<T extends ChannelConfig = ChannelConfig>
  extends BaseNotificationChannel {
  config: T;
}

// Channel Configuration Types

export interface BaseChannelConfig {
  type: ChannelType;
}

export interface EmailChannelConfig extends BaseChannelConfig {
  type: 'email';
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string; // encrypted
  from_address: string;
  from_name: string;
  tls_reject_unauthorized?: boolean;
}

export interface SlackChannelConfig extends BaseChannelConfig {
  type: 'slack';
  webhook_url: string; // encrypted
  channel?: string;
  username?: string;
  icon_emoji?: string;
  mentions?: {
    critical?: string; // e.g., "@channel"
    high?: string; // e.g., "@here"
  };
}

export interface WebhookChannelConfig extends BaseChannelConfig {
  type: 'webhook';
  url: string;
  method: 'POST' | 'PUT';
  headers?: Record<string, string>;
  auth_type: 'none' | 'bearer' | 'basic' | 'apikey';
  auth_value?: string; // encrypted
  /** Secret for HMAC-SHA256 signature (X-BugSpotter-Signature header) */
  signature_secret?: string; // encrypted
  retry_policy?: {
    max_attempts: number;
    backoff_ms: number;
  };
  timeout_ms?: number;
}

export interface DiscordChannelConfig extends BaseChannelConfig {
  type: 'discord';
  webhook_url: string; // encrypted
  username?: string;
  avatar_url?: string;
  mention_roles?: {
    critical?: string; // role ID
    high?: string; // role ID
  };
}

export interface TeamsChannelConfig extends BaseChannelConfig {
  type: 'teams';
  webhook_url: string; // encrypted
  card_template?: string; // Adaptive Card JSON template
}

export type ChannelConfig =
  | EmailChannelConfig
  | SlackChannelConfig
  | WebhookChannelConfig
  | DiscordChannelConfig
  | TeamsChannelConfig;

// Channel Creation/Update Types

export interface CreateChannelInput {
  project_id: string;
  name: string;
  type: ChannelType;
  config: ChannelConfig;
  active?: boolean;
}

export interface UpdateChannelInput {
  name?: string;
  config?: ChannelConfig;
  active?: boolean;
}

// ============================================================================
// RULE TYPES
// ============================================================================

export type TriggerEvent =
  | 'new_bug'
  | 'bug_resolved'
  | 'priority_change'
  | 'threshold_reached'
  | 'error_spike';

export type FilterOperator =
  | 'equals'
  | 'contains'
  | 'regex'
  | 'in'
  | 'not_in'
  | 'starts_with'
  | 'ends_with';

export type FilterField =
  | 'project'
  | 'browser'
  | 'os'
  | 'url_pattern'
  | 'user_email'
  | 'error_message'
  | 'priority'
  | 'status'
  | 'console_level'
  | 'console_message'
  | 'network_status'
  | 'network_url';

export interface TriggerCondition {
  event: TriggerEvent;
  params?: {
    priority?: 'critical' | 'high' | 'medium' | 'low';
    threshold?: number;
    time_window?: string; // e.g., "5m", "1h", "1d"
    spike_multiplier?: number; // e.g., 2, 5 for 2x, 5x normal rate
    from_priority?: string; // for priority_change
    to_priority?: string; // for priority_change
  };
}

export interface FilterCondition {
  field: FilterField;
  operator: FilterOperator;
  value: string | string[];
  case_sensitive?: boolean;
}

export interface ThrottleConfig {
  max_per_hour?: number;
  max_per_day?: number;
  /**
   * Grouping strategy for throttle limits:
   * - 'error_signature': Throttle per unique error type/signature
   * - 'project': Throttle per project
   * - 'user': Throttle per user who triggered the error
   * - 'url': Throttle per unique URL where error occurred
   * - 'none': Global throttle (all errors counted together)
   */
  group_by?: 'error_signature' | 'project' | 'user' | 'url' | 'none';
  digest_mode?: boolean; // batch into single notification
  digest_interval_minutes?: number; // how often to send digest
}

export type ScheduleType = 'immediate' | 'scheduled' | 'business_hours';

export interface ScheduleConfig {
  type: ScheduleType;
  timezone?: string; // IANA timezone (e.g., "America/New_York")
  business_hours?: {
    start: string; // HH:mm format (e.g., "09:00")
    end: string; // HH:mm format (e.g., "17:00")
    days: number[]; // 0-6, where 0 = Sunday
  };
  delay_minutes?: number; // delay after trigger
}

export interface NotificationRule {
  id: string;
  project_id: string;
  name: string;
  enabled: boolean;
  triggers: TriggerCondition[];
  filters: FilterCondition[] | null;
  throttle: ThrottleConfig | null;
  schedule: ScheduleConfig | null;
  priority: number;
  created_at: Date;
  updated_at: Date;
}

export interface NotificationRuleWithChannels extends NotificationRule {
  channels: string[]; // channel IDs
}

export interface CreateRuleInput {
  project_id: string;
  name: string;
  enabled?: boolean;
  triggers: TriggerCondition[];
  filters?: FilterCondition[];
  throttle?: ThrottleConfig;
  schedule?: ScheduleConfig;
  priority?: number;
  channel_ids: string[];
}

export interface UpdateRuleInput {
  name?: string;
  enabled?: boolean;
  triggers?: TriggerCondition[];
  filters?: FilterCondition[];
  throttle?: ThrottleConfig;
  schedule?: ScheduleConfig;
  priority?: number;
  channel_ids?: string[];
}

// ============================================================================
// TEMPLATE TYPES
// ============================================================================

export type TriggerType =
  | 'new_bug'
  | 'bug_resolved'
  | 'priority_change'
  | 'threshold_reached'
  | 'error_spike'
  | 'digest';

export interface TemplateVariable {
  name: string;
  description: string;
  example: string;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  channel_type: ChannelType;
  trigger_type: TriggerType;
  subject: string | null; // for email
  body: string;
  variables: TemplateVariable[] | null;
  recipients?: string[]; // Static recipients (optional, for testing/fixed destinations)
  version: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTemplateInput {
  name: string;
  channel_type: ChannelType;
  trigger_type: TriggerType;
  subject?: string;
  body: string;
  variables?: TemplateVariable[];
  recipients?: string[]; // Static recipients (optional)
}

export interface UpdateTemplateInput {
  name?: string;
  subject?: string;
  body?: string;
  variables?: TemplateVariable[];
  recipients?: string[]; // Static recipients (optional)
  is_active?: boolean;
}

export interface TemplateRenderContext {
  bug?: {
    id: string;
    title: string;
    message: string;
    priority: string;
    priorityColor: string;
    status: string;
    browser: string;
    os: string;
    url: string;
    user: {
      email?: string;
      name?: string;
    };
    stack_trace?: string;
  };
  project: {
    id: string;
    name: string;
  };
  link: {
    bugDetail: string;
    replay?: string;
  };
  stats?: {
    todayCount: number;
    weekCount: number;
    totalCount: number;
  };
  timestamp: string;
  timezone: string;
  // Allow additional properties for filter conditions
  [key: string]: unknown;
}

// ============================================================================
// NOTIFICATION HISTORY TYPES
// ============================================================================

export type NotificationStatus = 'sent' | 'failed' | 'pending' | 'throttled';

export interface NotificationHistory {
  id: string;
  channel_id: string | null;
  rule_id: string | null;
  template_id: string | null;
  bug_id: string | null;
  recipients: string[];
  payload: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
  status: NotificationStatus;
  error: string | null;
  attempts: number;
  delivered_at: Date | null;
  created_at: Date;
}

export interface NotificationHistoryWithDetails extends NotificationHistory {
  channel_name?: string;
  channel_type?: ChannelType;
  rule_name?: string;
  bug_title?: string;
}

export interface NotificationHistoryFilters {
  channel_id?: string;
  rule_id?: string;
  bug_id?: string;
  status?: NotificationStatus;
  created_after?: Date;
  created_before?: Date;
}

// ============================================================================
// THROTTLE TYPES
// ============================================================================

export interface NotificationThrottle {
  id: string;
  rule_id: string;
  group_key: string;
  count: number;
  window_start: Date;
  window_end: Date;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// NOTIFICATION DELIVERY TYPES
// ============================================================================

export interface NotificationPayload {
  to: string | string[];
  subject?: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: 'high' | 'normal' | 'low';
}

export interface DeliveryResult {
  success: boolean;
  message_id?: string;
  response?: Record<string, unknown>;
  error?: string;
  attempts?: number;
}

export interface ChannelHealthStatus {
  channel_id: string;
  channel_name: string;
  channel_type: ChannelType;
  status: 'healthy' | 'degraded' | 'failing';
  last_success_at: Date | null;
  last_failure_at: Date | null;
  recent_attempts: number;
  recent_failures: number;
  success_rate: number;
}

// ============================================================================
// NOTIFICATION STATS TYPES
// ============================================================================

export interface NotificationStats {
  total_sent_today: number;
  total_sent_week: number;
  total_sent_month: number;
  success_rate: number;
  average_delivery_time_ms: number;
  failed_count: number;
  by_channel: Array<{
    channel_type: ChannelType;
    count: number;
  }>;
  by_rule: Array<{
    rule_id: string;
    rule_name: string;
    count: number;
  }>;
  failure_reasons: Array<{
    error: string;
    count: number;
  }>;
  trend: Array<{
    date: string;
    sent: number;
    failed: number;
  }>;
}

// ============================================================================
// SERVICE TYPES
// ============================================================================

export interface NotificationJob {
  rule_id: string;
  bug_id?: string;
  channel_ids: string[];
  trigger_event: TriggerEvent;
  timestamp: Date;
}

export interface NotificationContext {
  bug: Record<string, unknown>; // BugReport type
  project: Record<string, unknown>; // Project type
  rule: NotificationRule;
  trigger_event: TriggerEvent;
}

export interface ChannelHandler {
  readonly type: ChannelType;
  send(config: ChannelConfig, payload: NotificationPayload): Promise<DeliveryResult>;
  test(config: ChannelConfig, testMessage?: string): Promise<DeliveryResult>;
}
