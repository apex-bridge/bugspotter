/**
 * Dedup-rule executor.
 *
 * Loads enabled rules for the firing project, filters by trigger type,
 * builds an evaluation context, evaluates conditions, checks rate
 * limit, then dispatches each action through the injected
 * `ActionDispatcher`. Returns telemetry for the caller to log.
 *
 * **Error containment, not fire-and-forget.** Callers (the outbox
 * worker, eventually the dedup service) DO await `fire(...)` — the
 * trigger handler runs at a point where awaiting is safe (already
 * inside a BullMQ job, no user request blocked on it). The executor's
 * job is to make sure nothing it does propagates back: rule load
 * errors return `[]`, individual action dispatch failures are caught
 * inside the dispatcher and logged, malformed `rule_json` is reported
 * as `evaluation_error` and other rules continue. The caller can
 * safely await without writing its own try/catch (though the outbox
 * worker wraps one anyway as defense-in-depth).
 *
 * Architectural choices worth flagging:
 *  - The executor talks to `DedupRuleRepository` (rule storage from
 *    PR-B) and to the injected `ActionDispatcher` / `RuleRateLimiter`.
 *    No direct DB access for tickets / integrations / bug reports —
 *    those go through the dispatcher's `CanonicalTicketResolver` and
 *    the trigger context.
 *  - Rule blobs are validated through `parseDedupRule` (Zod). Validation
 *    errors get logged and the rule is skipped — one malformed rule
 *    must not poison the others on the same trigger.
 *  - Only `outbox_about_to_skip` is wired in this PR (`duplicate_detected`
 *    lands with the email handler in PR-C2). Schedule-based and
 *    cluster-growing triggers are valid at the schema level but require
 *    a cron worker / aggregator — they fire from different entry points
 *    (a BullMQ job, a counter flush). The executor's design accommodates
 *    them; the wiring lands in follow-ups.
 */

import type { DedupRuleRepository } from '../../db/dedup-rule.repository.js';
import type { BugReport } from '../../db/types.js';
import type { DedupRule } from '../../integrations/dedup-rule.schema.js';
import { parseDedupRule } from '../../integrations/dedup-rule.schema.js';
import { getLogger } from '../../logger.js';
import { evaluateConditions, resolutionKey } from './evaluator.js';
import type {
  ActionDispatcher,
  RuleEvalContext,
  RuleFireResult,
  RuleRateLimiter,
  TriggerType,
} from './types.js';

const logger = getLogger();

/**
 * Resolves contextual data the conditions might reference: the
 * canonical bug, the count of hits in a window, etc. Kept as an
 * interface so tests can stub the DB-touching parts.
 */
export interface RuleContextProvider {
  /** Fetch the canonical bug (the one `duplicate_of` points at), or null. */
  loadCanonical(canonicalBugId: string): Promise<BugReport | null>;
  /** Count bugs whose `duplicate_of` is `canonicalBugId` within the window. */
  countHitsInWindow(canonicalBugId: string, window: string): Promise<number>;
}

export class DedupRuleExecutor {
  constructor(
    private readonly repo: DedupRuleRepository,
    private readonly dispatcher: ActionDispatcher,
    private readonly rateLimiter: RuleRateLimiter,
    private readonly context: RuleContextProvider
  ) {}

