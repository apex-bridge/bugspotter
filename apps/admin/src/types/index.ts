import type { FieldMappings, AttachmentConfig } from '@bugspotter/types';

// Language preferences type - shared across admin UI
export type LanguageCode = 'en' | 'ru' | 'kk';

export interface UserPreferences {
  language?: LanguageCode;
  theme?: 'light' | 'dark' | 'system';
  [key: string]: unknown;
}

export interface UserSecurity {
  is_platform_admin?: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role?: 'admin' | 'user' | 'viewer';
  security?: UserSecurity;
  oauth_provider?: string | null;
  oauth_id?: string | null;
  preferences?: UserPreferences;
  created_at?: string;
  updated_at?: string;
}

/**
 * Check if a user is a platform admin.
 * Uses security.is_platform_admin as source of truth when present.
 * Falls back to legacy role === 'admin' only when the security flag is absent.
 */
export function isPlatformAdmin(user: User | null | undefined): boolean {
  if (!user) {
    return false;
  }
  if (user.security && 'is_platform_admin' in user.security) {
    return user.security.is_platform_admin === true;
  }
  return user.role === 'admin';
}

// Integration Types
export interface Integration {
  id: string;
  type: string;
  name: string;
  description?: string;
  status: 'not_configured' | 'active' | 'error' | 'disabled';
  is_custom: boolean;
  plugin_source: 'builtin' | 'npm' | 'filesystem' | 'generic_http';
  trust_level: 'builtin' | 'custom';
  plugin_code?: string;
  code_hash?: string;
  allow_code_execution: boolean;
  config?: GenericHttpConfig | Record<string, unknown>; // Primary config field - flexible for custom plugins
  created_at: string;
  updated_at: string;
}

export interface GenericHttpConfig {
  baseUrl: string;
  auth: {
    type: 'bearer' | 'basic' | 'api_key' | 'oauth2';
    token?: string;
    username?: string;
    password?: string;
    apiKey?: string;
    header?: string;
  };
  endpoints: {
    create: {
      path: string;
      method: string;
      responseMapping: {
        idField: string;
        urlTemplate: string;
      };
    };
    [key: string]: unknown;
  };
  fieldMappings: Array<{
    bugReportField: string;
    externalField: string;
  }>;
}

export interface JiraConfig {
  instanceUrl?: string;
  authentication?: {
    type: 'basic' | 'oauth2' | 'pat';
    email?: string;
    apiToken?: string;
    accessToken?: string;
  };
  projectKey?: string;
  issueType?: string;
  fieldMapping?: {
    customFields?: Array<{
      id: string;
      sourceField: string;
      targetField: string;
    }>;
  };
  syncRules?: {
    autoCreate?: boolean;
    bidirectionalSync?: boolean;
  };
}

export interface CreateIntegrationRequest {
  type: string;
  name: string;
  description?: string;
  is_custom: boolean;
  plugin_source: 'builtin' | 'npm' | 'filesystem' | 'generic_http';
  trust_level: 'builtin' | 'custom';

  // Option 1: Full plugin code (advanced mode)
  plugin_code?: string;

  // Option 2: Structured parts (guided mode - simpler UI)
  metadata_json?: string; // JSON string of plugin metadata
  auth_type?: 'basic' | 'bearer' | 'api_key' | 'custom';
  create_ticket_code?: string; // JavaScript function body for createTicket
  test_connection_code?: string; // Optional: JavaScript function body for testConnection
  validate_config_code?: string; // Optional: JavaScript function body for validateConfig

  allow_code_execution: boolean;
  config?: GenericHttpConfig | Record<string, unknown>; // Flexible for custom plugins
}

export interface SecurityAnalysisResult {
  safe: boolean;
  risk_level: 'low' | 'medium' | 'high';
  violations: string[];
  warnings: string[];
  code_hash: string;
}

// Integration Rules Types
export interface FilterCondition {
  field:
    | 'priority'
    | 'status'
    | 'browser'
    | 'os'
    | 'url_pattern'
    | 'user_email'
    | 'error_message'
    | 'project'
    | 'console_level'
    | 'console_message'
    | 'network_status'
    | 'network_url';
  operator: 'equals' | 'contains' | 'regex' | 'in' | 'not_in' | 'starts_with' | 'ends_with';
  value: string | string[];
  case_sensitive?: boolean;
}

// Integration throttle config - used for rate-limiting ticket creation
export interface ThrottleConfig {
  max_per_hour?: number;
  max_per_day?: number;
  group_by?: 'user' | 'url' | 'error_type'; // Integration-specific grouping options
  digest_mode?: boolean;
  digest_interval_minutes?: number;
}

// Note: FieldMappings and AttachmentConfig are imported from @bugspotter/types at the top

