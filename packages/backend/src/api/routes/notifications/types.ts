/**
 * Notification route type definitions
 * Shared interfaces for query strings and request bodies
 */

import type { ChannelType } from '../../../types/notifications.js';

// ============================================================================
// CHANNEL TYPES
// ============================================================================

export interface ChannelQuerystring {
  project_id?: string;
  type?: ChannelType;
  active?: boolean;
  page?: number;
  limit?: number;
}

export interface CreateChannelBody {
  project_id: string;
  name: string;
  type: ChannelType;
  config: Record<string, unknown>;
  active?: boolean;
}

export interface UpdateChannelBody {
  name?: string;
  config?: Record<string, unknown>;
  active?: boolean;
}

export interface TestChannelBody {
  test_message?: string;
}

// ============================================================================
// RULE TYPES
// ============================================================================

export interface RuleQuerystring {
  project_id?: string;
  enabled?: boolean;
  page?: number;
  limit?: number;
}

export interface CreateRuleBody {
  project_id: string;
  name: string;
  enabled?: boolean;
  triggers: Array<Record<string, unknown>>;
  filters?: Array<Record<string, unknown>>;
  throttle?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
  priority?: number;
  channel_ids: string[];
}

export interface UpdateRuleBody {
  name?: string;
  enabled?: boolean;
  triggers?: Array<Record<string, unknown>>;
  filters?: Array<Record<string, unknown>>;
  throttle?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
  priority?: number;
  channel_ids?: string[];
}

// ============================================================================
// TEMPLATE TYPES
// ============================================================================

export interface TemplateQuerystring {
  channel_type?: string;
  trigger_type?: string;
  is_active?: boolean;
  page?: number;
  limit?: number;
}

export interface CreateTemplateBody {
  name: string;
  channel_type: string;
  trigger_type: string;
  subject?: string;
  body: string;
  variables?: Array<Record<string, unknown>>;
}

export interface UpdateTemplateBody {
  name?: string;
  subject?: string;
  body?: string;
  variables?: Array<Record<string, unknown>>;
  is_active?: boolean;
}

export interface PreviewTemplateBody {
  template_body: string;
  subject?: string;
  context: Record<string, unknown>;
}

// ============================================================================
// HISTORY TYPES
// ============================================================================

export interface HistoryQuerystring {
  channel_id?: string;
  rule_id?: string;
  bug_id?: string;
  status?: string;
  created_after?: string;
  created_before?: string;
  page?: number;
  limit?: number;
}
