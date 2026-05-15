/**
 * Unit tests for the Linear canonical-status mapper.
 *
 * Linear's `state.type` is invariant, so the mapping is mechanical. The
 * non-trivial bit is `pickStateForCanonicalStatus`:
 *   - prefer `unstarted` over `triage`/`backlog` when target is `open`
 *   - sort by `position` within a state type
 *   - return null when no state of the right type exists
 */

import { describe, it, expect } from 'vitest';
import {
  linearStateTypeToCanonical,
  pickStateForCanonicalStatus,
} from '../../../src/integrations/linear/status-mapper.js';
import type {
  LinearStateType,
  LinearWorkflowState,
} from '../../../src/integrations/linear/types.js';

const state = (
  id: string,
  name: string,
  type: LinearStateType,
  position = 0
): LinearWorkflowState => ({ id, name, type, position });

describe('linearStateTypeToCanonical', () => {
  it.each([
    ['started' as LinearStateType, 'in_progress'],
    ['completed' as LinearStateType, 'closed'],
    ['canceled' as LinearStateType, 'wont_fix'],
    ['triage' as LinearStateType, 'open'],
    ['backlog' as LinearStateType, 'open'],
    ['unstarted' as LinearStateType, 'open'],
  ] as const)('maps state.type=%s to canonical %s', (type, expected) => {
    expect(linearStateTypeToCanonical(type)).toBe(expected);
  });
});

describe('pickStateForCanonicalStatus', () => {
  it('returns null when no state of the right type exists', () => {
    const minimal = [state('s1', 'Triage', 'triage'), state('s2', 'Backlog', 'backlog')];
    expect(pickStateForCanonicalStatus(minimal, 'in_progress')).toBeNull();
    expect(pickStateForCanonicalStatus(minimal, 'closed')).toBeNull();
  });

  it('prefers `unstarted` over triage/backlog when target is open', () => {
    const team = [
      state('triage1', 'Triage', 'triage', 0),
      state('backlog1', 'Backlog', 'backlog', 1),
      state('todo1', 'Todo', 'unstarted', 2),
    ];
    const picked = pickStateForCanonicalStatus(team, 'open');
    expect(picked?.id).toBe('todo1');
    expect(picked?.type).toBe('unstarted');
  });

  it('falls back to triage/backlog when no unstarted state exists', () => {
    const team = [
      state('triage1', 'Triage', 'triage', 1),
      state('backlog1', 'Backlog', 'backlog', 0),
    ];
    // Lower position wins among non-unstarted candidates.
    const picked = pickStateForCanonicalStatus(team, 'open');
    expect(picked?.id).toBe('backlog1');
  });

  it('sorts by position within a state type', () => {
    const team = [state('ip2', 'Coding', 'started', 2), state('ip1', 'In Progress', 'started', 1)];
    expect(pickStateForCanonicalStatus(team, 'in_progress')?.id).toBe('ip1');
  });

  it('picks `completed` for canonical closed', () => {
    const team = [
      state('done1', 'Done', 'completed', 0),
      state('cancel1', 'Cancelled', 'canceled', 1),
    ];
    expect(pickStateForCanonicalStatus(team, 'closed')?.type).toBe('completed');
  });

  it('picks `canceled` for canonical wont_fix', () => {
    const team = [
      state('done1', 'Done', 'completed', 0),
      state('cancel1', 'Cancelled', 'canceled', 1),
    ];
    expect(pickStateForCanonicalStatus(team, 'wont_fix')?.type).toBe('canceled');
  });
});
