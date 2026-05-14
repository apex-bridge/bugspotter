/**
 * Mirror of the DedupRule schema served by the intelligence service.
 *
 * Source of truth lives in the Python side
 * (`bugspotter-intelligence/.../models/dedup_rule.py`). Keep these aligned —
 * if the wire shape changes, update both.
 */

export type TriggerSpec =
  | { type: 'duplicate_detected' }
  | { type: 'outbox_about_to_skip' }
  | { type: 'cluster_growing'; threshold: number; window: string }
  | { type: 'schedule'; cron: string };

export type ConditionOp = 'eq' | 'in' | 'not_in' | 'gte' | 'lte';

export interface ConditionSpec {
  field: string;
  op: ConditionOp;
  value: unknown;
  window?: string | null;
}

export type CanonicalStatus = 'open' | 'in_progress' | 'closed' | 'wont_fix';

export type ActionSpec =
  | { type: 'ticket.add_comment'; target: 'canonical'; body: string }
  | { type: 'ticket.transition'; target: 'canonical'; to: CanonicalStatus }
  | { type: 'notify.email'; to: string; template: string }
  | { type: 'notify.slack'; channel?: string | null; user?: string | null; message: string }
  | { type: 'notify.webhook'; url: string; payload?: Record<string, unknown> | null };

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
// Parse NL endpoint
// ============================================================================

export interface ParseNLRuleInput {
  nl: string;
  available_integrations?: string[];
  available_slack_channels?: string[];
  available_email_templates?: string[];
}

export interface ParseNLRuleResult {
  draft: DedupRule | null;
  errors: string[];
  clarifications: string[];
  raw_llm_output: string | null;
  model: string;
}