export interface IntegrationRule {
  id: string;
  project_id: string;
  integration_id: string;
  name: string;
  enabled: boolean;
  priority: number;
  filters: FilterCondition[];
  throttle: ThrottleConfig | null;
  auto_create: boolean;
  field_mappings: FieldMappings | null;
  description_template: string | null;
  attachment_config: AttachmentConfig | null;
  created_at: string;
  updated_at: string;
}

export interface CreateIntegrationRuleRequest {
  name: string;
  enabled?: boolean;
  priority?: number;
  filters: FilterCondition[];
  throttle?: ThrottleConfig | null;
  auto_create?: boolean;
  field_mappings?: FieldMappings | null;
  description_template?: string | null;
  attachment_config?: AttachmentConfig | null;
}

export interface UpdateIntegrationRuleRequest {
  name?: string;
  enabled?: boolean;
  priority?: number;
  filters?: FilterCondition[];
  throttle?: ThrottleConfig | null;
  auto_create?: boolean;
  field_mappings?: FieldMappings | null;
  description_template?: string | null;
  attachment_config?: AttachmentConfig | null;
}

export interface AuthResponse {
  access_token: string;
  refresh_token?: string; // Optional: Only present in backward compatibility mode
  user: User;
  expires_in: number;
  token_type: string;
}

export interface SetupStatus {
  initialized: boolean;
  requiresSetup: boolean;
  setupMode: 'minimal' | 'full';
  defaults?: {
    instance_name?: string;
    instance_url?: string;
    storage_type?: 'minio' | 's3';
    storage_endpoint?: string;
    storage_bucket?: string;
    storage_region?: string;
  };
}

export interface SetupRequest {
  admin_email: string;
  admin_password: string;
  admin_name?: string;
  instance_name?: string;
  instance_url?: string;
  storage_type?: 'minio' | 's3';
  storage_endpoint?: string;
  storage_access_key?: string;
  storage_secret_key?: string;
  storage_bucket?: string;
  storage_region?: string;
}

export interface InstanceSettings {
  instance_name: string;
  instance_url: string;
  support_email: string;
  storage_type: 'minio' | 's3';
  storage_endpoint?: string;
  storage_bucket: string;
  storage_region?: string;
  jwt_access_expiry: number;
  jwt_refresh_expiry: number;
  rate_limit_max: number;
  rate_limit_window: number;
  cors_origins: string[];
  retention_days: number;
  max_reports_per_project: number;
  session_replay_enabled: boolean;
  replay_duration: number;
  replay_inline_stylesheets: boolean;
  replay_inline_images: boolean;
  replay_collect_fonts: boolean;
  replay_record_canvas: boolean;
  replay_record_cross_origin_iframes: boolean;
  replay_sampling_mousemove: number;
  replay_sampling_scroll: number;
}

export interface Project {
  id: string;
  name: string;
  created_at: string;
  report_count: number;
  owner_id?: string;
  created_by?: string;
  organization_id?: string | null;
  updated_at?: string;
}

// Re-export shared health monitoring types from @bugspotter/types
export type {
  WorkerHealth,
  QueueHealth,
  PluginHealth,
  ServiceHealth,
  HealthStatus,
} from '@bugspotter/types';

export type BugStatus = 'open' | 'in-progress' | 'resolved' | 'closed';
export type BugPriority = 'low' | 'medium' | 'high' | 'critical';
export type ReplayUploadStatus = 'none' | 'pending' | 'processing' | 'completed' | 'failed';

export interface BugReport {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  screenshot_url: string | null;
  screenshot_key: string | null;
  replay_url: string | null;
  replay_key: string | null;
  replay_upload_status: ReplayUploadStatus;
  metadata: {
    console?: Array<{ level: string; message: string; timestamp: number }>;
    network?: Array<{ url: string; method: string; status: number }>;
    metadata?: {
      userAgent?: string;
      viewport?: { width: number; height: number };
      url?: string;
    };
    thumbnailKey?: string;
    [key: string]: unknown;
  };
  status: BugStatus;
  priority: BugPriority;
  duplicate_of: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  legal_hold: boolean;
  created_at: string;
  updated_at: string;
}

export interface BugReportFilters {
  project_id?: string;
  status?: BugStatus;
  priority?: BugPriority;
  created_after?: string;
  created_before?: string;
}

// Shared Types
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface BugReportListResponse {
  data: BugReport[];
  pagination: PaginationMeta;
}

export interface Session {
  id: string;
  bug_report_id: string;
  events: {
    type: string;
    recordedEvents: Array<{
      type: number | string;
      data?: unknown;
      timestamp: number;
      [key: string]: unknown;
    }>;
  };
  duration: number | null;
  created_at: string;
}

// User Management Types
export type UserRole = 'admin' | 'user' | 'viewer';

// Project Member Types
export type ProjectMemberRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: ProjectMemberRole;
  created_at: string;
  user_email?: string;
  user_name?: string;
}

