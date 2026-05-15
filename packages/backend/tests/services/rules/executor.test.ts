/**
 * Tests for `DedupRuleExecutor.fire(...)` — the orchestrator that
 * loads rules, filters by trigger, evaluates conditions, applies the
 * rate limit, and dispatches actions.
 *
 * All four collaborators (`DedupRuleRepository`, `ActionDispatcher`,
 * `RuleRateLimiter`, `RuleContextProvider`) are stubbed so this suite
 * runs in the unit harness without Postgres. Coverage focus:
 *   - happy path: rule fires, actions dispatched
 *   - trigger mismatch -> rule not even attempted
 *   - conditions fail -> reported as 'conditions_unmet', no actions
 *   - rate-limited -> reported as 'rate_limited', no actions
 *   - invalid rule_json -> reported as 'evaluation_error', other rules continue
 *   - canonical-touching rule with no canonical -> conditions on
 *     canonical.* return null and fail closed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DedupRuleExecutor } from '../../../src/services/rules/executor.js';
import type { RuleContextProvider } from '../../../src/services/rules/executor.js';
import type {
  ActionDispatcher,
  RuleEvalContext,
  RuleRateLimiter,
} from '../../../src/services/rules/types.js';
import type { DedupRuleRepository, DedupRuleRow } from '../../../src/db/dedup-rule.repository.js';
import type { ActionSpec } from '../../../src/integrations/dedup-rule.schema.js';
import type { BugReport } from '../../../src/db/types.js';

function makeBugReport(overrides: Partial<BugReport> = {}): BugReport {
  return {
    id: 'bug-new',
    project_id: 'project-1',
    title: 't',
    description: null,
    screenshot_url: null,
    replay_url: null,
    metadata: {},
    status: 'open',
    priority: 'high',
    deleted_at: null,
    deleted_by: null,
    legal_hold: false,
    organization_id: null,
    duplicate_of: 'bug-canonical',
    created_at: new Date(),
    updated_at: new Date(),
    screenshot_key: null,
    thumbnail_key: null,
    replay_key: null,
    upload_status: 'completed',
    replay_upload_status: 'completed',
    ...overrides,
  } as BugReport;
}

function makeCanonical(overrides: Partial<BugReport> = {}): BugReport {
  return makeBugReport({
    id: 'bug-canonical',
    duplicate_of: null,
    status: 'closed',
    updated_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    ...overrides,
  });
}

// COMMENT_RULE: B2-shaped "+1 occurrence" comment. Constrained to
// `canonical.status === 'closed'` so the conditions_unmet test can
// flip status to 'open' (which the executor maps to canonical 'open')
// and observe the mismatch deterministically.
const COMMENT_RULE: DedupRuleRow = {
  id: 'rule-1',
  project_id: 'project-1',
  name: 'B2 — counter on canonical',
  enabled: true,
  rule_json: {
    name: 'B2 — counter on canonical',
    when: { type: 'outbox_about_to_skip' },
    if: [{ field: 'canonical.status', op: 'eq', value: 'closed' }],
    then: [
      {
        type: 'ticket.add_comment',
        target: 'canonical',
        body: '+1 occurrence',
      },
    ],
  },
  created_at: new Date(),
  updated_at: new Date(),
};

describe('DedupRuleExecutor.fire', () => {
  let repo: { findByProject: ReturnType<typeof vi.fn> };
  let dispatcher: ActionDispatcher;
  let rateLimiter: RuleRateLimiter;
  let context: RuleContextProvider;
  let executor: DedupRuleExecutor;
  let dispatchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    repo = { findByProject: vi.fn().mockResolvedValue([COMMENT_RULE]) };
    dispatchSpy = vi.fn().mockResolvedValue(true);
    dispatcher = { dispatch: dispatchSpy };
    rateLimiter = {
      shouldFire: vi.fn().mockResolvedValue(true),
      recordFire: vi.fn().mockResolvedValue(undefined),
    };
    context = {
      loadCanonical: vi.fn().mockResolvedValue(makeCanonical()),
      countHitsInWindow: vi.fn().mockResolvedValue(7),
    };
    executor = new DedupRuleExecutor(
      repo as unknown as DedupRuleRepository,
      dispatcher,
      rateLimiter,
      context
    );
  });

  it('fires a rule when trigger matches, conditions pass, and rate limit allows', async () => {
    const results = await executor.fire('outbox_about_to_skip', makeBugReport());
    expect(results).toHaveLength(1);
    expect(results[0].fired).toBe(true);
    expect(results[0].skipReason).toBeNull();
    expect(results[0].actionsDispatched).toBe(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(rateLimiter.recordFire as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
  });

  it('passes the canonical into the eval context for ticket actions', async () => {
    await executor.fire('outbox_about_to_skip', makeBugReport());
    expect(context.loadCanonical).toHaveBeenCalledWith('bug-canonical');
    const ctxArg = dispatchSpy.mock.calls[0][0] as RuleEvalContext;
    expect(ctxArg.canonical?.id).toBe('bug-canonical');
  });

  it('skips rules whose when.type does not match the trigger', async () => {
    // Rule with `when.type = 'duplicate_detected'` shouldn't be touched
    // when we fire `outbox_about_to_skip`. Mismatches don't appear in
    // results (they're not "attempted" — keeps telemetry meaningful).
    const mismatchRule: DedupRuleRow = {
      ...COMMENT_RULE,
      id: 'rule-mismatch',
      rule_json: {
        ...(COMMENT_RULE.rule_json as object),
        when: { type: 'duplicate_detected' },
      },
    };
    repo.findByProject.mockResolvedValueOnce([COMMENT_RULE, mismatchRule]);

    const results = await executor.fire('outbox_about_to_skip', makeBugReport());
    expect(results.map((r) => r.ruleId)).toEqual(['rule-1']);
  });

  it('reports conditions_unmet when condition fails', async () => {
    // Canonical is 'open' (maps to canonical 'open'); rule wants 'closed'.
    (context.loadCanonical as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCanonical({ status: 'open' })
    );

    const results = await executor.fire('outbox_about_to_skip', makeBugReport());
    expect(results[0].fired).toBe(false);
    expect(results[0].skipReason).toBe('conditions_unmet');
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(rateLimiter.recordFire).not.toHaveBeenCalled();
  });

  it('reports rate_limited and does not dispatch when limiter says no', async () => {
    (rateLimiter.shouldFire as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const results = await executor.fire('outbox_about_to_skip', makeBugReport());
    expect(results[0].fired).toBe(false);
    expect(results[0].skipReason).toBe('rate_limited');
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(rateLimiter.recordFire).not.toHaveBeenCalled();
  });

  it('skips malformed rule_json and continues with other rules', async () => {
    const malformed: DedupRuleRow = {
      ...COMMENT_RULE,
      id: 'rule-malformed',
      rule_json: { name: 'bad', when: { type: 'made_up' } }, // invalid: unknown trigger, no `then`
    };
    repo.findByProject.mockResolvedValueOnce([malformed, COMMENT_RULE]);

    const results = await executor.fire('outbox_about_to_skip', makeBugReport());
    expect(results).toHaveLength(2);
    const bad = results.find((r) => r.ruleId === 'rule-malformed');
    const good = results.find((r) => r.ruleId === 'rule-1');
    expect(bad?.fired).toBe(false);
    expect(bad?.skipReason).toBe('evaluation_error');
    expect(good?.fired).toBe(true);
  });

  it('returns empty array when there are no rules for the project', async () => {
    repo.findByProject.mockResolvedValueOnce([]);
    const results = await executor.fire('outbox_about_to_skip', makeBugReport());
    expect(results).toEqual([]);
    expect(context.loadCanonical).not.toHaveBeenCalled();
  });

  it('does not load the canonical when no rule references canonical.* or ticket actions', async () => {
    const reporterRule: DedupRuleRow = {
      ...COMMENT_RULE,
      id: 'rule-no-canonical',
      rule_json: {
        name: 'severity check',
        when: { type: 'outbox_about_to_skip' },
        if: [{ field: 'severity', op: 'eq', value: 'high' }],
        // notify.email is a no-op in PR-C but the dispatcher won't
        // need a canonical to resolve it — so the executor should
        // skip the canonical fetch entirely.
        then: [{ type: 'notify.email', to: 'reporter', template: 'dedup_ack' }],
      },
    };
    repo.findByProject.mockResolvedValueOnce([reporterRule]);
    // Default dispatcher mock returns true; in production notify.email
    // would log-and-return-false, but the test focuses on whether
    // canonical was loaded.

    await executor.fire('outbox_about_to_skip', makeBugReport());
    expect(context.loadCanonical).not.toHaveBeenCalled();
  });

  it('isolates per-rule errors — DB-level failure on rules lookup returns []', async () => {
    repo.findByProject.mockRejectedValueOnce(new Error('db unavailable'));
    const results = await executor.fire('outbox_about_to_skip', makeBugReport());
    expect(results).toEqual([]);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('dispatches multiple actions in order', async () => {
    const twoActionsRule: DedupRuleRow = {
      ...COMMENT_RULE,
      id: 'rule-two-actions',
      rule_json: {
        name: 'B3 — auto-reopen',
        when: { type: 'outbox_about_to_skip' },
        if: [{ field: 'canonical.status', op: 'in', value: ['closed', 'wont_fix'] }],
        then: [
          { type: 'ticket.transition', target: 'canonical', to: 'in_progress' },
          { type: 'ticket.add_comment', target: 'canonical', body: 'auto-reopened' },
        ],
      },
    };
    repo.findByProject.mockResolvedValueOnce([twoActionsRule]);

    const results = await executor.fire('outbox_about_to_skip', makeBugReport());
    expect(results[0].fired).toBe(true);
    expect(results[0].actionsDispatched).toBe(2);
    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    // First call should be the transition (order matters — transition
    // before comment so the comment lands in the new state).
    const firstAction = dispatchSpy.mock.calls[0][1] as ActionSpec;
    const secondAction = dispatchSpy.mock.calls[1][1] as ActionSpec;
    expect(firstAction.type).toBe('ticket.transition');
    expect(secondAction.type).toBe('ticket.add_comment');
  });

  it('counts dispatched vs skipped actions correctly', async () => {
    dispatchSpy.mockReset();
    dispatchSpy.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const twoActionsRule: DedupRuleRow = {
      ...COMMENT_RULE,
      id: 'rule-two',
      rule_json: {
        name: 'mixed',
        when: { type: 'outbox_about_to_skip' },
        if: [{ field: 'canonical.status', op: 'eq', value: 'closed' }],
        then: [
          { type: 'ticket.add_comment', target: 'canonical', body: 'a' },
          { type: 'ticket.add_comment', target: 'canonical', body: 'b' },
        ],
      },
    };
    repo.findByProject.mockResolvedValueOnce([twoActionsRule]);

    const results = await executor.fire('outbox_about_to_skip', makeBugReport());
    expect(results[0].fired).toBe(true);
    expect(results[0].actionsDispatched).toBe(1);
    expect(results[0].actionsSkipped).toBe(1);
  });

  it('passes the rate limit key as canonicalId when canonical is loaded', async () => {
    await executor.fire('outbox_about_to_skip', makeBugReport());
    expect(rateLimiter.shouldFire).toHaveBeenCalledWith(
      'rule-1',
      'bug-canonical', // canonical's id, NOT the new bug's id
      expect.any(Object)
    );
  });

  it('resolves hits_in_window separately per window (multi-window cache key)', async () => {
    // Regression: a rule with two `hits_in_window` conditions on
    // different windows used to alias on the same cache key (just
    // `'hits_in_window'`), so the second condition saw the first
    // condition's count. Now the key is `hits_in_window:<window>`.
    const multiWindowRule: DedupRuleRow = {
      ...COMMENT_RULE,
      id: 'rule-multi-window',
      rule_json: {
        name: 'multi-window',
        when: { type: 'outbox_about_to_skip' },
        if: [
          { field: 'hits_in_window', op: 'gte', value: 3, window: '1h' },
          { field: 'hits_in_window', op: 'gte', value: 10, window: '24h' },
        ],
        then: [{ type: 'ticket.add_comment', target: 'canonical', body: 'noisy' }],
      },
    };
    repo.findByProject.mockResolvedValueOnce([multiWindowRule]);
    (context.countHitsInWindow as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(5) // 1h window -> meets 3
      .mockResolvedValueOnce(15); // 24h window -> meets 10

    const results = await executor.fire('outbox_about_to_skip', makeBugReport());
    expect(results[0].fired).toBe(true);
    expect(context.countHitsInWindow).toHaveBeenCalledTimes(2);
    expect(context.countHitsInWindow).toHaveBeenNthCalledWith(1, 'bug-canonical', '1h');
    expect(context.countHitsInWindow).toHaveBeenNthCalledWith(2, 'bug-canonical', '24h');
  });

  it('fails the rule when one window passes but the other does not', async () => {
    const multiWindowRule: DedupRuleRow = {
      ...COMMENT_RULE,
      id: 'rule-multi-window-fail',
      rule_json: {
        name: 'multi-window-fail',
        when: { type: 'outbox_about_to_skip' },
        if: [
          { field: 'hits_in_window', op: 'gte', value: 3, window: '1h' },
          { field: 'hits_in_window', op: 'gte', value: 10, window: '24h' },
        ],
        then: [{ type: 'ticket.add_comment', target: 'canonical', body: 'noisy' }],
      },
    };
    repo.findByProject.mockResolvedValueOnce([multiWindowRule]);
    (context.countHitsInWindow as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(5) // 1h -> 5 >= 3 OK
      .mockResolvedValueOnce(2); // 24h -> 2 < 10 FAIL

    const results = await executor.fire('outbox_about_to_skip', makeBugReport());
    expect(results[0].fired).toBe(false);
    expect(results[0].skipReason).toBe('conditions_unmet');
  });

  describe('per-rule error isolation', () => {
    // The executor's documented contract: a single rule throwing
    // anywhere in the rate-limit / dispatch path must not abort the
    // remaining rules in the same fire. These regressions catch a
    // future refactor that drops the inner try/catch.

    it('reports dispatch_error when rateLimiter.shouldFire throws and continues to the next rule', async () => {
      const otherRule: DedupRuleRow = {
        ...COMMENT_RULE,
        id: 'rule-2',
        rule_json: {
          ...(COMMENT_RULE.rule_json as object),
          name: 'B2-copy',
        },
      };
      repo.findByProject.mockResolvedValueOnce([COMMENT_RULE, otherRule]);
      (rateLimiter.shouldFire as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('throttle table unreachable'))
        .mockResolvedValueOnce(true);

      const results = await executor.fire('outbox_about_to_skip', makeBugReport());
      expect(results).toHaveLength(2);
      const first = results.find((r) => r.ruleId === 'rule-1');
      const second = results.find((r) => r.ruleId === 'rule-2');
      expect(first?.fired).toBe(false);
      expect(first?.skipReason).toBe('dispatch_error');
      expect(second?.fired).toBe(true);
    });

    it('reports dispatch_error when an action dispatch throws and continues to the next rule', async () => {
      const otherRule: DedupRuleRow = {
        ...COMMENT_RULE,
        id: 'rule-2',
        rule_json: {
          ...(COMMENT_RULE.rule_json as object),
          name: 'B2-copy',
        },
      };
      repo.findByProject.mockResolvedValueOnce([COMMENT_RULE, otherRule]);
      // Dispatcher contract is to swallow its own errors and return
      // false. If a buggy custom dispatcher throws instead, the
      // executor's outer try/catch must still contain it.
      dispatchSpy.mockRejectedValueOnce(new Error('dispatch went sideways'));

      const results = await executor.fire('outbox_about_to_skip', makeBugReport());
      const first = results.find((r) => r.ruleId === 'rule-1');
      const second = results.find((r) => r.ruleId === 'rule-2');
      expect(first?.skipReason).toBe('dispatch_error');
      expect(second?.fired).toBe(true);
    });
  });
});
