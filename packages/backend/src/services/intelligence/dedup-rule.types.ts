/**
 * TypeScript mirror of the Python DedupRule schema.
 *
 * The intelligence service is the source of truth for this schema — these
 * types exist so backend + admin UI can typecheck the wire shape without
 * importing Pydantic models. Keep in sync with
 * `bugspotter-intelligence/src/bugspotter_intelligence/models/dedup_rule.py`.
 */

// ============================================================================
// Triggers — discriminated on `type`
// ============================================================================

export type TriggerSpec =
  | { type: 'duplicate_detected' }
  | { type: 'outbox_about_to_skip' }
  | { type: 'cluster_growing'; threshold: number; window: string }
  | { type: 'schedule'; cron: string };

// ============================================================================
// Conditions
// ============================================================================

export type ConditionOp = 'eq' | 'in' | 'not_in' | 'gte' | 'lte';

export interface ConditionSpec {
  field: string;
  op: ConditionOp;
  value: unknown;
  window?: string | null;
}

// ============================================================================
// Actions — discriminated on `type`
// ============================================================================

export type CanonicalStatus = 'open' | 'in_progress' | 'closed' | 'wont_fix';

export type ActionSpec =
  | { type: 'ticket.add_comment'; target: 'canonical'; body: string }
  | { type: 'ticket.transition'; target: 'canonical'; to: CanonicalStatus }
  | { type: 'notify.email'; to: string; template: string }
  | { type: 'notify.slack'; channel?: string | null; user?: string | null; message: string }
  | { type: 'notify.webhook'; url: string; payload?: Record<string, unknown> | null };

// ============================================================================
// Rule
// ============================================================================

export interface RateLimit {
  count: number;
  window: string;
}

export interface DedupRule {
  name: string;
  when: TriggerSpec;
  if?: ConditionSpec[];
  then: ActionSpec[];
  rate_limit?: RateLimit | null;
  enabled?: boolean;
}

// ============================================================================
// Parse NL request / response
// ============================================================================

export interface ParseNLRuleRequest {
  nl: string;
  available_integrations?: string[];
  available_slack_channels?: string[];
  available_email_templates?: string[];
}

export interface ParseNLRuleResponse {
  draft: DedupRule | null;
  errors: string[];
  clarifications: string[];
  raw_llm_output: string | null;
  model: string;
}
