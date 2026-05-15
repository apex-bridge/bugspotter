/**
 * Types for the tiny dedup-rule engine.
 *
 * The executor takes a (TriggerType, BugReport) pair, loads the
 * matching rules from `application.dedup_rules`, builds an evaluation
 * context for each one, evaluates its conditions, and dispatches its
 * actions via the injected ActionDispatcher. The split here is so the
 * evaluator stays a pure function (easy to test without a DB) and the
 * executor only orchestrates.
 */

import type { BugReport } from '../../db/types.js';
import type { ActionSpec, DedupRule } from '../../integrations/dedup-rule.schema.js';

/**
 * Triggers the engine knows how to fire on in this slice (PR-C).
 *
 * Other DedupRule trigger types (`cluster_growing`, `schedule`) are valid
 * at the schema level but not wired here yet — they need an aggregator
 * and a cron worker respectively, both deferred to follow-up PRs.
 */
export type TriggerType = 'duplicate_detected' | 'outbox_about_to_skip';

/**
 * Evaluation context shared between condition matching and action
 * dispatch. Built once per (trigger, bugReport) and reused across
 * every rule that fires for the same event.
 *
 * `canonical` may be null when the trigger fires before a canonical is
 * known — e.g. a `duplicate_detected` event for a bug whose
 * `duplicate_of` field was just set but the canonical row has since
 * been hard-deleted. Rules with conditions on `canonical.*` skip when
 * canonical is null; rules with no canonical conditions still fire.
 */
export interface RuleEvalContext {
  /** The bug that triggered the event. */
  bugReport: BugReport;
  /** The canonical (the bug `bugReport.duplicate_of` points at), if any. */
  canonical: BugReport | null;
  /** Project id, mirrored for action dispatch (no rule will cross projects). */
  projectId: string;
  /**
   * Map from condition field literal -> resolved value, populated lazily
   * by the executor before evaluation. Lazy because `hits_in_window`
   * requires a DB count, and most rules won't reference it.
   *
   * `null` means "the field was looked up and resolved to absent" (e.g.
   * `hits_in_window` when canonical is null), which distinguishes from
   * "not yet resolved" (key missing).
   */
  resolved: Map<string, unknown>;
}

/**
 * Pluggable side-effect handler. The executor stays free of HTTP /
 * SMTP / Slack concerns; the route or worker that invokes it provides
 * a concrete dispatcher. PR-C ships an implementation for
 * `ticket.add_comment` and `ticket.transition`; the other action
 * types log and skip until their follow-up PRs land.
 *
 * Returns whether the action ran (true) or was skipped/failed (false).
 * Failures must be logged inside the dispatcher; the executor does not
 * inspect the return except to record telemetry.
 */
export interface ActionDispatcher {
  dispatch(context: RuleEvalContext, action: ActionSpec): Promise<boolean>;
}

/**
 * Optional rate-limit gate. The executor calls `shouldFire` BEFORE
 * dispatching any actions, and `recordFire` AFTER all actions for one
 * rule have been dispatched. Implementation routes through the
 * existing `notification_throttle` table so we don't introduce a
 * second throttle store.
 */
export interface RuleRateLimiter {
  shouldFire(ruleId: string, canonicalId: string, rule: DedupRule): Promise<boolean>;
  recordFire(ruleId: string, canonicalId: string, rule: DedupRule): Promise<void>;
}

/**
 * What the executor returns for telemetry / debugging. Not surfaced to
 * end users — the engine fires fire-and-forget from the trigger hooks.
 */
export interface RuleFireResult {
  ruleId: string;
  fired: boolean;
  /** When fired=false, the reason. `null` when fired=true. */
  skipReason: 'conditions_unmet' | 'rate_limited' | 'dispatch_error' | 'evaluation_error' | null;
  /** Count of actions that ran successfully (vs were skipped). */
  actionsDispatched: number;
  actionsSkipped: number;
}
