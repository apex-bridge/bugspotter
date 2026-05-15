/**
 * Pure-function tests for the dedup rule condition evaluator.
 *
 * The evaluator works against an already-resolved context map — it
 * doesn't touch the DB — so these tests cover every (op, value-shape)
 * combination directly. Field resolution is exercised by the executor
 * tests, which mock the DB-touching providers.
 */

import { describe, it, expect } from 'vitest';
import { evaluateConditions } from '../../../src/services/rules/evaluator.js';
import type { RuleEvalContext } from '../../../src/services/rules/types.js';
import type { ConditionSpec } from '../../../src/integrations/dedup-rule.schema.js';
import type { BugReport } from '../../../src/db/types.js';

// Cheap factory — never actually used as a real BugReport; the evaluator
// only reads `context.resolved` for condition checks. The fields below
// satisfy the type but most are inert.
function makeBugReport(): BugReport {
  return {
    id: 'bug-1',
    project_id: 'project-1',
    title: 't',
    description: null,
    screenshot_url: null,
    replay_url: null,
    metadata: {},
    status: 'open',
    priority: 'medium',
    deleted_at: null,
    deleted_by: null,
    legal_hold: false,
    organization_id: null,
    duplicate_of: null,
    created_at: new Date(),
    updated_at: new Date(),
    screenshot_key: null,
    thumbnail_key: null,
    replay_key: null,
    upload_status: 'completed',
    replay_upload_status: 'completed',
  } as BugReport;
}

function makeContext(resolved: Record<string, unknown>): RuleEvalContext {
  return {
    bugReport: makeBugReport(),
    canonical: null,
    projectId: 'project-1',
    resolved: new Map(Object.entries(resolved)),
  };
}

describe('evaluateConditions', () => {
  it('returns true for an empty conditions array (no conditions = always pass)', () => {
    expect(evaluateConditions(makeContext({}), [])).toBe(true);
  });

  describe('eq', () => {
    it('passes when resolved value equals condition value', () => {
      const conds: ConditionSpec[] = [
        { field: 'severity', op: 'eq', value: 'high' } as ConditionSpec,
      ];
      expect(evaluateConditions(makeContext({ severity: 'high' }), conds)).toBe(true);
    });

    it('fails when resolved value differs', () => {
      const conds: ConditionSpec[] = [
        { field: 'severity', op: 'eq', value: 'high' } as ConditionSpec,
      ];
      expect(evaluateConditions(makeContext({ severity: 'low' }), conds)).toBe(false);
    });

    it('fails when resolved value is null (absent field)', () => {
      const conds: ConditionSpec[] = [
        { field: 'canonical.status', op: 'eq', value: 'closed' } as ConditionSpec,
      ];
      expect(evaluateConditions(makeContext({ 'canonical.status': null }), conds)).toBe(false);
    });
  });

  describe('in / not_in', () => {
    it('in passes when resolved value is in the list', () => {
      const conds: ConditionSpec[] = [
        { field: 'canonical.status', op: 'in', value: ['closed', 'wont_fix'] } as ConditionSpec,
      ];
      expect(evaluateConditions(makeContext({ 'canonical.status': 'closed' }), conds)).toBe(true);
    });

    it('in fails when resolved value is not in the list', () => {
      const conds: ConditionSpec[] = [
        { field: 'canonical.status', op: 'in', value: ['closed', 'wont_fix'] } as ConditionSpec,
      ];
      expect(evaluateConditions(makeContext({ 'canonical.status': 'open' }), conds)).toBe(false);
    });

    it('not_in passes when resolved value is absent from the list', () => {
      const conds: ConditionSpec[] = [
        { field: 'severity', op: 'not_in', value: ['low'] } as ConditionSpec,
      ];
      expect(evaluateConditions(makeContext({ severity: 'critical' }), conds)).toBe(true);
    });

    it('not_in fails when resolved value is in the list', () => {
      const conds: ConditionSpec[] = [
        { field: 'severity', op: 'not_in', value: ['low'] } as ConditionSpec,
      ];
      expect(evaluateConditions(makeContext({ severity: 'low' }), conds)).toBe(false);
    });
  });

  describe('gte / lte', () => {
    it('gte passes when resolved value meets the threshold', () => {
      const conds: ConditionSpec[] = [
        { field: 'hits_in_window', op: 'gte', value: 3, window: '24h' } as ConditionSpec,
      ];
      expect(evaluateConditions(makeContext({ hits_in_window: 5 }), conds)).toBe(true);
      expect(evaluateConditions(makeContext({ hits_in_window: 3 }), conds)).toBe(true);
    });

    it('gte fails when resolved value is below the threshold', () => {
      const conds: ConditionSpec[] = [
        { field: 'hits_in_window', op: 'gte', value: 3, window: '24h' } as ConditionSpec,
      ];
      expect(evaluateConditions(makeContext({ hits_in_window: 2 }), conds)).toBe(false);
    });

    it('lte mirrors gte', () => {
      const conds: ConditionSpec[] = [
        {
          field: 'canonical.closed_days_ago',
          op: 'lte',
          value: 30,
        } as ConditionSpec,
      ];
      expect(evaluateConditions(makeContext({ 'canonical.closed_days_ago': 7 }), conds)).toBe(true);
      expect(evaluateConditions(makeContext({ 'canonical.closed_days_ago': 60 }), conds)).toBe(
        false
      );
    });

    it('gte fails when resolved value is non-numeric (defense-in-depth)', () => {
      const conds: ConditionSpec[] = [
        { field: 'hits_in_window', op: 'gte', value: 3, window: '24h' } as ConditionSpec,
      ];
      // Schema rejects this on parse, but the evaluator should still
      // refuse to compare if a bug let one through.
      expect(evaluateConditions(makeContext({ hits_in_window: 'lots' }), conds)).toBe(false);
    });
  });

  describe('AND semantics', () => {
    it('all conditions must pass', () => {
      const conds: ConditionSpec[] = [
        { field: 'canonical.status', op: 'in', value: ['closed'] } as ConditionSpec,
        { field: 'hits_in_window', op: 'gte', value: 3, window: '24h' } as ConditionSpec,
      ];
      expect(
        evaluateConditions(makeContext({ 'canonical.status': 'closed', hits_in_window: 5 }), conds)
      ).toBe(true);
    });

    it('one failing condition fails the whole rule', () => {
      const conds: ConditionSpec[] = [
        { field: 'canonical.status', op: 'in', value: ['closed'] } as ConditionSpec,
        { field: 'hits_in_window', op: 'gte', value: 3, window: '24h' } as ConditionSpec,
      ];
      expect(
        evaluateConditions(makeContext({ 'canonical.status': 'closed', hits_in_window: 1 }), conds)
      ).toBe(false);
    });
  });

  describe('unresolved fields', () => {
    it('treats missing-from-resolved-map as a failed condition (fail-closed)', () => {
      const conds: ConditionSpec[] = [
        { field: 'severity', op: 'eq', value: 'high' } as ConditionSpec,
      ];
      // `severity` was never resolved into the map -> the evaluator
      // returns false rather than throwing, so a bug in the resolver
      // can't break unrelated rules in the same fire.
      expect(evaluateConditions(makeContext({}), conds)).toBe(false);
    });
  });
});
