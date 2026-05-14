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

import { describe, it, expect, vi } from 'vitest';
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

  it('handles typographic / smart-quote apostrophes in wont_fix detection', () => {
    // Jira admins routinely type the status with a curly apostrophe; the
    // mapper used to mis-classify these as `closed`. Test all three
    // common apostrophe variants — U+2018, U+2019, U+02BC.
    expect(
      jiraIssueToCanonicalStatus(makeIssue({ statusName: 'Won’t Fix', categoryKey: 'done' }))
    ).toBe('wont_fix');
    expect(
      jiraIssueToCanonicalStatus(makeIssue({ statusName: 'Won‘t Fix', categoryKey: 'done' }))
    ).toBe('wont_fix');
    expect(
      jiraIssueToCanonicalStatus(makeIssue({ statusName: 'Wonʼt Fix', categoryKey: 'done' }))
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

  it('logs a warning when the closed/wont_fix fallback fires', async () => {
    // The fallback is intentional but worth observing — admins should
    // see it in logs to spot misconfigured workflows (e.g. a single
    // `Abandoned` terminal state being conflated with `closed`).
    const { getLogger } = await import('../../../src/logger.js');
    const warnSpy = vi.spyOn(getLogger(), 'warn').mockImplementation(() => undefined);

    const onlyWontFix = [
      makeTransition({
        id: '41',
        name: "Won't Do",
        toName: 'Cancelled',
        toCategoryKey: 'done',
      }),
    ];
    pickTransitionForCanonicalStatus(onlyWontFix, 'closed');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('fallback fired'),
      expect.objectContaining({ target: 'closed', fallbackTransitionId: '41' })
    );

    warnSpy.mockRestore();
  });

  it('returns null when no transition lands in the target category', () => {
    const onlyNew = [
      makeTransition({ id: '11', name: 'Reopen', toName: 'To Do', toCategoryKey: 'new' }),
    ];
    expect(pickTransitionForCanonicalStatus(onlyNew, 'in_progress')).toBeNull();
  });

  describe('deterministic preference ordering', () => {
    it('prefers "Done" over "Resolved" over "Fixed" for canonical closed', () => {
      // All three sit in `done` category and are non-wont-fix. Without
      // a preference list the picker was non-deterministic — first one
      // Jira's API returned won.
      const multiDone = [
        makeTransition({ id: 'f', name: 'Mark Fixed', toName: 'Fixed', toCategoryKey: 'done' }),
        makeTransition({
          id: 'r',
          name: 'Mark Resolved',
          toName: 'Resolved',
          toCategoryKey: 'done',
        }),
        makeTransition({ id: 'd', name: 'Mark Done', toName: 'Done', toCategoryKey: 'done' }),
      ];
      // Same input shuffled — output is stable.
      const picked1 = pickTransitionForCanonicalStatus(multiDone, 'closed');
      const picked2 = pickTransitionForCanonicalStatus([...multiDone].reverse(), 'closed');
      expect(picked1?.to.name).toBe('Done');
      expect(picked2?.to.name).toBe('Done');
    });

    it('prefers "In Progress" over "Doing" for canonical in_progress', () => {
      const ip = [
        makeTransition({
          id: 'd',
          name: 'Doing',
          toName: 'Doing',
          toCategoryKey: 'indeterminate',
        }),
        makeTransition({
          id: 'i',
          name: 'In Progress',
          toName: 'In Progress',
          toCategoryKey: 'indeterminate',
        }),
      ];
      expect(pickTransitionForCanonicalStatus(ip, 'in_progress')?.to.name).toBe('In Progress');
    });

    it('falls through to alphabetical when no preferred name matches', () => {
      // Both states are in the right category, neither is in the
      // preferences list. Alphabetical "Mystery A" wins.
      const obscure = [
        makeTransition({ id: 'z', name: 'Z', toName: 'Mystery Z', toCategoryKey: 'done' }),
        makeTransition({ id: 'a', name: 'A', toName: 'Mystery A', toCategoryKey: 'done' }),
      ];
      expect(pickTransitionForCanonicalStatus(obscure, 'closed')?.to.name).toBe('Mystery A');
    });

    it("does NOT fall back to a closed-style transition when target is 'wont_fix'", () => {
      // Threat: workflow only exposes "Done" / "Resolved" (i.e. canonical
      // `closed`). A rule asking for `wont_fix` must not silently succeed
      // with a `closed`-named transition — that would tell the rule
      // engine the intent landed when in fact the ticket is in `closed`.
      // Returning null lets the caller decide whether to degrade or skip.
      const onlyClosed = [
        makeTransition({ id: '31', name: 'Done', toName: 'Done', toCategoryKey: 'done' }),
        makeTransition({
          id: '32',
          name: 'Resolve',
          toName: 'Resolved',
          toCategoryKey: 'done',
        }),
      ];
      expect(pickTransitionForCanonicalStatus(onlyClosed, 'wont_fix')).toBeNull();
    });
  });
});
