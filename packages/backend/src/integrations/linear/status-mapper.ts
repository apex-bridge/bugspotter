/**
 * Map between Linear workflow states and the BugSpotter canonical-status enum.
 *
 * Linear's `state.type` is a built-in enum that's invariant across team
 * renames, which makes the mapping clean — no name-based heuristics needed
 * (unlike Jira where `closed` vs `wont_fix` lives in the status name).
 */

import type { CanonicalStatus } from '../capabilities.js';
import type { LinearStateType, LinearWorkflowState } from './types.js';

/**
 * Map a Linear `state.type` to the canonical enum.
 *
 * Notes:
 *   - `triage` / `backlog` / `unstarted` all collapse to `'open'`. The rule
 *     engine doesn't currently distinguish them.
 *   - `started` → `'in_progress'`.
 *   - `completed` → `'closed'`. `canceled` → `'wont_fix'`.
 */
export function linearStateTypeToCanonical(type: LinearStateType): CanonicalStatus {
  switch (type) {
    case 'started':
      return 'in_progress';
    case 'completed':
      return 'closed';
    case 'canceled':
      return 'wont_fix';
    case 'triage':
    case 'backlog':
    case 'unstarted':
      return 'open';
  }
}

/**
 * Find a workflow state in a team whose `type` maps to the target canonical
 * status. Returns the first match (Linear sorts states by `position` within
 * a type, so the first match is the team's "default" landing state for that
 * type — `unstarted` typically returns "Todo", `started` returns "In
 * Progress", etc).
 *
 * Returns null when the team has no state of the right type (rare —
 * typically only seen on heavily customized workflows). Caller logs and
 * skips the transition.
 */
export function pickStateForCanonicalStatus(
  states: LinearWorkflowState[],
  target: CanonicalStatus
): LinearWorkflowState | null {
  const candidates = states
    .filter((s) => linearStateTypeToCanonical(s.type) === target)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  if (candidates.length === 0) {
    return null;
  }

  // For `open`, prefer `unstarted` over `triage`/`backlog` since unstarted is
  // closer to "ready to work on" — what the rule engine usually wants when
  // it re-opens an issue.
  if (target === 'open') {
    const unstarted = candidates.find((s) => s.type === 'unstarted');
    if (unstarted) {
      return unstarted;
    }
  }

  return candidates[0];
}
