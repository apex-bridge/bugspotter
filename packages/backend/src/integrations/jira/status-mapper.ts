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
import { getLogger } from '../../logger.js';

const logger = getLogger();

/**
 * Status names that, in category `done`, signal "won't fix / cancelled /
 * duplicate / abandoned" rather than "resolved". Case-insensitive substring
 * match. Heuristic, deliberately permissive — false positives here mean the
 * auto-reopen rule won't fire for a ticket we already gave up on, which is
 * the safe direction.
 *
 * MUST stay in sync with the wont-fix branch of `PREFERRED_STATE_NAMES`
 * below — otherwise classification (`jiraIssueToCanonicalStatus`) and
 * transition selection disagree, and a workflow could be marked `wont_fix`
 * via `transition(...)` while a follow-up `getStatus(...)` claims it's
 * `closed`.
 */
const WONT_FIX_NAME_PATTERNS = [
  "won't fix",
  'wont fix',
  "won't do",
  'wont do',
  'cancelled',
  'canceled',
  'duplicate',
  'abandoned',
];

function isWontFixName(statusName: string | undefined): boolean {
  if (!statusName) {
    return false;
  }
  // Normalize curly / typographic apostrophes (U+2018, U+2019, U+02BC
  // modifier-letter-apostrophe) into the ASCII apostrophe before
  // matching — Jira admins routinely type "Won't Fix" with a smart
  // quote when they rename the status, and our patterns are written
  // with ASCII. Without this, smart-quote variants fall through into
  // `closed` and the auto-reopen rule mis-fires.
  // Use explicit Unicode escapes (file may be saved by editors with
  // varying encodings, especially on Windows). U+2018 LEFT, U+2019
  // RIGHT, U+02BC MODIFIER-LETTER-APOSTROPHE.
  const lowered = statusName.toLowerCase().replace(/[‘’ʼ]/g, "'");
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
 * Per-canonical preference list of common Jira state names. Used to
 * pick deterministically when more than one workflow transition lands
 * in the right category (e.g. both "Done" and "Resolved" available for
 * canonical `closed`). Case-insensitive exact match wins; falls through
 * to alphabetical order within the category if no name matches.
 *
 * Order matters — earlier entries are preferred. The lists cover the
 * most common Atlassian / Jira-Cloud defaults plus a handful of
 * community renames.
 */
const PREFERRED_STATE_NAMES: Record<CanonicalStatus, readonly string[]> = {
  open: ['to do', 'open', 'backlog', 'reopened', 'new'],
  in_progress: ['in progress', 'in development', 'in review', 'doing', 'working'],
  closed: ['done', 'resolved', 'closed', 'fixed', 'complete'],
  wont_fix: ["won't fix", "won't do", 'cancelled', 'canceled', 'duplicate', 'abandoned'],
} as const;

/**
 * Sort a set of category-matched transitions deterministically.
 *
 * Two-stage ordering:
 *   1. Transitions whose target-state name is in the preferred list rank
 *      first, in the order of the preferred list itself (preferred-name
 *      "Done" before "Resolved" before "Closed", etc).
 *   2. Remaining transitions rank by `to.name` alphabetically — purely
 *      to remove the API-order non-determinism flagged by reviewers.
 */
function rankTransitions(
  transitions: JiraTransition[],
  preferences: readonly string[]
): JiraTransition[] {
  return [...transitions].sort((a, b) => {
    const ai = preferences.indexOf((a.to?.name ?? '').toLowerCase());
    const bi = preferences.indexOf((b.to?.name ?? '').toLowerCase());
    if (ai !== -1 && bi !== -1) {
      return ai - bi; // both preferred — earlier preference wins
    }
    if (ai !== -1) {
      return -1; // a is preferred, b is not
    }
    if (bi !== -1) {
      return 1; // b is preferred, a is not
    }
    // neither preferred — alphabetical for determinism
    return (a.to?.name ?? '').localeCompare(b.to?.name ?? '');
  });
}

/**
 * Pick the best Jira transition that lands the issue in `target`.
 *
 * "Best" = the transition whose target state's `statusCategory.key`
 * matches the canonical mapping, with name-based preference and
 * alphabetical-fallback ordering so the choice is deterministic across
 * runs (the Jira API doesn't guarantee transition order, and earlier
 * reviewers flagged the non-determinism).
 *
 * Returns null when no transition lands in the right category. Caller
 * handles the null case — usually by logging and skipping the action.
 */
export function pickTransitionForCanonicalStatus(
  transitions: JiraTransition[],
  target: CanonicalStatus
): JiraTransition | null {
  if (transitions.length === 0) {
    return null;
  }

  const inCategory = transitions.filter((t) => {
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

  if (inCategory.length > 0) {
    return rankTransitions(inCategory, PREFERRED_STATE_NAMES[target])[0];
  }

  // For `closed` only, fall back to any `done`-category transition —
  // some workflows only expose one terminal state ("Done" / "Resolved"
  // / "Abandoned") and refusing the transition would be more disruptive
  // than picking something reasonable. Sorted via `rankTransitions` so
  // the choice is deterministic across API responses.
  //
  // We deliberately do NOT fall back for `wont_fix`: silently picking a
  // `closed`-style state (whose name doesn't match the wont-fix
  // patterns) would tell the rule engine "transition succeeded to
  // wont_fix" while the ticket is actually in `closed`. The caller —
  // typically the rule engine — must be allowed to decide whether to
  // degrade (e.g. fall back to `closed`) or skip the action. Returning
  // null surfaces that decision.
  if (target === 'closed') {
    const allDone = transitions.filter((t) => t.to?.statusCategory?.key === 'done');
    if (allDone.length > 0) {
      const anyDone = rankTransitions(allDone, PREFERRED_STATE_NAMES[target])[0];
      logger.warn(
        'Jira transition fallback fired — no name-matched terminal state, using any `done`',
        {
          target,
          fallbackTransitionId: anyDone.id,
          fallbackTransitionName: anyDone.name,
          fallbackToName: anyDone.to?.name,
          availableTransitions: transitions.map((t) => ({
            id: t.id,
            name: t.name,
            toName: t.to?.name,
            toCategory: t.to?.statusCategory?.key,
          })),
        }
      );
      return anyDone;
    }
  }

  return null;
}