export interface UserProject {
  id: string;
  name: string;
  role: ProjectMemberRole;
  created_at: string;
}

export interface AddProjectMemberRequest {
  user_id: string;
  role: 'admin' | 'member' | 'viewer';
}

export interface UpdateProjectMemberRequest {
  role: 'admin' | 'member' | 'viewer';
}

export interface ProjectMemberListResponse {
  members: ProjectMember[];
  pagination: PaginationMeta;
}

export interface UserProjectListResponse {
  projects: UserProject[];
  pagination: PaginationMeta;
}

export interface CreateUserRequest {
  email: string;
  name: string;
  password?: string;
  role: UserRole;
  oauth_provider?: string;
}

export interface UpdateUserRequest {
  name?: string;
  email?: string;
  role?: UserRole;
}

export interface UserManagementResponse {
  users: User[];
  pagination: PaginationMeta;
}

// Analytics Types
export interface AnalyticsDashboard {
  bug_reports: {
    by_status: {
      open: number;
      in_progress: number;
      resolved: number;
      closed: number;
      total: number;
    };
    by_priority: {
      low: number;
      medium: number;
      high: number;
      critical: number;
    };
  };
  projects: {
    total: number;
    total_reports: number;
    avg_reports_per_project: number;
  };
  users: {
    total: number;
  };
  time_series: Array<{
    date: string;
    count: number;
  }>;
  top_projects: Array<{
    id: string;
    name: string;
    report_count: number;
  }>;
}

export interface ReportTrend {
  days: number;
  trend: Array<{
    date: string;
    total: number;
    open: number;
    in_progress: number;
    resolved: number;
    closed: number;
  }>;
}

export interface ProjectStats {
  id: string;
  name: string;
  created_at: string;
  total_reports: number;
  open_reports: number;
  in_progress_reports: number;
  resolved_reports: number;
  closed_reports: number;
  critical_reports: number;
  last_report_at: string | null;
}

// Notification Types
export type ChannelType = 'email' | 'slack' | 'webhook' | 'discord' | 'teams';
export type TriggerEvent =
  | 'new_bug'
  | 'bug_resolved'
  | 'priority_change'
  | 'threshold_reached'
  | 'error_spike';
export type TriggerType = TriggerEvent | 'digest';
export type NotificationStatus = 'sent' | 'failed' | 'pending' | 'throttled';

export interface NotificationChannel {
  id: string;
  project_id: string;
  name: string;
  type: ChannelType;
  config: Record<string, unknown>;
  active: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_count: number;
  created_at: string;
  updated_at: string;
}

export interface TriggerCondition {
  event: TriggerEvent;
  params?: {
    priority?: 'critical' | 'high' | 'medium' | 'low';
    threshold?: number;
    time_window?: string;
    spike_multiplier?: number;
    from_priority?: string;
    to_priority?: string;
  };
}

// Notification throttle config - used for rate-limiting notifications
// Note: NotificationThrottleConfig has different group_by options than IntegrationThrottleConfig
export interface NotificationThrottleConfig {
  max_per_hour?: number;
  max_per_day?: number;
  group_by?: 'error_signature' | 'project' | 'user' | 'none'; // Notification-specific grouping
  digest_mode?: boolean;
  digest_interval_minutes?: number;
}

// Notification filters use the same FilterCondition type as Integration Rules
export type NotificationFilterCondition = FilterCondition;

export interface ScheduleConfig {
  type: 'immediate' | 'scheduled' | 'business_hours';
  timezone?: string;
  business_hours?: {
    start: string;
    end: string;
    days: number[];
  };
  delay_minutes?: number;
}

export interface NotificationRule {
  id: string;
  project_id: string;
  name: string;
  enabled: boolean;
  triggers: TriggerCondition[];
  filters: NotificationFilterCondition[] | null;
  throttle: NotificationThrottleConfig | null;
  schedule: ScheduleConfig | null;
  priority: number;
  created_at: string;
  updated_at: string;
  channels?: string[];
}

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
  subject: string | null;
  body: string;
  variables: TemplateVariable[] | null;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

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
  delivered_at: string | null;
  created_at: string;
  channel_name?: string;
  channel_type?: ChannelType;
  rule_name?: string;
  bug_title?: string;
}

export interface NotificationChannelListResponse {
  channels: NotificationChannel[];
  pagination: PaginationMeta;
}

export interface NotificationRuleListResponse {
  rules: NotificationRule[];
  pagination: PaginationMeta;
}

export interface NotificationTemplateListResponse {
  templates: NotificationTemplate[];
  pagination: PaginationMeta;
}

export interface NotificationHistoryListResponse {
  history: NotificationHistory[];
  pagination: PaginationMeta;
}

// API Key Types
export type {
  ApiKey,
  CreateApiKeyData,
  ApiKeyResponse,
  ApiKeyUsage,
  ApiKeyListResponse,
} from './api-keys';
