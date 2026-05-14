/**
 * Map between Jira workflow states and the BugSpotter canonical-status enum.
 *
 * Jira's `statusCategory.key` is the load-bearing field — it's invariant
 * across customer-renamed statuses ("In Dev" / "Coding" / "Implementing"
 * all map to category `indeterminate`). The status `name` is only consulted
 * to distinguish `closed` from `wont_fix`, since Jira lumps both into
 * category `done`.
 */

import type { JiraIssue, JiraTransition } from './types.js';
import type { CanonicalStatus } from '../capabilities.js';

/**
 * Status names that, in category `done`, signal "won't fix / cancelled /
 * duplicate" rather than "resolved". Case-insensitive substring match.
 * Heuristic, deliberately permissive — false positives here mean the
 * auto-reopen rule won't fire for a ticket we already gave up on, which is
 * the safe direction.
 */
const WONT_FIX_NAME_PATTERNS = ['wont fix', "won't fix", 'cancelled', 'canceled', 'duplicate'];

function isWontFixName(statusName: string | undefined): boolean {
  if (!statusName) {
    return false;
  }
  const lowered = statusName.toLowerCase();
  return WONT_FIX_NAME_PATTERNS.some((pattern) => lowered.includes(pattern));
}

/**
 * Derive the canonical status of a fetched Jira issue.
 *
 * Returns `'open'` as the safe default when `statusCategory` is missing
 * (e.g. a stripped-down mock or an `undefined`-category state) — better to
 * underreport "closed" than to fire auto-reopen against a ticket that's
 * still actively being worked.
 */
export function jiraIssueToCanonicalStatus(issue: JiraIssue): CanonicalStatus {
  const statusName = issue.fields?.status?.name;
  const categoryKey = issue.fields?.status?.statusCategory?.key;

  if (categoryKey === 'done') {
    return isWontFixName(statusName) ? 'wont_fix' : 'closed';
  }
  if (categoryKey === 'indeterminate') {
    return 'in_progress';
  }
  if (categoryKey === 'new') {
    return 'open';
  }
  // `undefined`/unknown → treat as open
  return 'open';
}

/**
 * Pick the best Jira transition that lands the issue in `target`.
 *
 * "Best" = the transition whose target state's `statusCategory.key` matches
 * the canonical mapping. When more than one matches, prefer transitions
 * whose target name matches `wont_fix` heuristics when target is `wont_fix`,
 * otherwise return the first match. Returns null when no transition lands
 * in the right category.
 *
 * Caller is expected to handle the null case — usually by logging a warning
 * and skipping the rule action.
 */
export function pickTransitionForCanonicalStatus(
  transitions: JiraTransition[],
  target: CanonicalStatus
): JiraTransition | null {
  if (transitions.length === 0) {
    return null;
  }

  const matches = transitions.filter((t) => {
    const targetCategory = t.to?.statusCategory?.key;
    switch (target) {
      case 'open':
        return targetCategory === 'new';
      case 'in_progress':
        return targetCategory === 'indeterminate';
      case 'closed':
        return targetCategory === 'done' && !isWontFixName(t.to?.name);
      case 'wont_fix':
        return targetCategory === 'done' && isWontFixName(t.to?.name);
    }
  });

  if (matches.length > 0) {
    return matches[0];
  }

  // For `closed`/`wont_fix`, fall back to any `done`-category transition —
  // some workflows only expose one terminal state and we'd rather use it
  // than refuse to transition at all.
  if (target === 'closed' || target === 'wont_fix') {
    const anyDone = transitions.find((t) => t.to?.statusCategory?.key === 'done');
    if (anyDone) {
      return anyDone;
    }
  }

  return null;
}
