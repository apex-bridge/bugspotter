/**
 * Pure condition evaluator for the dedup-rule engine.
 *
 * Takes a parsed DedupRule's `conditions` array and a RuleEvalContext
 * with already-resolved field values, and decides whether all
 * conditions are satisfied (AND semantics). No DB, no I/O — keeping
 * this pure lets the bulk of rule-engine logic stay covered by unit
 * tests without testcontainers.
 *
 * Field resolution (looking up `canonical.status`, `hits_in_window`,
 * etc.) happens in the executor BEFORE calling this. The map of
 * resolved values is passed in via `context.resolved`. A missing key
 * means the executor hasn't asked for that field — should never
 * happen if `resolveContextFields` is called first; we treat it as a
 * false condition rather than crash, so a buggy executor doesn't take
 * down the entire dedup pipeline.
 */

import type { ConditionSpec } from '../../integrations/dedup-rule.schema.js';
import type { RuleEvalContext } from './types.js';

/**
 * Returns true iff every condition is satisfied. Empty conditions
 * array means "no conditions" → always true. Order doesn't matter
 * for AND.
 */
export function evaluateConditions(context: RuleEvalContext, conditions: ConditionSpec[]): boolean {
  for (const c of conditions) {
    if (!evaluateOne(context, c)) {
      return false;
    }
  }
  return true;
}

function evaluateOne(context: RuleEvalContext, condition: ConditionSpec): boolean {
  // Field was never resolved -> bug in the executor. Fail closed (treat
  // as unsatisfied) rather than throw, so one malformed rule can't
  // cascade and break the trigger handler for the other rules.
  if (!context.resolved.has(condition.field)) {
    return false;
  }
  const actual = context.resolved.get(condition.field);

  // `null` resolved means "this field is absent in this context"
  // (e.g. `canonical.status` when canonical was hard-deleted). For
  // every op, treat absent as not-matching — conservative but
  // predictable.
  if (actual === null || actual === undefined) {
    return false;
  }

  switch (condition.op) {
    case 'eq':
      return actual === condition.value;
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(actual);
    case 'not_in':
      return Array.isArray(condition.value) && !condition.value.includes(actual);
    case 'gte':
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual >= condition.value
      );
    case 'lte':
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual <= condition.value
      );
    default: {
      // Exhaustiveness check — if a new op is added to the schema and
      // not handled here, TypeScript will flag the assignment below.
      const _exhaustive: never = condition.op;
      void _exhaustive;
      return false;
    }
  }
}