  /**
   * Entry point. Loads enabled rules for `bugReport.project_id`,
   * filters those whose `when.type` matches `trigger`, and runs each
   * through the full pipeline. Returns one result per rule it
   * attempted (skipped rules are included with their reason).
   */
  async fire(trigger: TriggerType, bugReport: BugReport): Promise<RuleFireResult[]> {
    let candidateRules;
    try {
      candidateRules = await this.repo.findByProject(bugReport.project_id, false);
    } catch (error) {
      logger.error('Rule executor: failed to load rules', {
        projectId: bugReport.project_id,
        bugReportId: bugReport.id,
        trigger,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
    if (candidateRules.length === 0) {
      return [];
    }

    const evalContext: RuleEvalContext = {
      bugReport,
      canonical: null,
      projectId: bugReport.project_id,
      resolved: new Map<string, unknown>(),
    };

    // Hydrate canonical lazily — only if at least one rule references
    // `canonical.*` OR `hits_in_window`. Saves a round-trip for rules
    // that only test on the new bug's fields.
    let canonicalLoaded = false;

    const results: RuleFireResult[] = [];

    for (const row of candidateRules) {
      let rule: DedupRule;
      try {
        rule = parseDedupRule(row.rule_json);
      } catch (error) {
        logger.warn('Rule executor: invalid rule_json, skipping', {
          ruleId: row.id,
          projectId: bugReport.project_id,
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({
          ruleId: row.id,
          fired: false,
          skipReason: 'evaluation_error',
          actionsDispatched: 0,
          actionsSkipped: 0,
        });
        continue;
      }

      if (rule.when.type !== trigger) {
        continue; // Trigger mismatch — not a "fire" attempt, don't record.
      }

      // Lazy canonical hydration.
      if (!canonicalLoaded && this.needsCanonical(rule)) {
        if (bugReport.duplicate_of) {
          try {
            evalContext.canonical = await this.context.loadCanonical(bugReport.duplicate_of);
          } catch (error) {
            logger.warn('Rule executor: canonical lookup failed', {
              ruleId: row.id,
              canonicalId: bugReport.duplicate_of,
              error: error instanceof Error ? error.message : String(error),
            });
            evalContext.canonical = null;
          }
        }
        canonicalLoaded = true;
      }

      // Resolve the fields this rule's conditions reference. Cache hits
      // across rules in the same fire so two rules touching
      // `canonical.status` only resolve once.
      try {
        await this.resolveFields(evalContext, rule);
      } catch (error) {
        logger.warn('Rule executor: field resolution failed', {
          ruleId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({
          ruleId: row.id,
          fired: false,
          skipReason: 'evaluation_error',
          actionsDispatched: 0,
          actionsSkipped: 0,
        });
        continue;
      }

      const conditionsMet = evaluateConditions(evalContext, rule.conditions);
      if (!conditionsMet) {
        results.push({
          ruleId: row.id,
          fired: false,
          skipReason: 'conditions_unmet',
          actionsDispatched: 0,
          actionsSkipped: 0,
        });
        continue;
      }

      // Rate limit applies per (rule, canonical) pair. Prefer
      // `canonical.id`; fall back to `bugReport.duplicate_of` (the same
      // cluster identifier the dedup pipeline used to set
      // `duplicate_of`), and only last to `bugReport.id`. Using the
      // bug's own id as the primary fallback would make every retry /
      // every new duplicate get a fresh throttle key — disabling the
      // rate limit exactly when defense-in-depth matters most.
      const limitKey = evalContext.canonical?.id ?? bugReport.duplicate_of ?? bugReport.id;

      // Wrap the rate-limit + dispatch path in a per-rule try/catch.
      // The dispatcher already swallows its own action failures, and
      // ThrottleBackedRateLimiter shouldn't throw — but a custom
      // implementation (or a DB hiccup the limiter doesn't catch)
      // would otherwise propagate up and abort every remaining rule
      // in this fire. The documented error-containment contract says
      // that must not happen.
      let dispatched = 0;
      let skipped = 0;
      try {
        const allowed = await this.rateLimiter.shouldFire(row.id, limitKey, rule);
        if (!allowed) {
          results.push({
            ruleId: row.id,
            fired: false,
            skipReason: 'rate_limited',
            actionsDispatched: 0,
            actionsSkipped: 0,
          });
          continue;
        }

        for (const action of rule.then) {
          const ok = await this.dispatcher.dispatch(evalContext, action);
          if (ok) {
            dispatched += 1;
          } else {
            skipped += 1;
          }
        }
        await this.rateLimiter.recordFire(row.id, limitKey, rule);
      } catch (error) {
        logger.error('Rule executor: rate-limit/dispatch path crashed for rule', {
          ruleId: row.id,
          projectId: bugReport.project_id,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        results.push({
          ruleId: row.id,
          fired: false,
          skipReason: 'dispatch_error',
          actionsDispatched: dispatched,
          actionsSkipped: skipped,
        });
        continue;
      }

      results.push({
        ruleId: row.id,
        fired: true,
        skipReason: null,
        actionsDispatched: dispatched,
        actionsSkipped: skipped,
      });
    }

    return results;
  }

  private needsCanonical(rule: DedupRule): boolean {
    for (const cond of rule.conditions) {
      if (cond.field.startsWith('canonical.') || cond.field === 'hits_in_window') {
        return true;
      }
    }
    // Ticket actions also need a canonical — see `DefaultActionDispatcher.resolveTarget`.
    for (const action of rule.then) {
      if (action.type === 'ticket.add_comment' || action.type === 'ticket.transition') {
        return true;
      }
    }
    return false;
  }

  private async resolveFields(context: RuleEvalContext, rule: DedupRule): Promise<void> {
    for (const cond of rule.conditions) {
      // Composite key for `hits_in_window` (field + window) so a rule
      // with two conditions on different windows resolves both. All
      // other fields key on the field name alone. `resolutionKey`
      // owns the keying logic so the evaluator's lookup stays
      // consistent.
      const key = resolutionKey(cond.field, cond.window);
      if (context.resolved.has(key)) {
        continue;
      }
      switch (cond.field) {
        case 'canonical.status':
          context.resolved.set(key, mapStatusToCanonical(context.canonical));
          break;
        case 'canonical.closed_days_ago':
          context.resolved.set(key, daysSinceUpdate(context.canonical));
          break;
        case 'hits_in_window':
          // `cond.window` is guaranteed non-empty by the schema's
          // hits_in_window validator, but TypeScript can't see that —
          // fall back to a 24h window if it's missing rather than
          // throwing.
          if (context.canonical) {
            const w = cond.window ?? '24h';
            context.resolved.set(
              key,
              await this.context.countHitsInWindow(context.canonical.id, w)
            );
          } else {
            context.resolved.set(key, null);
          }
          break;
        case 'reporter.customer.tier': {
          const tier = readPath(context.bugReport.metadata, ['user', 'tier']);
          context.resolved.set(key, tier);
          break;
        }
        case 'severity':
          // `severity` mirrors `bug_reports.priority` — both express the
          // same axis from the dedup rule's perspective. Mapping kept
          // simple (1:1) until product introduces a separate severity
          // field.
          context.resolved.set(key, context.bugReport.priority);
          break;
        default: {
          // Exhaustiveness check on the closed field literal.
          const _exhaustive: never = cond.field;
          void _exhaustive;
          context.resolved.set(key, null);
        }
      }
    }
  }
}

/**
 * Map `bug_reports.status` (the BugSpotter internal `BugStatus` —
 * `'open' | 'in-progress' | 'resolved' | 'closed'`) onto the DedupRule
 * schema's `CanonicalStatus` (`'open' | 'in_progress' | 'closed' |
 * 'wont_fix'`).
 *
 * The two enums diverge in two places:
 *   - `'in-progress'` (kebab) vs `'in_progress'` (snake)
 *   - `'resolved'` collapses into `'closed'` (rule authors think in
 *     terms of "closed or not"; the dedup engine doesn't care about
 *     the distinction)
 * `'wont_fix'` has no source counterpart yet — a rule comparing
 * `canonical.status in ['wont_fix']` will simply never match until
 * `BugStatus` gains a corresponding state.
 */
function mapStatusToCanonical(canonical: BugReport | null): string | null {
  if (!canonical) {
    return null;
  }
  switch (canonical.status) {
    case 'open':
      return 'open';
    case 'in-progress':
      return 'in_progress';
    case 'resolved':
    case 'closed':
      return 'closed';
    default:
      return null;
  }
}

/** Whole days since the canonical's `updated_at` (proxy for "closed at"). */
function daysSinceUpdate(canonical: BugReport | null): number | null {
  if (!canonical) {
    return null;
  }
  const updated =
    canonical.updated_at instanceof Date ? canonical.updated_at : new Date(canonical.updated_at);
  // Clamp to 0 — if the DB clock is slightly ahead of the app clock,
  // `Date.now() - updated.getTime()` can be negative and would flip
  // gte/lte comparisons. Treat "future" timestamps as "just now".
  const elapsedMs = Math.max(0, Date.now() - updated.getTime());
  return Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
}

/** Safe traversal of an unknown object by a dotted-path-equivalent array. */
function readPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') {
      return null;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur ?? null;
}
