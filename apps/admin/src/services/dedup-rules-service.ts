/**
 * Service module for the dedup-rule admin CRUD.
 *
 * Mirrors `integration-rules-service.ts` — pure HTTP wrapper around
 * `/api/v1/projects/:projectId/dedup-rules`. The backend rejects API-key
 * auth on these routes (`rejectApiKeyAuth` preHandler), so every call
 * here implicitly relies on the JWT interceptor in `api-client.ts`.
 *
 * The DedupRule shape is the TypeScript mirror of the Zod schema at
 * `packages/backend/src/integrations/dedup-rule.schema.ts`. Drift
 * between this type and the backend Zod is a real risk — when adding
 * a trigger/action variant, change both sides.
 */

import { api } from '../lib/api-client';
import { API_ENDPOINTS } from '../lib/api-constants';

// ----------------------------------------------------------------------
// DedupRule shape (mirror of packages/backend/src/integrations/dedup-rule.schema.ts)
// ----------------------------------------------------------------------

export type TriggerSpec =
  | { type: 'duplicate_detected' }
  | { type: 'outbox_about_to_skip' }
  | { type: 'cluster_growing'; threshold: number; window: string }
  | { type: 'schedule'; cron: string };

export const TRIGGER_TYPES = [
  'duplicate_detected',
  'outbox_about_to_skip',
  'cluster_growing',
  'schedule',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const CONDITION_FIELDS = [
  'canonical.status',
  'canonical.closed_days_ago',
  'hits_in_window',
  'reporter.customer.tier',
  'severity',
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_OPS = ['eq', 'in', 'not_in', 'gte', 'lte'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export interface ConditionSpec {
  field: ConditionField;
  op: ConditionOp;
  value: string | number | boolean | Array<string | number | boolean>;
  window?: string;
}

export const CANONICAL_STATUSES = ['open', 'in_progress', 'closed', 'wont_fix'] as const;
export type CanonicalStatus = (typeof CANONICAL_STATUSES)[number];

export type ActionSpec =
  | { type: 'ticket.add_comment'; target: 'canonical'; body: string }
  | { type: 'ticket.transition'; target: 'canonical'; to: CanonicalStatus }
  | { type: 'notify.email'; to: string; template: string }
  | {
      type: 'notify.slack';
      channel?: string | null;
      user?: string | null;
      message: string;
    }
  | {
      type: 'notify.webhook';
      url: string;
      payload?: Record<string, unknown> | null;
    };

export const ACTION_TYPES = [
  'ticket.add_comment',
  'ticket.transition',
  'notify.email',
  'notify.slack',
  'notify.webhook',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface RateLimit {
  count: number;
  window: string;
}

export interface DedupRule {
  name: string;
  when: TriggerSpec;
  conditions: ConditionSpec[];
  then: ActionSpec[];
  rate_limit?: RateLimit | null;
  enabled: boolean;
}

/**
 * The row shape the backend returns. `rule_json` is the raw DedupRule
 * blob; the `enabled` column is the source of truth for the executor's
 * hot-path query. The UI displays both consistently because PR-D1 keeps
 * them synced on every write.
 */
export interface DedupRuleRow {
  id: string;
  project_id: string;
  name: string;
  rule_json: DedupRule;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ----------------------------------------------------------------------
// Service
// ----------------------------------------------------------------------

interface ListResponse {
  success: boolean;
  data: { rules: DedupRuleRow[] };
}

interface OneResponse {
  success: boolean;
  data: { rule: DedupRuleRow };
}

interface DeleteResponse {
  success: boolean;
  data: { message: string };
}

export const dedupRulesService = {
  list: async (projectId: string): Promise<DedupRuleRow[]> => {
    const res = await api.get<ListResponse>(API_ENDPOINTS.dedupRules.list(projectId));
    return res.data.data.rules;
  },

  get: async (projectId: string, ruleId: string): Promise<DedupRuleRow> => {
    const res = await api.get<OneResponse>(API_ENDPOINTS.dedupRules.get(projectId, ruleId));
    return res.data.data.rule;
  },

  create: async (projectId: string, payload: DedupRule): Promise<DedupRuleRow> => {
    const res = await api.post<OneResponse>(API_ENDPOINTS.dedupRules.create(projectId), payload);
    return res.data.data.rule;
  },

  /**
   * Toggle-only PATCH. The backend short-circuits the body shape:
   * `{ enabled }` is the toggle path, everything else triggers full-rule
   * replacement validation.
   */
  toggleEnabled: async (
    projectId: string,
    ruleId: string,
    enabled: boolean
  ): Promise<DedupRuleRow> => {
    const res = await api.patch<OneResponse>(API_ENDPOINTS.dedupRules.update(projectId, ruleId), {
      enabled,
    });
    return res.data.data.rule;
  },

  /**
   * Full-rule replacement PATCH. Sends the whole DedupRule body; the
   * backend validates via parseDedupRule.
   *
   * Note on the backend's `omit-enabled-to-preserve` safety net:
   * `packages/backend/src/api/routes/dedup-rules.ts` checks
   * `'enabled' in body` and falls back to the existing column value
   * when absent. The admin UI ALWAYS sends `enabled` (form state
   * carries it explicitly), so that safety net is unreachable from
   * here — it exists for non-UI callers (curl, PR-D2's future
   * structured admin scripts) who might PATCH a partial body. A
   * concurrent-edit lost-update window remains (Admin A opens edit
   * → Admin B toggles disabled → Admin A saves → row flips back on)
   * and lands in a follow-up via ETag / optimistic concurrency.
   */
  update: async (projectId: string, ruleId: string, payload: DedupRule): Promise<DedupRuleRow> => {
    const res = await api.patch<OneResponse>(
      API_ENDPOINTS.dedupRules.update(projectId, ruleId),
      payload
    );
    return res.data.data.rule;
  },

  delete: async (projectId: string, ruleId: string): Promise<DeleteResponse['data']> => {
    const res = await api.delete<DeleteResponse>(
      API_ENDPOINTS.dedupRules.delete(projectId, ruleId)
    );
    return res.data.data;
  },
};

export default dedupRulesService;
