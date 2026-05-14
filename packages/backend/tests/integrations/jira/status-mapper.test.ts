/**
 * Unit tests for the Jira canonical-status mapper.
 *
 * Two functions:
 *   - `jiraIssueToCanonicalStatus(issue)` — derives canonical from
 *     `statusCategory.key` with a name heuristic for `wont_fix`.
 *   - `pickTransitionForCanonicalStatus(transitions, target)` — picks the
 *     transition whose target state's category matches the canonical
 *     target.
 *
 * No HTTP — pure functions over typed fixtures.
 */

import { describe, it, expect } from 'vitest';
import {
  jiraIssueToCanonicalStatus,
  pickTransitionForCanonicalStatus,
} from '../../../src/integrations/jira/status-mapper.js';
import type { JiraIssue, JiraTransition } from '../../../src/integrations/jira/types.js';

function makeIssue(opts: { statusName: string; categoryKey?: string }): JiraIssue {
  return {
    id: '10001',
    key: 'PROJ-1',
    self: 'https://example/api/3/issue/PROJ-1',
    fields: {
      summary: '...',
      description: '',
      status: {
        name: opts.statusName,
        ...(opts.categoryKey ? { statusCategory: { key: opts.categoryKey } } : {}),
      },
      created: '2026-05-01T00:00:00Z',
      updated: '2026-05-01T00:00:00Z',
    },
  };
}

function makeTransition(opts: {
  id: string;
  name: string;
  toName: string;
  toCategoryKey?: string;
}): JiraTransition {
  return {
    id: opts.id,
    name: opts.name,
    to: {
      name: opts.toName,
      ...(opts.toCategoryKey ? { statusCategory: { key: opts.toCategoryKey } } : {}),
    },
  };
}

describe('jiraIssueToCanonicalStatus', () => {
  it('maps `new` category to open', () => {
    expect(jiraIssueToCanonicalStatus(makeIssue({ statusName: 'To Do', categoryKey: 'new' }))).toBe(
      'open'
    );
  });

  it('maps `indeterminate` category to in_progress', () => {
    expect(
      jiraIssueToCanonicalStatus(
        makeIssue({ statusName: 'In Progress', categoryKey: 'indeterminate' })
      )
    ).toBe('in_progress');
  });

  it('maps `done` category with neutral name to closed', () => {
    expect(jiraIssueToCanonicalStatus(makeIssue({ statusName: 'Done', categoryKey: 'done' }))).toBe(
      'closed'
    );
    expect(
      jiraIssueToCanonicalStatus(makeIssue({ statusName: 'Resolved', categoryKey: 'done' }))
    ).toBe('closed');
  });

  it("maps `done` category with `Won't Fix` / variants to wont_fix", () => {
    expect(
      jiraIssueToCanonicalStatus(makeIssue({ statusName: "Won't Fix", categoryKey: 'done' }))
    ).toBe('wont_fix');
    expect(
      jiraIssueToCanonicalStatus(makeIssue({ statusName: 'wont fix', categoryKey: 'done' }))
    ).toBe('wont_fix');
    expect(
      jiraIssueToCanonicalStatus(makeIssue({ statusName: 'Cancelled', categoryKey: 'done' }))
    ).toBe('wont_fix');
    expect(
      jiraIssueToCanonicalStatus(makeIssue({ statusName: 'Duplicate', categoryKey: 'done' }))
    ).toBe('wont_fix');
  });

  it('falls back to open when statusCategory is missing', () => {
    expect(jiraIssueToCanonicalStatus(makeIssue({ statusName: 'Anything' }))).toBe('open');
  });

  it('falls back to open for `undefined` / unknown categories', () => {
    expect(
      jiraIssueToCanonicalStatus(makeIssue({ statusName: 'X', categoryKey: 'undefined' }))
    ).toBe('open');
    expect(jiraIssueToCanonicalStatus(makeIssue({ statusName: 'X', categoryKey: 'mystery' }))).toBe(
      'open'
    );
  });
});

describe('pickTransitionForCanonicalStatus', () => {
  const allTransitions: JiraTransition[] = [
    makeTransition({ id: '11', name: 'To Do', toName: 'To Do', toCategoryKey: 'new' }),
    makeTransition({
      id: '21',
      name: 'In Progress',
      toName: 'In Progress',
      toCategoryKey: 'indeterminate',
    }),
    makeTransition({ id: '31', name: 'Done', toName: 'Done', toCategoryKey: 'done' }),
    makeTransition({
      id: '41',
      name: "Won't Do",
      toName: "Won't Fix",
      toCategoryKey: 'done',
    }),
  ];

  it('returns null on empty input', () => {
    expect(pickTransitionForCanonicalStatus([], 'in_progress')).toBeNull();
  });

  it('picks a `new` transition for canonical open', () => {
    expect(pickTransitionForCanonicalStatus(allTransitions, 'open')?.id).toBe('11');
  });

  it('picks an `indeterminate` transition for canonical in_progress', () => {
    expect(pickTransitionForCanonicalStatus(allTransitions, 'in_progress')?.id).toBe('21');
  });

  it('picks a non-wont-fix `done` transition for canonical closed', () => {
    const picked = pickTransitionForCanonicalStatus(allTransitions, 'closed');
    expect(picked?.id).toBe('31');
    expect(picked?.to.name).toBe('Done');
  });

  it('picks a wont-fix-named `done` transition for canonical wont_fix', () => {
    const picked = pickTransitionForCanonicalStatus(allTransitions, 'wont_fix');
    expect(picked?.id).toBe('41');
    expect(picked?.to.name).toBe("Won't Fix");
  });

  it('falls back to any `done` transition for closed when no neutral name exists', () => {
    // Only a "Won't Fix"-named transition is available — still better than
    // refusing to transition at all when the rule wants `closed`.
    const onlyWontFix = [
      makeTransition({
        id: '41',
        name: "Won't Do",
        toName: 'Cancelled',
        toCategoryKey: 'done',
      }),
    ];
    expect(pickTransitionForCanonicalStatus(onlyWontFix, 'closed')?.id).toBe('41');
  });

  it('returns null when no transition lands in the target category', () => {
    const onlyNew = [
      makeTransition({ id: '11', name: 'Reopen', toName: 'To Do', toCategoryKey: 'new' }),
    ];
    expect(pickTransitionForCanonicalStatus(onlyNew, 'in_progress')).toBeNull();
  });
});
